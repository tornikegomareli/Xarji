// Read-only tools the model can call to inspect the user's data.
// These are pure functions over the AIToolContext — no mutations, no
// network. v2 will add write tools (create_category, set_budget) with
// a consent flow.

import {
  startOfMonth,
  endOfMonth,
  isWithinInterval,
  subMonths,
  format,
} from "date-fns";
import { autoCategorize } from "../../utils";
import type { AITool, AIToolContext } from "./types";

const MONTH_INPUT = {
  type: "object",
  properties: {
    month: { type: "integer", minimum: 0, maximum: 11, description: "0-indexed month (0 = January). Defaults to the current month." },
    year: { type: "integer", description: "Four-digit year. Defaults to the current year." },
  },
} as const;

function resolveMonth(ctx: AIToolContext, input: Record<string, unknown>) {
  const month = typeof input.month === "number" ? input.month : ctx.now.getMonth();
  const year = typeof input.year === "number" ? input.year : ctx.now.getFullYear();
  const start = startOfMonth(new Date(year, month, 1));
  const end = endOfMonth(new Date(year, month, 1));
  return { month, year, start, end, label: format(start, "MMMM yyyy") };
}

const getMonthSummary: AITool = {
  definition: {
    name: "get_month_summary",
    description:
      "Returns aggregate spending, income, and net for a specific month, plus the top 5 merchants and top 5 categories. Defaults to the current month if no arguments are given.",
    inputSchema: MONTH_INPUT,
  },
  statusText: "Reading your month summary…",
  executor: (input, ctx) => {
    const { start, end, label } = resolveMonth(ctx, input);
    const inMonth = (ts: number) => isWithinInterval(new Date(ts), { start, end });

    let totalSpent = 0;
    let txCount = 0;
    const merchantTotals = new Map<string, { total: number; count: number }>();
    const categoryTotals = new Map<string, { total: number; count: number }>();

    for (const p of ctx.payments) {
      if (!inMonth(p.transactionDate) || p.gelAmount === null) continue;
      totalSpent += p.gelAmount;
      txCount += 1;
      const merchant = p.merchant || "Unknown";
      const m = merchantTotals.get(merchant) ?? { total: 0, count: 0 };
      m.total += p.gelAmount;
      m.count += 1;
      merchantTotals.set(merchant, m);
      const category = autoCategorize(p.merchant ?? null);
      const c = categoryTotals.get(category) ?? { total: 0, count: 0 };
      c.total += p.gelAmount;
      c.count += 1;
      categoryTotals.set(category, c);
    }

    let totalIncome = 0;
    let incomeCount = 0;
    for (const c of ctx.credits) {
      if (!inMonth(c.transactionDate) || c.gelAmount === null) continue;
      totalIncome += c.gelAmount;
      incomeCount += 1;
    }

    const failedCount = ctx.failedPayments.filter((f) => inMonth(f.transactionDate)).length;

    const topMerchants = [...merchantTotals.entries()]
      .map(([name, v]) => ({ name, total: Math.round(v.total), count: v.count }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const topCategories = [...categoryTotals.entries()]
      .map(([name, v]) => ({ name, total: Math.round(v.total), count: v.count }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return {
      period: label,
      currency: "GEL",
      totalSpent: Math.round(totalSpent),
      totalIncome: Math.round(totalIncome),
      net: Math.round(totalIncome - totalSpent),
      transactionCount: txCount,
      incomeDepositCount: incomeCount,
      failedPaymentCount: failedCount,
      topMerchants,
      topCategories,
    };
  },
};

const searchTransactions: AITool = {
  definition: {
    name: "search_transactions",
    description:
      "Filter transactions by free-text query, category, currency, amount range, and date range. Returns up to 50 matches with key fields. Use this when the user asks for specific transactions or a precise filter.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring matched against merchant + raw SMS message (case-insensitive)." },
        category: { type: "string", description: "Category name (e.g. 'Groceries', 'Subscriptions')." },
        currency: { type: "string", description: "Currency code (GEL, USD, EUR)." },
        minAmount: { type: "number", description: "Minimum GEL-equivalent amount." },
        maxAmount: { type: "number", description: "Maximum GEL-equivalent amount." },
        dateFrom: { type: "string", description: "ISO date (YYYY-MM-DD) — inclusive." },
        dateTo: { type: "string", description: "ISO date (YYYY-MM-DD) — inclusive." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Max rows to return (default 20)." },
      },
    },
  },
  statusText: "Searching your transactions…",
  executor: (input, ctx) => {
    const query = typeof input.query === "string" ? input.query.toLowerCase() : null;
    const category = typeof input.category === "string" ? input.category.toLowerCase() : null;
    const currency = typeof input.currency === "string" ? input.currency.toUpperCase() : null;
    const min = typeof input.minAmount === "number" ? input.minAmount : null;
    const max = typeof input.maxAmount === "number" ? input.maxAmount : null;
    const from = typeof input.dateFrom === "string" ? new Date(input.dateFrom).getTime() : null;
    const to = typeof input.dateTo === "string" ? new Date(input.dateTo).getTime() : null;
    const limit = typeof input.limit === "number" ? Math.min(100, Math.max(1, input.limit)) : 20;

    const matches = ctx.payments
      .filter((p) => {
        if (query) {
          const haystack = `${p.merchant ?? ""} ${p.rawMessage ?? ""}`.toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        if (category) {
          const cat = autoCategorize(p.merchant ?? null).toLowerCase();
          if (cat !== category) return false;
        }
        if (currency && p.currency.toUpperCase() !== currency) return false;
        const amt = p.gelAmount ?? 0;
        if (min !== null && amt < min) return false;
        if (max !== null && amt > max) return false;
        if (from !== null && p.transactionDate < from) return false;
        if (to !== null && p.transactionDate > to) return false;
        return true;
      })
      .slice(0, limit)
      .map((p) => ({
        date: format(new Date(p.transactionDate), "yyyy-MM-dd HH:mm"),
        merchant: p.merchant ?? "Unknown",
        amount: p.amount,
        currency: p.currency,
        gelAmount: p.gelAmount !== null ? Math.round(p.gelAmount) : null,
        category: autoCategorize(p.merchant ?? null),
        card: p.cardLastDigits ?? null,
      }));

    return { matchCount: matches.length, transactions: matches };
  },
};

const compareMonths: AITool = {
  definition: {
    name: "compare_months",
    description:
      "Side-by-side comparison of spending, income, and category breakdown between two months. Defaults to comparing the current month with the previous month.",
    inputSchema: {
      type: "object",
      properties: {
        a: MONTH_INPUT,
        b: MONTH_INPUT,
      },
    },
  },
  statusText: "Comparing months…",
  executor: (input, ctx) => {
    const a = resolveMonth(ctx, (input.a ?? {}) as Record<string, unknown>);
    const bDefault = subMonths(a.start, 1);
    const b = resolveMonth(
      ctx,
      input.b
        ? (input.b as Record<string, unknown>)
        : { month: bDefault.getMonth(), year: bDefault.getFullYear() }
    );

    const summarize = (range: typeof a) => {
      const inRange = (ts: number) =>
        isWithinInterval(new Date(ts), { start: range.start, end: range.end });
      let spent = 0;
      let income = 0;
      const cats = new Map<string, number>();
      for (const p of ctx.payments) {
        if (!inRange(p.transactionDate) || p.gelAmount === null) continue;
        spent += p.gelAmount;
        const cat = autoCategorize(p.merchant ?? null);
        cats.set(cat, (cats.get(cat) ?? 0) + p.gelAmount);
      }
      for (const c of ctx.credits) {
        if (!inRange(c.transactionDate) || c.gelAmount === null) continue;
        income += c.gelAmount;
      }
      return {
        period: range.label,
        spent: Math.round(spent),
        income: Math.round(income),
        net: Math.round(income - spent),
        topCategories: [...cats.entries()]
          .map(([name, total]) => ({ name, total: Math.round(total) }))
          .sort((x, y) => y.total - x.total)
          .slice(0, 5),
      };
    };

    const sa = summarize(a);
    const sb = summarize(b);
    const delta = {
      spentDelta: sa.spent - sb.spent,
      incomeDelta: sa.income - sb.income,
      netDelta: sa.net - sb.net,
    };
    return { a: sa, b: sb, delta };
  },
};

const listCategories: AITool = {
  definition: {
    name: "list_categories",
    description:
      "Returns the user's categories with their color and icon, plus the GEL-equivalent total for the current month for each.",
    inputSchema: { type: "object", properties: {} },
  },
  statusText: "Looking at your categories…",
  executor: (_input, ctx) => {
    const { start, end } = resolveMonth(ctx, {});
    const inMonth = (ts: number) => isWithinInterval(new Date(ts), { start, end });
    const monthTotals = new Map<string, { total: number; count: number }>();
    for (const p of ctx.payments) {
      if (!inMonth(p.transactionDate) || p.gelAmount === null) continue;
      const cat = autoCategorize(p.merchant ?? null);
      const v = monthTotals.get(cat) ?? { total: 0, count: 0 };
      v.total += p.gelAmount;
      v.count += 1;
      monthTotals.set(cat, v);
    }
    return {
      categories: ctx.categories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        icon: c.icon,
        thisMonthTotal: Math.round(monthTotals.get(c.name)?.total ?? 0),
        thisMonthCount: monthTotals.get(c.name)?.count ?? 0,
      })),
    };
  },
};

