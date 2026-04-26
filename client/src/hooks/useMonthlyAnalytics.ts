import { useMemo } from "react";
import { db } from "../lib/instant";
import { DEFAULT_CATEGORIES } from "../lib/utils";
import { formatLocalDay } from "../ink/format";
import { useConvertedPayments } from "./useTransactions";
import { useCategorizer } from "./useCategorizer";
import { startOfMonth, endOfMonth, format, differenceInDays } from "date-fns";
import { isInRange, previousRange, type DateRange } from "../lib/dateRange";

export interface MonthYear {
  month: number; // 0-11
  year: number;
}

export function useAvailableMonths() {
  const { data: paymentsData } = db.useQuery({ payments: {} });
  const { data: failedData } = db.useQuery({ failedPayments: {} });

  return useMemo(() => {
    const months = new Set<string>();
    const all = [
      ...(paymentsData?.payments || []),
      ...(failedData?.failedPayments || []),
    ];

    for (const tx of all) {
      const d = new Date(tx.transactionDate);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      months.add(key);
    }

    return [...months]
      .sort()
      .reverse()
      .map((key) => {
        const [year, month] = key.split("-").map(Number);
        const d = new Date(year, month, 1);
        return {
          value: key,
          label: format(d, "MMMM yyyy"),
          month,
          year,
        };
      });
  }, [paymentsData?.payments, failedData?.failedPayments]);
}

/** Filters payments + failed-payments to the given date range, returns
 *  the totals + comparisons against the previous equal-length window.
 *  Replaces the old useMonthStats(my) — the page now decides the range
 *  via the PageHeader buttons. */
export function useRangeStats(range: DateRange) {
  const { payments } = useConvertedPayments();
  const { data: failedData } = db.useQuery({ failedPayments: {} });

  return useMemo(() => {
    const failed = failedData?.failedPayments || [];
    const prev = previousRange(range);
    const inCur = (ts: number) => isInRange(ts, range);
    const inPrev = (ts: number) => isInRange(ts, prev);

    let total = 0;
    let count = 0;
    let prevTotal = 0;
    let prevCount = 0;
    for (const p of payments) {
      const cur = inCur(p.transactionDate);
      const previous = !cur && inPrev(p.transactionDate);
      if (!cur && !previous) continue;
      if (p.gelAmount === null) continue;
      if (cur) {
        total += p.gelAmount;
        count += 1;
      } else {
        prevTotal += p.gelAmount;
        prevCount += 1;
      }
    }

    const failedCount = failed.filter((p) => inCur(p.transactionDate)).length;
    const avg = count > 0 ? total / count : 0;
    const totalChange = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : 0;
    const countChange = prevCount > 0 ? ((count - prevCount) / prevCount) * 100 : 0;

    return {
      total,
      count,
      failedCount,
      avg,
      prevTotal,
      prevCount,
      totalChange,
      countChange,
    };
  }, [payments, failedData?.failedPayments, range]);
}

/** Aggregates spending into per-day buckets across the active range.
 *  Returns at most ~93 days; longer ranges fall back to monthly buckets
 *  so a "Year" view stays readable. */
export function useRangeSpendingByDay(range: DateRange) {
  const { payments } = useConvertedPayments();

  return useMemo(() => {
    const days = differenceInDays(range.end, range.start) + 1;
    const useMonthly = days > 93;
    const buckets: Record<string, number> = {};

    for (const p of payments) {
      if (!isInRange(p.transactionDate, range)) continue;
      if (p.gelAmount === null) continue;
      const d = new Date(p.transactionDate);
      const key = useMonthly
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        : formatLocalDay(p.transactionDate);
      buckets[key] = (buckets[key] || 0) + p.gelAmount;
    }

    if (useMonthly) {
      const out: { date: string; amount: number }[] = [];
      const cur = new Date(range.start);
      cur.setDate(1);
      while (cur.getTime() <= range.end.getTime()) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
        out.push({ date: key, amount: buckets[key] || 0 });
        cur.setMonth(cur.getMonth() + 1);
      }
      return out;
    }

    const out: { date: string; amount: number }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate() + i);
      const key = formatLocalDay(d.getTime());
      out.push({ date: key, amount: buckets[key] || 0 });
    }
    return out;
  }, [payments, range]);
}

