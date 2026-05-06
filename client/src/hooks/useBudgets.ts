// React hooks for the flex-budgeting feature. Layer the pure utility
// functions in lib/budgets.ts on top of InstantDB queries + the
// existing categorizer / payments / credits hooks.

import { useCallback, useMemo } from "react";
import { id } from "@instantdb/react";
import { db, type BudgetPlan, type Category } from "../lib/instant";
import { useCategories, useMergedCategories } from "./useCategories";
import { useConvertedCredits } from "./useCredits";
import { useConvertedPayments } from "./useTransactions";
import { useCategorizer } from "./useCategorizer";
import { DEFAULT_CATEGORIES } from "../lib/utils";
import {
  anchorMonthFromPlans,
  bucketMonthlyCommitment,
  computeFlexPool,
  computeRollover,
  median,
  monthKeyFromTimestamp,
  monthlyAccrual,
  planMonthKey,
  type Bucket,
} from "../lib/budgets";

/**
 * Read-only view of all budget plan rows. One per month at most.
 * The page hooks below read the current month's plan via
 * `useBudgetPlan(planMonth)`; this raw list is mostly useful for
 * Phase 2 rollover math walking prior months.
 */
export function useBudgetPlans() {
  const { data, isLoading, error } = db.useQuery({ budgetPlans: {} });
  const plans = useMemo<BudgetPlan[]>(() => {
    const rows = (data?.budgetPlans ?? []) as BudgetPlan[];
    return [...rows].sort((a, b) => a.planMonth.localeCompare(b.planMonth));
  }, [data?.budgetPlans]);
  return { plans, isLoading, error };
}

/**
 * 3-month rolling average of GEL-converted credits, excluding any
 * `excludedFromAnalytics: true` rows. The default for
 * expectedIncome — the user can always override.
 *
 * Returns 0 when the user has no qualifying credits in the window.
 * The page surfaces a "no income detected" affordance in that case
 * instead of silently showing a ₾0 flex pool.
 *
 * Returns `isLoading` alongside the value so callers can skeleton
 * the auto-derived flex pool until credits arrive — without it the
 * page can flash a temporary ₾0 income before the credits query
 * resolves, even when payments/categories/plans are already loaded.
 * (Codex P2 on PR #47.)
 */
export function useExpectedIncomeDefault(now = new Date()): { value: number; isLoading: boolean } {
  const { credits, isLoading } = useConvertedCredits();
  const value = useMemo(() => {
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 3, 1).getTime();
    const monthEnd = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthly = new Map<string, number>();
    for (const c of credits) {
      if (c.gelAmount === null) continue;
      if (c.excludedFromAnalytics) continue;
      if (c.transactionDate < cutoff || c.transactionDate >= monthEnd) continue;
      const d = new Date(c.transactionDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthly.set(key, (monthly.get(key) ?? 0) + c.gelAmount);
    }
    if (monthly.size === 0) return 0;
    const totals = Array.from(monthly.values());
    return totals.reduce((s, x) => s + x, 0) / totals.length;
  }, [credits, now]);
  return { value, isLoading };
}

/**
 * Resolved view of one month's budget plan. If a row exists it's
 * read as-is; otherwise the values fall back to the auto-derived
 * defaults (income from `useExpectedIncomeDefault`, pool from the
 * canonical formula). The `auto` flags reflect what the page
 * displays — a stored row with `expectedIncomeAuto: true` will
 * still render the auto-derived value, not the stale stored one.
 *
 * No row is created until the user explicitly saves a change. That
 * keeps the DB free of empty-state plan rows for months the user
 * hasn't visited.
 */
