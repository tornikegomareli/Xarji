/**
 * TBC Bank — pure Georgian parser (no transliteration).
 *
 * All patterns match Georgian Unicode directly. TBC sends SMS in Georgian
 * script (U+10D0–U+10FF); comments show the human-readable transliteration
 * beside each Unicode-escaped literal for readability.
 *
 * Handles:
 *   ჩარიცხვა:          incoming transfer     → transfer_in   (in)
 *   გAdaRicxVa:        outgoing transfer     → transfer_out  (out)
 *   სESxis dAFARVa:    loan repayment        → loan_repayment (out)
 *   sabarate operacia … uarYofiliA           → payment_failed (out)
 *   uKUGatareba:       card reversal         → reversal       (in)
 *   NNN CUR + card line + merchant           → payment        (out)
 *   გადახდა:           bill / utility pay   → transfer_out  (out)
 *   მobIlURIs ShEvSeba: mobile top-up        → transfer_out  (out)
 *   AvtomATUri GAdaRicXVa: scheduled auto   → transfer_out  (out)
 *   naGDI fulis SheTaNa: cash deposit        → deposit        (in)
 *   TaNXIs GaNaGdeba:  ATM cash withdrawal   → atm_withdrawal (out)
 *
 * Marketing / OTP / security / investment notifications return null.
 */

import type { RawMessage } from "../db-reader";
import type { BankParser, Transaction, TransactionKind, TransactionStatus } from "./types";
import { directionOf } from "./types";
import {
  generateTransactionId,
  parseFlexibleAmount,
  parseDateSlashed,
  stripTrailingNoise,
  mergeDateAndTime,
} from "./shared";

const BANK_KEY = "TBC";

// ── Self-transfer guard ────────────────────────────────────────────────────
// საკუთარ ანგარიშზე (own-account transfer) — skip entirely.
// U+10E1 U+10D0 U+10D9 U+10E3 U+10D7 U+10D0 U+10E0 = საKuTAr
// U+10D0 U+10DC U+10D2 U+10D0 U+10E0 U+10D8 U+10E8 U+10D4 U+10D1 U+10D6 U+10D4 = ANGaRiShebZe
const RE_SELF = /\u10E1\u10D0\u10D9\u10E3\u10D7\u10D0\u10E0 \u10D0\u10DC\u10D2\u10D0\u10E0\u10D8\u10E8\u10D4\u10D1\u10D6\u10D4/;

// ── Incoming transfer (ჩარიცხვა: NNN CUR) ─────────────────────────────────
// U+10E9 U+10D0 U+10E0 U+10D8 U+10EA U+10EE U+10D5 U+10D0 = ჩARicxVa
const RE_INCOMING = /\u10E9\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0:\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Outgoing transfer (გAdaRicxVa:\nNNN CUR) ──────────────────────────────
// U+10D2 U+10D0 U+10D3 U+10D0 U+10E0 U+10D8 U+10EA U+10EE U+10D5 U+10D0 = გAdaRicxVa
const RE_TRANSFER_OUT = /\u10D2\u10D0\u10D3\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0:\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Loan full repayment (სESxis dAFARVa: NNN CUR) ─────────────────────────
// U+10E1 U+10D4 U+10E1 U+10EE U+10D8 U+10E1 = სESxis
// U+10D3 U+10D0 U+10E4 U+10D0 U+10E0 U+10D5 U+10D0 = dAFARVa
const RE_LOAN = /\u10E1\u10D4\u10E1\u10EE\u10D8\u10E1 \u10D3\u10D0\u10E4\u10D0\u10E0\u10D5\u10D0:\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Failed card payment (sabarate operacia NNN CUR uarYofiliA) ────────────
// U+10E1 U+10D0 U+10D1 U+10D0 U+10E0 U+10D0 U+10D7 U+10D4 = sabarate
// U+10DD U+10DE U+10D4 U+10E0 U+10D0 U+10EA U+10D8 U+10D0 = operacia
// U+10E3 U+10D0 U+10E0 U+10E7 U+10DD U+10E4 U+10D8 U+10DA U+10D8 U+10D0 = uarYofiliA
const RE_FAILED = /\u10E1\u10D0\u10D1\u10D0\u10E0\u10D0\u10D7\u10D4 \u10DD\u10DE\u10D4\u10E0\u10D0\u10EA\u10D8\u10D0\s*([\d.,]+)\s*([A-Z]{3})\s*\u10E3\u10D0\u10E0\u10E7\u10DD\u10E4\u10D8\u10DA\u10D8\u10D0/i;

