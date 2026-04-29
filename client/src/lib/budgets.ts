// Pure utility module for flex budgeting. No React, no InstantDB —
// just the math + classification logic. Imported by useBudgets.ts
// (the hook layer) and by future AI tools (Phase 3) so the same
// formula drives the UI and chat.

import type { Category } from "./instant";
import type { ConvertedPayment } from "../hooks/useTransactions";

export const BUCKETS = ["fixed", "flex", "non_monthly"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const BUCKET_LABELS: Record<Bucket, string> = {
  fixed: "Fixed",
  flex: "Flex",
  non_monthly: "Non-Monthly",
};

export const BUCKET_DESCRIPTIONS: Record<Bucket, string> = {
  fixed: "Predictable monthly costs (rent, utilities, subscriptions). Each category has its own target.",
  flex: "Discretionary spending (dining, shopping, entertainment). Shares one pool across all categories.",
  non_monthly: "Irregular but expected (annual insurance, holidays). Spreads target across N months.",
};

/**
 * Monthly accrual for a Non-Monthly category. e.g. ₾2,400 across
 * 12 months = ₾200/month. Returns 0 for non-`non_monthly` buckets
 * or when frequencyMonths is missing/zero.
 *
 * Phase 1 doesn't yet display accruals on /budgets — Phase 2 wires
 * the rollover math that consumes this. Exported now so the formula
 * in computeFlexPool can subtract accruals from the income side.
 */
export function monthlyAccrual(category: Pick<Category, "bucket" | "targetAmount" | "frequencyMonths">): number {
  if (category.bucket !== "non_monthly") return 0;
  if (!category.targetAmount || !category.frequencyMonths) return 0;
  if (category.frequencyMonths <= 0) return 0;
  return category.targetAmount / category.frequencyMonths;
}

/**
 * Canonical flex-pool formula:
 *   flex = expectedIncome
 *        - sum(fixed targets)
 *        - sum(non-monthly accruals)
 *        - savingsTarget
 *
 * Returns a non-negative number; if the sums exceed expected income
 * the result is clamped to 0 so the UI shows "₾0 left" instead of a
 * negative pool. The user is over-allocated and needs to either
 * raise income or lower targets — clamping avoids the misleading
 * impression that they have negative-flex spending power.
 *
 * Pure: takes the resolved input numbers, doesn't peek at React
 * state. Same function used by the page header, the AI tools, and
 * Phase 2's rollover-aware variant.
 */
export function computeFlexPool(input: {
  expectedIncome: number;
  fixedTargets: number;
  nonMonthlyAccruals: number;
  savingsTarget: number;
}): number {
  const { expectedIncome, fixedTargets, nonMonthlyAccruals, savingsTarget } = input;
  const raw = expectedIncome - fixedTargets - nonMonthlyAccruals - savingsTarget;
  return Math.max(0, raw);
}

/**
 * Sum of monthly targets across categories in a given bucket.
 * For Fixed: targetAmount as-is. For Non-Monthly: monthlyAccrual.
 * Flex categories return 0 (the bucket pool isn't a sum of children).
 *
 * Tolerates undefined targets — returns 0 for them — so a
 * partially-classified state still renders without throwing.
 */
export function bucketMonthlyCommitment(category: Pick<Category, "bucket" | "targetAmount" | "frequencyMonths">): number {
  if (category.bucket === "fixed") return category.targetAmount ?? 0;
  if (category.bucket === "non_monthly") return monthlyAccrual(category);
  return 0;
}

/**
 * Suggest a bucket for a category based on its recent spending pattern.
 * Used by the /budgets setup wizard to pre-populate bucket assignments
 * — the user can always change the suggestion before saving.
 *
 * Heuristics:
 *   - Stable monthly cadence + low variance → Fixed
 *   - High variance + many small transactions → Flex
 *   - Long gaps + one large transaction → Non-Monthly
 *
 * Returns null when there isn't enough history to suggest. The wizard
 * should default unclassified rows to Flex in that case (it's the
 * safest "I don't know yet" assignment — Flex doesn't impose a target).
 */
export function classifyHistorical(
  payments: ConvertedPayment[],
  categoryFor: (p: ConvertedPayment) => string,
  categoryId: string,
  windowMonths = 3,
  now = new Date()
): Bucket | null {
  const cutoff = new Date(now.getFullYear(), now.getMonth() - windowMonths, now.getDate()).getTime();
  const matching = payments.filter(
    (p) => p.gelAmount !== null && p.transactionDate >= cutoff && categoryFor(p) === categoryId
  );
  if (matching.length === 0) return null;

  // Group by month-of-year. A category that's spent in nearly every
  // month with low coefficient-of-variation is Fixed; one that's
  // spent in only a few months with one large hit is Non-Monthly;
  // everything else is Flex.
  const byMonth = new Map<string, number>();
  for (const p of matching) {
    if (p.gelAmount === null) continue;
    const d = new Date(p.transactionDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + p.gelAmount);
  }
  const monthsCovered = byMonth.size;
  const totals = Array.from(byMonth.values());
  const mean = totals.reduce((s, x) => s + x, 0) / totals.length;
  const variance =
    totals.reduce((s, x) => s + (x - mean) ** 2, 0) / totals.length;
  const stddev = Math.sqrt(variance);
  const cov = mean > 0 ? stddev / mean : 0;

  // Spent in most months of the window with low variability — Fixed.
  if (monthsCovered >= windowMonths - 1 && cov < 0.35) return "fixed";

  // Sparse coverage but each hit is large — Non-Monthly. "Large" is
  // relative to the user's other categories; we use a simple
  // monthsCovered-vs-window ratio as the proxy. Refine in Phase 2 if
  // the suggestions feel wrong.
  if (monthsCovered <= Math.ceil(windowMonths / 2) && matching.length <= 3) {
    return "non_monthly";
  }

  return "flex";
}

/** "YYYY-MM" key for a Date. Used as the budgetPlans.planMonth value. */
export function planMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Median of a non-empty array; mean used as a tie-breaker. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
