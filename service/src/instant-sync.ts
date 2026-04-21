import { init, id } from "@instantdb/admin";
import schema from "./instant-schema";
import type { Config } from "./config";
import type { Transaction } from "./parser";

export interface InstantSyncResult {
  success: boolean;
  syncedCount: number;
  paymentsCount: number;
  failedPaymentsCount: number;
  creditsCount: number;
  error?: string;
}

let db: ReturnType<typeof init<typeof schema>> | null = null;

/**
 * In-memory cache of transactionIds already written to InstantDB, across
 * all three namespaces (payments, failedPayments, credits). Populated on
 * the first sync after startup and kept warm thereafter.
 *
 * Rationale: our `transactionId` field has a schema-level `unique()`
 * constraint, but because the setup wizard bootstraps namespaces by doing
 * a schemaless `init()` (to get around "attributes are missing" on empty
 * apps), that uniqueness is not enforced server-side. Without this cache,
 * re-running the service after `rm ~/.xarji/state.db` would re-insert
 * every historical row as a duplicate.
 */
let syncedIds: Set<string> | null = null;

/**
 * Split a batch of transactions into the three destination tables.
 * Pure function — exported for direct testing without spinning up a DB.
 *
 * Rule: direction === "in" → credits, status === "failed" → failedPayments,
 * everything else → payments. The direction check runs first so a failed
 * incoming (if we ever add that kind) still lands with other incoming.
 */
export function routeTransactions(transactions: Transaction[]): {
  credits: Transaction[];
  failedPayments: Transaction[];
  successfulPayments: Transaction[];
} {
  const credits = transactions.filter((tx) => tx.direction === "in");
  const failedPayments = transactions.filter(
    (tx) => tx.direction !== "in" && tx.status === "failed"
  );
  const successfulPayments = transactions.filter(
    (tx) => tx.direction !== "in" && tx.status === "success"
  );
  return { credits, failedPayments, successfulPayments };
}

/**
 * Drop transactions whose id already appears in `existingIds`. Returns the
 * filtered list and the count skipped. Pure function.
 */
export function applyDedup(
  transactions: Transaction[],
  existingIds: ReadonlySet<string>
): { toSync: Transaction[]; skipped: number } {
  const toSync = transactions.filter((t) => !existingIds.has(t.id));
  return { toSync, skipped: transactions.length - toSync.length };
}

async function loadSyncedIds(): Promise<Set<string>> {
  if (!db) return new Set();
  const ids = new Set<string>();
  try {
    const res = await db.query({
      payments: { $: { limit: 100000 } },
      failedPayments: { $: { limit: 100000 } },
      credits: { $: { limit: 100000 } },
    });
    for (const p of res.payments || []) if (p.transactionId) ids.add(p.transactionId);
    for (const p of res.failedPayments || []) if (p.transactionId) ids.add(p.transactionId);
    for (const c of res.credits || []) if (c.transactionId) ids.add(c.transactionId);
    console.log(`[InstantDB] Loaded ${ids.size} existing transactionIds for dedup`);
  } catch (err) {
    console.error("[InstantDB] Could not preload dedup set, proceeding without it:", err);
  }
  return ids;
}

/**
 * Initialize InstantDB connection
 */
export function initInstantDB(config: Config["instantdb"]): boolean {
  if (!config.enabled) {
    console.log("[InstantDB] Sync disabled");
    return false;
  }

  if (!config.appId || !config.adminToken) {
    console.error("[InstantDB] Missing appId or adminToken");
    return false;
  }

  try {
    db = init({
      appId: config.appId,
      adminToken: config.adminToken,
      schema,
    });
    console.log("[InstantDB] Initialized successfully");
    return true;
  } catch (error) {
    console.error("[InstantDB] Failed to initialize:", error);
    return false;
  }
}

/**
 * Sync transactions to InstantDB - routes to correct table based on status
 */
