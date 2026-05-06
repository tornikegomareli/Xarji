/**
 * TBC Bank — real sender id "TBC SMS" (not "TBC").
 *
 * Each detection regex matches BOTH Georgian script (U+10D0–U+10FF) AND the
 * Latin transliteration TBC actually sends in production. Real-world SMS
 * dumped from chat.db on 2026-05-05 had headers like "Charicxva:",
 * "Gadaricxva:", "Ukugatareba:", "Mobiluris shevseba:", and balances like
 * "Nashti:" — so the parser missed every keyworded transaction (incoming
 * credits, outgoing transfers, mobile top-ups, reversals, ATM withdrawals)
 * and only got card payments right (those don't depend on a header keyword,
 * just on a bare amount-currency line + card-parens marker). Card payments
 * lulled the test suite into thinking the parser worked.
 *
 * Handles:
 *   ჩარიცხვა / Charicxva:                    incoming transfer  → transfer_in   (in)
 *   გადარიცხვა / Gadaricxva:                 outgoing transfer  → transfer_out  (out)
 *   სესხის დაფარვა / Sesxis dapharva:        loan repayment     → loan_repayment (out)
 *   საბარათე ოპერაცია … უარყოფილია /
 *     Sabarate operacia … uarYofiliA         failed card pay    → payment_failed (out)
 *   უკუგატარება / Ukugatareba:               card reversal      → reversal       (in)
 *   NNN CUR + card line + merchant           card payment       → payment        (out)
 *   გადახდა / Gadaxda:                       bill / utility     → transfer_out   (out)
 *   მობილურის შევსება / Mobiluris shevseba:  mobile top-up      → transfer_out   (out)
 *   ავტომატური გადარიცხვა /
 *     Avtomaturi gadaricxva                  scheduled auto     → transfer_out   (out)
 *   ნაღდი ფულის შეტანა /
 *     Naghdi pulis shetana:                  cash deposit       → deposit        (in)
 *   თანხის განაღდება / Tanxis ganagdeba:     ATM cash withdraw  → atm_withdrawal (out)
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
// საკუთარ ანგარიშებზე / Sakutar angarishebze — skip entirely.
const RE_SELF = /(?:საკუთარ ანგარიშებზე|[Ss]akutar angarishebze)/;

// ── Incoming transfer (ჩარიცხვა / Charicxva: NNN CUR) ─────────────────────
const RE_INCOMING = /(?:ჩარიცხვა|[Cc]haricxva):\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Outgoing transfer (გადარიცხვა / Gadaricxva: NNN CUR) ──────────────────
const RE_TRANSFER_OUT = /(?:გადარიცხვა|[Gg]adaricxva):\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Loan full repayment (სესხის დაფარვა / Sesxis dapharva: NNN CUR) ───────
const RE_LOAN = /(?:სესხის დაფარვა|[Ss]esxis dapharva):\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Failed card payment (საბარათე ოპერაცია … უარყოფილია /
//                        Sabarate operacia … uarYofiliA) ────────────────────
const RE_FAILED = /(?:საბარათე ოპერაცია|[Ss]abarate operacia)\s*([\d.,]+)\s*([A-Z]{3})\s*(?:უარყოფილია|uar[Yy]ofili[Aa])/i;

// ── Card reversal (უკუგატარება / Ukugatareba: …) ──────────────────────────
const RE_REVERSAL = /(?:უკუგატარება|[Uu]kugatareba):/;

// Inline shape — same SMS but everything on one line. Real example:
// "Ukugatareba: 13.90 GEL TBC Concept 360 VISA Signature (***8058) BOLTTAXI
//  05/05/2026 17:25:01 nashti: 400.00 GEL"
// Captures the amount + currency right after the header so detect() can fire
// without needing the line-anchored RE_CARD_AMOUNT to also match.
const RE_REVERSAL_INLINE = /(?:უკუგატარება|[Uu]kugatareba):\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Bill / utility payment (გადახდა / Gadakhda: NNN CUR) ──────────────────
// Latin form varies in the wild: "Gadakhda" and "Gadaxda" both seen. Allow
// both spellings via an optional "k". Distinct from "Gadaricxva" — the
// preceding word boundary stops "Gadaricxva" from matching here by accident.
const RE_BILL = /(?:გადახდა|[Gg]ada(?:kh|x)da):\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Mobile top-up (მობილურის შევსება / Mobiluris shevseba: …) ─────────────
const RE_MOBILE = /(?:მობილურის შევსება|[Mm]obiluris shevseba):\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Scheduled auto-transfer (ავტომატური გადარიცხვა /
//                             Avtomaturi gadaricxva) ──────────────────────
const RE_AUTO = /(?:ავტომატური გადარიცხვა|[Aa]vtomaturi gadaricxva)\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Cash deposit (ნაღდი ფულის შეტანა / Naghdi pulis shetana:) ─────────────
const RE_DEPOSIT = /(?:ნაღდი ფულის შეტანა|[Nn]aghdi pulis shetana):/;

// ── ATM cash withdrawal (თანხის განაღდება / Tanxis ganagdeba:) ────────────
const RE_ATM = /(?:თანხის განაღდება|[Tt]anxis ganagdeba):/;

// ── Amount label used in deposit/ATM/auto (თანხა / Tanxa: NNN CUR) ────────
const RE_TANXA = /(?:თანხა|[Tt]anxa):\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Generic card-payment amount: bare "NNN.NN CUR" line ───────────────────
// Optional leading ")" covers TBC municipal transport taps.
const RE_CARD_AMOUNT = /^\s*\)?\s*([\d.,]+)\s*([A-Z]{3})\s*$/m;

// ── Card number extraction ─────────────────────────────────────────────────
const RE_CARD_PARENS = /\(\s*\*{3,}'?(\d{3,4})'?\s*\)/;
const RE_CARD_STARS  = /\*{3,}(\d{3,4})/;

// ── Balance (ნაშთი / Nashti: NNN CUR) ─────────────────────────────────────
// Real-world TBC SMS varies the casing — "Nashti:" on most card-payment SMS
// but "nashti:" lowercase on some inline reversals. The [Nn] handles both.
const RE_BALANCE = /(?:ნაშთი|[Nn]ashti):\s*([\d.,]+)\s*([A-Z]{3})/;

// ── Failure reason (მიზეზი / Mizezi: text) ───────────────────────────────
const RE_REASON = /(?:მიზეზი|[Mm]izezi):\s*(.+)/i;

// ── Loan source account (ანგარიშიდან / Angarishidan: accountName) ─────────
const RE_SOURCE_ACCOUNT = /(?:ანგარიშიდან|[Aa]ngarishidan):\s*(.+?)(?:\s*$)/im;

// ── Loan remaining balance (სესხის ნაშთი / Sesxis nashti: NNN CUR) ────────
const RE_LOAN_REMAINING = /(?:სესხის ნაშთი|[Ss]esxis nashti):\s*([\d.,]+)\s*([A-Z]{3})/;

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
