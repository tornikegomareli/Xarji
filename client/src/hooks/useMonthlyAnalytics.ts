import { useMemo } from "react";
import { db } from "../lib/instant";
import { DEFAULT_CATEGORIES } from "../lib/utils";
import { useCategorizer } from "./useCategorizer";
import { formatLocalDay } from "../ink/format";
import { useConvertedPayments } from "./useTransactions";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  isWithinInterval,
  getDaysInMonth,
  format,
} from "date-fns";

export interface MonthYear {
  month: number; // 0-11
  year: number;
}

function getMonthInterval(my: MonthYear) {
  const d = new Date(my.year, my.month, 1);
  return { start: startOfMonth(d), end: endOfMonth(d) };
}

function getPreviousMonth(my: MonthYear): MonthYear {
  const d = subMonths(new Date(my.year, my.month, 1), 1);
  return { month: d.getMonth(), year: d.getFullYear() };
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

export function useMonthStats(my: MonthYear) {
  const { payments } = useConvertedPayments();
  const { data: failedData } = db.useQuery({ failedPayments: {} });

  return useMemo(() => {
    const failed = failedData?.failedPayments || [];
    const interval = getMonthInterval(my);
    const prevInterval = getMonthInterval(getPreviousMonth(my));

    const inRange = (date: number, iv: { start: Date; end: Date }) =>
      isWithinInterval(new Date(date), iv);

    // Sum every currency converted to GEL via the NBG rate for each
    // transaction's date. Rows still loading (`gelAmount === null`)
    // skip the total this render, then snap in once the rate arrives.
    let total = 0;
    let count = 0;
    let prevTotal = 0;
    let prevCount = 0;
    for (const p of payments) {
      const inCur = inRange(p.transactionDate, interval);
      const inPrev = !inCur && inRange(p.transactionDate, prevInterval);
      if (!inCur && !inPrev) continue;
      if (p.gelAmount === null) continue;
      if (inCur) {
        total += p.gelAmount;
        count += 1;
      } else {
        prevTotal += p.gelAmount;
        prevCount += 1;
      }
    }
    const failedCount = failed.filter((p) => inRange(p.transactionDate, interval)).length;
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
  }, [payments, failedData?.failedPayments, my.month, my.year]);
}

export function useMonthSpendingByDay(my: MonthYear) {
  const { payments } = useConvertedPayments();

  return useMemo(() => {
    const interval = getMonthInterval(my);

    const monthPayments = payments.filter((p) =>
      isWithinInterval(new Date(p.transactionDate), interval)
    );

    const dailyTotals: Record<string, number> = {};
    for (const p of monthPayments) {
      if (p.gelAmount === null) continue;
      const date = formatLocalDay(p.transactionDate);
      dailyTotals[date] = (dailyTotals[date] || 0) + p.gelAmount;
    }

    const daysInMonth = getDaysInMonth(new Date(my.year, my.month, 1));
    const result: { date: string; amount: number }[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = formatLocalDay(new Date(my.year, my.month, day).getTime());
      result.push({ date, amount: dailyTotals[date] || 0 });
    }

    return result;
  }, [payments, my.month, my.year]);
}

export function useMonthTopMerchants(my: MonthYear, limit: number = 10) {
  const { payments } = useConvertedPayments();

  return useMemo(() => {
    const interval = getMonthInterval(my);

    const monthPayments = payments.filter((p) =>
      isWithinInterval(new Date(p.transactionDate), interval)
    );

    const merchantTotals: Record<string, { total: number; count: number }> = {};
    for (const p of monthPayments) {
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
  }, [payments, my.month, my.year, limit]);
}

export function useMonthCategoryAnalytics(my: MonthYear) {
  const { payments } = useConvertedPayments();
  const { data: catData } = db.useQuery({ categories: {} });
  const { categorizeName } = useCategorizer();

  return useMemo(() => {
    const categories = catData?.categories || [];
    const interval = getMonthInterval(my);

    const monthPayments = payments.filter((p) =>
      isWithinInterval(new Date(p.transactionDate), interval)
    );

    const categoryTotals: Record<string, { total: number; count: number; color: string }> = {};

    const cats = categories.length > 0 ? categories : DEFAULT_CATEGORIES;
    for (const cat of cats) {
      categoryTotals[cat.name] = { total: 0, count: 0, color: cat.color };
    }
    if (!categoryTotals["Other"]) {
      categoryTotals["Other"] = { total: 0, count: 0, color: "#6b7280" };
    }

    for (const payment of monthPayments) {
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
  }, [payments, catData?.categories, my.month, my.year, categorizeName]);
}
