import { watch } from "fs";
import { MessagesDbReader } from "./db-reader";
import { parseMessages } from "./parser";
import { StateDb, ensureStateDbDir } from "./state-db";
import { syncAllTargets, initSyncTargets } from "./sync";
import { defaultConfig, type Config } from "./config";
import { closeInstantDB, isConnected as isInstantDBConnected } from "./instant-sync";

export type SyncTargetName = "local" | "webhook" | "instantdb";

export interface SyncFailure {
  sender: string;
  target: SyncTargetName;
  error: string;
}

/** Result of `processNewMessages`. `synced` counts only the transactions
 *  that landed in every enabled target — partial successes are
 *  intentionally excluded from the count so the UI never reports a
 *  number that overstates how many made it to the user's destination. */
export interface SyncOutcome {
  synced: number;
  failures: SyncFailure[];
}

export class ExpenseTrackerService {
  private config: Config;
  private stateDb: StateDb | null = null;
  private watcher: ReturnType<typeof watch> | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;
  private lastProcessTime = 0;
  private debounceMs = 2000; // Debounce file changes

  constructor(config: Config = defaultConfig) {
    this.config = config;
  }

  /**
   * Initialize the service
   */
  async init(): Promise<void> {
    console.log("[Service] Initializing SMS Expense Tracker...");

    // Ensure state directory exists
    await ensureStateDbDir();

    // Initialize state database
    this.stateDb = new StateDb(this.config.stateDbPath);
    console.log("[Service] State database initialized");

    // Initialize sync targets (InstantDB, etc.)
    initSyncTargets(this.config);
  }