export async function syncTransactions(
  transactions: Transaction[],
  bankSenderId: string
): Promise<InstantSyncResult> {
  if (!db) {
    return { success: false, syncedCount: 0, paymentsCount: 0, failedPaymentsCount: 0, creditsCount: 0, error: "InstantDB not initialized" };
  }

  if (transactions.length === 0) {
    return { success: true, syncedCount: 0, paymentsCount: 0, failedPaymentsCount: 0, creditsCount: 0 };
  }

  try {
    // Lazy-load the dedup cache on first call. Subsequent calls just read it.
    if (syncedIds === null) {
      syncedIds = await loadSyncedIds();
    }
    const dedupSet = syncedIds;
    const { toSync, skipped } = applyDedup(transactions, dedupSet);
    transactions = toSync;
    if (skipped > 0) {
      console.log(`[InstantDB] Skipping ${skipped} already-synced transactions (dedup)`);
    }

    if (transactions.length === 0) {
      return { success: true, syncedCount: 0, paymentsCount: 0, failedPaymentsCount: 0, creditsCount: 0 };
    }

    const now = Date.now();
    const operations: any[] = [];

    const { credits, failedPayments, successfulPayments } = routeTransactions(transactions);

    for (const tx of successfulPayments) {
      const txId = id();
      operations.push(
        db.tx.payments[txId].update({
          transactionId: tx.id,
          transactionType: tx.transactionType,
          amount: tx.amount!,
          currency: tx.currency,
          merchant: tx.merchant,
          cardLastDigits: tx.cardLastDigits,
          transactionDate: tx.transactionDate.getTime(),
          messageTimestamp: tx.messageTimestamp.getTime(),
          syncedAt: now,
          plusEarned: tx.plusEarned,
          plusTotal: tx.plusTotal,
          bankSenderId,
          rawMessage: tx.rawMessage,
        })
      );
    }

    for (const tx of failedPayments) {
      const txId = id();
      operations.push(
        db.tx.failedPayments[txId].update({
          transactionId: tx.id,
          transactionType: tx.transactionType,
          currency: tx.currency,
          merchant: tx.merchant,
          cardLastDigits: tx.cardLastDigits,
          failureReason: tx.failureReason,
          balance: tx.balance,
          transactionDate: tx.transactionDate.getTime(),
          messageTimestamp: tx.messageTimestamp.getTime(),
          syncedAt: now,
          bankSenderId,
          rawMessage: tx.rawMessage,
        })
      );
    }

    for (const tx of credits) {
      if (tx.amount === null) continue;
      const txId = id();
      operations.push(
        db.tx.credits[txId].update({
          transactionId: tx.id,
          transactionType: tx.transactionType,
          amount: tx.amount,
          currency: tx.currency,
          counterparty: tx.counterparty ?? tx.merchant,
          cardLastDigits: tx.cardLastDigits,
          transactionDate: tx.transactionDate.getTime(),
          messageTimestamp: tx.messageTimestamp.getTime(),
          syncedAt: now,
          bankSenderId,
          rawMessage: tx.rawMessage,
        })
      );
    }

    if (operations.length > 0) {
      await db.transact(operations);
      // Record the ids we just wrote so a subsequent call in the same process
      // won't retry them.
      for (const tx of transactions) dedupSet.add(tx.id);
    }

    console.log(
      `[InstantDB] Synced ${successfulPayments.length} payments, ${failedPayments.length} failed, ${credits.length} credits`
    );
    return {
      success: true,
      syncedCount: transactions.length,
      paymentsCount: successfulPayments.length,
      failedPaymentsCount: failedPayments.length,
      creditsCount: credits.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[InstantDB] Batch sync error:", message);
    return {
      success: false,
      syncedCount: 0,
      paymentsCount: 0,
      failedPaymentsCount: 0,
      creditsCount: 0,
      error: message,
    };
  }
}

/**
 * Query payments from InstantDB
 */
export async function queryPayments(options?: {
  limit?: number;
  currency?: string;
  merchant?: string;
}): Promise<{ payments: any[]; error?: string }> {
  if (!db) {
    return { payments: [], error: "InstantDB not initialized" };
  }

  try {
    const whereClause: Record<string, any> = {};
    if (options?.currency) whereClause.currency = options.currency;
    if (options?.merchant) whereClause.merchant = options.merchant;

    // `where` in the admin SDK's query types is currently `undefined`-only,
    // so build the $ object dynamically to avoid a type clash while still
    // sending the filter when caller supplied one.
    const $: Record<string, unknown> = { limit: options?.limit || 100 };
    if (Object.keys(whereClause).length > 0) $.where = whereClause;

    const result = await db.query({
      payments: { $ } as any,
    });

    return { payments: result.payments || [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { payments: [], error: message };
  }
}

/**
 * Query failed payments from InstantDB
 */
export async function queryFailedPayments(options?: {
  limit?: number;
}): Promise<{ failedPayments: any[]; error?: string }> {
  if (!db) {
    return { failedPayments: [], error: "InstantDB not initialized" };
  }

  try {
    const result = await db.query({
      failedPayments: {
        $: {
          limit: options?.limit || 100,
        },
      },
    });

    return { failedPayments: result.failedPayments || [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { failedPayments: [], error: message };
  }
}

/**
 * Check if InstantDB is connected
 */
export function isConnected(): boolean {
  return db !== null;
}

/**
 * Close InstantDB connection
 */
export function closeInstantDB(): void {
  db = null;
  syncedIds = null;
  console.log("[InstantDB] Connection closed");
}
