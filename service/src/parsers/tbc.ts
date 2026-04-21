/**
 * TBC Bank — real sender id "TBC SMS" (not "TBC").
 *
 * TBC formats differ from SOLO in three ways:
 *   - Georgian is transliterated to Latin script (`Sesxis daparva`).
 *   - Dates are slashed `DD/MM/YYYY`.
 *   - Amounts may use European comma as decimal (`13345,29 GEL`).
 *
 * Handles:
 *   - `Sesxis daparva:`                      — full loan repayment   → loan_repayment (out)
 *   - `NNN GEL -it natsilobriv daifara …`    — partial loan payment  → loan_repayment (out)
 *   - `Gadaricxva:`                          — outgoing transfer     → transfer_out (out)
 *   - `Sabarate operacia … uarkofilia`       — declined card payment → payment_failed (out)
 *   - `Charicxva:`                           — incoming              → transfer_in (in)
 *
 * Marketing / notifications / security codes / card-expiry messages return
 * null so they're silently skipped.
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

// Full loan repayment:
//   "Sesxis daparva: 13345,29 GEL"
const RE_LOAN_FULL = /Sesxis daparva:\s*([\d.,]+)\s*([A-Z]{3})/i;

// Partial loan repayment:
//   "543 GEL -it natsilobriv daifara Samomkhmareblo seskhi angarishidan: ..."
const RE_LOAN_PARTIAL = /([\d.,]+)\s*([A-Z]{3})\s*-it natsilobriv daifara/i;

// Outgoing transfer:
//   "Gadaricxva:\n50.00 GEL"
const RE_TRANSFER_AMOUNT = /Gadaricxva:\s*([\d.,]+)\s*([A-Z]{3})/i;

// Incoming:
//   "Charicxva: 2250.00 GEL\nCurrent\n20/04/2026\nLUKA MAISURADZE"
const RE_INCOMING_AMOUNT = /Charicxva:\s*([\d.,]+)\s*([A-Z]{3})/i;

// Failed card payment:
//   "Sabarate operacia 9.99 USD uarkofilia."
const RE_FAIL_AMOUNT = /Sabarate operacia\s*([\d.,]+)\s*([A-Z]{3})\s*uarkofilia/i;
// failure reason, optional: "mizezi: baratit sargebloba shezgudulia."
const RE_FAIL_REASON = /mizezi:\s*(.+)/i;
// card: "SPACE DIGITAL CARD (***'5312')" or variants with ***NNNN / ****NNNN
const RE_CARD_PARENS = /\(\s*\*{3,}'?(\d{3,4})'?\s*\)/;
const RE_CARD_STARS = /\*{3,}(\d{3,4})/;

// Account hint in transfers ("Current", "Space Card", "Expired deposits account")
const RE_ACCOUNT_HINT = /^\s*(Current|Space Card|Expired deposits account|[A-Z][A-Za-z ]+ account)\s*$/;

// Loan repayment extras
const RE_REMAINING = /sesxis nashti:\s*([\d.,]+)\s*([A-Z]{3})/i;
const RE_SOURCE_ACCOUNT = /Angarishidan:\s*(.+?)(?:\s*$|\s*Sesxis nashti|\s*davalianebis)/im;
const RE_PARTIAL_SOURCE = /angarishidan:\s*([^;]+);/i;

interface Detected {
  kind: TransactionKind;
  status: TransactionStatus;
}

function detect(text: string): Detected | null {
  if (RE_FAIL_AMOUNT.test(text)) return { kind: "payment_failed", status: "failed" };
  if (RE_LOAN_FULL.test(text)) return { kind: "loan_repayment", status: "success" };
  if (RE_LOAN_PARTIAL.test(text)) return { kind: "loan_repayment", status: "success" };
  if (/Gadaricxva:/i.test(text)) return { kind: "transfer_out", status: "success" };
  if (RE_INCOMING_AMOUNT.test(text)) return { kind: "transfer_in", status: "success" };
  return null;
}

function parseCard(text: string): string | null {
  const m = text.match(RE_CARD_PARENS) ?? text.match(RE_CARD_STARS);
  return m ? m[1] : null;
}

function parseFailedMerchant(text: string): string | null {
  // Merchant is the last non-empty line after the date.
  const lines = text.trim().split(/\r?\n/).map(stripTrailingNoise).filter(Boolean);
  // Find date line, merchant usually follows it.
  const dateIdx = lines.findIndex((l) => /\d{2}\/\d{2}\/\d{4}/.test(l));
  if (dateIdx === -1 || dateIdx === lines.length - 1) return null;
  return lines[dateIdx + 1] || null;
}

function parseCounterpartyAfterDate(text: string): string | null {
  // For Charicxva / Gadaricxva: the SMS layout is
  //   Charicxva: 21448.00 GEL
  //   Current
  //   20/04/2026
  //   LUKA MAISURADZE        ← counterparty (may have trailing noise)
  const lines = text.trim().split(/\r?\n/).map(stripTrailingNoise).filter(Boolean);
  const dateIdx = lines.findIndex((l) => /\d{2}\/\d{2}\/\d{4}/.test(l));
  if (dateIdx === -1 || dateIdx === lines.length - 1) return null;
  const tail = lines[dateIdx + 1];
  if (!tail || RE_ACCOUNT_HINT.test(tail)) return null;
  return tail;
}

function parseAccountFromLoan(text: string, partial: boolean): string | null {
  if (partial) {
    const m = text.match(RE_PARTIAL_SOURCE);
    return m ? m[1].trim() : null;
  }
  const m = text.match(RE_SOURCE_ACCOUNT);
  return m ? m[1].trim() : null;
}

function parse(raw: RawMessage): Transaction | null {
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
      const m = text.match(RE_FAIL_AMOUNT);
      if (!m) return null;
      amount = parseFlexibleAmount(m[1]);
      currency = m[2];
      merchant = parseFailedMerchant(text);
      const r = text.match(RE_FAIL_REASON);
      if (r) failureReason = r[1].trim();
      break;
    }
    case "loan_repayment": {
      const full = text.match(RE_LOAN_FULL);
      const partial = text.match(RE_LOAN_PARTIAL);
      if (full) {
        amount = parseFlexibleAmount(full[1]);
        currency = full[2];
      } else if (partial) {
        amount = parseFlexibleAmount(partial[1]);
        currency = partial[2];
      } else {
        return null;
      }
      // Keep the raw source account (e.g. "Space Card", "Expired deposits
      // account") as counterparty; present a clean, stable merchant label.
      counterparty = parseAccountFromLoan(text, !!partial && !full);
      merchant = "Loan repayment";
      const remaining = text.match(RE_REMAINING);
      if (remaining) balance = parseFlexibleAmount(remaining[1]);
      break;
    }
    case "transfer_out": {
      const m = text.match(RE_TRANSFER_AMOUNT);
      if (!m) return null;
      amount = parseFlexibleAmount(m[1]);
      currency = m[2];
      counterparty = parseCounterpartyAfterDate(text);
      // TBC `Gadaricxva:` SMS often has no destination line at all — just
      // amount + account hint + date. Use a stable generic label so the
      // dashboard shows "Transfer" instead of "—".
      merchant = counterparty ?? "Transfer";
      break;
    }
    case "transfer_in": {
      const m = text.match(RE_INCOMING_AMOUNT);
      if (!m) return null;
      amount = parseFlexibleAmount(m[1]);
      currency = m[2];
      counterparty = parseCounterpartyAfterDate(text);
      merchant = counterparty;
      break;
    }
    default:
      return null;
  }

  if (amount === null) return null;

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
    rawMessage: text,
    failureReason,
    balance,
    plusEarned: null,
    plusTotal: null,
    counterparty,
  };
}

export const tbcParser: BankParser = {
  bankKey: BANK_KEY,
  // TBC ships from "TBC SMS" in chat.db. We include "TBC" as an alias for users
  // who typed that manually (it matches nothing, but no harm).
  senderIds: ["TBC SMS", "TBC"],
  parse,
};
