/**
 * Parser registry + public entry points.
 *
 * Adding a new bank:
 *   1. Create `./<bank>.ts` that exports a `BankParser`.
 *   2. Import + register it below.
 */

import type { RawMessage } from "../db-reader";
import type { BankParser, ParseResult, Transaction } from "./types";
import { soloParser } from "./solo";
import { tbcParser } from "./tbc";
import { isSecurityMessage } from "./security";

export type { BankParser, ParseResult, Transaction } from "./types";
export type {
  TransactionKind,
  TransactionStatus,
  TransactionDirection,
} from "./types";

const PARSERS: readonly BankParser[] = [soloParser, tbcParser];

// Pre-compute sender-id -> parser map for fast lookup.
const PARSER_BY_SENDER: Map<string, BankParser> = new Map();
for (const p of PARSERS) {
  for (const id of p.senderIds) PARSER_BY_SENDER.set(id, p);
}

export function getParserForSender(senderId: string): BankParser | null {
  return PARSER_BY_SENDER.get(senderId) ?? null;
}

export function allBanks(): readonly BankParser[] {
  return PARSERS;
}

/**
 * Parse a single raw message. Returns null for messages that don't match
 * any registered parser's recognised kinds (marketing, codes, notices, …).
 */
export function parseMessage(raw: RawMessage): Transaction | null {
  if (isSecurityMessage(raw.text)) return null;
  const parser = getParserForSender(raw.senderId);
  if (!parser) return null;
  return parser.parse(raw);
}

/**
 * Bulk parse. Security messages are omitted. Other messages that fail routing
 * or per-bank parsing are collected
 * into `failed` so callers can log them for diagnosis.
 */
export function parseMessages(messages: readonly RawMessage[]): ParseResult {
  const success: Transaction[] = [];
  const failed: RawMessage[] = [];
  for (const msg of messages) {
    if (isSecurityMessage(msg.text)) continue;
    const tx = parseMessage(msg);
    if (tx) success.push(tx);
    else failed.push(msg);
  }
  return { success, failed };
}

export function filterByStatus(
  transactions: readonly Transaction[],
  status: "success" | "failed"
): Transaction[] {
  return transactions.filter((tx) => tx.status === status);
}
