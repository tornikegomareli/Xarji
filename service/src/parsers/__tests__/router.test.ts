import { describe, test, expect } from "bun:test";
import { parseMessage, parseMessages, getParserForSender, allBanks } from "../index";
import type { RawMessage } from "../../db-reader";

function mk(senderId: string, text: string, messageId = 1): RawMessage {
  return { messageId, text, timestamp: new Date("2026-04-21T12:00:00Z"), senderId };
}

describe("parser registry", () => {
  test("exposes at least SOLO and TBC banks", () => {
    const keys = allBanks().map((b) => b.bankKey);
    expect(keys).toContain("SOLO");
    expect(keys).toContain("TBC");
  });

  test("getParserForSender dispatches SOLO by sender id", () => {
    expect(getParserForSender("SOLO")?.bankKey).toBe("SOLO");
  });

  test("getParserForSender dispatches TBC SMS to the TBC parser", () => {
    expect(getParserForSender("TBC SMS")?.bankKey).toBe("TBC");
  });

  test("getParserForSender returns null for unknown senders", () => {
    expect(getParserForSender("UNKNOWN SENDER")).toBeNull();
    expect(getParserForSender("")).toBeNull();
  });
});

describe("parseMessage router", () => {
  test("SOLO message routed through SOLO parser", () => {
    const tx = parseMessage(
      mk("SOLO", ["გადახდა: GEL1.00", "Card:***1234", "Shop", "01.01.2026"].join("\n"))
    )!;
    expect(tx.bankKey).toBe("SOLO");
    expect(tx.transactionType).toBe("payment");
  });

  test("TBC SMS message routed through TBC parser", () => {
    // \u10E9\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0 = ჩარიცხვა (incoming transfer)
    const tx = parseMessage(mk("TBC SMS", "\u10E9\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0: 1.00 GEL\nCurrent\n01/01/2026"))!;
    expect(tx.bankKey).toBe("TBC");
    expect(tx.transactionType).toBe("transfer_in");
  });

  test("unknown sender returns null (not misrouted)", () => {
    expect(parseMessage(mk("RANDOM", "გადახდა: GEL1.00"))).toBeNull();
  });

  test("recognised sender but unparseable content returns null", () => {
    expect(parseMessage(mk("SOLO", "some random non-transaction text"))).toBeNull();
  });
});

describe("parseMessages bulk", () => {
  const raws: RawMessage[] = [
    mk("SOLO", ["გადახდა: GEL5.00", "Card:***1111", "Shop1", "01.01.2026"].join("\n"), 1),
    mk("SOLO", "random noise", 2),
    mk("TBC SMS", "\u10E9\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0: 10.00 GEL\nCurrent\n01/01/2026", 3),
    mk("RANDOM", "anything", 4),
  ];
  const result = parseMessages(raws);

  test("parsed messages land in success array", () => {
    expect(result.success.length).toBe(2);
  });

  test("unparseable messages land in failed array", () => {
    expect(result.failed.length).toBe(2);
    expect(result.failed.map((m) => m.messageId).sort()).toEqual([2, 4]);
  });

  test("success set contains one SOLO + one TBC row", () => {
    const keys = result.success.map((t) => t.bankKey).sort();
    expect(keys).toEqual(["SOLO", "TBC"]);
  });
});
