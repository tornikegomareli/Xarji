import { describe, expect, test } from "bun:test";
import {
  isItemPaidThisCycle,
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
    isRecurring: over.isRecurring ?? false,
    notes: over.notes,
    dueDate: over.dueDate,
    createdAt: over.createdAt ?? Date.now(),
    updatedAt: over.updatedAt ?? Date.now(),
  };
}

const MAY_15 = new Date("2026-05-15T12:00:00Z");
const MAY_1 = new Date("2026-05-01T08:00:00Z");
const APR_28 = new Date("2026-04-28T10:00:00Z");
const APR_30 = new Date("2026-04-30T23:59:00Z");
const MAY_2025 = new Date("2025-05-15T12:00:00Z");

describe("isItemPaidThisCycle", () => {
  test("never-paid item is unpaid", () => {
    expect(isItemPaidThisCycle(item({ lastPaidAt: undefined }), MAY_15)).toBe(false);
  });

  test("non-recurring with lastPaidAt is permanently paid", () => {
    // Paid a year ago, still counts as done because it was a one-off.
    expect(
      isItemPaidThisCycle(item({ isRecurring: false, lastPaidAt: MAY_2025.getTime() }), MAY_15)
    ).toBe(true);
  });

  test("recurring item paid this month is paid", () => {
    expect(
      isItemPaidThisCycle(item({ isRecurring: true, lastPaidAt: MAY_1.getTime() }), MAY_15)
    ).toBe(true);
  });

  test("recurring item paid last month is unpaid (rollover)", () => {
    expect(
      isItemPaidThisCycle(item({ isRecurring: true, lastPaidAt: APR_28.getTime() }), MAY_15)
    ).toBe(false);
  });

  test("recurring item paid on the last second of last month rolls over", () => {
    // Boundary check — Apr 30 23:59 is still April, so on May 1+ it
    // should be unpaid again. Catches off-by-one bugs in month math.
    expect(
      isItemPaidThisCycle(item({ isRecurring: true, lastPaidAt: APR_30.getTime() }), MAY_1)
    ).toBe(false);
  });

  test("recurring item paid same month last year is unpaid (not just same-month)", () => {
    // "May 2025" is not the same cycle as "May 2026" — isSameMonth from
    // date-fns considers year, so this should NOT count as paid.
    expect(
      isItemPaidThisCycle(item({ isRecurring: true, lastPaidAt: MAY_2025.getTime() }), MAY_15)
    ).toBe(false);
  });
});

describe("summarizeMustPay", () => {
  test("empty list returns zeros", () => {
    expect(summarizeMustPay([], MAY_15)).toEqual({
      pendingCount: 0,
      pendingTotal: 0,
      paidCount: 0,
      paidTotal: 0,
    });
  });

  test("mixed paid/unpaid sums correctly", () => {
    const items = [
      item({ amountGEL: 100, isRecurring: false, lastPaidAt: undefined }), // pending
      item({ amountGEL: 200, isRecurring: false, lastPaidAt: MAY_1.getTime() }), // paid (one-off)
      item({ amountGEL: 50, isRecurring: true, lastPaidAt: MAY_1.getTime() }), // paid (recurring this month)
      item({ amountGEL: 75, isRecurring: true, lastPaidAt: APR_28.getTime() }), // pending (rolled over)
    ];
    expect(summarizeMustPay(items, MAY_15)).toEqual({
      pendingCount: 2,
      pendingTotal: 175,
      paidCount: 2,
      paidTotal: 250,
    });
  });

  test("all recurring items paid this month → pending sum is 0", () => {
    const items = [
      item({ amountGEL: 800, isRecurring: true, lastPaidAt: MAY_1.getTime() }),
      item({ amountGEL: 1200, isRecurring: true, lastPaidAt: MAY_1.getTime() }),
    ];
    expect(summarizeMustPay(items, MAY_15).pendingTotal).toBe(0);
  });

  test("recurring items paid last month roll into pending", () => {
    // Mirrors the real-world "I marked rent paid in April, now it's
    // May and rent is due again" flow that's the whole point of the
    // recurring flag.
    const items = [
      item({ amountGEL: 800, isRecurring: true, lastPaidAt: APR_28.getTime() }),
      item({ amountGEL: 1200, isRecurring: true, lastPaidAt: APR_28.getTime() }),
    ];
    expect(summarizeMustPay(items, MAY_15)).toEqual({
      pendingCount: 2,
      pendingTotal: 2000,
      paidCount: 0,
      paidTotal: 0,
    });
  });
});

describe("computePotMath", () => {
  test("pot 100, pending 60 → free 40, not overdrawn", () => {
    expect(computePotMath(100, 60)).toEqual({ free: 40, isOverdrawn: false });
  });

  test("pot 50, pending 60 → free -10, overdrawn", () => {
    expect(computePotMath(50, 60)).toEqual({ free: -10, isOverdrawn: true });
  });

  test("pot 0, pending 0 → free 0, not overdrawn", () => {
    expect(computePotMath(0, 0)).toEqual({ free: 0, isOverdrawn: false });
  });

  test("pot 100, pending 100 → free 0, not overdrawn (exact match)", () => {
    // Edge: zero free isn't overdrawn. The accent-color warning only
    // fires on strict-less-than-zero.
    expect(computePotMath(100, 100)).toEqual({ free: 0, isOverdrawn: false });
  });

  test("pot 0, pending 50 → free -50, overdrawn", () => {
    // Common real-world case: user hasn't entered their pot yet but
    // already has obligations. The page should show "Over by ₾50"
    // so they know to set the pot.
    expect(computePotMath(0, 50)).toEqual({ free: -50, isOverdrawn: true });
  });
});
