import { Database } from "bun:sqlite";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import { defaultConfig } from "./config";
import type { Transaction } from "./parser";

export interface SyncState {
  senderId: string;
  lastMessageId: number;
  lastSyncAt: Date;
}

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
    `);
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
  getUnsyncedTransactions(): Transaction[] {
    const rows = this.db
      .query("SELECT * FROM processed_transactions WHERE webhook_sent = 0")
      .all() as Array<{
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
    }>;

    return rows.map((row) => ({
      id: row.id,
      messageId: row.message_id,
      transactionType: row.transaction_type as Transaction["transactionType"],
      amount: row.amount,
      currency: row.currency,
      merchant: row.merchant,
      cardLastDigits: row.card_last_digits,
      transactionDate: new Date(row.transaction_date),
      messageTimestamp: new Date(row.message_timestamp),
      rawMessage: row.raw_message,
      plusEarned: row.plus_earned,
      plusTotal: row.plus_total,
    }));
  }

  /**
   * Get all processed transactions
   */
  getAllTransactions(limit: number = 1000): Transaction[] {
    const rows = this.db
      .query(
        "SELECT * FROM processed_transactions ORDER BY transaction_date DESC LIMIT ?"
      )
      .all(limit) as Array<{
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
    }>;

    return rows.map((row) => ({
      id: row.id,
      messageId: row.message_id,
      transactionType: row.transaction_type as Transaction["transactionType"],
      amount: row.amount,
      currency: row.currency,
      merchant: row.merchant,
      cardLastDigits: row.card_last_digits,
      transactionDate: new Date(row.transaction_date),
      messageTimestamp: new Date(row.message_timestamp),
      rawMessage: row.raw_message,
      plusEarned: row.plus_earned,
      plusTotal: row.plus_total,
    }));
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
