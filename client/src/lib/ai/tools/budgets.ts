// AI tools for the flex-budgeting feature. Read tools surface the
// current plan to the model; write tools mutate categories +
// budgetPlans rows via db.transact (mirrors the existing
// WRITE_TOOLS pattern in write.ts).
//
// Auto-apply policy:
//   - All write tools auto-apply. Reasoning: each write is reversible
//     in the UI (move bucket back, edit target, reset auto). The
//     blast radius is one row per call — there is no destructive
//     equivalent to delete_category here.
//   - clear_category_budget unclassifies a category (drops bucket +
//     target + frequency + rollover) but doesn't delete the category
//     itself. Reversible by re-bucketing.

import { id } from "@instantdb/react";
import { db } from "../../instant";
import {
  anchorMonthFromPlans,
  bucketMonthlyCommitment,
  computeFlexPool,
  computeRollover,
  monthKeyFromTimestamp,
  monthlyAccrual,
  planMonthKey,
  BUCKETS,
  type Bucket,
} from "../../budgets";
import type { AITool, AIToolContext } from "./types";

const BUCKET_DESC =
  "One of 'fixed' (predictable monthly costs with per-category targets), 'flex' (discretionary spending sharing one pool), or 'non_monthly' (irregular costs spread across N months).";

function isBucket(v: unknown): v is Bucket {
  return typeof v === "string" && (BUCKETS as readonly string[]).includes(v);
}

function planMonthYear(key: string): number {
  return Number(key.slice(0, 4));
}
function planMonthMonth(key: string): number {
  return Number(key.slice(5, 7)) - 1;
}

/** Aggregate the same shape useBudgetSummary produces, but pure +
 *  read-only against the AIToolContext. Reused by both read tools so
 *  list_budgets_by_bucket and get_budget_summary agree on numbers. */
