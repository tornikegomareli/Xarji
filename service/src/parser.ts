import { defaultConfig } from "./config";
import type { RawMessage } from "./db-reader";

export type TransactionType = "payment" | "payment_failed" | "atm_withdrawal" | "transfer" | "unknown";
export type TransactionStatus = "success" | "failed";

export interface Transaction {
  id: string;
  messageId: number;
  transactionType: TransactionType;
  status: TransactionStatus;
  amount: number | null;
  currency: string;
  merchant: string | null;
  cardLastDigits: string | null;
  transactionDate: Date;
  messageTimestamp: Date;
  rawMessage: string;
  failureReason: string | null;
  balance: number | null;
  plusEarned: number | null;
  plusTotal: number | null;
}

export interface ParseResult {
  success: Transaction[];  // Successfully parsed (both successful and failed payments)
  failed: RawMessage[];    // Messages that couldn't be parsed
}

/**
 * Parse amount from successful payment message
 * Format: გადახდა: GEL123.45
 */
function parseSuccessfulAmount(text: string): { currency: string; amount: number } | null {
  const pattern = /გადახდა:\s*([A-Z]{3})([\d,]+\.?\d*)/;
  const match = text.match(pattern);

  if (match) {
    const currency = match[1];
    const amountStr = match[2].replace(/,/g, "");
    const amount = parseFloat(amountStr);
    if (!isNaN(amount)) {
      return { currency, amount };
    }
  }
  return null;
}

/**
 * Parse balance from failed payment message
 * Format: ნაშთი: GEL0.00
 */
function parseBalance(text: string): { currency: string; balance: number } | null {
  const pattern = /ნაშთი:\s*([A-Z]{3})([\d,]+\.?\d*)/;
  const match = text.match(pattern);

  if (match) {
    const currency = match[1];
    const balanceStr = match[2].replace(/,/g, "");
    const balance = parseFloat(balanceStr);
    if (!isNaN(balance)) {
      return { currency, balance };
    }
  }
  return null;
}

/**
 * Parse failure reason from failed payment message
 * Format: მიზეზი: არასაკმარისი თანხა
 */
function parseFailureReason(text: string): string | null {
  const pattern = /მიზეზი:\s*(.+)/;
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

/**
 * Parse card last digits from message
 */
function parseCard(text: string): string | null {
  const match = text.match(defaultConfig.patterns.card);
  return match ? match[1] : null;
}

/**
 * Parse transaction date from message
 */
function parseDate(text: string): Date | null {
  const match = text.match(defaultConfig.patterns.date);
  if (match) {
    const [day, month, year] = match[1].split(".").map(Number);
    return new Date(year, month - 1, day);
  }
  return null;
}

/**
 * Parse Plus points from message
 */
function parsePlusPoints(text: string): { earned: number | null; total: number | null } {
  let earned: number | null = null;
  let total: number | null = null;

  const earnedMatch = text.match(defaultConfig.patterns.plusEarned);
  if (earnedMatch) {
    earned = parseFloat(earnedMatch[1].replace(/,/g, ""));
    if (isNaN(earned)) earned = null;
  }

  const totalMatch = text.match(defaultConfig.patterns.plusTotal);
  if (totalMatch) {
    total = parseFloat(totalMatch[1].replace(/,/g, ""));
    if (isNaN(total)) total = null;
  }

  return { earned, total };
}

/**
 * Parse merchant name from message
 * For failed payments: merchant is on the last line before any garbage
 * For successful payments: after Card line
 */
function parseMerchant(text: string): string | null {
  const lines = text.trim().split("\n");

  // Find the Card line index
  let cardLineIdx: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (defaultConfig.patterns.card.test(lines[i])) {
      cardLineIdx = i;
      break;
    }
  }

  if (cardLineIdx === null || cardLineIdx >= lines.length - 1) {
    return null;
  }

  // Merchant is on the line(s) after Card, before Plus info or date
  const merchantLines: string[] = [];
  for (let i = cardLineIdx + 1; i < lines.length; i++) {
    let line = lines[i].trim();

    // Remove trailing garbage (non-printable chars, random chars at end)
    line = line.replace(/[\x00-\x1F\x7F-\x9F]+.*$/, "").trim();

    // Stop conditions
    if (defaultConfig.patterns.date.test(line)) break;
    if (line.includes("PLUS")) break;
    if (line.includes("დაგერიცხებათ")) break;
    if (line.includes("სულ:")) break;

    if (line) {
      merchantLines.push(line);
    }
  }

  return merchantLines.length > 0 ? merchantLines.join(" ") : null;
}

/**
 * Detect transaction type from message
 */
function detectTransactionType(text: string): { type: TransactionType; status: TransactionStatus } {
  // Check for failed payment first
  if (text.includes("გადახდა ვერ შესრულდა")) {
    return { type: "payment_failed", status: "failed" };
  }

  // Check for successful payment
  if (defaultConfig.patterns.payment.trigger.test(text)) {
    return { type: "payment", status: "success" };
  }

  return { type: "unknown", status: "failed" };
}

/**
 * Generate unique ID for a transaction
 */
function generateTransactionId(messageId: number, text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `${messageId}-${Math.abs(hash).toString(16)}`;
}

/**
 * Parse a single message into a transaction
 */
export function parseMessage(raw: RawMessage): Transaction | null {
  const text = raw.text;

  // Detect transaction type
  const { type: txType, status } = detectTransactionType(text);
  if (txType === "unknown") {
    return null;
  }

  // Parse based on type
  let amount: number | null = null;
  let currency = "GEL";
  let balance: number | null = null;
  let failureReason: string | null = null;

  if (status === "success") {
    const amountResult = parseSuccessfulAmount(text);
    if (!amountResult) {
      return null;
    }
    amount = amountResult.amount;
    currency = amountResult.currency;
  } else {
    // Failed payment
    failureReason = parseFailureReason(text);
    const balanceResult = parseBalance(text);
    if (balanceResult) {
      balance = balanceResult.balance;
      currency = balanceResult.currency;
    }
  }

  // Parse other fields
  const card = parseCard(text);
  const txDate = parseDate(text) || raw.timestamp;
  const merchant = parseMerchant(text);
  const plusPoints = parsePlusPoints(text);

  return {
    id: generateTransactionId(raw.messageId, text),
    messageId: raw.messageId,
    transactionType: txType,
    status,
    amount,
    currency,
    merchant,
    cardLastDigits: card,
    transactionDate: txDate,
    messageTimestamp: raw.timestamp,
    rawMessage: text,
    failureReason,
    balance,
    plusEarned: plusPoints.earned,
    plusTotal: plusPoints.total,
  };
}

/**
 * Parse multiple messages
 */
export function parseMessages(messages: RawMessage[]): ParseResult {
  const success: Transaction[] = [];
  const failed: RawMessage[] = [];

  for (const msg of messages) {
    const tx = parseMessage(msg);
    if (tx) {
      success.push(tx);
    } else {
      failed.push(msg);
    }
  }

  return { success, failed };
}

/**
 * Filter transactions by status
 */
export function filterByStatus(transactions: Transaction[], status: TransactionStatus): Transaction[] {
  return transactions.filter(tx => tx.status === status);
}
