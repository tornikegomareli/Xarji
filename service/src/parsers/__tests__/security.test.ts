import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MessagesDbReader } from "../../db-reader";
import { parseMessage, parseMessages } from "../index";
import { isSecurityMessage } from "../security";
import { tbcParser } from "../tbc";
import type { RawMessage } from "../../db-reader";

const payment = "47.80 GEL\nVISA (***0000)\nSYNTHETIC SHOP\n01/01/2026";
const mk = (text: string, senderId = "TBC SMS", messageId = 1): RawMessage => ({ text, senderId, messageId, timestamp: new Date("2026-01-01T12:00:00Z") });

test("shared guard recognises synthetic OTP formats and keeps ordinary merchant words", () => {
  for (const text of [
    "Sms Code:654321\nPlease check that you enter this code only on https://tbconline.ge or in mobilebank",
    "Your OTP is 654321", "ერთჯერადი კოდი: 654321", "ertjeradi kodi: 654321",
    "Verification code 654321", "PIN: 654321",
  ]) expect(isSecurityMessage(text)).toBe(true);
  expect(isSecurityMessage(payment)).toBe(false);
  expect(isSecurityMessage(`${payment}\nSPINNER SHOP`)).toBe(false);
});

test("cloud router skips mixed payment/OTP bodies for TBC and its alias", () => {
  const mixed = `${payment}\nSMS Code: 654321`;
  // A recognised payment must not reach sync just because the bank parser accepts it.
  expect(tbcParser.parse(mk(mixed))).not.toBeNull();
  for (const sender of ["TBC SMS", "TBC"]) {
    expect(parseMessage(mk(mixed, sender))).toBeNull();
    expect(parseMessage(mk(payment, sender))?.amount).toBe(47.8);
  }
});

test("cloud guard also runs before the SOLO bank parser", () => {
  const solo = "გადახდა: GEL47.80\nCard:***0000\nSYNTHETIC SHOP\n01.01.2026";
  expect(parseMessage(mk(solo, "SOLO"))?.amount).toBe(47.8);
  expect(parseMessage(mk(`${solo}\nერთჯერადი კოდი: 654321`, "SOLO"))).toBeNull();
});

test("cloud bulk result omits security SMS from both transactions and diagnostic failures", () => {
  const result = parseMessages([mk(payment, "TBC SMS", 1), mk("Your OTP is 654321", "TBC", 2), mk(`${payment}\nPIN: 654321`, "TBC SMS", 3), mk("ordinary unrecognised notice", "TBC SMS", 4)]);
  expect(result.success.map(row => row.messageId)).toEqual([1]);
  expect(result.failed.map(row => row.messageId)).toEqual([4]);
  expect(JSON.stringify(result)).not.toContain("654321");
});

test("cloud source checks the full archive before extraction can trim away an OTP", () => {
  const root = mkdtempSync(join(tmpdir(), "xarji-security-test-"));
  const path = join(root, "synthetic-chat.db");
  const db = new Database(path, { create: true });
  db.exec("CREATE TABLE handle(id TEXT); CREATE TABLE message(handle_id INTEGER,text TEXT,attributedBody BLOB,date INTEGER); INSERT INTO handle VALUES('TBC SMS');");
  const blob = (text: string) => Buffer.concat([Buffer.from("NSString +"), Buffer.from([text.length]), Buffer.from(text), Buffer.from("NSDictionary")]);
  const insert = db.query("INSERT INTO message VALUES(1,?,?,?)");
  insert.run(payment, null, 789004800000000000);
  insert.run(`${payment}\nSms Code:654321`, null, 789004800000000001);
  insert.run(null, blob(`${payment}\n01.01.2026\nSms Code:654321`), 789004800000000002);
  insert.run(payment, blob("Sms Code:654321"), 789004800000000003);
  insert.run(null, blob(payment), 789004800000000004);
  db.close();
  const reader = new MessagesDbReader(path);
  try {
    for (const messages of [reader.getMessagesBySender("TBC SMS", 20), reader.getMessagesSince("TBC SMS", 0, 20)]) {
      expect(messages.map(row => row.messageId).sort()).toEqual([1, 5]);
      expect(JSON.stringify(messages)).not.toContain("654321");
    }
  } finally { reader.close(); rmSync(root, { recursive: true, force: true }); }
});
