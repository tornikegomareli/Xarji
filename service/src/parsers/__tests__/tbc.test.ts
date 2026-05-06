import { describe, test, expect } from "bun:test";
import { tbcParser } from "../tbc";
import type { RawMessage } from "../../db-reader";

function mk(messageId: number, text: string): RawMessage {
  return {
    messageId,
    text,
    timestamp: new Date("2026-04-21T12:00:00Z"),
    senderId: "TBC SMS",
  };
}

// ── Registration ───────────────────────────────────────────────────────────

describe("TBC parser — registration", () => {
  test("registered for real 'TBC SMS' sender id", () => {
    expect(tbcParser.senderIds).toContain("TBC SMS");
  });
  test("also accepts 'TBC' alias", () => {
    expect(tbcParser.senderIds).toContain("TBC");
  });
  test("bank key is TBC", () => {
    expect(tbcParser.bankKey).toBe("TBC");
  });
});

// ── Full loan repayment ────────────────────────────────────────────────────
// Real format: "სESxis dAFARVa: NNN GEL\nLoan name\nANGaRiShIdaN: accountName\nსESxis ნAshTi: NNN GEL\nDATE"

describe("TBC parser — full loan repayment (სESxis dAFARVa:)", () => {
  const tx = tbcParser.parse(
    mk(
      100,
      [
        "\u10E1\u10D4\u10E1\u10EE\u10D8\u10E1 \u10D3\u10D0\u10E4\u10D0\u10E0\u10D5\u10D0: 13345,29 GEL",
        "GanvAdeba",
        "\u10D0\u10DC\u10D2\u10D0\u10E0\u10D8\u10E8\u10D8\u10D3\u10D0\u10DC: Expired deposits account",
        "\u10E1\u10D4\u10E1\u10EE\u10D8\u10E1 \u10DC\u10D0\u10E8\u10D7\u10D8: 0 GEL",
        "20/04/2026",
      ].join("\n")
    )
  )!;

  test("classified as loan repayment outgoing", () => {
    expect(tx.transactionType).toBe("loan_repayment");
    expect(tx.direction).toBe("out");
    expect(tx.status).toBe("success");
  });
  test("handles European comma decimal", () => {
    expect(tx.amount).toBe(13345.29);
    expect(tx.currency).toBe("GEL");
  });
  test("merchant is stable 'Loan repayment', counterparty is the source account", () => {
    expect(tx.merchant).toBe("Loan repayment");
    expect(tx.counterparty).toBe("Expired deposits account");
  });
  test("captures remaining loan balance", () => {
    expect(tx.balance).toBe(0);
  });
  test("parses slashed date DD/MM/YYYY", () => {
    expect(tx.transactionDate.getFullYear()).toBe(2026);
    expect(tx.transactionDate.getMonth()).toBe(3);
    expect(tx.transactionDate.getDate()).toBe(20);
  });
});

// ── Outgoing transfer ──────────────────────────────────────────────────────

describe("TBC parser — outgoing transfer (გAdaRicxVa:)", () => {
  const tx = tbcParser.parse(
    mk(
      200,
      [
        "\u10D2\u10D0\u10D3\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0:",
        "26.00 GEL",
        "VISA GOLD",
        "20/04/2026",
      ].join("\n")
    )
  )!;

  test("classified as transfer_out", () => {
    expect(tx.transactionType).toBe("transfer_out");
    expect(tx.direction).toBe("out");
    expect(tx.amount).toBe(26);
    expect(tx.currency).toBe("GEL");
  });
  test("merchant falls back to 'Transfer' when no counterparty after date", () => {
    expect(tx.merchant).toBe("Transfer");
    expect(tx.counterparty).toBeNull();
  });

  test("transfer with named counterparty", () => {
    const t = tbcParser.parse(
      mk(
        201,
        [
          "\u10D2\u10D0\u10D3\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0:",
          "50.00 GEL",
          "VISA GOLD",
          "24/04/2026",
          "LUKA MAISURADZE",
        ].join("\n")
      )
    )!;
    expect(t.transactionType).toBe("transfer_out");
    expect(t.counterparty).toBe("LUKA MAISURADZE");
    expect(t.merchant).toBe("LUKA MAISURADZE");
  });
});

// ── Declined card payment ──────────────────────────────────────────────────