const getRecurringCharges: AITool = {
  definition: {
    name: "get_recurring_charges",
    description:
      "Detects merchants charged at a roughly monthly cadence (≥3 payments across the last 6 months). Returns merchant, average amount, count, last seen date, and the current month's spend.",
    inputSchema: { type: "object", properties: {} },
  },
  statusText: "Checking recurring charges…",
  executor: (_input, ctx) => {
    const cutoff = subMonths(ctx.now, 6).getTime();
    const byMerchant = new Map<
      string,
      { amounts: number[]; dates: number[]; thisMonth: number }
    >();
    const monthStart = startOfMonth(ctx.now).getTime();
    for (const p of ctx.payments) {
      if (p.transactionDate < cutoff || p.gelAmount === null) continue;
      const merchant = p.merchant || "Unknown";
      const v = byMerchant.get(merchant) ?? { amounts: [], dates: [], thisMonth: 0 };
      v.amounts.push(p.gelAmount);
      v.dates.push(p.transactionDate);
      if (p.transactionDate >= monthStart) v.thisMonth += p.gelAmount;
      byMerchant.set(merchant, v);
    }

    const recurring: Array<{
      merchant: string;
      averageAmount: number;
      occurrences: number;
      lastSeen: string;
      thisMonthSpend: number;
    }> = [];
    for (const [merchant, v] of byMerchant) {
      if (v.amounts.length < 3) continue;
      const avg = v.amounts.reduce((s, x) => s + x, 0) / v.amounts.length;
      const stddev = Math.sqrt(
        v.amounts.reduce((s, x) => s + (x - avg) ** 2, 0) / v.amounts.length
      );
      const stable = avg > 0 && stddev / avg < 0.5;
      if (!stable) continue;
      const lastTs = Math.max(...v.dates);
      recurring.push({
        merchant,
        averageAmount: Math.round(avg),
        occurrences: v.amounts.length,
        lastSeen: format(new Date(lastTs), "yyyy-MM-dd"),
        thisMonthSpend: Math.round(v.thisMonth),
      });
    }
    recurring.sort((a, b) => b.averageAmount - a.averageAmount);
    return { recurring };
  },
};

export const READONLY_TOOLS: AITool[] = [
  getMonthSummary,
  searchTransactions,
  compareMonths,
  listCategories,
  getRecurringCharges,
];
