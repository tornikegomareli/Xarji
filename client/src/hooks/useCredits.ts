import { useMemo } from "react";
import { db, type Credit } from "../lib/instant";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { useGelConverter } from "../lib/exchangeRates";
import type { MonthYear } from "./useMonthlyAnalytics";
import { isInRange, type DateRange } from "../lib/dateRange";

export function useCredits() {
  const { data, isLoading, error } = db.useQuery({ credits: {} });

  const credits = useMemo(() => {
    if (!data?.credits) return [];
    return [...data.credits].sort((a, b) => b.transactionDate - a.transactionDate);
  }, [data?.credits]);

  return { credits, isLoading, error };
}

export type ConvertedCredit = Credit & { gelAmount: number | null };

export function useConvertedCredits() {
  const { credits, isLoading, error } = useCredits();
  const toGel = useGelConverter();
  const converted = useMemo<ConvertedCredit[]>(
    () => credits.map((c) => ({ ...c, gelAmount: toGel(c.amount, c.currency, c.transactionDate) })),
    [credits, toGel]
  );
  return { credits: converted, isLoading, error };
}

export function useRangeCredits(range: DateRange) {
  const { credits } = useConvertedCredits();

  return useMemo(() => {
    const inRange = credits.filter((c) => isInRange(c.transactionDate, range));
    // `total` sums every currency converted to GEL; `count` reflects rows
    // that have actually contributed (i.e. either GEL or non-GEL with a
    // resolved rate). Rows still waiting on a rate are kept in `credits`
    // but excluded from the totals until the rate lands.
    let total = 0;
    let count = 0;
    for (const c of inRange) {
      if (c.gelAmount === null) continue;
      total += c.gelAmount;
      count += 1;
    }
    return { total, count, credits: inRange };
  }, [credits, range]);
}

export function useRangeCashflow(range: DateRange, spendingTotal: number) {
  const income = useRangeCredits(range);
  return {
    income: income.total,
    spending: spendingTotal,
    net: income.total - spendingTotal,
    incomeCount: income.count,
  };
}

// Backwards-compat shim — Dashboard + Income still call this with a
// MonthYear; converts to DateRange and forwards. Removed once those
// callers migrate to useRangeCredits in this same PR.
export function useMonthCredits(my: MonthYear) {
  const range = useMemo<DateRange>(() => {
    const start = startOfMonth(new Date(my.year, my.month, 1));
    const end = endOfMonth(start);
    return { start, end, label: format(start, "MMMM yyyy"), key: "Month" };
  }, [my.month, my.year]);
  return useRangeCredits(range);
}

