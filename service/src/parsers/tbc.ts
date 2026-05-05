/**
 * TBC Bank — real sender id "TBC SMS" (not "TBC").
 *
 * All patterns match Georgian Unicode directly. TBC sends SMS in Georgian
 * script (U+10D0–U+10FF); comments show the human-readable transliteration
 * beside each Unicode-escaped literal for readability.
 *
 * Handles:
 *   ჩარიცხვა:          incoming transfer     → transfer_in   (in)
 *   გადარიცხვა:        outgoing transfer     → transfer_out  (out)
 *   სესხის დაფარვა:    loan repayment        → loan_repayment (out)
 *   საბარათე ოპერაცია … უარყოფილია           → payment_failed (out)
 *   უკუგატარება:       card reversal         → reversal       (in)
 *   NNN CUR + card line + merchant           → payment        (out)
 *   გადახდა:           bill / utility pay    → transfer_out  (out)
 *   მობილურის შევსება: mobile top-up         → transfer_out  (out)
 *   ავტომატური გადარიცხვა: scheduled auto    → transfer_out  (out)
 *   ნაღდი ფულის შეტანა: cash deposit         → deposit        (in)
 *   თანხის განაღდება:  ATM cash withdrawal   → atm_withdrawal (out)
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
const RE_SELF = /საკუთარ ანგარიშებზე/;

// ── Incoming transfer (ჩარიცხვა: NNN CUR) ─────────────────────────────────
// U+10E9 U+10D0 U+10E0 U+10D8 U+10EA U+10EE U+10D5 U+10D0 = ჩARicxVa
const RE_INCOMING = /ჩარიცხვა:\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Outgoing transfer (გადარიცხვა:\nNNN CUR) ──────────────────────────────
// U+10D2 U+10D0 U+10D3 U+10D0 U+10E0 U+10D8 U+10EA U+10EE U+10D5 U+10D0 = გადარიცხვა
const RE_TRANSFER_OUT = /გადარიცხვა:\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Loan full repayment (სESxis dAFARVa: NNN CUR) ─────────────────────────
// U+10E1 U+10D4 U+10E1 U+10EE U+10D8 U+10E1 = სESxis
// U+10D3 U+10D0 U+10E4 U+10D0 U+10E0 U+10D5 U+10D0 = dAFARVa
const RE_LOAN = /სესხის დაფარვა:\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Failed card payment (sabarate operacia NNN CUR uarYofiliA) ────────────
// U+10E1 U+10D0 U+10D1 U+10D0 U+10E0 U+10D0 U+10D7 U+10D4 = sabarate
// U+10DD U+10DE U+10D4 U+10E0 U+10D0 U+10EA U+10D8 U+10D0 = operacia
// U+10E3 U+10D0 U+10E0 U+10E7 U+10DD U+10E4 U+10D8 U+10DA U+10D8 U+10D0 = uarYofiliA
const RE_FAILED = /საბარათე ოპერაცია\s*([\d.,]+)\s*([A-Z]{3})\s*უარყოფილია/i;

// ── Card reversal (uKUGatareba:\nNNN CUR\nCARD\nmerchant) ─────────────────
// U+10E3 U+10D9 U+10E3 U+10D2 U+10D0 U+10E2 U+10D0 U+10E0 U+10D4 U+10D1 U+10D0 = uKUGatareba
const RE_REVERSAL = /უკუგატარება:/;

// Inline shape — same SMS but everything on one line. Seen in the wild as e.g.
// "უკუგატარება: 13.90 GEL TBC Concept 360 VISA Signature (***8058) BOLTTAXI 05/05/2026 17:25:01 ნაშთი: 400.00 GEL"
// Captures the amount + currency right after the header so detect() can fire
// without needing the line-anchored RE_CARD_AMOUNT to also match.
const RE_REVERSAL_INLINE = /უკუგატარება:\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Bill / utility payment (გAdaXda:\nNNN CUR\nMERCHANT) ──────────────────
// U+10D2 U+10D0 U+10D3 U+10D0 U+10EE U+10D3 U+10D0 = გAdaXda (note: ხ ≠ რ in გAdaRicxVa)
const RE_BILL = /გადახდა:\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Mobile top-up (მobIlURIs ShEvSeba:\nNNN CUR\nMERCHANT) ───────────────
// U+10DB U+10DD U+10D1 U+10D8 U+10DA U+10E3 U+10E0 U+10D8 U+10E1 = მobIlURIs
// U+10E8 U+10D4 U+10D5 U+10E1 U+10D4 U+10D1 U+10D0 = ShEvSeba
const RE_MOBILE = /მობილურის შევსება:\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Scheduled auto-transfer (AvtomATUri GAdaRicXVa\nNNN CUR\nMERCHANT) ───
// U+10D0 U+10D5 U+10E2 U+10DD U+10DB U+10D0 U+10E2 U+10E3 U+10E0 U+10D8 = AvtomATUri
const RE_AUTO = /ავტომატური გადარიცხვა\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Cash deposit (naGDI fulis SheTaNa:\nTaNXa: NNN CUR) ───────────────────
// U+10DC U+10D0 U+10E6 U+10D3 U+10D8 = naGDI
// U+10E4 U+10E3 U+10DA U+10D8 U+10E1 = fulis
// U+10E8 U+10D4 U+10E2 U+10D0 U+10DC U+10D0 = SheTaNa
const RE_DEPOSIT = /ნაღდი ფულის შეტანა:/;

// ── ATM cash withdrawal (TaNXIs GaNaGdeba:\nDATE\nTaNXa: NNN CUR) ─────────
// U+10D7 U+10D0 U+10DC U+10EE U+10D8 U+10E1 = TaNXIs
// U+10D2 U+10D0 U+10DC U+10D0 U+10E6 U+10D3 U+10D4 U+10D1 U+10D0 = GaNaGdeba
const RE_ATM = /თანხის განაღდება:/;

// ── Amount label used in deposit/ATM/auto (TaNXa: NNN CUR) ────────────────
// U+10D7 U+10D0 U+10DC U+10EE U+10D0 = TaNXa
const RE_TANXA = /თანხა:\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Generic card-payment amount: bare "NNN.NN CUR" line ───────────────────
// Optional leading ")" covers TBC municipal transport taps.
const RE_CARD_AMOUNT = /^\s*\)?\s*([\d.,]+)\s*([A-Z]{3})\s*$/m;

// ── Card number extraction ─────────────────────────────────────────────────
const RE_CARD_PARENS = /\(\s*\*{3,}'?(\d{3,4})'?\s*\)/;
const RE_CARD_STARS  = /\*{3,}(\d{3,4})/;

// ── Balance (ნAshTi: NNN CUR) ──────────────────────────────────────────────
// U+10DC U+10D0 U+10E8 U+10D7 U+10D8 = ნAshTi
const RE_BALANCE = /ნაშთი:\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Failure reason (მiZeZi: text) ─────────────────────────────────────────
// U+10DB U+10D8 U+10D6 U+10D4 U+10D6 U+10D8 = მiZeZi
const RE_REASON = /მიზეზი:\s*(.+)/i;

// ── Loan source account (ANGaRiShIdaN: accountName) ────────────────────────
// U+10D0 U+10DC U+10D2 U+10D0 U+10E0 U+10D8 U+10E8 U+10D8 U+10D3 U+10D0 U+10DC = ANGaRiShIdaN
const RE_SOURCE_ACCOUNT = /ანგარიშიდან:\s*(.+?)(?:\s*$)/im;

// ── Loan remaining balance (სESxis ნAshTi: NNN CUR) ───────────────────────
const RE_LOAN_REMAINING = /სესხის ნაშთი:\s*([\d.,]+)\s*([A-Z]{3})/;

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
  // Two shapes supported: the original multi-line layout (RE_REVERSAL header +
  // RE_CARD_AMOUNT on its own line), and a newer inline layout where TBC
  // collapses everything onto one line (RE_REVERSAL_INLINE captures both
  // header and amount in a single match).
  if (RE_REVERSAL_INLINE.test(text) || (RE_REVERSAL.test(text) && RE_CARD_AMOUNT.test(text))) {
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

/** Merchant for card payments: the line immediately after the card-number line.
 *  For inline-shape SMS where everything is on one line, falls back to the
 *  text immediately after the card-parens marker (e.g. "(***8058) BOLTTAXI
 *  05/05/2026" → "BOLTTAXI"), trimmed against the date that follows. */
function parseMerchantFromCard(text: string): string | null {
  const lines = text.trim().split(/\r?\n/).map(stripTrailingNoise).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (RE_CARD_STARS.test(lines[i])) {
      // Multi-line: merchant is the next line after the card line.
      if (lines[i + 1] != null) return lines[i + 1];
      // Inline single-line shape: card-parens + merchant + date sit on the
      // same line. Pull the substring after the closing paren and stop at
      // the date.
      const afterParens = lines[i].split(/\)\s*/)[1];
      if (!afterParens) return null;
      const beforeDate = afterParens.split(/\s+\d{2}\/\d{2}\/\d{4}/)[0];
      return beforeDate.trim() || null;
    }
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
      // Multi-line shape stores amount on its own line (RE_CARD_AMOUNT).
      // Inline reversal shape (RE_REVERSAL_INLINE) captures it from the
      // header line directly. Try the inline match first for reversals
      // since that path is the one detect() may have fired on.
      let m = detected.kind === "reversal" ? text.match(RE_REVERSAL_INLINE) : null;
      if (!m) m = text.match(RE_CARD_AMOUNT);
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