// ── Card reversal (uKUGatareba:\nNNN CUR\nCARD\nmerchant) ─────────────────
// U+10E3 U+10D9 U+10E3 U+10D2 U+10D0 U+10E2 U+10D0 U+10E0 U+10D4 U+10D1 U+10D0 = uKUGatareba
const RE_REVERSAL = /\u10E3\u10D9\u10E3\u10D2\u10D0\u10E2\u10D0\u10E0\u10D4\u10D1\u10D0:/;

// ── Bill / utility payment (გAdaXda:\nNNN CUR\nMERCHANT) ──────────────────
// U+10D2 U+10D0 U+10D3 U+10D0 U+10EE U+10D3 U+10D0 = გAdaXda (note: ხ ≠ რ in გAdaRicxVa)
const RE_BILL = /\u10D2\u10D0\u10D3\u10D0\u10EE\u10D3\u10D0:\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Mobile top-up (მobIlURIs ShEvSeba:\nNNN CUR\nMERCHANT) ───────────────
// U+10DB U+10DD U+10D1 U+10D8 U+10DA U+10E3 U+10E0 U+10D8 U+10E1 = მobIlURIs
// U+10E8 U+10D4 U+10D5 U+10E1 U+10D4 U+10D1 U+10D0 = ShEvSeba
const RE_MOBILE = /\u10DB\u10DD\u10D1\u10D8\u10DA\u10E3\u10E0\u10D8\u10E1 \u10E8\u10D4\u10D5\u10E1\u10D4\u10D1\u10D0:\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Scheduled auto-transfer (AvtomATUri GAdaRicXVa\nNNN CUR\nMERCHANT) ───
// U+10D0 U+10D5 U+10E2 U+10DD U+10DB U+10D0 U+10E2 U+10E3 U+10E0 U+10D8 = AvtomATUri
const RE_AUTO = /\u10D0\u10D5\u10E2\u10DD\u10DB\u10D0\u10E2\u10E3\u10E0\u10D8 \u10D2\u10D0\u10D3\u10D0\u10E0\u10D8\u10EA\u10EE\u10D5\u10D0\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Cash deposit (naGDI fulis SheTaNa:\nTaNXa: NNN CUR) ───────────────────
// U+10DC U+10D0 U+10E6 U+10D3 U+10D8 = naGDI
// U+10E4 U+10E3 U+10DA U+10D8 U+10E1 = fulis
// U+10E8 U+10D4 U+10E2 U+10D0 U+10DC U+10D0 = SheTaNa
const RE_DEPOSIT = /\u10DC\u10D0\u10E6\u10D3\u10D8 \u10E4\u10E3\u10DA\u10D8\u10E1 \u10E8\u10D4\u10E2\u10D0\u10DC\u10D0:/;

// ── ATM cash withdrawal (TaNXIs GaNaGdeba:\nDATE\nTaNXa: NNN CUR) ─────────
// U+10D7 U+10D0 U+10DC U+10EE U+10D8 U+10E1 = TaNXIs
// U+10D2 U+10D0 U+10DC U+10D0 U+10E6 U+10D3 U+10D4 U+10D1 U+10D0 = GaNaGdeba
const RE_ATM = /\u10D7\u10D0\u10DC\u10EE\u10D8\u10E1 \u10D2\u10D0\u10DC\u10D0\u10E6\u10D3\u10D4\u10D1\u10D0:/;

// ── Amount label used in deposit/ATM/auto (TaNXa: NNN CUR) ────────────────
// U+10D7 U+10D0 U+10DC U+10EE U+10D0 = TaNXa
const RE_TANXA = /\u10D7\u10D0\u10DC\u10EE\u10D0:\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Generic card-payment amount: bare "NNN.NN CUR" line ───────────────────
// Optional leading ")" covers TBC municipal transport taps.
const RE_CARD_AMOUNT = /^\s*\)?\s*([\d.,]+)\s*([A-Z]{3})\s*$/m;

// ── Card number extraction ─────────────────────────────────────────────────
const RE_CARD_PARENS = /\(\s*\*{3,}'?(\d{3,4})'?\s*\)/;
const RE_CARD_STARS  = /\*{3,}(\d{3,4})/;

// ── Balance (ნAshTi: NNN CUR) ──────────────────────────────────────────────
// U+10DC U+10D0 U+10E8 U+10D7 U+10D8 = ნAshTi
const RE_BALANCE = /\u10DC\u10D0\u10E8\u10D7\u10D8:\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Failure reason (მiZeZi: text) ─────────────────────────────────────────
// U+10DB U+10D8 U+10D6 U+10D4 U+10D6 U+10D8 = მiZeZi
const RE_REASON = /\u10DB\u10D8\u10D6\u10D4\u10D6\u10D8:\s*(.+)/i;

