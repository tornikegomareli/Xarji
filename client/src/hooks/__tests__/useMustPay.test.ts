import { describe, expect, test } from "bun:test";
import {
  isItemPaid,
  summarizeMustPay,
  computePotMath,
} from "../useMustPay";
import type { MustPayItem } from "../../lib/instant";

// Compact factory so each fixture row reads as one line.
function item(over: Partial<MustPayItem> = {}): MustPayItem {
  return {
    id: over.id ?? "row-" + Math.random().toString(36).slice(2, 8),
    title: over.title ?? "Test item",
    amountGEL: over.amountGEL ?? 100,
    lastPaidAt: over.lastPaidAt,
    // The design dropped the recurring toggle but the schema field
    // stays — every new item is one-off. Default to false here so
    // fixtures don't have to specify it.
    isRecurring: over.isRecurring ?? false,
    notes: over.notes,
    dueDate: over.dueDate,
    createdAt: over.createdAt ?? Date.now(),
    updatedAt: over.updatedAt ?? Date.now(),
  };
}

describe("isItemPaid", () => {
  test("never-paid item is unpaid", () => {
    expect(isItemPaid(item({ lastPaidAt: undefined }))).toBe(false);
  });

  test("item with any lastPaidAt is paid", () => {
    expect(isItemPaid(item({ lastPaidAt: Date.now() }))).toBe(true);
  });

  test("paid is paid forever — last year's lastPaidAt still counts", () => {
    // The design removed the auto-month-rollover feature. Once paid,
    // an item stays paid until the user explicitly unchecks it.
    const yearAgo = new Date("2025-05-15").getTime();
    expect(isItemPaid(item({ lastPaidAt: yearAgo }))).toBe(true);
  });

  test("lastPaidAt of 0 still counts as paid", () => {
    // Edge case: epoch zero is a valid timestamp; only null/undefined
    // mean "never paid". A regression here would silently hide rows
    // that got toggled at a weird system clock.
    expect(isItemPaid(item({ lastPaidAt: 0 }))).toBe(true);
  });
});

describe("summarizeMustPay", () => {
  test("empty list returns zeros", () => {
    expect(summarizeMustPay([])).toEqual({
      pendingCount: 0,
      pendingTotal: 0,
      paidCount: 0,
      paidTotal: 0,
    });
  });

  test("mixed paid/unpaid sums correctly", () => {
    const items = [
      item({ amountGEL: 100, lastPaidAt: undefined }), // pending
      item({ amountGEL: 200, lastPaidAt: Date.now() }), // paid
      item({ amountGEL: 50, lastPaidAt: Date.now() }), // paid
      item({ amountGEL: 75, lastPaidAt: undefined }), // pending
    ];
    expect(summarizeMustPay(items)).toEqual({
      pendingCount: 2,
      pendingTotal: 175,
      paidCount: 2,
      paidTotal: 250,
    });
  });

  test("all items paid → pending sum is 0", () => {
    const items = [
      item({ amountGEL: 800, lastPaidAt: Date.now() }),
      item({ amountGEL: 1200, lastPaidAt: Date.now() }),
    ];
    expect(summarizeMustPay(items).pendingTotal).toBe(0);
  });

  test("all items unpaid → paid sum is 0", () => {
    const items = [
      item({ amountGEL: 800, lastPaidAt: undefined }),
      item({ amountGEL: 1200, lastPaidAt: undefined }),
    ];
    expect(summarizeMustPay(items).paidTotal).toBe(0);
  });
});

describe("computePotMath", () => {
  test("pot 100, pending 60, paid 0 → free 40, not overdrawn", () => {
    expect(computePotMath(100, 60, 0)).toEqual({ free: 40, isOverdrawn: false });
  });

  test("marking an item paid does NOT change free", () => {
    // Core invariant: Free = Pot − (Pending + Paid). The split between
    // pending and paid is workflow state, not flow. Moving money from
    // the pending bucket to the paid bucket keeps the same total
    // obligations and the same free figure. This is the bug fix the
    // user explicitly called out — checking an item used to inflate
    // Free, which they read as "checking means I got richer."
    const beforeCheck = computePotMath(100, 60, 0); // 60 pending, 0 paid
    const afterCheck = computePotMath(100, 0, 60); // 60 moved into paid
    expect(beforeCheck.free).toBe(afterCheck.free);
    expect(beforeCheck.free).toBe(40);
  });

  test("pot 50, pending 60, paid 0 → free -10, overdrawn", () => {
    expect(computePotMath(50, 60, 0)).toEqual({ free: -10, isOverdrawn: true });
  });

  test("paid obligations alone can overdraw the pot", () => {
    // Pot 100, no pending, 200 already paid — total obligations
    // exceed pot, free should be -100 overdrawn.
    expect(computePotMath(100, 0, 200)).toEqual({ free: -100, isOverdrawn: true });
  });

  test("mixed pending + paid sum correctly", () => {
    expect(computePotMath(1000, 600, 300)).toEqual({ free: 100, isOverdrawn: false });
  });

  test("pot 0, pending 0, paid 0 → free 0, not overdrawn", () => {
    expect(computePotMath(0, 0, 0)).toEqual({ free: 0, isOverdrawn: false });
  });

  test("pot 100, total obligations 100 → free 0, not overdrawn (exact match)", () => {
    // Edge: zero free isn't overdrawn. The accent-color warning only
    // fires on strict-less-than-zero. Whether the obligations are
    // pending, paid, or mixed shouldn't matter.
    expect(computePotMath(100, 70, 30)).toEqual({ free: 0, isOverdrawn: false });
  });
});