describe("TBC parser — declined card payment (sabarate operacia … uarYofiliA)", () => {
  const tx = tbcParser.parse(
    mk(
      300,
      [
        "!\u10E1\u10D0\u10D1\u10D0\u10E0\u10D0\u10D7\u10D4 \u10DD\u10DE\u10D4\u10E0\u10D0\u10EA\u10D8\u10D0 9.99 USD \u10E3\u10D0\u10E0\u10E7\u10DD\u10E4\u10D8\u10DA\u10D8\u10D0. ",
        "\u10DB\u10D8\u10D6\u10D4\u10D6\u10D8: baratit sargebloba shezgudulia.",
        "SPACE DIGITAL CARD (***'5312') ",
        "10/09/2025",
        "APPLE.COM/BILL",
      ].join("\n")
    )
  )!;

  test("classified as failed payment", () => {
    expect(tx.transactionType).toBe("payment_failed");
    expect(tx.status).toBe("failed");
    expect(tx.direction).toBe("out");
  });
  test("amount and foreign currency", () => {
    expect(tx.amount).toBe(9.99);
    expect(tx.currency).toBe("USD");
  });
  test("captures failure reason (text after the Georgian label)", () => {
    expect(tx.failureReason).toBe("baratit sargebloba shezgudulia.");
  });
  test("captures card last digits from parenthesised format", () => {
    expect(tx.cardLastDigits).toBe("5312");
  });
  test("merchant taken from line after date", () => {
    expect(tx.merchant).toBe("APPLE.COM/BILL");
  });
});

// ── Successful card payment ────────────────────────────────────────────────

describe("TBC parser — successful card payment", () => {
  const tx = tbcParser.parse(
    mk(
      350,
      [
        "20.00 GEL",
        "VISA GOLD (***0792)",
        "BIRD APP* PRELOAD",
        "11/05/2024 14:29:45",
        "\u10DC\u10D0\u10E8\u10D7\u10D8: 2895.84 GEL",
      ].join("\n")
    )
  )!;

  test("classified as payment", () => {
    expect(tx.transactionType).toBe("payment");
    expect(tx.status).toBe("success");
    expect(tx.direction).toBe("out");
  });
  test("extracts amount, currency, card digits and merchant", () => {
    expect(tx.amount).toBe(20);
    expect(tx.currency).toBe("GEL");
    expect(tx.cardLastDigits).toBe("0792");
    expect(tx.merchant).toBe("BIRD APP* PRELOAD");
  });
  test("extracts balance from ნAshTi: line", () => {
    expect(tx.balance).toBe(2895.84);
  });

  test("ERTGULI PLATINUM format with cashback tail lines", () => {
    const t = tbcParser.parse(
      mk(
        351,
        [
          "9.90 GEL",
          "ERTGULI VISA PLATINUM (***6582)",
          "NIKORA",
          "23/04/2026 19:02:15",
          "\u10DC\u10D0\u10E8\u10D7\u10D8: 43.79 GEL",
          "\u10D3\u10D0\u10D2\u10D8\u10D1\u10E0\u10E3\u10DC\u10D3\u10D0 0.20 GEL",
        ].join("\n")
      )
    )!;
    expect(t.transactionType).toBe("payment");
    expect(t.amount).toBe(9.9);
    expect(t.cardLastDigits).toBe("6582");
    expect(t.merchant).toBe("NIKORA");
    expect(t.balance).toBe(43.79);
  });

  test("foreign currency payment (USD)", () => {
    const t = tbcParser.parse(
      mk(
        352,
        [
          "132.00 USD",
          "VISA GOLD (***3214)",
          "Ryanair Head Office",
          "24/04/2026 00:36:34",
          "\u10DC\u10D0\u10E8\u10D7\u10D8: 1208.38 GEL",
        ].join("\n")
      )
    )!;
    expect(t.transactionType).toBe("payment");
    expect(t.currency).toBe("USD");
    expect(t.amount).toBe(132);
    expect(t.merchant).toBe("Ryanair Head Office");
  });

  test("municipal transport tap — amount line starts with )", () => {
    const t = tbcParser.parse(
      mk(
        353,
        [
          ")1.00 GEL",
          "VISA GOLD (***0792)",
          "TBCTPBUS",
          "25/04/2024 21:13:52",
          " ",
          "\u10E8\u10D4\u10DC \u10D2\u10D0\u10D2\u10D8\u10D0\u10E5\u10E2\u10D8\u10E3\u10E0\u10D3\u10D0 90 \u10EC\u10E3\u10D7\u10D8\u10D0\u10DC\u10D8 transport",
        ].join("\n")
      )
    )!;
    expect(t.transactionType).toBe("payment");
    expect(t.amount).toBe(1);
    expect(t.currency).toBe("GEL");
    expect(t.cardLastDigits).toBe("0792");
    expect(t.merchant).toBe("TBCTPBUS");
  });
});