function summarize(ctx: AIToolContext, planMonth: string) {
  const categories = ctx.getAllCategories();
  // getAllCategories returns InkCategory which lacks bucket/target —
  // walk the raw categories list instead. The merged version is for
  // pickers; analytics need the DB row's full shape.
  const dbCategories = ctx.categories;
  const monthStart = new Date(planMonthYear(planMonth), planMonthMonth(planMonth), 1).getTime();
  const monthEnd = new Date(planMonthYear(planMonth), planMonthMonth(planMonth) + 1, 1).getTime();
  const plans = ctx.getPlans();
  const anchor = anchorMonthFromPlans(plans);

  const spentByCategoryId = new Map<string, number>();
  const monthlyActualsByCategory = new Map<string, number>();
  for (const p of ctx.payments) {
    if (p.gelAmount === null) continue;
    if (p.excludedFromAnalytics) continue;
    // Use the same id-resolution path as the page so AI numbers match
    // dashboard numbers. categorizeName returns the human name; we
    // need the id for keying, so reach through the merged-category
    // map by name.
    const catName = ctx.categorizeName(p.merchant ?? null);
    const merged = categories.find((c) => c.name === catName);
    const catId = merged?.id ?? "other";
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

  const stored = plans.find((p) => p.planMonth === planMonth) ?? null;
  const expectedIncome =
    stored && !stored.expectedIncomeAuto ? stored.expectedIncome : autoIncome(ctx);
  const fixedTargets = dbCategories
    .filter((c) => c.bucket === "fixed")
    .reduce((s, c) => s + (c.targetAmount ?? 0), 0);
  const nonMonthlyAccruals = dbCategories
    .filter((c) => c.bucket === "non_monthly")
    .reduce((s, c) => s + monthlyAccrual(c), 0);
  const savingsTarget = stored?.savingsTarget ?? 0;
  const flexPoolAuto = computeFlexPool({ expectedIncome, fixedTargets, nonMonthlyAccruals, savingsTarget });
  const flexPool = stored && !stored.flexPoolAuto ? stored.flexPool : flexPoolAuto;

  const rows = dbCategories.map((c) => {
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
    return {
      id: c.id,
      name: c.name,
      bucket,
      target: Math.round(target),
      monthlyCommitment: Math.round(monthlyCommitment),
      actual: Math.round(actual),
      rolloverIn: Math.round(rolloverIn),
      effectiveTarget: Math.round(effectiveTarget),
      remaining: Math.round(effectiveTarget - actual),
      rolloverEnabled: c.rolloverEnabled === true,
      frequencyMonths: c.frequencyMonths ?? null,
    };
  });

  const flexActual = rows
    .filter((r) => r.bucket === "flex")
    .reduce((s, r) => s + r.actual, 0);
  const fixedActual = rows.filter((r) => r.bucket === "fixed").reduce((s, r) => s + r.actual, 0);
  const nonMonthlyActual = rows.filter((r) => r.bucket === "non_monthly").reduce((s, r) => s + r.actual, 0);
  const nonMonthlySinkingFund = rows.filter((r) => r.bucket === "non_monthly").reduce((s, r) => s + r.rolloverIn, 0);

  return {
    planMonth,
    expectedIncome: Math.round(expectedIncome),
    expectedIncomeAuto: !stored || stored.expectedIncomeAuto,
    fixedTargets: Math.round(fixedTargets),
    nonMonthlyAccruals: Math.round(nonMonthlyAccruals),
    savingsTarget: Math.round(savingsTarget),
    flexPool: Math.round(flexPool),
    flexPoolAuto: !stored || stored.flexPoolAuto,
    flexActual: Math.round(flexActual),
    flexRemaining: Math.round(Math.max(0, flexPool - flexActual)),
    fixedActual: Math.round(fixedActual),
    nonMonthlyActual: Math.round(nonMonthlyActual),
    nonMonthlySinkingFund: Math.round(nonMonthlySinkingFund),
    rows,
  };
}

/** 3-month rolling average of GEL credits, excluding excluded rows.
 *  Mirrors useExpectedIncomeDefault. */
function autoIncome(ctx: AIToolContext): number {
  const cutoff = new Date(ctx.now.getFullYear(), ctx.now.getMonth() - 3, 1).getTime();
  const monthEnd = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), 1).getTime();
  const monthly = new Map<string, number>();
  for (const c of ctx.credits) {
    if (c.gelAmount === null) continue;
    if (c.excludedFromAnalytics) continue;
    if (c.transactionDate < cutoff || c.transactionDate >= monthEnd) continue;
    const key = monthKeyFromTimestamp(c.transactionDate);
    monthly.set(key, (monthly.get(key) ?? 0) + c.gelAmount);
  }
  if (monthly.size === 0) return 0;
  const totals = Array.from(monthly.values());
  return totals.reduce((s, x) => s + x, 0) / totals.length;
}

const getBudgetSummary: AITool = {
  definition: {
    name: "get_budget_summary",
    description:
      "Returns the user's flex-budgeting plan for the current month: flex pool, flex remaining, fixed/non-monthly/flex actuals, savings target, rollover sinking fund. Use this when the user asks 'how much flex do I have left', 'what's my budget for X', 'am I on track this month', or any plan-aware question. Defaults to the current month when no args.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "integer", minimum: 0, maximum: 11, description: "0-indexed month. Defaults to current." },
        year: { type: "integer", description: "Four-digit year. Defaults to current." },
      },
    },
  },
  statusText: "Reading your budget…",
  executor: (input, ctx) => {
    const month = typeof input.month === "number" ? input.month : ctx.now.getMonth();
    const year = typeof input.year === "number" ? input.year : ctx.now.getFullYear();
    const planMonth = `${year}-${String(month + 1).padStart(2, "0")}`;
    const summary = summarize(ctx, planMonth);
    return {
      planMonth: summary.planMonth,
      expectedIncome: summary.expectedIncome,
      expectedIncomeAuto: summary.expectedIncomeAuto,
      flexPool: summary.flexPool,
      flexPoolAuto: summary.flexPoolAuto,
      flexActual: summary.flexActual,
      flexRemaining: summary.flexRemaining,
      fixedActual: summary.fixedActual,
      fixedTargets: summary.fixedTargets,
      nonMonthlyActual: summary.nonMonthlyActual,
      nonMonthlyAccruals: summary.nonMonthlyAccruals,
      nonMonthlySinkingFund: summary.nonMonthlySinkingFund,
      savingsTarget: summary.savingsTarget,
    };
  },
};

