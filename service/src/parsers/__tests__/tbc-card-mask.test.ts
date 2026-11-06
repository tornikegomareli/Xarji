import { test, expect } from "bun:test";
import { tbcParser } from "../tbc";
import type { RawMessage } from "../../db-reader";

function message(card: string, tail = "", senderId = "TBC SMS"): RawMessage {
  return {
    messageId: 1, senderId, timestamp: new Date("2026-01-01T12:34:56Z"),
    text: `47.80 GEL\n${card}\nSYNTHETIC SHOP\n01/01/2026\n${tail}`,
  };
}

for (const [card, digits] of [
  ["(*0000)", "0000"], ["(*000)", "000"], ["(*'0000')", "0000"],
  ["( *0000 )", "0000"], ["VISA (***0000)", "0000"],
  ["VISA (***'0000')", "0000"], ["VISA (****0000)", "0000"],
  ["VISA ***0000", "0000"],
]) {
  test(`TBC payment retains amount, merchant and suffix for ${card}`, () => {
    const raw = message(card);
    const tx = tbcParser.parse(raw);
    expect(tx?.transactionType).toBe("payment");
    expect(tx?.direction).toBe("out");
    expect(tx?.amount).toBe(47.8);
    expect(tx?.currency).toBe("GEL");
    expect(tx?.merchant).toBe("SYNTHETIC SHOP");
    expect(tx?.cardLastDigits).toBe(digits);
    expect(tx?.rawMessage).toBe(raw.text);
  });
}

for (const card of ["*0000", "(**0000)", "(*00)", "(*00000)", "(*00A0)", "(*0000", "*0000)", "(*'0000)", "(*0000')"]) {
  test(`TBC rejects an invalid single-star card boundary: ${card}`, () => {
    expect(tbcParser.parse(message(card))).toBeNull();
  });
}

test("a card mask without the existing amount/currency layout is not a payment", () => {
  for (const text of ["(*0000)\nSYNTHETIC SHOP", "47.80\n(*0000)\nSYNTHETIC SHOP", "47.80 GEL paid\n(*0000)\nSYNTHETIC SHOP", "47.80 USD was declined.\nInsufficient funds.\n(*'0000')"]) {
    expect(tbcParser.parse({ ...message("(*0000)"), text })).toBeNull();
  }
});

test("single-star card recognition also retains a reversal's incoming direction", () => {
  const raw = message("(*0000)");
  const tx = tbcParser.parse({ ...raw, text: `Ukugatareba:\n${raw.text}` });
  expect(tx?.transactionType).toBe("reversal");
  expect(tx?.direction).toBe("in");
  expect(tx?.amount).toBe(47.8);
  expect(tx?.merchant).toBe("SYNTHETIC SHOP");
});

test("the TBC alias accepts the same new mask", () => {
  expect(tbcParser.parse(message("(*0000)", "", "TBC"))?.cardLastDigits).toBe("0000");
});

test("ordinary merchant words containing PIN do not look like an OTP label", () => {
  for (const merchant of ["SYNTHETIC PIN SHOP", "SYNTHETIC SPINNER SHOP"]) {
    const raw = message("(*0000)");
    expect(tbcParser.parse({ ...raw, text: raw.text.replace("SYNTHETIC SHOP", merchant) })?.merchant).toBe(merchant);
  }
});

test("OTP bodies cannot become payments with either new or legacy masks", () => {
  const security = [
    "Sms Code:654321\nPlease check that you enter this code only on https://tbconline.ge or in mobilebank",
    "Your OTP is 654321", "ერთჯერადი კოდი: 654321", "PIN: 654321",
    "Verification code: 654321", "One-time password: 654321",
  ];
  for (const text of security) {
    expect(tbcParser.parse({ ...message("(*0000)"), text })).toBeNull();
    for (const card of ["(*0000)", "(***0000)"]) {
      expect(tbcParser.parse(message(card, text))).toBeNull();
      const raw = message(card);
      expect(tbcParser.parse({ ...raw, text: `${text}\n${raw.text}` })).toBeNull();
    }
  }
});