// ── Incoming transfer (ჩARicxVa:) ─────────────────────────────────────────

describe("TBC parser — incoming transfer (ჩARicxVa:)", () => {
  test("with counterparty line after date", () => {
    const tx = tbcParser.parse(
      mk(
        400,
        [
          "\u10E9\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0: 21448.00 GEL",
          "VISA GOLD",
          "20/04/2026",
          "LUKA MAISURADZE",
        ].join("\n")
      )
    )!;
    expect(tx.transactionType).toBe("transfer_in");
    expect(tx.direction).toBe("in");
    expect(tx.amount).toBe(21448);
    expect(tx.counterparty).toBe("LUKA MAISURADZE");
  });

  test("with trailing unicode replacement noise (TBC's \\uFFFD\\iI pattern)", () => {
    const tx = tbcParser.parse(
      mk(
        401,
        "\u10E9\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0: 21448.00 GEL\nVISA GOLD\n20/04/2026\nLUKA MAISURADZE\uFFFDiI "
      )
    )!;
    expect(tx.counterparty).toBe("LUKA MAISURADZE");
  });

  test("without any counterparty line", () => {
    const tx = tbcParser.parse(
      mk(
        402,
        "\u10E9\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0: 2250.00 GEL\nVISA GOLD\n02/04/2026"
      )
    )!;
    expect(tx.transactionType).toBe("transfer_in");
    expect(tx.direction).toBe("in");
    expect(tx.amount).toBe(2250);
    expect(tx.counterparty).toBeNull();
  });
});

// ── Reversal ───────────────────────────────────────────────────────────────

describe("TBC parser — reversal (უKUGatareba:)", () => {
  const tx = tbcParser.parse(
    mk(
      600,
      [
        "\u10E3\u10D9\u10E3\u10D2\u10D0\u10E2\u10D0\u10E0\u10D4\u10D1\u10D0:",
        "7.90 GEL",
        "VISA ERTGULI CLASSIC (***6531)",
        "BOLTTAXI",
        "02/02/2026 10:13:15",
        "\u10DC\u10D0\u10E8\u10D7\u10D8: 2864.48 GEL",
      ].join("\n")
    )
  )!;

  test("classified as reversal, direction in", () => {
    expect(tx.transactionType).toBe("reversal");
    expect(tx.direction).toBe("in");
    expect(tx.status).toBe("success");
  });
  test("extracts amount, currency, card, merchant", () => {
    expect(tx.amount).toBe(7.9);
    expect(tx.currency).toBe("GEL");
    expect(tx.cardLastDigits).toBe("6531");
    expect(tx.merchant).toBe("BOLTTAXI");
  });
  test("captures balance", () => {
    expect(tx.balance).toBe(2864.48);
  });

  test("BOLTFOOD reversal", () => {
    const t = tbcParser.parse(
      mk(
        601,
        [
          "\u10E3\u10D9\u10E3\u10D2\u10D0\u10E2\u10D0\u10E0\u10D4\u10D1\u10D0:",
          "54.62 GEL",
          "VISA ERTGULI CLASSIC (***6531)",
          "BOLTFOOD",
          "20/02/2026 19:32:28",
          "\u10DC\u10D0\u10E8\u10D7\u10D8: 2091.88 GEL",
        ].join("\n")
      )
    )!;
    expect(t.transactionType).toBe("reversal");
    expect(t.direction).toBe("in");
    expect(t.amount).toBe(54.62);
    expect(t.merchant).toBe("BOLTFOOD");
  });

  test("reversal on TBC Concept card", () => {
    const t = tbcParser.parse(
      mk(
        602,
        [
          "\u10E3\u10D9\u10E3\u10D2\u10D0\u10E2\u10D0\u10E0\u10D4\u10D1\u10D0:",
          "4.00 GEL",
          "TBC Concept MC World elite (***6109)",
          "jetshr",
          "22/04/2026 13:03:18",
          "\u10DC\u10D0\u10E8\u10D7\u10D8: 4.91 GEL",
        ].join("\n")
      )
    )!;
    expect(t.transactionType).toBe("reversal");
    expect(t.direction).toBe("in");
    expect(t.amount).toBe(4);
    expect(t.cardLastDigits).toBe("6109");
    expect(t.merchant).toBe("jetshr");
  });

  // Inline-shape reversal: a real-world SMS reported by the user where TBC
  // collapses header + amount + card + merchant + date + balance onto one
  // line. The line-anchored RE_CARD_AMOUNT misses this so detect() needs
  // RE_REVERSAL_INLINE to fire instead. The merchant extractor also takes
  // its inline branch (substring between ")" and the date).
  test("inline-shape reversal classified correctly", () => {
    const t = tbcParser.parse(
      mk(
        700,
        "\u10E3\u10D9\u10E3\u10D2\u10D0\u10E2\u10D0\u10E0\u10D4\u10D1\u10D0: 13.90 GEL TBC Concept 360 VISA Signature (***8058) BOLTTAXI 05/05/2026 17:25:01 \u10DC\u10D0\u10E8\u10D7\u10D8: 400.00 GEL"
      )
    )!;
    expect(t.transactionType).toBe("reversal");
    expect(t.direction).toBe("in");
    expect(t.status).toBe("success");
    expect(t.amount).toBe(13.9);
    expect(t.currency).toBe("GEL");
    expect(t.cardLastDigits).toBe("8058");
    expect(t.merchant).toBe("BOLTTAXI");
    expect(t.balance).toBe(400);
  });
});

