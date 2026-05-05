import { Database } from "bun:sqlite";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import { defaultConfig } from "./config";
import type { Transaction, TransactionKind } from "./parser";

interface TransactionRow {
  id: string;
  message_id: number;
  transaction_type: string;
  amount: number;
  currency: string;
  merchant: string | null;
  card_last_digits: string | null;
  transaction_date: string;
  message_timestamp: string;
  raw_message: string;
  plus_earned: number | null;
  plus_total: number | null;
}

/**
 * Honest shape of what `processed_transactions` actually stores. This is
 * deliberately narrower than `Transaction` — the local cache persists
 * only the columns the CLI + legacy webhook code were written against,
 * so reconstructing a full Transaction here would require fabricating
 * bankKey, direction, status, failureReason, balance and counterparty.
 * InstantDB is the source of truth for those; state.db's only job is
 * per-message-id dedup and a thin local backup.
 */
export interface StoredTransaction {
  id: string;
  messageId: number;
  transactionType: TransactionKind;
  amount: number;
  currency: string;
  merchant: string | null;
  cardLastDigits: string | null;
  transactionDate: Date;
  messageTimestamp: Date;
  rawMessage: string;
  plusEarned: number | null;
  plusTotal: number | null;
}

function rowToStoredTransaction(row: TransactionRow): StoredTransaction {
  return {
    id: row.id,
    messageId: row.message_id,
    transactionType: row.transaction_type as TransactionKind,
    amount: row.amount,
    currency: row.currency,
    merchant: row.merchant,
    cardLastDigits: row.card_last_digits,
    transactionDate: new Date(row.transaction_date),
    messageTimestamp: new Date(row.message_timestamp),
    rawMessage: row.raw_message,
    plusEarned: row.plus_earned,
    plusTotal: row.plus_total,
  };
}

export interface SyncState {
  senderId: string;
  lastMessageId: number;
  lastSyncAt: Date;
}

/**
 * The kinds of InstantDB collections a tombstone can apply to.
 * Mirrors `routeTransactions`'s output buckets so we can recover the
 * source collection if we ever need to re-import a tombstoned row.
 */
export type TombstoneKind = "payment" | "credit" | "failedPayment";

export class StateDb {
  private db: Database;