export function useRangeTopMerchants(range: DateRange, limit: number = 10) {
  const { payments } = useConvertedPayments();

  return useMemo(() => {
    const merchantTotals: Record<string, { total: number; count: number }> = {};
    for (const p of payments) {
      if (!isInRange(p.transactionDate, range)) continue;
      if (p.gelAmount === null) continue;
      const merchant = p.merchant || "Unknown";
      if (!merchantTotals[merchant]) merchantTotals[merchant] = { total: 0, count: 0 };
      merchantTotals[merchant].total += p.gelAmount;
      merchantTotals[merchant].count += 1;
    }

    return Object.entries(merchantTotals)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  }, [payments, range, limit]);
}

export function useRangeCategoryAnalytics(range: DateRange) {
  const { payments } = useConvertedPayments();
  const { data: catData } = db.useQuery({ categories: {} });
  const { categorizeName } = useCategorizer();

  return useMemo(() => {
    const categories = catData?.categories || [];
    const categoryTotals: Record<string, { total: number; count: number; color: string }> = {};

    const cats = categories.length > 0 ? categories : DEFAULT_CATEGORIES;
    for (const cat of cats) {
      categoryTotals[cat.name] = { total: 0, count: 0, color: cat.color };
    }
    if (!categoryTotals["Other"]) {
      categoryTotals["Other"] = { total: 0, count: 0, color: "#6b7280" };
    }

    for (const payment of payments) {
      if (!isInRange(payment.transactionDate, range)) continue;
      if (payment.gelAmount === null) continue;
      const categoryName = categorizeName(payment.merchant ?? null);
      if (categoryTotals[categoryName]) {
        categoryTotals[categoryName].total += payment.gelAmount;
        categoryTotals[categoryName].count += 1;
      } else {
        categoryTotals["Other"].total += payment.gelAmount;
        categoryTotals["Other"].count += 1;
      }
    }

    const result = Object.entries(categoryTotals)
      .map(([name, data]) => ({ name, ...data }))
      .filter((cat) => cat.total > 0)
      .sort((a, b) => b.total - a.total);

    const totalSpent = result.reduce((sum, cat) => sum + cat.total, 0);

    return {
      byCategory: result,
      totalSpent,
      withPercentages: result.map((cat) => ({
        ...cat,
        percentage: totalSpent > 0 ? (cat.total / totalSpent) * 100 : 0,
      })),
    };
  }, [payments, catData?.categories, range, categorizeName]);
}

// ──────────────────────────────────────────────────────────────────
// Backwards-compat shims so call sites that still pass MonthYear keep
// working through the migration. Each just builds the equivalent
// DateRange and forwards. Deleted once every page has moved to the
// range-based hooks.

function rangeFromMonth(my: MonthYear): DateRange {
  const start = startOfMonth(new Date(my.year, my.month, 1));
  const end = endOfMonth(start);
  return { start, end, label: format(start, "MMMM yyyy"), key: "Month" };
}

export function useMonthStats(my: MonthYear) {
  return useRangeStats(useMemo(() => rangeFromMonth(my), [my.month, my.year]));
}

export function useMonthTopMerchants(my: MonthYear, limit: number = 10) {
  return useRangeTopMerchants(useMemo(() => rangeFromMonth(my), [my.month, my.year]), limit);
}

export function useMonthCategoryAnalytics(my: MonthYear) {
  return useRangeCategoryAnalytics(useMemo(() => rangeFromMonth(my), [my.month, my.year]));
}

export function useMonthSpendingByDay(my: MonthYear) {
  return useRangeSpendingByDay(useMemo(() => rangeFromMonth(my), [my.month, my.year]));
}