// ── Self-transfers ─────────────────────────────────────────────────────────

describe("TBC parser — self-transfers (საKuTAr ANGaRiShebZe)", () => {
  test("GEL self-transfer returns null", () => {
    expect(
      tbcParser.parse(mk(700, "\u10E1\u10D0\u10D9\u10E3\u10D7\u10D0\u10E0 \u10D0\u10DC\u10D2\u10D0\u10E0\u10D8\u10E8\u10D4\u10D1\u10D6\u10D4 \u10D2\u10D0\u10D3\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0:\n1000.00 GEL\n02/02/2026"))
    ).toBeNull();
  });
  test("USD self-transfer returns null", () => {
    expect(
      tbcParser.parse(mk(701, "\u10E1\u10D0\u10D9\u10E3\u10D7\u10D0\u10E0 \u10D0\u10DC\u10D2\u10D0\u10E0\u10D8\u10E8\u10D4\u10D1\u10D6\u10D4 \u10D2\u10D0\u10D3\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0:\n74854.64 USD\n24/04/2026"))
    ).toBeNull();
  });
});

// ── Bill / utility payments ────────────────────────────────────────────────

describe("TBC parser — bill payment (გAdaXda:)", () => {
  test("TELMICO bill payment", () => {
    const tx = tbcParser.parse(
      mk(
        800,
        [
          "\u10D2\u10D0\u10D3\u10D0\u10EE\u10D3\u10D0:",
          "20.00 GEL ",
          "TELMICO",
          "ID:5802811",
          "\u10E8\u10D4\u10E5\u10DB\u10DC\u10D8\u10E1 \u10D7\u10D0\u10E0\u10D8\u10E6\u10D8: 24/04/2026 20:33:47",
        ].join("\n")
      )
    )!;
    expect(tx.transactionType).toBe("transfer_out");
    expect(tx.direction).toBe("out");
    expect(tx.amount).toBe(20);
    expect(tx.currency).toBe("GEL");
    expect(tx.merchant).toBe("TELMICO");
  });

  test("Tbilisi Energy bill payment", () => {
    const tx = tbcParser.parse(
      mk(
        801,
        [
          "\u10D2\u10D0\u10D3\u10D0\u10EE\u10D3\u10D0:",
          "50.00 GEL ",
          "Tbilisi Energy",
          "ID:548823371",
          "\u10E8\u10D4\u10E5\u10DB\u10DC\u10D8\u10E1 \u10D7\u10D0\u10E0\u10D8\u10E6\u10D8: 24/04/2026 20:33:47",
        ].join("\n")
      )
    )!;
    expect(tx.transactionType).toBe("transfer_out");
    expect(tx.amount).toBe(50);
    expect(tx.merchant).toBe("Tbilisi Energy");
  });
});

