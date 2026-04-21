import { describe, test, expect } from "bun:test";
import { routeTransactions, applyDedup } from "../instant-sync";
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
