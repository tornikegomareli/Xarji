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

export const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * One `xarji.payment/v1` event per transaction. `rawMessage` is left out
 * on purpose: the SMS text carries balances and card details the
 * receiver doesn't need.
 */
export function buildWebhookEvent(tx: Transaction, receivedAt: Date = new Date()) {
  return {
    schema: "xarji.payment/v1",
    source: "xarji",
    eventId: tx.id,
    receivedAt: receivedAt.toISOString(),
    transaction: {
      id: tx.id,
      messageId: tx.messageId,
      bankKey: tx.bankKey,
      bankSenderId: tx.bankSenderId,
      kind: tx.transactionType,
      status: tx.status,
      direction: tx.direction,
      amount: tx.amount,
      currency: tx.currency,
      merchant: tx.merchant,
      counterparty: tx.counterparty,
      cardLastDigits: tx.cardLastDigits,
      balance: tx.balance,
      failureReason: tx.failureReason,
      transactionDate: tx.transactionDate.toISOString(),
      messageTimestamp: tx.messageTimestamp.toISOString(),
    },
  };
}

export function buildTestEvent(receivedAt: Date = new Date()) {
  return { schema: "xarji.test/v1", test: true, source: "xarji", receivedAt: receivedAt.toISOString() };
}

/**
 * Turns the Settings form `{ url, secret }` into the webhook config to
 * save. An empty URL turns the webhook off and drops the secret. An
 * empty secret keeps the saved one, so the user can change the URL
 * without pasting the secret again.
 */
export function parseWebhookUpdate(
  current: Config["webhook"],
  body: { url?: unknown; secret?: unknown }
): { ok: true; webhook: Config["webhook"] } | { ok: false; error: string } {
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) return { ok: true, webhook: { enabled: false, url: "", headers: {} } };

  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return { ok: false, error: "URL is not valid" };
  }
  if (protocol !== "https:" && protocol !== "http:") {
    return { ok: false, error: "URL must start with https:// or http://" };
  }

  // People often paste the whole header value.
  const secret = typeof body.secret === "string" ? body.secret.trim().replace(/^bearer\s+/i, "") : "";
  const headers = secret ? { Authorization: `Bearer ${secret}` } : (current.headers ?? {});
  return { ok: true, webhook: { enabled: true, url, headers } };
}

/** POSTs one JSON body. Returns the HTTP status; throws on network error or timeout. */
export async function sendWebhook(webhook: Config["webhook"], body: string): Promise<number> {
  const response = await fetch(webhook.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...webhook.headers },
    body,
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  return response.status;
}

/**
 * Delivers queued events oldest first. Stops at the first retryable
 * failure (network, timeout, 408, 429, 5xx) so events never arrive out
 * of order. Any other non-2xx status will not succeed on retry, so the
 * event is logged and dropped to keep it from blocking the queue.
 */
export async function deliverWebhookQueue(
  stateDb: import("./state-db").StateDb,
  webhook: Config["webhook"]
): Promise<SyncResult> {
  let delivered = 0;
  for (const event of stateDb.pendingWebhookEvents()) {
    let status: number;
    try {
      status = await sendWebhook(webhook, event.payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Webhook] ${event.eventId}: ${message} — will retry`);
      return { success: false, syncedCount: delivered, error: message };
    }

    if (status >= 200 && status < 300) {
      stateDb.markWebhookDelivered(event.eventId);
      delivered++;
      continue;
    }

    if (status === 408 || status === 429 || status >= 500) {
      console.error(`[Webhook] ${event.eventId}: HTTP ${status} — will retry`);
      return { success: false, syncedCount: delivered, error: `HTTP ${status}` };
    }

    console.error(`[Webhook] Dropping ${event.eventId}: HTTP ${status} is not retryable`);
    stateDb.markWebhookDelivered(event.eventId);
  }

  if (delivered > 0) console.log(`[Webhook] Delivered ${delivered} event(s) to ${webhook.url}`);
  return { success: true, syncedCount: delivered };
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
): Promise<{ local: SyncResult; instantdb: SyncResult }> {
  const [local, instantdb] = await Promise.all([
    syncToLocalFile(transactions, config.localBackupPath),
    syncToInstant(transactions, config, bankSenderId, stateDb),
  ]);

  return { local, instantdb };
}