  /**
   * Process new messages from all configured senders.
   *
   * Returns the count of transactions that landed in every enabled
   * target plus any per-target failures. The cursor (`last_message_id`)
   * only advances when ALL enabled targets succeeded for a batch — a
   * transient InstantDB or webhook failure now causes a retry on the
   * next run instead of silently leaving those messages out of the
   * destination forever.
   */
  async processNewMessages(): Promise<SyncOutcome> {
    if (this.isProcessing) {
      console.log("[Service] Already processing, skipping...");
      return { synced: 0, failures: [] };
    }

    // Debounce rapid file changes
    const now = Date.now();
    if (now - this.lastProcessTime < this.debounceMs) {
      return { synced: 0, failures: [] };
    }

    this.isProcessing = true;
    this.lastProcessTime = now;
    let totalNewTransactions = 0;
    const failures: SyncFailure[] = [];

    try {
      const reader = new MessagesDbReader(this.config.messagesDbPath);

      for (const senderId of this.config.bankSenderIds) {
        try {
          // Get last processed message ID
          const syncState = this.stateDb!.getSyncState(senderId);
          const lastMessageId = syncState?.lastMessageId ?? 0;

          console.log(`[Service] Checking ${senderId} (last ID: ${lastMessageId})`);

          // Get new messages since last sync
          const messages = reader.getMessagesSince(senderId, lastMessageId);

          if (messages.length === 0) {
            console.log(`[Service] No new messages from ${senderId}`);
            continue;
          }

          console.log(`[Service] Found ${messages.length} new messages from ${senderId}`);

          // Parse messages
          const { success, failed } = parseMessages(messages);

          console.log(
            `[Service] Parsed ${success.length} transactions, ${failed.length} failed`
          );

          // Filter out already processed transactions
          const newTransactions = success.filter(
            (tx) => !this.stateDb!.isProcessed(tx.id)
          );

          if (newTransactions.length === 0) {
            // Nothing parsed in this batch. Advance last_message_id ONLY if we
            // know we've seen these messages before (any parsed at all this
            // run). Otherwise leave it pinned so that adding a new parser
            // later can retroactively pick up old messages.
            //
            // Note: we also de-dup via `isProcessed`, so any already-parsed
            // transaction won't be written twice even if we re-fetch it.
            if (success.length > 0) {
              const maxParsedId = Math.max(...success.map((tx) => tx.messageId));
              this.stateDb!.updateSyncState(senderId, maxParsedId);
            } else {
              console.log(
                `[Service] ${senderId}: no parseable messages in this batch — leaving last_message_id at ${lastMessageId} so a future parser upgrade can retry.`
              );
            }
            continue;
          }

          // Sync to all targets (local, webhook, InstantDB)
          const syncResults = await syncAllTargets(newTransactions, this.config, senderId);

          // Determine which targets are enabled, then collect failures.
          // Local file is always enabled (it's the failsafe backup).
          // Webhook and InstantDB are config-gated.
          const targetChecks: Array<{ target: SyncTargetName; enabled: boolean; success: boolean; error?: string }> = [
            { target: "local", enabled: true, success: syncResults.local.success, error: syncResults.local.error },
            {
              target: "webhook",
              enabled: this.config.webhook.enabled && !!this.config.webhook.url,
              success: syncResults.webhook.success,
              error: syncResults.webhook.error,
            },
            {
              target: "instantdb",
              enabled: this.config.instantdb.enabled,
              success: syncResults.instantdb.success,
              error: syncResults.instantdb.error,
            },
          ];

          const enabledFailures = targetChecks
            .filter((t) => t.enabled && !t.success)
            .map((t) => ({ sender: senderId, target: t.target, error: t.error || "unknown error" }));

          if (enabledFailures.length > 0) {
            // Don't advance the cursor and don't mark transactions as
            // processed-for-state-db — next sync will retry the same
            // batch. Surface the failure so the manual-sync UI can show
            // it instead of falsely reporting success.
            failures.push(...enabledFailures);
            console.error(
              `[Service] ${senderId}: holding cursor at ${lastMessageId} — ${enabledFailures
                .map((f) => `${f.target}: ${f.error}`)
                .join("; ")}`
            );
            continue;
          }

          // Every enabled target succeeded — record locally and advance.
          for (const tx of newTransactions) {
            this.stateDb!.saveTransaction(tx, true);
          }

          if (syncResults.instantdb.success && syncResults.instantdb.syncedCount) {
            console.log(`[Service] Synced ${syncResults.instantdb.syncedCount} to InstantDB`);
          }

          // Advance last_message_id to the highest message ID we successfully
          // parsed. We intentionally do NOT jump to `max(messages.map(m => m.messageId))`
          // even though those messages are newer — if the parser can't handle
          // them today, advancing would permanently skip them after a future
          // parser upgrade.
          const maxParsedId = Math.max(...success.map((tx) => tx.messageId));
          this.stateDb!.updateSyncState(senderId, maxParsedId);

          totalNewTransactions += newTransactions.length;

          console.log(
            `[Service] Processed ${newTransactions.length} new transactions from ${senderId}`
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[Service] Error processing ${senderId}:`, error);
          failures.push({ sender: senderId, target: "local", error: `processing: ${message}` });
        }
      }

      reader.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Service] Error in processNewMessages:", error);
      failures.push({ sender: "*", target: "local", error: `processing: ${message}` });
    } finally {
      this.isProcessing = false;
    }

    return { synced: totalNewTransactions, failures };
  }

  /**
   * Start watching for changes
   */
  startWatching(): void {
    console.log(`[Service] Starting file watcher for ${this.config.messagesDbPath}`);

    // Watch chat.db for changes
    try {
      this.watcher = watch(this.config.messagesDbPath, async (eventType) => {
        if (eventType === "change") {
          console.log("[Service] chat.db changed, processing...");
          await this.processNewMessages();
        }
      });

      console.log("[Service] File watcher started");
    } catch (error) {
      console.error("[Service] Failed to start file watcher:", error);
      console.log("[Service] Falling back to polling mode");
      this.startPolling();
    }
  }

  /**
   * Start polling mode (fallback)
   */
  startPolling(): void {
    console.log(
      `[Service] Starting polling mode (interval: ${this.config.pollIntervalMs}ms)`
    );

    this.pollInterval = setInterval(async () => {
      await this.processNewMessages();
    }, this.config.pollIntervalMs);
  }

  /**
   * Start the service
   */
  async start(): Promise<void> {
    await this.init();

    // Process any existing messages first
    console.log("[Service] Running initial sync...");
    const initial = await this.processNewMessages();
    console.log(`[Service] Initial sync complete: ${initial.synced} transactions`);
    if (initial.failures.length > 0) {
      console.warn(`[Service] Initial sync had ${initial.failures.length} failure(s); cursor held for retry.`);
    }

    // Start watching for changes
    this.startWatching();

    // Also start a fallback poll (less frequent) in case file watching misses something
    const fallbackInterval = this.config.pollIntervalMs * 5; // 5x slower than normal poll
    setInterval(async () => {
      await this.processNewMessages();
    }, fallbackInterval);

    console.log("[Service] SMS Expense Tracker service started");
    console.log(`[Service] Watching senders: ${this.config.bankSenderIds.join(", ")}`);
    console.log(`[Service] Local backup: ${this.config.localBackupPath}`);
    console.log(
      `[Service] InstantDB: ${this.config.instantdb.enabled ? "enabled" : "disabled"}`
    );
    console.log(
      `[Service] Webhook: ${this.config.webhook.enabled ? this.config.webhook.url : "disabled"}`
    );
  }

  /**
   * Stop the service
   */
  stop(): void {
    console.log("[Service] Stopping SMS Expense Tracker...");

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.stateDb) {
      this.stateDb.close();
      this.stateDb = null;
    }

    // Close InstantDB connection
    closeInstantDB();

    console.log("[Service] Service stopped");
  }

  /**
   * Get service status
   */
  getStatus(): {
    running: boolean;
    transactionCount: number;
    lastSync: Date | null;
  } {
    const transactionCount = this.stateDb?.getTransactionCount() ?? 0;
    const syncState = this.stateDb?.getSyncState(this.config.bankSenderIds[0]);

    return {
      running: this.watcher !== null || this.pollInterval !== null,
      transactionCount,
      lastSync: syncState?.lastSyncAt ?? null,
    };
  }
}