// ── Mobile top-ups ────────────────────────────────────────────────────────

describe("TBC parser — mobile top-up (მobIlURIs ShEvSeba:)", () => {
  test("Silknet top-up", () => {
    const tx = tbcParser.parse(
      mk(
        850,
        [
          "\u10DB\u10DD\u10D1\u10D8\u10DA\u10E3\u10E0\u10D8\u10E1 \u10E8\u10D4\u10D5\u10E1\u10D4\u10D1\u10D0:",
          "10.00 GEL ",
          "Silknet account",
          "ID:591300569",
          "\u10E8\u10D4\u10E5\u10DB\u10DC\u10D8\u10E1 \u10D7\u10D0\u10E0\u10D8\u10E6\u10D8: 24/04/2026 15:46:57",
        ].join("\n")
      )
    )!;
    expect(tx.transactionType).toBe("transfer_out");
    expect(tx.direction).toBe("out");
    expect(tx.amount).toBe(10);
    expect(tx.currency).toBe("GEL");
    expect(tx.merchant).toBe("Silknet account");
  });
});

// ── Scheduled auto-transfer ───────────────────────────────────────────────

describe("TBC parser — scheduled auto-transfer (AvtomATUri GAdaRicXVa)", () => {
  test("Geocell auto-transfer", () => {
    const tx = tbcParser.parse(
      mk(
        900,
        [
          "\u10D0\u10D5\u10E2\u10DD\u10DB\u10D0\u10E2\u10E3\u10E0\u10D8 \u10D2\u10D0\u10D3\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0",
          "5.00 GEL",
          "Geocell",
          "(N 591300569)",
          "01/12/2024",
        ].join("\n")
      )
    )!;
    expect(tx.transactionType).toBe("transfer_out");
    expect(tx.direction).toBe("out");
    expect(tx.amount).toBe(5);
    expect(tx.currency).toBe("GEL");
    expect(tx.merchant).toBe("Geocell");
  });
});

// ── Cash deposit (incoming) ───────────────────────────────────────────────

describe("TBC parser — cash deposit (naGDI fulis SheTaNa:)", () => {
  test("large GEL cash deposit", () => {
    const tx = tbcParser.parse(
      mk(
        950,
        [
          "\u10DC\u10D0\u10E6\u10D3\u10D8 \u10E4\u10E3\u10DA\u10D8\u10E1 \u10E8\u10D4\u10E2\u10D0\u10DC\u10D0:",
          "\u10D7\u10D0\u10DC\u10EE\u10D0: 55000.00 GEL",
          "\u10D0\u10DC\u10D2\u10D0\u10E0\u10D8\u10E8\u10D8: TBC CARD",
          "07/04/2026",
          "\u10D2\u10DB\u10D0\u10D3\u10DA\u10DD\u10D1\u10D7",
        ].join("\n")
      )
    )!;
    expect(tx.transactionType).toBe("deposit");
    expect(tx.direction).toBe("in");
    expect(tx.status).toBe("success");
    expect(tx.amount).toBe(55000);
    expect(tx.currency).toBe("GEL");
    expect(tx.merchant).toBe("Cash deposit");
  });
});

// ── ATM cash withdrawal ───────────────────────────────────────────────────

describe("TBC parser — ATM withdrawal (TaNXIs GaNaGdeba:)", () => {
  test("EUR ATM withdrawal", () => {
    const tx = tbcParser.parse(
      mk(
        1000,
        [
          "\u10D7\u10D0\u10DC\u10EE\u10D8\u10E1 \u10D2\u10D0\u10DC\u10D0\u10E6\u10D3\u10D4\u10D1\u10D0:",
          "11/02/2026",
          "\u10D7\u10D0\u10DC\u10EE\u10D0: 200.00 EUR ",
          "\u10D2\u10DB\u10D0\u10D3\u10DA\u10DD\u10D1\u10D7",
        ].join("\n")
      )
    )!;
    expect(tx.transactionType).toBe("atm_withdrawal");
    expect(tx.direction).toBe("out");
    expect(tx.amount).toBe(200);
    expect(tx.currency).toBe("EUR");
    expect(tx.merchant).toBe("ATM withdrawal");
  });

  test("USD ATM withdrawal", () => {
    const tx = tbcParser.parse(
      mk(
        1001,
        [
          "\u10D7\u10D0\u10DC\u10EE\u10D8\u10E1 \u10D2\u10D0\u10DC\u10D0\u10E6\u10D3\u10D4\u10D1\u10D0:",
          "23/10/2025",
          "\u10D7\u10D0\u10DC\u10EE\u10D0: 200.00 USD ",
          "\u10D2\u10DB\u10D0\u10D3\u10DA\u10DD\u10D1\u10D7",
        ].join("\n")
      )
    )!;
    expect(tx.transactionType).toBe("atm_withdrawal");
    expect(tx.amount).toBe(200);
    expect(tx.currency).toBe("USD");
  });
});

