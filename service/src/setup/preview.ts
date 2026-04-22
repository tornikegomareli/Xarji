/**
 * Read-only pre-flight sampler for the onboarding wizard.
 *
 * Given a list of bank-sender IDs, opens the macOS Messages SQLite
 * store (`~/Library/Messages/chat.db`) read-only, feeds every message
 * from each sender through the parser registry, and returns counts +
 * a handful of sample transactions per bank — without writing anything
 * to state.db or to InstantDB. The user sees their own numbers before
 * the wizard commits any credentials.
 *
 * Intentionally independent of the rest of setup/: it doesn't need the
 * FieldMap and doesn't produce a Config, so it can run before the
 * final submit. No config file on disk is required.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { accessSync } from "node:fs";
import { MessagesDbReader } from "../db-reader";
import { parseMessage, type Transaction } from "../parser";

export interface PreviewSample {
  merchant: string | null;
  amount: number | null;
  currency: string;
  direction: "in" | "out";
  transactionDate: string; // ISO
  kind: string;
}

export interface PreviewBank {
  senderId: string;
  messageCount: number;
  parsedCount: number;
  failedCount: number;
  /** Up to 5 most-recent successfully parsed transactions. */
  samples: PreviewSample[];
}

export type PreviewErrorKind = "full-disk-access" | "messages-db-missing" | "internal";

export interface PreviewResult {
  ok: boolean;
  banks: PreviewBank[];
  /** Only set when ok === false. */
  error?: string;
  errorKind?: PreviewErrorKind;
}

export interface PreviewOptions {
  /** Path to chat.db. Defaults to the standard macOS location. */
  messagesDbPath?: string;
  /** Maximum raw messages to read per sender. Keeps the preview cheap. */
  perSenderLimit?: number;
  /** Maximum sample transactions returned per bank. */
  sampleLimit?: number;
}

const DEFAULT_MESSAGES_DB = join(homedir(), "Library", "Messages", "chat.db");

function toSample(tx: Transaction): PreviewSample {
  return {
    merchant: tx.merchant,
    amount: tx.amount,
    currency: tx.currency,
    direction: tx.direction,
    transactionDate: tx.transactionDate.toISOString(),
    kind: tx.transactionType,
  };
}

/**
 * Run the preview. Returns an `ok: false` result (never throws) for the
 * expected error modes so the UI can render a specific recovery hint.
 */
export function previewSenders(
  senderIds: readonly string[],
  opts: PreviewOptions = {}
): PreviewResult {
  const dbPath = opts.messagesDbPath ?? DEFAULT_MESSAGES_DB;
  const perSenderLimit = opts.perSenderLimit ?? 2000;
  const sampleLimit = opts.sampleLimit ?? 5;

  // Distinguish "file doesn't exist" from "no permission to read it"
  // so the UI can link to the right System Settings pane.
  try {
    accessSync(dbPath);
  } catch {
    return {
      ok: false,
      banks: [],
      error: `Messages database not found at ${dbPath}`,
      errorKind: "messages-db-missing",
    };
  }

  let reader: MessagesDbReader;
  try {
    reader = new MessagesDbReader(dbPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // bun:sqlite surfaces sandbox / permission rejections as open errors.
    const denied = /permission|operation not permitted|authorization/i.test(message);
    return {
      ok: false,
      banks: [],
      error: denied
        ? "Xarji can't read the Messages database. Grant Full Disk Access to this app in System Settings → Privacy & Security → Full Disk Access."
        : message,
      errorKind: denied ? "full-disk-access" : "internal",
    };
  }

  const banks: PreviewBank[] = [];
  try {
    for (const senderId of senderIds) {
      const messages = reader.getMessagesBySender(senderId, perSenderLimit);

      let parsedCount = 0;
      let failedCount = 0;
      // Keep samples in chronological order (newest first since the reader
      // already returns DESC by date). Parse everything but only hold the
      // first `sampleLimit` successful ones.
      const samples: PreviewSample[] = [];

      for (const raw of messages) {
        const tx = parseMessage(raw);
        if (tx) {
          parsedCount += 1;
          if (samples.length < sampleLimit) {
            samples.push(toSample(tx));
          }
        } else {
          failedCount += 1;
        }
      }

      banks.push({
        senderId,
        messageCount: messages.length,
        parsedCount,
        failedCount,
        samples,
      });
    }
  } catch (err) {
    reader.close();
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      banks,
      error: message,
      errorKind: "internal",
    };
  }

  reader.close();
  return { ok: true, banks };
}