export function useBudgetPlan(planMonth = planMonthKey()) {
  const { plans, isLoading: plansLoading, error } = useBudgetPlans();
  const { value: expectedIncomeAuto, isLoading: incomeLoading } = useExpectedIncomeDefault();
  const categories = useMergedCategories();
  // Page renders the headline + flex pool against expectedIncomeAuto
  // unless the user has explicitly overridden it. While credits are
  // still loading, the auto value is 0 and the headline would briefly
  // show "Flex remaining: ₾0 of ₾0 pool (auto)" before snapping to
  // the right number. Bubble the loading flag up so the page can
  // skeleton through that gap. (Codex P2 on PR #47.)
  const isLoading = plansLoading || incomeLoading;

  return useMemo(() => {
    const stored = plans.find((p) => p.planMonth === planMonth) ?? null;
    const expectedIncome =
      stored && !stored.expectedIncomeAuto ? stored.expectedIncome : expectedIncomeAuto;
    const fixedTargets = sumByBucket(categories, "fixed");
    const nonMonthlyAccruals = sumByBucket(categories, "non_monthly");
    const savingsTarget = stored?.savingsTarget ?? 0;
    const flexPoolAuto = computeFlexPool({
      expectedIncome,
      fixedTargets,
      nonMonthlyAccruals,
      savingsTarget,
    });
    const flexPool = stored && !stored.flexPoolAuto ? stored.flexPool : flexPoolAuto;

    return {
      planMonth,
      stored,
      expectedIncome,
      expectedIncomeIsAuto: !stored || stored.expectedIncomeAuto,
      fixedTargets,
      nonMonthlyAccruals,
      savingsTarget,
      flexPool,
      flexPoolIsAuto: !stored || stored.flexPoolAuto,
      autoDerivedFlexPool: flexPoolAuto,
      isLoading,
      error,
    };
  }, [plans, expectedIncomeAuto, categories, planMonth, isLoading, error]);
}

/**
 * Per-bucket aggregate the page renders. For each category, returns
 * target + monthly commitment + actual + rolloverIn (Phase 2) +
 * remaining. Honors `excludedFromAnalytics`.
 *
 * Rollover semantics (Phase 2):
 *   - Fixed with `rolloverEnabled: true`: leftover/overshoot from
 *     prior months carries to current month's effective target.
 *   - Non-Monthly: always rolls forward (sinking-fund balance) —
 *     accrual_m − actual_m summed across months from the anchor.
 *   - Flex: never rolls (matches Monarch's help docs).
 *
 * The anchor is the earliest planMonth in the user's saved plans.
 * Months before the anchor are treated as 0-contribution; the user
 * hadn't started budgeting yet, so we don't retro-credit nor debit.
 */