  constructor(dbPath: string = defaultConfig.stateDbPath) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    // Create tables if they don't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        sender_id TEXT PRIMARY KEY,
        last_message_id INTEGER NOT NULL DEFAULT 0,
        last_sync_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processed_transactions (
        id TEXT PRIMARY KEY,
        message_id INTEGER NOT NULL,
        transaction_type TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        merchant TEXT,
        card_last_digits TEXT,
        transaction_date TEXT NOT NULL,
        message_timestamp TEXT NOT NULL,
        raw_message TEXT NOT NULL,
        plus_earned REAL,
        plus_total REAL,
        synced_at TEXT NOT NULL,
        webhook_sent INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_date
        ON processed_transactions(transaction_date);

      CREATE INDEX IF NOT EXISTS idx_transactions_message_id
        ON processed_transactions(message_id);

      -- User-deleted transactions. The dedup hot-path in instant-sync.ts
      -- merges these IDs into its existing-IDs Set so a re-encountered
      -- SMS skips through the same dedup path as already-synced rows.
      -- Stays-deleted across service restarts, since this table is on
      -- disk in ~/.xarji/state.db (not in InstantDB).
      CREATE TABLE IF NOT EXISTS deleted_transactions (
        transaction_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        deleted_at TEXT NOT NULL
      );
    `);
  }

  /**
   * Record a user-initiated tombstone. Subsequent syncs see the
   * `transactionId` in the dedup Set via `loadDeletedTransactionIds`
   * and skip re-importing the SMS even though the InstantDB row is
   * gone. INSERT OR REPLACE so a double-delete is idempotent.
   */
  markTransactionDeleted(transactionId: string, kind: TombstoneKind): void {
    this.db
      .query(
        `
        INSERT INTO deleted_transactions (transaction_id, kind, deleted_at)
        VALUES (?, ?, ?)
        ON CONFLICT(transaction_id) DO UPDATE SET
          kind = excluded.kind,
          deleted_at = excluded.deleted_at
      `
      )
      .run(transactionId, kind, new Date().toISOString());
  }

  /** True if the user previously deleted this transaction. */
  isTransactionDeleted(transactionId: string): boolean {
    const row = this.db
      .query("SELECT 1 FROM deleted_transactions WHERE transaction_id = ?")
      .get(transactionId);
    return row !== null;
  }

  /**
   * Bulk read for the dedup hot path. Returns a Set so the syncer can
   * union it with the existing transactionIds in O(n+m) and call the
   * existing applyDedup unmodified.
   */
  loadDeletedTransactionIds(): Set<string> {
    const rows = this.db
      .query("SELECT transaction_id FROM deleted_transactions")
      .all() as Array<{ transaction_id: string }>;
    return new Set(rows.map((r) => r.transaction_id));
  }

  /**
   * Get sync state for a sender
   */
  getSyncState(senderId: string): SyncState | null {
    const row = this.db
      .query("SELECT * FROM sync_state WHERE sender_id = ?")
      .get(senderId) as {
      sender_id: string;
      last_message_id: number;
      last_sync_at: string;
    } | null;

    if (!row) return null;

    return {
      senderId: row.sender_id,
      lastMessageId: row.last_message_id,
      lastSyncAt: new Date(row.last_sync_at),
    };
  }

  /**
   * Update sync state for a sender
   */
  updateSyncState(senderId: string, lastMessageId: number): void {
    this.db
      .query(
        `
        INSERT INTO sync_state (sender_id, last_message_id, last_sync_at)
        VALUES (?, ?, ?)
        ON CONFLICT(sender_id) DO UPDATE SET
          last_message_id = excluded.last_message_id,
          last_sync_at = excluded.last_sync_at
      `
      )
      .run(senderId, lastMessageId, new Date().toISOString());
  }

  /**
   * Check if a transaction has already been processed
   */
  isProcessed(transactionId: string): boolean {
    const row = this.db
      .query("SELECT 1 FROM processed_transactions WHERE id = ?")
      .get(transactionId);
    return row !== null;
  }

  /**
   * Save a processed transaction
   */
  saveTransaction(tx: Transaction, webhookSent: boolean = false): void {
    this.db
      .query(
        `
        INSERT OR IGNORE INTO processed_transactions (
          id, message_id, transaction_type, amount, currency,
          merchant, card_last_digits, transaction_date, message_timestamp,
          raw_message, plus_earned, plus_total, synced_at, webhook_sent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        tx.id,
        tx.messageId,
        tx.transactionType,
        tx.amount,
        tx.currency,
        tx.merchant,
        tx.cardLastDigits,
        tx.transactionDate.toISOString(),
        tx.messageTimestamp.toISOString(),
        tx.rawMessage,
        tx.plusEarned,
        tx.plusTotal,
        new Date().toISOString(),
        webhookSent ? 1 : 0
      );
  }

  /**
   * Mark transaction as webhook sent
   */
  markWebhookSent(transactionId: string): void {
    this.db
      .query("UPDATE processed_transactions SET webhook_sent = 1 WHERE id = ?")
      .run(transactionId);
  }

  /**
   * Get transactions that haven't been sent via webhook
   */
  getUnsyncedTransactions(): StoredTransaction[] {
    const rows = this.db
      .query("SELECT * FROM processed_transactions WHERE webhook_sent = 0")
      .all() as TransactionRow[];
    return rows.map((row) => rowToStoredTransaction(row));
  }

  /**
   * Get all processed transactions
   */
  getAllTransactions(limit: number = 1000): StoredTransaction[] {
    const rows = this.db
      .query(
        "SELECT * FROM processed_transactions ORDER BY transaction_date DESC LIMIT ?"
      )
      .all(limit) as TransactionRow[];
    return rows.map((row) => rowToStoredTransaction(row));
  }

  /**
   * Get transaction count
   */
  getTransactionCount(): number {
    const row = this.db
      .query("SELECT COUNT(*) as count FROM processed_transactions")
      .get() as { count: number };
    return row.count;
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Ensure state database directory exists
 */
export async function ensureStateDbDir(): Promise<void> {
  const dir = dirname(defaultConfig.stateDbPath);
  await mkdir(dir, { recursive: true });
}
