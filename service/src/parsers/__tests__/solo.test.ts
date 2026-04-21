import { describe, test, expect } from "bun:test";
import { soloParser } from "../solo";
import type { RawMessage } from "../../db-reader";

function mk(messageId: number, text: string): RawMessage {
  return {
    messageId,
    text,
    timestamp: new Date("2026-04-21T12:00:00Z"),
    senderId: "SOLO",
  };
}

describe("SOLO parser — registration", () => {
  test("registered for SOLO sender id", () => {
    expect(soloParser.senderIds).toContain("SOLO");
  });
  test("bank key is SOLO", () => {
    expect(soloParser.bankKey).toBe("SOLO");
  });
});

describe("SOLO parser — card purchase (გადახდა:)", () => {
  const text = [
    "გადახდა: GEL7.00",
    "Card:***4896",
    "nona Turmanidze",
    "დაგერიცხებათ: 15.75 PLUS",
    "სულ: 18,240.35 PLUS",
    "31.12.2025",
  ].join("\n");

  const tx = soloParser.parse(mk(100, text))!;

  test("parses a successful payment", () => {
    expect(tx).not.toBeNull();
    expect(tx.transactionType).toBe("payment");
    expect(tx.status).toBe("success");
    expect(tx.direction).toBe("out");
  });
  test("extracts amount and currency", () => {
    expect(tx.amount).toBe(7);
    expect(tx.currency).toBe("GEL");
  });
  test("extracts card last digits", () => {
    expect(tx.cardLastDigits).toBe("4896");
  });
  test("extracts merchant name", () => {
    expect(tx.merchant).toBe("nona Turmanidze");
  });
  test("extracts plus points earned and total", () => {
    expect(tx.plusEarned).toBe(15.75);
    expect(tx.plusTotal).toBe(18240.35);
  });
  test("extracts transaction date from the SMS body (not the SMS timestamp)", () => {
    expect(tx.transactionDate.getFullYear()).toBe(2025);
    expect(tx.transactionDate.getMonth()).toBe(11); // December
    expect(tx.transactionDate.getDate()).toBe(31);
  });
  test("preserves time-of-day from the SMS arrival timestamp (date wins, time wins)", () => {
    // mk() sets arrival to 2026-04-21T12:00:00Z. Even though the SMS body
    // says 31.12.2025, the time component comes from the arrival.
    const arrived = new Date("2026-04-21T12:00:00Z");
    expect(tx.transactionDate.getHours()).toBe(arrived.getHours());
    expect(tx.transactionDate.getMinutes()).toBe(arrived.getMinutes());
  });

  test("handles USD amounts", () => {
    const usd = [
      "გადახდა: USD17.99",
      "Card:***4896",
      "APPLE.COM/BILL>CORK IE",
      "19.04.2026",
    ].join("\n");
    const t = soloParser.parse(mk(200, usd))!;
    expect(t.currency).toBe("USD");
    expect(t.amount).toBe(17.99);
    expect(t.merchant).toBe("APPLE.COM/BILL>CORK IE");
  });
});

describe("SOLO parser — failed payment (გადახდა ვერ შესრულდა)", () => {
  const text = [
    "გადახდა ვერ შესრულდა: GEL14.00",
    "მიზეზი: არასაკმარისი თანხა",
    "ნაშთი: GEL0.00",
    "Card:***5650",
    "GOOGLE *Minecraft Drea>g.co/HelpPay US",
  ].join("\n");

  const tx = soloParser.parse(mk(100, text))!;

  test("marks as failed payment", () => {
    expect(tx.transactionType).toBe("payment_failed");
    expect(tx.status).toBe("failed");
    expect(tx.direction).toBe("out");
  });
  test("captures failure reason", () => {
    expect(tx.failureReason).toBe("არასაკმარისი თანხა");
  });
  test("captures balance at time of failure", () => {
    expect(tx.balance).toBe(0);
    expect(tx.currency).toBe("GEL");
  });
  test("captures merchant even for failed attempts", () => {
    expect(tx.merchant).toBe("GOOGLE *Minecraft Drea>g.co/HelpPay US");
    expect(tx.cardLastDigits).toBe("5650");
  });

  test("handles failed payment with no amount on first line", () => {
    const t = soloParser.parse(
      mk(
        101,
        ["გადახდა ვერ შესრულდა", "მიზეზი: არასაკმარისი თანხა", "ნაშთი: GEL0.00", "Card:***4896", "Wolt"].join("\n")
      )
    )!;
    expect(t).not.toBeNull();
    expect(t.status).toBe("failed");
    expect(t.merchant).toBe("Wolt");
  });
});

describe("SOLO parser — incoming (ჩარიცხვა:)", () => {
  test("with a counterparty name", () => {
    const tx = soloParser.parse(
      mk(300, ["ჩარიცხვა: GEL1.00", "GE72***7257GEL", "თოხაძე ელენე", "20.04.2026"].join("\n"))
    )!;
    expect(tx.transactionType).toBe("transfer_in");
    expect(tx.direction).toBe("in");
    expect(tx.status).toBe("success");
    expect(tx.amount).toBe(1);
    expect(tx.counterparty).toBe("თოხაძე ელენე");
    expect(tx.merchant).toBe("თოხაძე ელენე");
  });

  test("when only IBAN + date present (no name)", () => {
    const tx = soloParser.parse(
      mk(301, ["ჩარიცხვა: GEL500.00", "GE72***7257GEL", "15.04.2026"].join("\n"))
    )!;
    expect(tx.transactionType).toBe("transfer_in");
    expect(tx.direction).toBe("in");
    expect(tx.counterparty).toBeNull();
  });
});

