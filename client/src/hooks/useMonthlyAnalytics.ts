import { useMemo } from "react";
import { db } from "../lib/instant";
import { DEFAULT_CATEGORIES, autoCategorize } from "../lib/utils";
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
  const { data: paymentsData } = db.useQuery({ payments: {} });
  const { data: failedData } = db.useQuery({ failedPayments: {} });

  return useMemo(() => {
    const payments = paymentsData?.payments || [];
    const failed = failedData?.failedPayments || [];
    const interval = getMonthInterval(my);
    const prevInterval = getMonthInterval(getPreviousMonth(my));

    const inRange = (date: number, iv: { start: Date; end: Date }) =>
      isWithinInterval(new Date(date), iv);

    // Filter to GEL before summing: foreign-currency amounts (USD/EUR) can't
    // be added to a GEL total without a conversion, and summing them raw
    // would inflate the number. `count` stays unfiltered so the "N transactions"
    // hint still reflects everything that happened this month.
    const currentPayments = payments.filter((p) => inRange(p.transactionDate, interval));
    const currentFailed = failed.filter((p) => inRange(p.transactionDate, interval));
    const prevPayments = payments.filter((p) => inRange(p.transactionDate, prevInterval));

    const currentGelPayments = currentPayments.filter((p) => p.currency === "GEL");
    const prevGelPayments = prevPayments.filter((p) => p.currency === "GEL");

    const total = currentGelPayments.reduce((s, p) => s + p.amount, 0);
    const count = currentPayments.length;
    const failedCount = currentFailed.length;
    const avg = count > 0 ? total / count : 0;

    const prevTotal = prevGelPayments.reduce((s, p) => s + p.amount, 0);
    const prevCount = prevPayments.length;
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
  }, [paymentsData?.payments, failedData?.failedPayments, my.month, my.year]);
}

export function useMonthSpendingByDay(my: MonthYear) {
  const { data: paymentsData } = db.useQuery({ payments: {} });

  return useMemo(() => {
    const payments = paymentsData?.payments || [];
    const interval = getMonthInterval(my);

    const monthPayments = payments.filter((p) =>
      isWithinInterval(new Date(p.transactionDate), interval)
    );

    const dailyTotals: Record<string, number> = {};
    for (const p of monthPayments) {
      const date = new Date(p.transactionDate).toISOString().split("T")[0];
      dailyTotals[date] = (dailyTotals[date] || 0) + p.amount;
    }

    const daysInMonth = getDaysInMonth(new Date(my.year, my.month, 1));
    const result: { date: string; amount: number }[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(my.year, my.month, day).toISOString().split("T")[0];
      result.push({ date, amount: dailyTotals[date] || 0 });
    }

    return result;
  }, [paymentsData?.payments, my.month, my.year]);
}

export function useMonthTopMerchants(my: MonthYear, limit: number = 10) {
  const { data: paymentsData } = db.useQuery({ payments: {} });

  return useMemo(() => {
    const payments = paymentsData?.payments || [];
    const interval = getMonthInterval(my);

    const monthPayments = payments.filter((p) =>
      isWithinInterval(new Date(p.transactionDate), interval)
    );

    const merchantTotals: Record<string, { total: number; count: number }> = {};
    for (const p of monthPayments) {
      const merchant = p.merchant || "Unknown";
      if (!merchantTotals[merchant]) merchantTotals[merchant] = { total: 0, count: 0 };
      merchantTotals[merchant].total += p.amount;
      merchantTotals[merchant].count += 1;
    }

    return Object.entries(merchantTotals)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  }, [paymentsData?.payments, my.month, my.year, limit]);
}

export function useMonthCategoryAnalytics(my: MonthYear) {
  const { data: paymentsData } = db.useQuery({ payments: {} });
  const { data: catData } = db.useQuery({ categories: {} });

  return useMemo(() => {
    const payments = paymentsData?.payments || [];
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
      const categoryName = autoCategorize(payment.merchant ?? null);
      if (categoryTotals[categoryName]) {
        categoryTotals[categoryName].total += payment.amount;
        categoryTotals[categoryName].count += 1;
      } else {
        categoryTotals["Other"].total += payment.amount;
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
  }, [paymentsData?.payments, catData?.categories, my.month, my.year]);
}