const listBudgetsByBucket: AITool = {
  definition: {
    name: "list_budgets_by_bucket",
    description:
      "Lists every category grouped by bucket (Fixed, Flex, Non-Monthly, Unclassified) with target, monthly commitment, current-month actual, and rollover. Use this when the user asks 'which categories are over budget', 'show me all my budgets', or 'what's left in fixed'.",
    inputSchema: { type: "object", properties: {} },
  },
  statusText: "Listing your budgets…",
  executor: (_input, ctx) => {
    const planMonth = planMonthKey(ctx.now);
    const { rows } = summarize(ctx, planMonth);
    const groups: Record<string, typeof rows> = {
      fixed: [],
      flex: [],
      non_monthly: [],
      unclassified: [],
    };
    for (const r of rows) {
      const key = r.bucket ?? "unclassified";
      groups[key].push(r);
    }
    return groups;
  },
};

const setCategoryBucket: AITool = {
  definition: {
    name: "set_category_bucket",
    description:
      "Assigns a category to a budget bucket. AUTO-APPLIES. Use when the user says 'put rent in fixed', 'move dining to flex', or after creating a category that needs a bucket. To unclassify, call clear_category_budget instead.",
    inputSchema: {
      type: "object",
      properties: {
        categoryId: { type: "string", description: "InstantDB id of the category. Resolve via list_categories or list_budgets_by_bucket." },
        bucket: { type: "string", enum: ["fixed", "flex", "non_monthly"], description: BUCKET_DESC },
      },
      required: ["categoryId", "bucket"],
    },
  },
  statusText: "Updating the bucket…",
  executor: async (input, ctx) => {
    const categoryId = typeof input.categoryId === "string" ? input.categoryId : "";
    const bucket = typeof input.bucket === "string" ? input.bucket : "";
    if (!categoryId) throw new Error("`categoryId` is required.");
    if (!isBucket(bucket)) throw new Error(`\`bucket\` must be one of: ${BUCKETS.join(", ")}.`);
    const cat = ctx.categories.find((c) => c.id === categoryId);
    if (!cat) throw new Error(`No category with id "${categoryId}". Use list_categories to find ids.`);
    await db.transact(db.tx.categories[categoryId].update({ bucket }));
    return { categoryId, name: cat.name, bucket, applied: true };
  },
};

const setCategoryTarget: AITool = {
  definition: {
    name: "set_category_target",
    description:
      "Sets the budget target for a category. For Fixed: monthly target in GEL. For Non-Monthly: total target across `frequencyMonths` (e.g. ₾2400 / 12 = ₾200/mo accrual). AUTO-APPLIES. The category must have a bucket assigned first — call set_category_bucket if it doesn't. Flex categories don't take targets (the bucket pool is the limit).",
    inputSchema: {
      type: "object",
      properties: {
        categoryId: { type: "string", description: "InstantDB id of the category." },
        targetGEL: { type: "number", description: "Target amount in GEL. Must be ≥ 0." },
        frequencyMonths: {
          type: "integer",
          description: "Required for Non-Monthly categories — number of months the targetGEL spreads across (12 for annual, 4 for quarterly). Ignored for Fixed.",
        },
      },
      required: ["categoryId", "targetGEL"],
    },
  },
  statusText: "Updating the target…",
  executor: async (input, ctx) => {
    const categoryId = typeof input.categoryId === "string" ? input.categoryId : "";
    const targetGEL = typeof input.targetGEL === "number" ? input.targetGEL : NaN;
    const frequencyMonths = typeof input.frequencyMonths === "number" ? input.frequencyMonths : undefined;
    if (!categoryId) throw new Error("`categoryId` is required.");
    if (!Number.isFinite(targetGEL) || targetGEL < 0) {
      throw new Error("`targetGEL` must be a non-negative number.");
    }
    const cat = ctx.categories.find((c) => c.id === categoryId);
    if (!cat) throw new Error(`No category with id "${categoryId}".`);
    if (cat.bucket === "flex") {
      throw new Error("Flex categories don't have per-category targets; the bucket pool is the limit. Use set_flex_pool to change the pool.");
    }
    if (cat.bucket === "non_monthly" && (!frequencyMonths || frequencyMonths <= 0)) {
      throw new Error("`frequencyMonths` is required for Non-Monthly categories and must be > 0.");
    }
    const updates: Partial<{ targetAmount: number; frequencyMonths: number }> = { targetAmount: targetGEL };
    if (cat.bucket === "non_monthly" && frequencyMonths) {
      updates.frequencyMonths = frequencyMonths;
    }
    await db.transact(db.tx.categories[categoryId].update(updates));
    return { categoryId, name: cat.name, targetGEL, frequencyMonths: updates.frequencyMonths ?? null, applied: true };
  },
};

