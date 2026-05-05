import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { routeTransactions, applyDedup } from "../instant-sync";
import { StateDb } from "../state-db";
import type { Transaction } from "../parser";

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: "id-0",
    messageId: 0,
    bankKey: "SOLO",
    bankSenderId: "SOLO",
    transactionType: "payment",
    status: "success",
    direction: "out",
    amount: 10,
    currency: "GEL",
    merchant: "Test",
    cardLastDigits: null,
    transactionDate: new Date("2026-04-20T10:00:00Z"),
    messageTimestamp: new Date("2026-04-20T10:00:00Z"),
    rawMessage: "raw",
    failureReason: null,
    balance: null,
    plusEarned: null,
    plusTotal: null,
    counterparty: null,
    ...overrides,
  };
}

describe("routeTransactions", () => {
  test("incoming goes to credits, regardless of status", () => {
    const txs = [
      tx({ id: "a", direction: "in", transactionType: "transfer_in" }),
      tx({ id: "b", direction: "in", transactionType: "deposit" }),
    ];
    const r = routeTransactions(txs);
    expect(r.credits.map((t) => t.id)).toEqual(["a", "b"]);
    expect(r.failedPayments).toEqual([]);
    expect(r.successfulPayments).toEqual([]);
  });

  test("failed outgoing goes to failedPayments", () => {
    const txs = [
      tx({ id: "a", direction: "out", status: "failed", transactionType: "payment_failed" }),
    ];
    const r = routeTransactions(txs);
    expect(r.failedPayments.map((t) => t.id)).toEqual(["a"]);
    expect(r.credits).toEqual([]);
    expect(r.successfulPayments).toEqual([]);
  });

  test("successful outgoing goes to payments", () => {
    const txs = [
      tx({ id: "a", direction: "out", status: "success" }),
      tx({ id: "b", direction: "out", status: "success", transactionType: "loan_repayment" }),
      tx({ id: "c", direction: "out", status: "success", transactionType: "atm_withdrawal" }),
    ];
    const r = routeTransactions(txs);
    expect(r.successfulPayments.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(r.credits).toEqual([]);
    expect(r.failedPayments).toEqual([]);
  });

  test("mixed batch splits correctly", () => {
    const txs = [
      tx({ id: "in1", direction: "in" }),
      tx({ id: "out1", direction: "out", status: "success" }),
      tx({ id: "fail1", direction: "out", status: "failed" }),
      tx({ id: "in2", direction: "in" }),
      tx({ id: "out2", direction: "out", status: "success" }),
    ];
    const r = routeTransactions(txs);
    expect(r.credits.map((t) => t.id)).toEqual(["in1", "in2"]);
    expect(r.failedPayments.map((t) => t.id)).toEqual(["fail1"]);
    expect(r.successfulPayments.map((t) => t.id)).toEqual(["out1", "out2"]);
  });

  test("empty input", () => {
    expect(routeTransactions([])).toEqual({ credits: [], failedPayments: [], successfulPayments: [] });
  });

  test("no transaction appears in more than one bucket", () => {
    const txs = [
      tx({ id: "a", direction: "in" }),
      tx({ id: "b", direction: "out", status: "failed" }),
      tx({ id: "c", direction: "out", status: "success" }),
    ];
    const r = routeTransactions(txs);
    const total = r.credits.length + r.failedPayments.length + r.successfulPayments.length;
    expect(total).toBe(txs.length);
  });

  test("incoming-but-failed (defensive) still goes to credits, not failedPayments", () => {
    // Direction check runs first, by design. Document the invariant.
    const r = routeTransactions([
      tx({ id: "weird", direction: "in", status: "failed" }),
    ]);
    expect(r.credits.length).toBe(1);
    expect(r.failedPayments.length).toBe(0);
  });

  test("reversals are dropped — never reach any bucket", () => {
    // TBC refunds (transactionType: "reversal", direction: "in") would
    // otherwise land in credits via the direction === "in" rule. The
    // user wants refund SMS to vanish from analytics entirely — neither
    // outgoing spend nor incoming credit. Filter happens before bucketing.
    const r = routeTransactions([
      tx({ id: "rev1", direction: "in", transactionType: "reversal" }),
      tx({ id: "ok1", direction: "in", transactionType: "transfer_in" }),
      tx({ id: "rev2", direction: "in", transactionType: "reversal" }),
    ]);
    expect(r.credits.map((t) => t.id)).toEqual(["ok1"]);
    expect(r.failedPayments).toEqual([]);
    expect(r.successfulPayments).toEqual([]);
  });

  test("reversals dropped even if status is something other than success", () => {
    const r = routeTransactions([
      tx({ id: "rev", direction: "in", transactionType: "reversal", status: "failed" }),
    ]);
    expect(r.credits).toEqual([]);
    expect(r.failedPayments).toEqual([]);
    expect(r.successfulPayments).toEqual([]);
  });
});

describe("applyDedup", () => {
  test("filters out transactions whose id is in the existing set", () => {
    const txs = [tx({ id: "a" }), tx({ id: "b" }), tx({ id: "c" })];
    const existing = new Set(["a", "c"]);
    const { toSync, skipped } = applyDedup(txs, existing);
    expect(toSync.map((t) => t.id)).toEqual(["b"]);
    expect(skipped).toBe(2);
  });

  test("empty existing set keeps everything", () => {
    const txs = [tx({ id: "a" }), tx({ id: "b" })];
    const { toSync, skipped } = applyDedup(txs, new Set());
    expect(toSync.length).toBe(2);
    expect(skipped).toBe(0);
  });

  test("all-dupes returns empty", () => {
    const txs = [tx({ id: "a" }), tx({ id: "b" })];
    const { toSync, skipped } = applyDedup(txs, new Set(["a", "b"]));
    expect(toSync).toEqual([]);
    expect(skipped).toBe(2);
  });

  test("empty input", () => {
    const { toSync, skipped } = applyDedup([], new Set(["a"]));
    expect(toSync).toEqual([]);
    expect(skipped).toBe(0);
  });

  test("preserves the original order of kept transactions", () => {
    const txs = [tx({ id: "a" }), tx({ id: "b" }), tx({ id: "c" }), tx({ id: "d" })];
    const { toSync } = applyDedup(txs, new Set(["b"]));
    expect(toSync.map((t) => t.id)).toEqual(["a", "c", "d"]);
  });
});

describe("StateDb tombstones", () => {
  let dir: string;
  let db: StateDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "xarji-state-test-"));
    db = new StateDb(join(dir, "state.db"));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("markTransactionDeleted records the id and isTransactionDeleted reads it back", () => {
    expect(db.isTransactionDeleted("tx-1")).toBe(false);
    db.markTransactionDeleted("tx-1", "payment");
    expect(db.isTransactionDeleted("tx-1")).toBe(true);
  });

  test("loadDeletedTransactionIds returns the full Set for the dedup hot path", () => {
    db.markTransactionDeleted("tx-1", "payment");
    db.markTransactionDeleted("tx-2", "credit");
    db.markTransactionDeleted("tx-3", "failedPayment");
    const ids = db.loadDeletedTransactionIds();
    expect(ids).toEqual(new Set(["tx-1", "tx-2", "tx-3"]));
  });

  test("double-delete is idempotent (no error, single row)", () => {
    db.markTransactionDeleted("tx-1", "payment");
    db.markTransactionDeleted("tx-1", "payment");
    expect(db.loadDeletedTransactionIds().size).toBe(1);
  });

  test("dedup honors tombstones — applyDedup with merged set skips the row", () => {
    db.markTransactionDeleted("tx-deleted", "payment");
    const txs = [tx({ id: "tx-deleted" }), tx({ id: "tx-kept" })];
    // Mirror the syncTransactions production path: union the in-memory
    // syncedIds (empty here, simulating a fresh restart) with the
    // tombstones, then call applyDedup.
    const merged = new Set([...new Set<string>(), ...db.loadDeletedTransactionIds()]);
    const { toSync, skipped } = applyDedup(txs, merged);
    expect(toSync.map((t) => t.id)).toEqual(["tx-kept"]);
    expect(skipped).toBe(1);
  });

  test("partial-failure retry: warm syncedIds cache must catch the second pass even when tombstones exist", () => {
    // Codex P2 on PR #46. processNewMessages intentionally retries the
    // same SMS batch when a non-InstantDB target (webhook/local) fails,
    // without marking the message as processed in state.db. The
    // InstantDB-side dedup must still skip the already-written row on
    // that retry — otherwise a duplicate InstantDB row gets inserted.
    //
    // The bug being guarded: when tombstones exist, the dedup-check Set
    // is a temporary union of syncedIds + tombstones. If
    // syncTransactions only added the just-written id to that temporary
    // Set (instead of the persistent syncedIds), the next call would
    // rebuild the union from a stale syncedIds and re-import the row.
    //
    // This test simulates the production sequence directly without
    // standing up InstantDB: build the union, mark a row "written" by
    // adding to the persistent set, then check that the next sync's
    // freshly-built union still treats the row as already-synced.
    db.markTransactionDeleted("tomb-1", "payment");
    const syncedIds = new Set<string>(); // simulates module-level cache
    const buildUnion = () =>
      new Set([...syncedIds, ...db.loadDeletedTransactionIds()]);

    // Sync 1: row "tx-A" not in either set, should be selected for write.
    const sync1 = applyDedup([tx({ id: "tx-A" })], buildUnion());
    expect(sync1.toSync.map((t) => t.id)).toEqual(["tx-A"]);

    // Imitate the post-write step: mark tx-A in the persistent set.
    for (const t of sync1.toSync) syncedIds.add(t.id);

    // Sync 2 (retry path): same input, freshly-built union from the
    // *persistent* syncedIds + tombstones. tx-A must now be deduped.
    const sync2 = applyDedup([tx({ id: "tx-A" })], buildUnion());
    expect(sync2.toSync).toEqual([]);
    expect(sync2.skipped).toBe(1);
  });

  test("tombstones survive close + reopen (persistent)", () => {
    db.markTransactionDeleted("tx-survives", "payment");
    db.close();
    const reopened = new StateDb(join(dir, "state.db"));
    expect(reopened.isTransactionDeleted("tx-survives")).toBe(true);
    reopened.close();
  });
});
