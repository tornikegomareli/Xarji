import { mkdir } from "fs/promises";
import { dirname } from "path";
import { defaultConfig, type Config } from "./config";
import type { Transaction } from "./parser";
import {
  initInstantDB,
  syncTransactions as syncToInstantDB,
  isConnected as isInstantDBConnected,
  type InstantSyncResult,
} from "./instant-sync";

export interface SyncResult {
  success: boolean;
  syncedCount?: number;
  error?: string;
}

/**
 * Append transactions to local JSON file
 */
export async function syncToLocalFile(
  transactions: Transaction[],
  filePath: string = defaultConfig.localBackupPath
): Promise<SyncResult> {
  try {
    // Ensure directory exists
    await mkdir(dirname(filePath), { recursive: true });

    // Read existing data
    let existing: Transaction[] = [];
    const file = Bun.file(filePath);

    if (await file.exists()) {
      try {
        const content = await file.json();
        existing = content.transactions || [];
      } catch {
        // File exists but is empty or invalid, start fresh
      }
    }

    // Merge new transactions (dedupe by ID)
    const existingIds = new Set(existing.map((t) => t.id));
    const newTransactions = transactions.filter((t) => !existingIds.has(t.id));

    if (newTransactions.length === 0) {
      return { success: true };
    }

    const merged = [...existing, ...newTransactions];

    // Sort by date (newest first)
    merged.sort(
      (a, b) =>
        new Date(b.transactionDate).getTime() -
        new Date(a.transactionDate).getTime()
    );

    // Write back
    const output = {
      lastUpdated: new Date().toISOString(),
      transactionCount: merged.length,
      transactions: merged,
    };

    await Bun.write(filePath, JSON.stringify(output, null, 2));

    console.log(`[LocalSync] Saved ${newTransactions.length} new transactions to ${filePath}`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[LocalSync] Error: ${message}`);
    return { success: false, error: message };
  }
}

/**
 * Send transactions to webhook endpoint
 */
export async function syncToWebhook(
  transactions: Transaction[],
  config: Config["webhook"]
): Promise<SyncResult> {
  if (!config.enabled || !config.url) {
    return { success: true }; // Webhook disabled, consider success
  }

  if (transactions.length === 0) {
    return { success: true };
  }

  try {
    const payload = {
      timestamp: new Date().toISOString(),
      transactionCount: transactions.length,
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.transactionType,
        amount: t.amount,
        currency: t.currency,
        merchant: t.merchant,
        cardLastDigits: t.cardLastDigits,
        transactionDate: t.transactionDate.toISOString(),
        messageTimestamp: t.messageTimestamp.toISOString(),
        plusEarned: t.plusEarned,
        plusTotal: t.plusTotal,
      })),
    };

    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    console.log(`[Webhook] Sent ${transactions.length} transactions to ${config.url}`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Webhook] Error: ${message}`);
    return { success: false, error: message };
  }
}

/**
 * Initialize sync targets
 */
export function initSyncTargets(config: Config): void {
  // Initialize InstantDB if configured
  if (config.instantdb.enabled) {
    initInstantDB(config.instantdb);
  }
}

/**
 * Sync transactions to InstantDB
 */
async function syncToInstant(
  transactions: Transaction[],
  config: Config,
  bankSenderId: string,
  stateDb?: import("./state-db").StateDb
): Promise<SyncResult> {
  if (!config.instantdb.enabled) {
    return { success: true, syncedCount: 0 };
  }

  if (!isInstantDBConnected()) {
    // Try to initialize
    const initialized = initInstantDB(config.instantdb);
    if (!initialized) {
      return { success: false, syncedCount: 0, error: "Failed to initialize InstantDB" };
    }
  }

  const result = await syncToInstantDB(transactions, bankSenderId, stateDb);
  return {
    success: result.success,
    syncedCount: result.syncedCount,
    error: result.error,
  };
}

/**
 * Sync transactions to all configured targets. The optional `stateDb`
 * is threaded into the InstantDB path so the dedup logic can union
 * user-tombstoned transactionIds into its skip set; without it, deleted
 * transactions would re-import on the next sync.
 */
export async function syncAllTargets(
  transactions: Transaction[],
  config: Config,
  bankSenderId: string = "SOLO",
  stateDb?: import("./state-db").StateDb
): Promise<{ local: SyncResult; webhook: SyncResult; instantdb: SyncResult }> {
  const [local, webhook, instantdb] = await Promise.all([
    syncToLocalFile(transactions, config.localBackupPath),
    syncToWebhook(transactions, config.webhook),
    syncToInstant(transactions, config, bankSenderId, stateDb),
  ]);

  return { local, webhook, instantdb };
}

// Keep old function for backward compatibility
export async function syncTransactions(
  transactions: Transaction[],
  config: Config
): Promise<{ local: SyncResult; webhook: SyncResult }> {
  const [local, webhook] = await Promise.all([
    syncToLocalFile(transactions, config.localBackupPath),
    syncToWebhook(transactions, config.webhook),
  ]);

  return { local, webhook };
}