// ── Silently skipped ──────────────────────────────────────────────────────

describe("TBC parser — silently skipped messages", () => {
  test("OTP code returns null", () => {
    expect(tbcParser.parse(mk(500, "TBC SMS Code: 6700\nDartsmundi, rom kodi shegyavs: https://tbconline.ge"))).toBeNull();
  });
  test("marketing loyalty points notification returns null", () => {
    expect(tbcParser.parse(mk(501, "\u10DB\u10D8\u10EE\u10D4\u10D8\u10DA,  \u10D2\u10DA\u10DD\u10D5\u10DD-\u10E8\u10D8 \u10D2\u10D0\u10DC\u10EE\u10DD\u10E0\u10EA\u10D8\u10D4\u10DA\u10D4\u10D1\u10E3\u10DA \n18.26-\u10DA\u10D0\u10E0\u10D8\u10D0\u10DC \u10E8\u10D4\u10DC\u10D0\u10eb\u10D4\u10DC\u10D6\u10D4"))).toBeNull();
  });
  test("currency conversion returns null", () => {
    expect(tbcParser.parse(mk(502, "\u10D9\u10DD\u10DC\u10D5\u10D4\u10E0\u10E2\u10D0\u10EA\u10D8\u10D0:\n2540.80 GEL\n800.00 EUR\n\u10D9\u10E3\u10E0\u10E1\u10D8: 3.176\n24/04/2026"))).toBeNull();
  });
  test("fully irrelevant text returns null", () => {
    expect(tbcParser.parse(mk(503, "zzz"))).toBeNull();
  });
});

// ── Invariants ────────────────────────────────────────────────────────────

describe("TBC parser — invariants", () => {
  const tx = tbcParser.parse(
    mk(9000, "\u10E9\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0: 1.00 GEL\nVISA GOLD\n01/01/2026")
  )!;

  test("bankKey is TBC regardless of raw sender id", () => {
    expect(tx.bankKey).toBe("TBC");
  });
  test("bankSenderId reflects the raw sender id", () => {
    expect(tx.bankSenderId).toBe("TBC SMS");
  });
});

// ── Latin transliteration variants ───────────────────────────────────────
//
// All the existing fixtures above use Georgian script. Real production
// TBC SMS arrive in Latin transliteration — confirmed from a chat.db dump
// on 2026-05-05. Until this fix every SMS that depended on a header keyword
// (Charicxva, Gadaricxva, Ukugatareba, Mobiluris shevseba, Nashti, etc)
// silently fell off the dashboard because the parser only matched the
// Georgian-script forms. Card payments worked anyway because they don't
// need a header keyword (just `<amount> <currency>` + `(***NNNN)`).
//
// The fixtures below mirror real SMS the user was missing on their feed.