const clearCategoryBudget: AITool = {
  definition: {
    name: "clear_category_budget",
    description:
      "Unclassifies a category — drops its bucket, target, frequency, and rollover flag. Does NOT delete the category itself; it just disappears from the budget formula. AUTO-APPLIES. Reversible by calling set_category_bucket again.",
    inputSchema: {
      type: "object",
      properties: {
        categoryId: { type: "string", description: "InstantDB id of the category to unclassify." },
      },
      required: ["categoryId"],
    },
  },
  statusText: "Unclassifying the category…",
  executor: async (input, ctx) => {
    const categoryId = typeof input.categoryId === "string" ? input.categoryId : "";
    if (!categoryId) throw new Error("`categoryId` is required.");
    const cat = ctx.categories.find((c) => c.id === categoryId);
    if (!cat) throw new Error(`No category with id "${categoryId}".`);
    await db.transact(
      db.tx.categories[categoryId].update({
        bucket: undefined,
        targetAmount: undefined,
        frequencyMonths: undefined,
        rolloverEnabled: undefined,
      })
    );
    return { categoryId, name: cat.name, cleared: true };
  },
};

// Per-month plan upserts. Mirror the useBudgetMutations.upsertPlan
// pattern: read plans via the live getter, decide insert-vs-update,
// fall back to creating a fresh row keyed by id() if none exists.
async function upsertPlan(
  ctx: AIToolContext,
  planMonth: string,
  updates: Record<string, unknown>
) {
  const now = Date.now();
  const plans = ctx.getPlans();
  const existing = plans.find((p) => p.planMonth === planMonth);
  if (existing) {
    await db.transact(db.tx.budgetPlans[existing.id].update({ ...updates, updatedAt: now }));
  } else {
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
}

const setExpectedIncome: AITool = {
  definition: {
    name: "set_expected_income",
    description:
      "Sets the expected monthly income (the input to the flex formula) for a given month. AUTO-APPLIES. Pass `amountGEL: null` to revert to the auto-derived 3-month rolling average. Defaults to the current month.",
    inputSchema: {
      type: "object",
      properties: {
        amountGEL: { type: ["number", "null"], description: "Income in GEL, or null to revert to auto." },
        month: { type: "string", description: "Plan month as 'YYYY-MM'. Defaults to current." },
      },
      required: ["amountGEL"],
    },
  },
  statusText: "Updating expected income…",
  executor: async (input, ctx) => {
    const planMonth = typeof input.month === "string" ? input.month : planMonthKey(ctx.now);
    const amount = input.amountGEL;
    if (amount === null) {
      await upsertPlan(ctx, planMonth, { expectedIncomeAuto: true });
      return { planMonth, applied: true, mode: "auto" };
    }
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      throw new Error("`amountGEL` must be a non-negative number or null.");
    }
    await upsertPlan(ctx, planMonth, { expectedIncome: amount, expectedIncomeAuto: false });
    return { planMonth, applied: true, mode: "manual", amountGEL: amount };
  },
};