describe("SOLO parser — outgoing transfer (გასავალი:)", () => {
  const tx = soloParser.parse(
    mk(400, ["გასავალი: GEL100.00", "GE72***7257GEL", "31.12.2025"].join("\n"))
  )!;

  test("classified as outgoing transfer", () => {
    expect(tx.transactionType).toBe("transfer_out");
    expect(tx.direction).toBe("out");
    expect(tx.status).toBe("success");
    expect(tx.amount).toBe(100);
  });
  test("merchant falls back to stable 'Transfer' label", () => {
    expect(tx.merchant).toBe("Transfer");
  });
});

describe("SOLO parser — loan repayment (სესხის დაფარვა:)", () => {
  const tx = soloParser.parse(
    mk(
      500,
      [
        "სესხის დაფარვა: 1.00 GEL",
        "სესხი: სამომხმარებლო სესხი, 11282592",
        "დარჩენილი მიმდინარე გადასახადი: 661.79 GEL",
        "20.04.2026",
      ].join("\n")
    )
  )!;

  test("classified as loan repayment, outgoing", () => {
    expect(tx.transactionType).toBe("loan_repayment");
    expect(tx.direction).toBe("out");
  });
  test("amount uses comma/decimal correctly", () => {
    expect(tx.amount).toBe(1);
    expect(tx.currency).toBe("GEL");
  });
  test("merchant is the stable label, loan detail goes to counterparty", () => {
    expect(tx.merchant).toBe("Loan repayment");
    expect(tx.counterparty).toBe("სამომხმარებლო სესხი, 11282592");
  });
  test("remaining balance captured", () => {
    expect(tx.balance).toBe(661.79);
  });
});

describe("SOLO parser — ATM withdrawal (განაღდება:)", () => {
  const tx = soloParser.parse(
    mk(600, ["განაღდება: GEL1,000.00", "Card:***4896", "30.12.2025"].join("\n"))
  )!;

  test("classified as ATM withdrawal, outgoing", () => {
    expect(tx.transactionType).toBe("atm_withdrawal");
    expect(tx.direction).toBe("out");
  });
  test("amount parses with thousands separator", () => {
    expect(tx.amount).toBe(1000);
  });
  test("merchant is stable 'ATM'", () => {
    expect(tx.merchant).toBe("ATM");
  });
  test("card digits captured", () => {
    expect(tx.cardLastDigits).toBe("4896");
  });
});

describe("SOLO parser — silently skipped messages", () => {
  test("debt overdue notice returns null", () => {
    const r = soloParser.parse(
      mk(
        700,
        "თორნიკე, რადგან ვერ დაგიკავშირდით გაცნობებთ, რომ გერიცხებათ ვადაგადაცილებული დავალიანება 4838.25 ლარი"
      )
    );
    expect(r).toBeNull();
  });

  test("loan-due reminder returns null", () => {
    const r = soloParser.parse(
      mk(701, "თორნიკე, სესხზე გერიცხებათ დავალიანება: 4,733.80 GEL. საჭიროა თანხის დაფარვა.")
    );
    expect(r).toBeNull();
  });

  test("upcoming-payment reminder returns null", () => {
    const r = soloParser.parse(
      mk(702, "თორნიკე, შეგახსენებთ, რომ თქვენს სესხ(ებ)ზე მომდევნო თვეში გადასახდელია 4299.24 ლარი.")
    );
    expect(r).toBeNull();
  });

  test("self-transfer between own accounts returns null (avoids double-counting)", () => {
    const r = soloParser.parse(
      mk(
        703,
        "საკუთარ ანგარიშზე გადარიცხვა: GEL12,026.00 GE60***6616GEL-დან GE72***7257GEL-ზე ნაშთი: GEL100.00"
      )
    );
    expect(r).toBeNull();
  });

  test("unrecognised plain text returns null", () => {
    expect(soloParser.parse(mk(704, "random unrelated text"))).toBeNull();
  });
});

describe("SOLO parser — invariants", () => {
  test("bankKey and bankSenderId always set", () => {
    const tx = soloParser.parse(
      mk(800, ["გადახდა: GEL1.00", "Card:***1234", "X", "01.01.2026"].join("\n"))
    )!;
    expect(tx.bankKey).toBe("SOLO");
    expect(tx.bankSenderId).toBe("SOLO");
  });
  test("id is stable + starts with messageId", () => {
    const text = ["გადახდა: GEL1.00", "Card:***1234", "X", "01.01.2026"].join("\n");
    const a = soloParser.parse(mk(42, text))!;
    const b = soloParser.parse(mk(42, text))!;
    expect(a.id).toBe(b.id);
    expect(a.id).toStartWith("42-");
  });
});