describe("TBC parser — Latin transliteration", () => {
  test("incoming transfer (Charicxva) classifies as transfer_in", () => {
    const tx = tbcParser.parse(
      mk(
        900,
        [
          "Charicxva: 12000.00 GEL",
          "Current",
          "05/05/2026",
        ].join("\n")
      )
    )!;
    expect(tx).not.toBeNull();
    expect(tx.transactionType).toBe("transfer_in");
    expect(tx.direction).toBe("in");
    expect(tx.amount).toBe(12000);
    expect(tx.currency).toBe("GEL");
  });

  test("outgoing transfer (Gadaricxva) classifies as transfer_out", () => {
    // Layout mirrors the existing Georgian "transfer with named
    // counterparty" test: header / amount / account-hint /
    // date / counterparty. parseCounterpartyAfterDate returns the
    // line AFTER the date, which is the counterparty (TBC CARD here
    // since the user's real SMS pays off a credit card from current).
    const tx = tbcParser.parse(
      mk(
        901,
        [
          "Gadaricxva:",
          "670.00 GEL",
          "VISA GOLD",
          "05/05/2026",
          "TBC CARD",
        ].join("\n")
      )
    )!;
    expect(tx).not.toBeNull();
    expect(tx.transactionType).toBe("transfer_out");
    expect(tx.direction).toBe("out");
    expect(tx.amount).toBe(670);
    expect(tx.currency).toBe("GEL");
    expect(tx.counterparty).toBe("TBC CARD");
    expect(tx.merchant).toBe("TBC CARD");
  });

  test("self-transfer (Sakutar angarishebze) is skipped", () => {
    const tx = tbcParser.parse(
      mk(
        902,
        "Sakutar angarishebze gadaricxva: 6357.00 GEL 05/05/2026"
      )
    );
    expect(tx).toBeNull();
  });

  test("mobile top-up (Mobiluris shevseba) classifies as transfer_out", () => {
    // Layout mirrors the existing Georgian-script Silknet fixture above:
    // header / amount / merchant / account-id / date. parseBillMerchant
    // returns lines[2] (the merchant).
    const tx = tbcParser.parse(
      mk(
        903,
        [
          "Mobiluris shevseba:",
          "10.00 GEL ",
          "Silknet account",
          "ID:577600243",
          "Sheqmnis tarigi: 05/05/2026 15:47:36",
        ].join("\n")
      )
    )!;
    expect(tx).not.toBeNull();
    expect(tx.transactionType).toBe("transfer_out");
    expect(tx.direction).toBe("out");
    expect(tx.amount).toBe(10);
    expect(tx.currency).toBe("GEL");
    expect(tx.merchant).toBe("Silknet account");
  });

  test("inline reversal (Ukugatareba) — user's actual May 2026 SMS", () => {
    // The exact SMS body the user reported on 2026-05-06: a refund that
    // was being mis-counted as outgoing spending because RE_REVERSAL only
    // matched Georgian "უკუგატარება:" — the Latin "Ukugatareba" header
    // fell through to the generic-card-payment branch.
    const tx = tbcParser.parse(
      mk(
        904,
        "Ukugatareba: 13.90 GEL TBC Concept 360 VISA Signature (***8058) BOLTTAXI 05/05/2026 17:25:01 nashti: 400.00 GEL"
      )
    )!;
    expect(tx).not.toBeNull();
    expect(tx.transactionType).toBe("reversal");
    expect(tx.direction).toBe("in");
    expect(tx.amount).toBe(13.9);
    expect(tx.currency).toBe("GEL");
    expect(tx.cardLastDigits).toBe("8058");
    expect(tx.merchant).toBe("BOLTTAXI");
    // Lowercase "nashti:" — the inline-reversal SMS uses lowercase here.
    expect(tx.balance).toBe(400);
  });

  test("multi-line reversal (Ukugatareba) classifies correctly", () => {
    const tx = tbcParser.parse(
      mk(
        905,
        [
          "Ukugatareba:",
          "13.90 GEL",
          "VISA SIGNATURE (***8058)",
          "BOLTTAXI",
          "05/05/2026 17:25:01",
          "Nashti: 400.00 GEL",
        ].join("\n")
      )
    )!;
    expect(tx).not.toBeNull();
    expect(tx.transactionType).toBe("reversal");
    expect(tx.direction).toBe("in");
    expect(tx.amount).toBe(13.9);
    expect(tx.balance).toBe(400);
  });

  test("ATM withdrawal (Tanxis ganagdeba) classifies as atm_withdrawal", () => {
    const tx = tbcParser.parse(
      mk(
        906,
        [
          "Tanxis ganagdeba:",
          "05/05/2026",
          "Tanxa: 500.00 GEL",
        ].join("\n")
      )
    )!;
    expect(tx).not.toBeNull();
    expect(tx.transactionType).toBe("atm_withdrawal");
    expect(tx.direction).toBe("out");
    expect(tx.amount).toBe(500);
    expect(tx.currency).toBe("GEL");
  });

  test("cash deposit (Naghdi pulis shetana) classifies as deposit", () => {
    const tx = tbcParser.parse(
      mk(
        907,
        [
          "Naghdi pulis shetana:",
          "Tanxa: 200.00 GEL",
          "05/05/2026",
        ].join("\n")
      )
    )!;
    expect(tx).not.toBeNull();
    expect(tx.transactionType).toBe("deposit");
    expect(tx.direction).toBe("in");
    expect(tx.amount).toBe(200);
  });

  test("scheduled auto-transfer (Avtomaturi gadaricxva)", () => {
    // 5-line layout mirroring the existing Georgian Geocell test:
    // header / amount / merchant / paren-info / date. parseBillMerchant
    // returns lines[2] (the merchant) for this shape.
    const tx = tbcParser.parse(
      mk(
        908,
        [
          "Avtomaturi gadaricxva",
          "50.00 GEL",
          "Geocell",
          "(N 591300569)",
          "05/05/2026",
        ].join("\n")
      )
    )!;
    expect(tx).not.toBeNull();
    expect(tx.transactionType).toBe("transfer_out");
    expect(tx.amount).toBe(50);
    expect(tx.merchant).toBe("Geocell");
  });

  test("bill payment (Gadakhda) classifies as transfer_out", () => {
    // 5-line layout mirroring the existing Georgian TELMICO test:
    // header / amount / merchant / ID:NNN / date. parseBillMerchant
    // returns lines[2] (the merchant).
    const tx = tbcParser.parse(
      mk(
        909,
        [
          "Gadakhda:",
          "75.00 GEL",
          "Magti",
          "ID:5802811",
          "Sheqmnis tarigi: 05/05/2026 12:00:00",
        ].join("\n")
      )
    )!;
    expect(tx).not.toBeNull();
    expect(tx.transactionType).toBe("transfer_out");
    expect(tx.amount).toBe(75);
    expect(tx.merchant).toBe("Magti");
  });

  test("failed card payment (Sabarate operacia ... uarYofiliA)", () => {
    // 5-line layout mirroring the existing Georgian declined-card test:
    // header (with amount + uarYofiliA) / Mizezi / card / date / merchant.
    // parseFailedMerchant returns the line AFTER the date, so the merchant
    // belongs there, not before it.
    const tx = tbcParser.parse(
      mk(
        910,
        [
          "!Sabarate operacia 100.00 GEL uarYofiliA.",
          "Mizezi: insufficient funds",
          "VISA GOLD (***'7940')",
          "05/05/2026",
          "MERCHANT.NAME",
        ].join("\n")
      )
    )!;
    expect(tx).not.toBeNull();
    expect(tx.transactionType).toBe("payment_failed");
    expect(tx.status).toBe("failed");
    expect(tx.amount).toBe(100);
    expect(tx.failureReason).toBe("insufficient funds");
    expect(tx.cardLastDigits).toBe("7940");
    expect(tx.merchant).toBe("MERCHANT.NAME");
  });

  test("loan repayment (Sesxis dapharva)", () => {
    const tx = tbcParser.parse(
      mk(
        911,
        [
          "Sesxis dapharva: 250.00 GEL",
          "Personal loan",
          "Angarishidan: Current",
          "Sesxis nashti: 1500.00 GEL",
          "05/05/2026",
        ].join("\n")
      )
    )!;
    expect(tx).not.toBeNull();
    expect(tx.transactionType).toBe("loan_repayment");
    expect(tx.direction).toBe("out");
    expect(tx.amount).toBe(250);
    expect(tx.balance).toBe(1500);
    expect(tx.counterparty).toBe("Current");
  });

  test("card payment with 'Nashti' balance (no header keyword needed)", () => {
    // This case worked before the fix because card-payment detection
    // doesn't require a header keyword. Test pinned here to make sure
    // nothing regresses — including that balance still extracts from
    // the Latin "Nashti:" form.
    const tx = tbcParser.parse(
      mk(
        912,
        [
          "46.82 GEL",
          "TBC Concept 360 MC World elite (***7940)",
          "Wolt",
          "06/05/2026 14:12:50",
          "Nashti: 4565.73 GEL",
        ].join("\n")
      )
    )!;
    expect(tx).not.toBeNull();
    expect(tx.transactionType).toBe("payment");
    expect(tx.amount).toBe(46.82);
    expect(tx.merchant).toBe("Wolt");
    expect(tx.balance).toBe(4565.73);
  });
});