const setFlexPool: AITool = {
  definition: {
    name: "set_flex_pool",
    description:
      "Manually overrides the flex pool for a given month, bypassing the auto-derived formula. AUTO-APPLIES. Pass `amountGEL: null` to revert to auto. Use when the user wants to cap flex spending at a specific number regardless of income/fixed math.",
    inputSchema: {
      type: "object",
      properties: {
        amountGEL: { type: ["number", "null"], description: "Pool in GEL, or null to revert to auto." },
        month: { type: "string", description: "Plan month as 'YYYY-MM'. Defaults to current." },
      },
      required: ["amountGEL"],
    },
  },
  statusText: "Updating flex pool…",
  executor: async (input, ctx) => {
    const planMonth = typeof input.month === "string" ? input.month : planMonthKey(ctx.now);
    const amount = input.amountGEL;
    if (amount === null) {
      await upsertPlan(ctx, planMonth, { flexPoolAuto: true });
      return { planMonth, applied: true, mode: "auto" };
    }
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      throw new Error("`amountGEL` must be a non-negative number or null.");
    }
    await upsertPlan(ctx, planMonth, { flexPool: amount, flexPoolAuto: false });
    return { planMonth, applied: true, mode: "manual", amountGEL: amount };
  },
};

const setSavingsTarget: AITool = {
  definition: {
    name: "set_savings_target",
    description:
      "Sets the monthly savings allocation. AUTO-APPLIES. Drops out of the flex pool — savings is deducted from income before flex is computed (matches Monarch's model). Pass 0 to clear.",
    inputSchema: {
      type: "object",
      properties: {
        amountGEL: { type: "number", description: "Savings in GEL. 0 to clear." },
        month: { type: "string", description: "Plan month as 'YYYY-MM'. Defaults to current." },
      },
      required: ["amountGEL"],
    },
  },
  statusText: "Updating savings target…",
  executor: async (input, ctx) => {
    const planMonth = typeof input.month === "string" ? input.month : planMonthKey(ctx.now);
    const amount = input.amountGEL;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      throw new Error("`amountGEL` must be a non-negative number.");
    }
    await upsertPlan(ctx, planMonth, { savingsTarget: amount });
    return { planMonth, savingsTarget: amount, applied: true };
  },
};

const setCategoryRollover: AITool = {
  definition: {
    name: "set_category_rollover",
    description:
      "Toggles whether a Fixed category rolls leftover/overshoot to the next month. AUTO-APPLIES. Only meaningful for Fixed categories (Non-Monthly always rolls; Flex never does). Off by default — opt the user in when they explicitly want the carry behaviour.",
    inputSchema: {
      type: "object",
      properties: {
        categoryId: { type: "string", description: "InstantDB id of a Fixed category." },
        enabled: { type: "boolean", description: "true to turn rollover on, false to turn it off." },
      },
      required: ["categoryId", "enabled"],
    },
  },
  statusText: "Updating rollover…",
  executor: async (input, ctx) => {
    const categoryId = typeof input.categoryId === "string" ? input.categoryId : "";
    const enabled = input.enabled;
    if (!categoryId) throw new Error("`categoryId` is required.");
    if (typeof enabled !== "boolean") throw new Error("`enabled` must be a boolean.");
    const cat = ctx.categories.find((c) => c.id === categoryId);
    if (!cat) throw new Error(`No category with id "${categoryId}".`);
    if (cat.bucket !== "fixed") {
      throw new Error("Rollover toggle only applies to Fixed categories. Non-Monthly always rolls; Flex never does.");
    }
    await db.transact(db.tx.categories[categoryId].update({ rolloverEnabled: enabled }));
    return { categoryId, name: cat.name, rolloverEnabled: enabled, applied: true };
  },
};

export const BUDGET_TOOLS: AITool[] = [
  getBudgetSummary,
  listBudgetsByBucket,
  setCategoryBucket,
  setCategoryTarget,
  setCategoryRollover,
  setExpectedIncome,
  setFlexPool,
  setSavingsTarget,
  clearCategoryBudget,
];