// ── Loan source account (ANGaRiShIdaN: accountName) ────────────────────────
// U+10D0 U+10DC U+10D2 U+10D0 U+10E0 U+10D8 U+10E8 U+10D8 U+10D3 U+10D0 U+10DC = ANGaRiShIdaN
const RE_SOURCE_ACCOUNT = /\u10D0\u10DC\u10D2\u10D0\u10E0\u10D8\u10E8\u10D8\u10D3\u10D0\u10DC:\s*(.+?)(?:\s*$)/im;

// ── Loan remaining balance (სESxis ნAshTi: NNN CUR) ───────────────────────
const RE_LOAN_REMAINING = /\u10E1\u10D4\u10E1\u10EE\u10D8\u10E1 \u10DC\u10D0\u10E8\u10D7\u10D8:\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Account hint lines that are NOT counterparty names ────────────────────
const RE_ACCOUNT_HINT = /^\s*(Current|Space Card|Expired deposits account|VISA GOLD|[A-Z][A-Za-z ]+ account)\s*$/;

interface Detected {
  kind: TransactionKind;
  status: TransactionStatus;
}

function detect(text: string): Detected | null {
  if (RE_FAILED.test(text)) return { kind: "payment_failed", status: "failed" };
  if (RE_LOAN.test(text))   return { kind: "loan_repayment", status: "success" };
  if (RE_INCOMING.test(text)) return { kind: "transfer_in",  status: "success" };
  if (RE_TRANSFER_OUT.test(text)) return { kind: "transfer_out", status: "success" };
  if (RE_BILL.test(text))   return { kind: "transfer_out",   status: "success" };
  if (RE_MOBILE.test(text)) return { kind: "transfer_out",   status: "success" };
  if (RE_AUTO.test(text))   return { kind: "transfer_out",   status: "success" };
  if (RE_DEPOSIT.test(text)) return { kind: "deposit",       status: "success" };
  if (RE_ATM.test(text))    return { kind: "atm_withdrawal", status: "success" };
  // Reversal check must precede the generic card-amount check — layout is identical.
  if (RE_REVERSAL.test(text) && RE_CARD_AMOUNT.test(text)) {
    return { kind: "reversal", status: "success" };
  }
  if (RE_CARD_AMOUNT.test(text) && (RE_CARD_PARENS.test(text) || RE_CARD_STARS.test(text))) {
    return { kind: "payment", status: "success" };
  }
  return null;
}

function parseCard(text: string): string | null {
  const m = text.match(RE_CARD_PARENS) ?? text.match(RE_CARD_STARS);
  return m ? m[1] : null;
}

/** Merchant for card payments: the line immediately after the card-number line. */
function parseMerchantFromCard(text: string): string | null {
  const lines = text.trim().split(/\r?\n/).map(stripTrailingNoise).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (RE_CARD_STARS.test(lines[i])) return lines[i + 1] ?? null;
  }
  return null;
}

/** Balance from "ნAshTi: NNN CUR". */
function parseBalance(text: string): number | null {
  const m = text.match(RE_BALANCE);
  return m ? parseFlexibleAmount(m[1]) : null;
}

/** Merchant for failed payments: first non-date, non-reason, non-card line after the date. */
function parseFailedMerchant(text: string): string | null {
  const lines = text.trim().split(/\r?\n/).map(stripTrailingNoise).filter(Boolean);
  const dateIdx = lines.findIndex((l) => /\d{2}\/\d{2}\/\d{4}/.test(l));
  if (dateIdx === -1 || dateIdx === lines.length - 1) return null;
  return lines[dateIdx + 1] ?? null;
}

/**
 * Counterparty name for transfers: the line immediately after the date line,
 * as long as it is not a known account-hint (VISA GOLD, Current, etc.).
 */
function parseCounterpartyAfterDate(text: string): string | null {
  const lines = text.trim().split(/\r?\n/).map(stripTrailingNoise).filter(Boolean);
  const dateIdx = lines.findIndex((l) => /\d{2}\/\d{2}\/\d{4}/.test(l));
  if (dateIdx === -1 || dateIdx === lines.length - 1) return null;
  const tail = lines[dateIdx + 1];
  if (!tail || RE_ACCOUNT_HINT.test(tail)) return null;
  return tail;
}

/** Loan source account from "ANGaRiShIdaN: <name>". */
function parseLoanAccount(text: string): string | null {
  const m = text.match(RE_SOURCE_ACCOUNT);
  return m ? m[1].trim() : null;
}

