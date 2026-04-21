import { useMemo } from "react";
import { db } from "../lib/instant";
import { isWithinInterval, startOfMonth, endOfMonth } from "date-fns";
import type { MonthYear } from "./useMonthlyAnalytics";

export function useCredits() {
  const { data, isLoading, error } = db.useQuery({ credits: {} });

  const credits = useMemo(() => {
    if (!data?.credits) return [];
    return [...data.credits].sort((a, b) => b.transactionDate - a.transactionDate);
  }, [data?.credits]);

  return { credits, isLoading, error };
}

export function useMonthCredits(my: MonthYear) {
  const { data } = db.useQuery({ credits: {} });

  return useMemo(() => {
    const credits = data?.credits || [];
    const start = startOfMonth(new Date(my.year, my.month, 1));
    const end = endOfMonth(new Date(my.year, my.month, 1));
    const monthCredits = credits.filter((c) =>
      isWithinInterval(new Date(c.transactionDate), { start, end })
    );
    const gelCredits = monthCredits.filter((c) => c.currency === "GEL");
    const total = gelCredits.reduce((s, c) => s + c.amount, 0);
    const count = monthCredits.length;
    return { total, count, credits: monthCredits };
  }, [data?.credits, my.month, my.year]);
}

export function useMonthCashflow(my: MonthYear, spendingTotal: number) {
  const income = useMonthCredits(my);
  return {
    income: income.total,
    spending: spendingTotal,
    net: income.total - spendingTotal,
    incomeCount: income.count,
  };
}
