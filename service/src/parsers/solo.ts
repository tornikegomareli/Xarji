/**
 * Bank of Georgia — Solo (sender id "SOLO").
 *
 * Handles:
 *   - გადახდა:                  — successful card purchase       → payment (out)
 *   - გადახდა ვერ შესრულდა:     — declined card purchase         → payment_failed (out)
 *   - ჩარიცხვა:                  — incoming money                 → transfer_in (in)
 *   - გასავალი:                  — outgoing transfer              → transfer_out (out)
 *   - სესხის დაფარვა:           — loan repayment                 → loan_repayment (out)
 *   - განაღდება:                — ATM cash withdrawal            → atm_withdrawal (out)
 *
 * Silently skipped (return null):
 *   - Debt overdue notices            (`…ვადაგადაცილებული დავალიანება…`)
 *   - Debt reminders                  (`სესხზე გერიცხებათ დავალიანება:`)
 *   - Upcoming-loan-payment reminders (`…მომდევნო თვეში გადასახდელია…`)
 *   - Self-transfer between own accts (`საკუთარ ანგარიშზე გადარიცხვა:`) —
 *     these just shuffle money between the user's own accounts and would
 *     double-count if treated as spending or income.
 */

import type { RawMessage } from "../db-reader";
import type { BankParser, Transaction, TransactionKind, TransactionStatus } from "./types";
import { directionOf } from "./types";
import { generateTransactionId, parseFlexibleAmount, parseDateDotted, mergeDateAndTime } from "./shared";

const BANK_KEY = "SOLO";

// Card purchase
const RE_PAYMENT_AMOUNT = /გადახდა:\s*([A-Z]{3})([\d,]+\.?\d*)/;
// Failed payment
const RE_BALANCE = /ნაშთი:\s*([A-Z]{3})([\d,]+\.?\d*)/;
const RE_FAIL_REASON = /მიზეზი:\s*(.+)/;
// Card line
const RE_CARD = /Card:\*{3}(\d+)/;
// Plus points
const RE_PLUS_EARNED = /დაგერიცხებათ:\s*([\d,]+\.?\d*)\s*PLUS/;
const RE_PLUS_TOTAL = /სულ:\s*([\d,]+\.?\d*)\s*PLUS/;
// Incoming: "ჩარიცხვა: GEL1.00"
const RE_INCOMING_AMOUNT = /ჩარიცხვა:\s*([A-Z]{3})([\d,]+\.?\d*)/;
// Outgoing transfer: "გასავალი: GEL100.00"
const RE_OUTGOING_AMOUNT = /გასავალი:\s*([A-Z]{3})([\d,]+\.?\d*)/;
// Loan repayment: "სესხის დაფარვა: 1.00 GEL"
const RE_LOAN_AMOUNT = /სესხის დაფარვა:\s*([\d,]+\.?\d*)\s*([A-Z]{3})/;
// Loan remaining: "დარჩენილი მიმდინარე გადასახადი: 661.79 GEL"
const RE_LOAN_REMAINING = /დარჩენილი მიმდინარე გადასახადი:\s*([\d,]+\.?\d*)\s*([A-Z]{3})/;
// Loan identifier: "სესხი: სამომხმარებლო სესხი, 11282592"
const RE_LOAN_LABEL = /სესხი:\s*(.+)/;
// IBAN-like account line (signals transfer/incoming context)
const RE_IBAN = /^\s*GE\d{2}\*{3}\w+\s*$/m;
// ATM cash withdrawal: "განაღდება: GEL1,000.00"
const RE_ATM_AMOUNT = /განაღდება:\s*([A-Z]{3})([\d,]+\.?\d*)/;

interface DetectedKind {
  kind: TransactionKind;
  status: TransactionStatus;
}

function detect(text: string): DetectedKind | null {
  // Notification-only messages — always skip.
  if (text.includes("ვადაგადაცილებული დავალიანება")) return null;
  if (/სესხზე გერიცხებათ დავალიანება:/.test(text)) return null;
  if (/მომდევნო თვეში გადასახდელია/.test(text)) return null;
  // Self-transfer — real movement but between user's own accounts,
  // would double-count if treated as income or spending. Skip.
  if (/საკუთარ ანგარიშზე გადარიცხვა:/.test(text)) return null;

  if (text.includes("გადახდა ვერ შესრულდა")) {
    return { kind: "payment_failed", status: "failed" };
  }
  if (RE_PAYMENT_AMOUNT.test(text)) {
    return { kind: "payment", status: "success" };
  }
  if (RE_INCOMING_AMOUNT.test(text)) {
    return { kind: "transfer_in", status: "success" };
  }
  if (RE_OUTGOING_AMOUNT.test(text)) {
    return { kind: "transfer_out", status: "success" };
  }
  if (RE_LOAN_AMOUNT.test(text)) {
    return { kind: "loan_repayment", status: "success" };
  }
  if (RE_ATM_AMOUNT.test(text)) {
    return { kind: "atm_withdrawal", status: "success" };
  }
  return null;
}

/**
 * For a card purchase message, pull the merchant name from the lines between
 * the Card:*** line and the PLUS/date terminators.
 */