/**
 * Merchant for bill payments, mobile top-ups, and auto transfers.
 * Layout is always: header line → amount line → merchant line → reference line.
 * We return the third non-empty line.
 */
function parseBillMerchant(text: string): string | null {
  const lines = text.trim().split(/\r?\n/).map(stripTrailingNoise).filter(Boolean);
  return lines[2] ?? null;
}

function parse(raw: RawMessage): Transaction | null {
  // Skip own-account transfers before any further processing.
  if (RE_SELF.test(raw.text)) return null;

  const text = raw.text;
  const detected = detect(text);
  if (!detected) return null;

  let amount: number | null = null;
  let currency = "GEL";
  let merchant: string | null = null;
  let counterparty: string | null = null;
  let failureReason: string | null = null;
  let balance: number | null = null;

  switch (detected.kind) {
    case "payment_failed": {
      const m = text.match(RE_FAILED);
      if (!m) return null;
      amount = parseFlexibleAmount(m[1]);
      currency = m[2];
      merchant = parseFailedMerchant(text);
      const r = text.match(RE_REASON);
      if (r) failureReason = r[1].trim();
      break;
    }

    case "loan_repayment": {
      const m = text.match(RE_LOAN);
      if (!m) return null;
      amount = parseFlexibleAmount(m[1]);
      currency = m[2];
      counterparty = parseLoanAccount(text);
      merchant = "Loan repayment";
      const rem = text.match(RE_LOAN_REMAINING);
      if (rem) balance = parseFlexibleAmount(rem[1]);
      break;
    }

    case "transfer_in": {
      const m = text.match(RE_INCOMING);
      if (!m) return null;
      amount = parseFlexibleAmount(m[1]);
      currency = m[2];
      counterparty = parseCounterpartyAfterDate(text);
      merchant = counterparty;
      break;
    }

    case "transfer_out": {
      // Distinguish the four outgoing-transfer subtypes by which pattern matched.
      if (RE_BILL.test(text)) {
        const m = text.match(RE_BILL);
        if (!m) return null;
        amount = parseFlexibleAmount(m[1]);
        currency = m[2];
        merchant = parseBillMerchant(text);
        counterparty = merchant;
      } else if (RE_MOBILE.test(text)) {
        const m = text.match(RE_MOBILE);
        if (!m) return null;
        amount = parseFlexibleAmount(m[1]);
        currency = m[2];
        merchant = parseBillMerchant(text);
        counterparty = merchant;
      } else if (RE_AUTO.test(text)) {
        const m = text.match(RE_AUTO);
        if (!m) return null;
        amount = parseFlexibleAmount(m[1]);
        currency = m[2];
        merchant = parseBillMerchant(text);
        counterparty = merchant;
      } else {
        // Standard გAdaRicxVa: transfer
        const m = text.match(RE_TRANSFER_OUT);
        if (!m) return null;
        amount = parseFlexibleAmount(m[1]);
        currency = m[2];
        counterparty = parseCounterpartyAfterDate(text);
        merchant = counterparty ?? "Transfer";
      }
      break;
    }

    case "deposit": {
      // Cash deposit: "TaNXa: NNN CUR" somewhere in the body.
      const m = text.match(RE_TANXA);
      if (!m) return null;
      amount = parseFlexibleAmount(m[1]);
      currency = m[2];
      merchant = "Cash deposit";
      break;
    }

    case "atm_withdrawal": {
      // ATM: "TaNXa: NNN CUR" in the body.
      const m = text.match(RE_TANXA);
      if (!m) return null;
      amount = parseFlexibleAmount(m[1]);
      currency = m[2];
      merchant = "ATM withdrawal";
      break;
    }

    case "payment":
    case "reversal": {
      const m = text.match(RE_CARD_AMOUNT);
      if (!m) return null;
      amount = parseFlexibleAmount(m[1]);
      currency = m[2];
      merchant = parseMerchantFromCard(text);
      counterparty = merchant;
      break;
    }

    default:
      return null;
  }

  if (amount === null) return null;

  balance = balance ?? parseBalance(text);

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
      const ymd = parseDateSlashed(text);
      return ymd ? mergeDateAndTime(ymd, raw.timestamp) : raw.timestamp;
    })(),
    messageTimestamp: raw.timestamp,
    rawMessage: raw.text,
    failureReason,
    balance,
    plusEarned: null,
    plusTotal: null,
    counterparty,
  };
}

export const tbcParser: BankParser = {
  bankKey: BANK_KEY,
  senderIds: ["TBC SMS", "TBC"],
  parse,
};