export function useBudgetSummary(planMonth = planMonthKey(), rangeStart?: Date, rangeEnd?: Date) {
  const categories = useMergedCategories();
  const { payments, isLoading: paymentsLoading } = useConvertedPayments();
  const { isLoading: categoriesLoading } = useCategories();
  const { categorize } = useCategorizer();
  const { plans, isLoading: plansLoading } = useBudgetPlans();
  const rangeStartMs = rangeStart?.getTime();
  const rangeEndMs = rangeEnd?.getTime();
  const isLoading = paymentsLoading || categoriesLoading || plansLoading;

  const summary = useMemo(() => {
    const monthStart = rangeStartMs !== undefined
      ? rangeStartMs
      : new Date(planMonthYear(planMonth), planMonthMonth(planMonth), 1).getTime();
    // +1ms so endOfDay (23:59:59.999) is included when using < comparison
    const monthEnd = rangeEndMs !== undefined
      ? rangeEndMs + 1
      : new Date(planMonthYear(planMonth), planMonthMonth(planMonth) + 1, 1).getTime();
    const anchor = anchorMonthFromPlans(plans);

    // Bucket-by-categoryId for current month spend AND build the
    // (categoryId × monthKey) → spend lookup we hand to
    // computeRollover. Walking payments once for both is an O(n)
    // pass; Phase 1 walked twice in different callers.
    const spentByCategoryId = new Map<string, number>();
    const monthlyActualsByCategory = new Map<string, number>();
    for (const p of payments) {
      if (p.gelAmount === null) continue;
      if (p.excludedFromAnalytics) continue;
      const catId = categorize(p.merchant ?? null, p.rawMessage ?? null, p.id);
      const mKey = monthKeyFromTimestamp(p.transactionDate);
      const compoundKey = `${catId}::${mKey}`;
      monthlyActualsByCategory.set(
        compoundKey,
        (monthlyActualsByCategory.get(compoundKey) ?? 0) + p.gelAmount
      );
      if (p.transactionDate >= monthStart && p.transactionDate < monthEnd) {
        spentByCategoryId.set(catId, (spentByCategoryId.get(catId) ?? 0) + p.gelAmount);
      }
    }

    type Row = {
      category: Category;
      bucket: Bucket | null;
      target: number;
      monthlyCommitment: number;
      actual: number;
      rolloverIn: number;
      effectiveTarget: number;
      remaining: number;
    };

    const rows: Row[] = categories.map((c) => {
      const bucket = isBucket(c.bucket) ? c.bucket : null;
      const target = c.targetAmount ?? 0;
      const monthlyCommitment = bucketMonthlyCommitment(c);
      const actual = spentByCategoryId.get(c.id) ?? 0;
      const rolloverIn = anchor
        ? computeRollover({
            category: c,
            categoryId: c.id,
            anchorMonth: anchor,
            currentMonth: planMonth,
            monthlyActualsByCategory,
          })
        : 0;
      const effectiveTarget = (bucket === "fixed" ? target : monthlyCommitment) + rolloverIn;
      const remaining = effectiveTarget - actual;
      return { category: c, bucket, target, monthlyCommitment, actual, rolloverIn, effectiveTarget, remaining };
    });

    const byBucket = {
      fixed: rows.filter((r) => r.bucket === "fixed"),
      flex: rows.filter((r) => r.bucket === "flex"),
      non_monthly: rows.filter((r) => r.bucket === "non_monthly"),
      unclassified: rows.filter((r) => r.bucket === null),
    };

    const fixedActual = byBucket.fixed.reduce((s, r) => s + r.actual, 0);
    const fixedTarget = byBucket.fixed.reduce((s, r) => s + r.target, 0);
    const flexActual = byBucket.flex.reduce((s, r) => s + r.actual, 0);
    const nonMonthlyActual = byBucket.non_monthly.reduce((s, r) => s + r.actual, 0);
    const nonMonthlyAccruals = byBucket.non_monthly.reduce((s, r) => s + r.monthlyCommitment, 0);
    // Sinking-fund balance across all Non-Monthly categories — the
    // total accrued-but-unspent pool. Useful as a header-level
    // signal even though each row also displays its own carry.
    const nonMonthlySinkingFund = byBucket.non_monthly.reduce((s, r) => s + r.rolloverIn, 0);

    return {
      rows,
      byBucket,
      fixedActual,
      fixedTarget,
      flexActual,
      nonMonthlyActual,
      nonMonthlyAccruals,
      nonMonthlySinkingFund,
      anchor,
    };
  }, [categories, payments, categorize, plans, planMonth, rangeStartMs, rangeEndMs]);

  return { ...summary, isLoading };
}

/**
 * Mutations for the /budgets page. Each function wraps a single
 * `db.transact` call, keeping the InstantDB write surface in one
 * place (matches the useTransactionExclude / useCategoryActions
 * pattern elsewhere in the app).
 *
 * Subscribes to the budgetPlans list so upsertPlan can decide
 * insert-vs-update against React state rather than calling
 * `db.queryOnce` — the demo DB at `client/src/dev/demoDb.ts` doesn't
 * implement queryOnce, so going through the live subscription makes
 * the same code path work in real and demo modes. (Codex P2 on PR
 * #42.)
 */
