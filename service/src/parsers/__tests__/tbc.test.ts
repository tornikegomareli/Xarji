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

describe("TBC parser — registration", () => {
  test("registered for real 'TBC SMS' sender id (not 'TBC')", () => {
    expect(tbcParser.senderIds).toContain("TBC SMS");
  });
  test("also accepts 'TBC' as an alias for users who configured it manually", () => {
    expect(tbcParser.senderIds).toContain("TBC");
  });
  test("bank key is TBC", () => {
    expect(tbcParser.bankKey).toBe("TBC");
  });
});

describe("TBC parser — full loan repayment (Sesxis daparva:)", () => {
  const tx = tbcParser.parse(
    mk(
      100,
      [
        "Sesxis daparva: 13345,29 GEL",
        "Samomkhmareblo seskhi ",
        "Angarishidan: Expired deposits account ",
        "Sesxis nashti: 0 GEL",
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

describe("TBC parser — partial loan repayment (natsilobriv daifara)", () => {
  const tx = tbcParser.parse(
    mk(
      101,
      [
        "543 GEL -it natsilobriv daifara Samomkhmareblo seskhi angarishidan: Expired deposits account; davalianebis dasafarad sachiro tanxa:6794,32 GEL",
        "sesxis nashti: 12047,6 GEL",
        "02/04/2026",
      ].join("\n")
    )
  )!;

  test("classified as loan repayment", () => {
    expect(tx.transactionType).toBe("loan_repayment");
    expect(tx.direction).toBe("out");
  });
  test("extracts leading-amount format correctly", () => {
    expect(tx.amount).toBe(543);
    expect(tx.currency).toBe("GEL");
  });
  test("merchant stable, counterparty captures source account from inline angarishidan", () => {
    expect(tx.merchant).toBe("Loan repayment");
    expect(tx.counterparty).toBe("Expired deposits account");
  });
  test("remaining balance handles European comma", () => {
    expect(tx.balance).toBe(12047.6);
  });

  test("another partial with comma-decimal amount", () => {
    const t = tbcParser.parse(
      mk(
        102,
        [
          "1730,85 GEL -it natsilobriv daifara Samomkhmareblo seskhi angarishidan: Space Card; davalianebis dasafarad sachiro tanxa:8362,13 GEL",
          "sesxis nashti: 8026,03 GEL",
          "02/04/2026",
        ].join("\n")
      )
    )!;
    expect(t.amount).toBe(1730.85);
    expect(t.counterparty).toBe("Space Card");
    expect(t.balance).toBe(8026.03);
  });
});

describe("TBC parser — outgoing transfer (Gadaricxva:)", () => {
  const tx = tbcParser.parse(
    mk(200, ["Gadaricxva:", "26.00 GEL ", "Current", "20/04/2026"].join("\n"))
  )!;

  test("classified as transfer_out", () => {
    expect(tx.transactionType).toBe("transfer_out");
    expect(tx.direction).toBe("out");
    expect(tx.amount).toBe(26);
    expect(tx.currency).toBe("GEL");
  });
  test("merchant falls back to 'Transfer' when no destination in SMS", () => {
    expect(tx.merchant).toBe("Transfer");
    expect(tx.counterparty).toBeNull();
  });
});

describe("TBC parser — declined card payment (Sabarate operacia ... uarkofilia)", () => {
  const tx = tbcParser.parse(
    mk(
      300,
      [
        "Sabarate operacia 9.99 USD uarkofilia. ",
        "mizezi: baratit sargebloba shezgudulia.",
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
  test("captures failure reason", () => {
    expect(tx.failureReason).toBe("baratit sargebloba shezgudulia.");
  });
  test("captures card last digits from parenthesised format", () => {
    expect(tx.cardLastDigits).toBe("5312");
  });
  test("merchant taken from the last line after the date", () => {
    expect(tx.merchant).toBe("APPLE.COM/BILL");
  });
});

describe("TBC parser — incoming (Charicxva:)", () => {
  test("with counterparty line", () => {
    const tx = tbcParser.parse(
      mk(400, "Charicxva: 21448.00 GEL\nCurrent\n20/04/2026\nLUKA MAISURADZE")
    )!;
    expect(tx.transactionType).toBe("transfer_in");
    expect(tx.direction).toBe("in");
    expect(tx.amount).toBe(21448);
    expect(tx.counterparty).toBe("LUKA MAISURADZE");
  });

  test("with trailing unicode replacement noise (TBC's �iI pattern)", () => {
    const tx = tbcParser.parse(
      mk(401, "Charicxva: 21448.00 GEL\nCurrent\n20/04/2026\nLUKA MAISURADZE�iI ")
    )!;
    expect(tx.counterparty).toBe("LUKA MAISURADZE");
  });

  test("without any counterparty line", () => {
    const tx = tbcParser.parse(mk(402, "Charicxva: 2250.00 GEL\nCurrent\n02/04/2026"))!;
    expect(tx.transactionType).toBe("transfer_in");
    expect(tx.direction).toBe("in");
    expect(tx.amount).toBe(2250);
    expect(tx.counterparty).toBeNull();
  });
});

describe("TBC parser — silently skipped messages", () => {
  test("card-expiry notice returns null", () => {
    const r = tbcParser.parse(
      mk(500, "gatsnobebt, rom tkvens barats **2923 (DIGITAL CARD MC GOLD) vada ewureba 02/2026 tarigshi.")
    );
    expect(r).toBeNull();
  });
  test("SMS security code returns null", () => {
    const r = tbcParser.parse(mk(501, "TBC SMS Code: 6700\nDartsmundi, rom kodi shegyavs: https:/tbconline.ge"));
    expect(r).toBeNull();
  });
  test("password-change notice returns null", () => {
    const r = tbcParser.parse(
      mk(502, "Shens mobail/internet bankshi paroli sheicvala, tu qmedeba shen ar shegisrulebia")
    );
    expect(r).toBeNull();
  });
  test("fully irrelevant text returns null", () => {
    expect(tbcParser.parse(mk(503, "zzz"))).toBeNull();
  });
});

describe("TBC parser — invariants", () => {
  const tx = tbcParser.parse(mk(900, "Charicxva: 1.00 GEL\nCurrent\n01/01/2026"))!;

  test("bankKey is TBC regardless of raw sender id", () => {
    expect(tx.bankKey).toBe("TBC");
  });
  test("bankSenderId reflects the raw sender id we were given", () => {
    expect(tx.bankSenderId).toBe("TBC SMS");
  });
});
