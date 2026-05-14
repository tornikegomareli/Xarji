import { useMemo } from "react";
import { id } from "@instantdb/react";
import { db, type MustPayItem, type MustPayState } from "../lib/instant";

const SINGLETON_KEY = "singleton";

export function useMustPayItems() {
  const { data, isLoading, error } = db.useQuery({ mustPayItems: {} });
  const items = useMemo(() => (data?.mustPayItems ?? []) as MustPayItem[], [data?.mustPayItems]);
  return { items, isLoading, error };
}

/**
 * The pot is a singleton — one row keyed "singleton" with the user's
 * current wallet amount. We query everything in `mustPayState` and
 * pick the first match instead of a where-filter so the hook works
 * identically against the live db and the demo-db (which doesn't
 * implement InstantDB's `$.where` syntax). The row count is bounded at
 * 1 by the unique-key constraint so an unindexed scan is fine.
 */
export function useMustPayState() {
  const { data, isLoading, error } = db.useQuery({ mustPayState: {} });
  const state = useMemo(() => {
    const rows = (data?.mustPayState ?? []) as MustPayState[];
    return rows.find((r) => r.key === SINGLETON_KEY) ?? null;
  }, [data?.mustPayState]);
  return {
    currentPotGEL: state?.currentPotGEL ?? 0,
    updatedAt: state?.updatedAt ?? 0,
    hasValue: state != null,
    isLoading,
    error,
  };
}

export function useMustPayActions() {
  const { data } = db.useQuery({ mustPayState: {} });

  const create = async (input: { title: string; amountGEL: number }) => {
    const now = Date.now();
    const itemId = id();
    // isRecurring stays in the schema for backward compat but the
    // design dropped the toggle — every new item is one-off, "paid"
    // means paid forever until manually unchecked.
    await db.transact(
      db.tx.mustPayItems[itemId].update({
        ...input,
        isRecurring: false,
        createdAt: now,
        updatedAt: now,
      })
    );
    return itemId;
  };

  const update = async (itemId: string, patch: Partial<Omit<MustPayItem, "id" | "createdAt">>) => {
    await db.transact(
      db.tx.mustPayItems[itemId].update({ ...patch, updatedAt: Date.now() })
    );
  };

  /**
   * Toggling "paid" sets or clears `lastPaidAt`. The page treats any
   * non-null lastPaidAt as paid (paid stays paid until unchecked).
   */
  const togglePaid = async (item: MustPayItem) => {
    const now = Date.now();
    await db.transact(
      db.tx.mustPayItems[item.id].update({
        lastPaidAt: isItemPaid(item) ? null : now,
        updatedAt: now,
      })
    );
  };

  const remove = async (itemId: string) => {
    await db.transact(db.tx.mustPayItems[itemId].delete());
  };

  /**
   * Upsert the singleton pot. Find an existing row first so we hit
   * `.update()` on the same id and InstantDB recognises it as an
   * update rather than creating a second row that would conflict
   * with the unique-key constraint. First-time callers get a fresh
   * row id.
   */
  const setCurrentPot = async (amount: number) => {
    const rows = (data?.mustPayState ?? []) as MustPayState[];
    const existing = rows.find((r) => r.key === SINGLETON_KEY);
    const rowId = existing?.id ?? id();
    await db.transact(
      db.tx.mustPayState[rowId].update({
        key: SINGLETON_KEY,
        currentPotGEL: amount,
        updatedAt: Date.now(),
      })
    );
  };

  return { create, update, togglePaid, remove, setCurrentPot };
}

/**
 * Counter for the sidebar pillBadge. Reads via useMustPayItems so
 * Sidebar doesn't have to plumb a separate query — InstantDB
 * deduplicates the underlying subscription anyway.
 */
export function usePendingMustPayCount(): number {
  const { items } = useMustPayItems();
  return items.filter((it) => !isItemPaid(it)).length;
}

// ── Pure helpers (no React, no DB — unit-testable) ────────────────────────

export function isItemPaid(item: MustPayItem): boolean {
  return item.lastPaidAt != null;
}

export interface MustPaySummary {
  pendingCount: number;
  pendingTotal: number;
  paidCount: number;
  paidTotal: number;
}

export function summarizeMustPay(items: MustPayItem[]): MustPaySummary {
  let pendingCount = 0;
  let pendingTotal = 0;
  let paidCount = 0;
  let paidTotal = 0;
  for (const it of items) {
    if (isItemPaid(it)) {
      paidCount++;
      paidTotal += it.amountGEL;
    } else {
      pendingCount++;
      pendingTotal += it.amountGEL;
    }
  }
  return { pendingCount, pendingTotal, paidCount, paidTotal };
}

export interface PotMath {
  free: number;
  isOverdrawn: boolean;
}

/**
 * Free = Pot − (Pending + Paid). The pot represents the user's
 * starting wallet; paid obligations have already left it conceptually
 * but we still subtract them so checking an item paid doesn't make
 * Free rise (the money was always going to leave). The split between
 * pending and paid is a workflow indicator, not a flow.
 */
export function computePotMath(pot: number, pendingTotal: number, paidTotal: number): PotMath {
  const free = pot - pendingTotal - paidTotal;
  return { free, isOverdrawn: free < 0 };
}