export function useBudgetMutations() {
  const { plans } = useBudgetPlans();
  const { categories: dbCats } = useCategories();
  const setCategoryBucket = useCallback(async (categoryId: string, bucket: Bucket | null) => {
    // If this id belongs to a DEFAULT_CATEGORY that hasn't been written
    // to DB yet, seed a full row first so name/color/icon aren't lost
    // when only `bucket` is set. DEFAULT_CATEGORIES use slug ids (e.g.
    // "groceries") which InstantDB rejects — generate a real UUID here.
    let resolvedId = categoryId;
    const existsInDb = dbCats.some((c) => c.id === categoryId);
    if (!existsInDb) {
      const def = DEFAULT_CATEGORIES.find((d) => d.id === categoryId);
      if (def) {
        resolvedId = id();
        await db.transact(
          db.tx.categories[resolvedId].update({
            name: def.name,
            color: def.color,
            icon: def.icon,
            isDefault: true,
          })
        );
      }
    }
    if (bucket === null) {
      await db.transact(
        db.tx.categories[resolvedId].update({
          bucket: undefined,
          targetAmount: undefined,
          frequencyMonths: undefined,
          rolloverEnabled: undefined,
        })
      );
    } else {
      await db.transact(db.tx.categories[resolvedId].update({ bucket }));
    }
  }, [dbCats]);

  const setCategoryTarget = useCallback(
    async (
      categoryId: string,
      args: { targetAmount?: number; frequencyMonths?: number; rolloverEnabled?: boolean }
    ) => {
      await db.transact(db.tx.categories[categoryId].update(args));
    },
    []
  );

  const setCategoryRollover = useCallback(
    async (categoryId: string, enabled: boolean) => {
      await db.transact(db.tx.categories[categoryId].update({ rolloverEnabled: enabled }));
    },
    []
  );

  const upsertPlan = useCallback(
    async (planMonth: string, updates: Partial<Omit<BudgetPlan, "id" | "planMonth" | "createdAt">>) => {
      const now = Date.now();
      const existing = plans.find((p) => p.planMonth === planMonth);
      if (existing) {
        await db.transact(
          db.tx.budgetPlans[existing.id].update({ ...updates, updatedAt: now })
        );
      } else {
        // Seed required fields with sensible defaults — the row gets
        // created in auto-everything mode unless the caller said
        // otherwise via `updates`.
        const newId = id();
        await db.transact(
          db.tx.budgetPlans[newId].update({
            planMonth,
            expectedIncome: 0,
            expectedIncomeAuto: true,
            flexPool: 0,
            flexPoolAuto: true,
            createdAt: now,
            updatedAt: now,
            ...updates,
          })
        );
      }
    },
    [plans]
  );

  const setExpectedIncome = useCallback(
    async (planMonth: string, value: number | null) => {
      if (value === null) {
        await upsertPlan(planMonth, { expectedIncomeAuto: true });
      } else {
        await upsertPlan(planMonth, {
          expectedIncome: value,
          expectedIncomeAuto: false,
        });
      }
    },
    [upsertPlan]
  );

  const setFlexPool = useCallback(
    async (planMonth: string, value: number | null) => {
      if (value === null) {
        await upsertPlan(planMonth, { flexPoolAuto: true });
      } else {
        await upsertPlan(planMonth, { flexPool: value, flexPoolAuto: false });
      }
    },
    [upsertPlan]
  );

  const setSavingsTarget = useCallback(
    async (planMonth: string, value: number) => {
      await upsertPlan(planMonth, { savingsTarget: value });
    },
    [upsertPlan]
  );

  return {
    setCategoryBucket,
    setCategoryTarget,
    setCategoryRollover,
    setExpectedIncome,
    setFlexPool,
    setSavingsTarget,
  };
}

/**
 * Wizard helper: median of monthly spend for one category in the
 * last 3 months. Pre-fills the target field for Fixed suggestions.
 */
export function useCategoryMedianSpend(categoryId: string, months = 3, now = new Date()): number {
  const { payments } = useConvertedPayments();
  const { categorize } = useCategorizer();
  return useMemo(() => {
    const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1).getTime();
    const monthlyTotals = new Map<string, number>();
    for (const p of payments) {
      if (p.gelAmount === null) continue;
      if (p.excludedFromAnalytics) continue;
      if (p.transactionDate < cutoff) continue;
      const catId = categorize(p.merchant ?? null, p.rawMessage ?? null, p.id);
      if (catId !== categoryId) continue;
      const d = new Date(p.transactionDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthlyTotals.set(key, (monthlyTotals.get(key) ?? 0) + p.gelAmount);
    }
    return median(Array.from(monthlyTotals.values()));
  }, [payments, categorize, categoryId, months, now]);
}

// Helpers — kept inside the module since they're tied to the InstantDB
// shape and would just be noise in lib/budgets.ts.

function sumByBucket(categories: Category[], bucket: Bucket): number {
  let sum = 0;
  for (const c of categories) {
    if (c.bucket !== bucket) continue;
    if (bucket === "fixed") sum += c.targetAmount ?? 0;
    if (bucket === "non_monthly") sum += monthlyAccrual(c);
  }
  return sum;
}

function isBucket(value: string | undefined): value is Bucket {
  return value === "fixed" || value === "flex" || value === "non_monthly";
}

function planMonthYear(key: string): number {
  return Number(key.slice(0, 4));
}

function planMonthMonth(key: string): number {
  return Number(key.slice(5, 7)) - 1;
}