function parsePaymentMerchant(text: string): string | null {
  const lines = text.trim().split("\n");
  let cardLineIdx: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (RE_CARD.test(lines[i])) {
      cardLineIdx = i;
      break;
    }
  }
  if (cardLineIdx === null || cardLineIdx >= lines.length - 1) return null;

  const out: string[] = [];
  for (let i = cardLineIdx + 1; i < lines.length; i++) {
    let line = lines[i].trim();
    line = line.replace(/[\x00-\x1F\x7F-\x9F]+.*$/, "").trim();
    if (/\d{2}\.\d{2}\.\d{4}/.test(line)) break;
    if (line.includes("PLUS")) break;
    if (line.includes("დაგერიცხებათ")) break;
    if (line.includes("სულ:")) break;
    if (line) out.push(line);
  }
  return out.length > 0 ? out.join(" ") : null;
}

/**
 * For ჩარიცხვა: merchant/counterparty is the sender name.
 * Layout:
 *   ჩარიცხვა: GEL1.00
 *   GE72***7257GEL
 *   თოხაძე ელენე        ← counterparty
 *   20.04.2026
 *
 * Not every incoming SMS has a name line (e.g. salary deposits arrive from
 * a company name, from an IBAN with no printable name, etc.), so this may
 * return null.
 */
function parseIncomingCounterparty(text: string): string | null {
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.replace(/[\x00-\x1F\x7F-\x9F]+.*$/, "").trim())
    .filter(Boolean);

  const amountIdx = lines.findIndex((l) => RE_INCOMING_AMOUNT.test(l));
  if (amountIdx === -1) return null;

  // Walk forward past the IBAN line (if present) and return the first
  // non-date, non-IBAN line. Stop at the date.
  for (let i = amountIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(line)) return null;
    if (RE_IBAN.test(line)) continue;
    return line;
  }
  return null;
}

function parsePlus(text: string): { earned: number | null; total: number | null } {
  const earned = text.match(RE_PLUS_EARNED);
  const total = text.match(RE_PLUS_TOTAL);
  return {
    earned: earned ? parseFlexibleAmount(earned[1]) : null,
    total: total ? parseFlexibleAmount(total[1]) : null,
  };
}

function parseCard(text: string): string | null {
  const m = text.match(RE_CARD);
  return m ? m[1] : null;
}

function parse(raw: RawMessage): Transaction | null {
  const text = raw.text;
  const detected = detect(text);
  if (!detected) return null;

  let amount: number | null = null;
  let currency = "GEL";
  let balance: number | null = null;
  let failureReason: string | null = null;
  let merchant: string | null = null;
  let counterparty: string | null = null;

  switch (detected.kind) {
    case "payment": {
      const m = text.match(RE_PAYMENT_AMOUNT);
      if (!m) return null;
      currency = m[1];
      amount = parseFlexibleAmount(m[2]);
      merchant = parsePaymentMerchant(text);
      break;
    }
    case "payment_failed": {
      const reason = text.match(RE_FAIL_REASON);
      if (reason) failureReason = reason[1].trim();
      const bal = text.match(RE_BALANCE);
      if (bal) {
        currency = bal[1];
        balance = parseFlexibleAmount(bal[2]);
      }
      merchant = parsePaymentMerchant(text);
      break;
    }
    case "transfer_in": {
      const m = text.match(RE_INCOMING_AMOUNT);
      if (!m) return null;
      currency = m[1];
      amount = parseFlexibleAmount(m[2]);
      counterparty = parseIncomingCounterparty(text);
      merchant = counterparty;
      break;
    }
    case "transfer_out": {
      const m = text.match(RE_OUTGOING_AMOUNT);
      if (!m) return null;
      currency = m[1];
      amount = parseFlexibleAmount(m[2]);
      // SOLO `გასავალი:` SMS carries an IBAN but typically no recipient
      // name. Use a stable generic label so the dashboard doesn't render "—".
      merchant = "Transfer";
      break;
    }
    case "loan_repayment": {
      const m = text.match(RE_LOAN_AMOUNT);
      if (!m) return null;
      amount = parseFlexibleAmount(m[1]);
      currency = m[2];
      // Keep the raw loan label as counterparty detail; present a clean,
      // stable merchant name for UI / top-merchant aggregation.
      const loan = text.match(RE_LOAN_LABEL);
      if (loan) counterparty = loan[1].trim();
      merchant = "Loan repayment";
      const remaining = text.match(RE_LOAN_REMAINING);
      if (remaining) balance = parseFlexibleAmount(remaining[1]);
      break;
    }
    case "atm_withdrawal": {
      const m = text.match(RE_ATM_AMOUNT);
      if (!m) return null;
      currency = m[1];
      amount = parseFlexibleAmount(m[2]);
      merchant = "ATM";
      break;
    }
    default:
      return null;
  }

  if (amount === null && detected.status === "success") return null;

  const plus = parsePlus(text);

  return {
    id: generateTransactionId(raw.messageId, text),
    messageId: raw.messageId,
    bankKey: BANK_KEY,
    bankSenderId: raw.senderId,
    transactionType: detected.kind,
    status: detected.status,
    direction: directionOf(detected.kind),
    amount,
    currency,
    merchant,
    cardLastDigits: parseCard(text),
    transactionDate: (() => {
      const ymd = parseDateDotted(text);
      return ymd ? mergeDateAndTime(ymd, raw.timestamp) : raw.timestamp;
    })(),
    messageTimestamp: raw.timestamp,
    rawMessage: text,
    failureReason,
    balance,
    plusEarned: plus.earned,
    plusTotal: plus.total,
    counterparty,
  };
}

export const soloParser: BankParser = {
  bankKey: BANK_KEY,
  senderIds: ["SOLO"],
  parse,
};
