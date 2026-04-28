import { useMemo } from "react";
import { db, type Payment } from "../lib/instant";
import { groupBy, getDateGroup } from "../lib/utils";
import { formatLocalDay } from "../ink/format";
import { useGelConverter } from "../lib/exchangeRates";
import { startOfMonth, endOfMonth, subMonths, isWithinInterval } from "date-fns";

export function usePayments() {
  const { data, isLoading, error } = db.useQuery({ payments: {} });

  const payments = useMemo(() => {
    if (!data?.payments) return [];
    return [...data.payments].sort((a, b) => b.transactionDate - a.transactionDate);
  }, [data?.payments]);

  return { payments, isLoading, error };
}

// Same as usePayments but with each row decorated with `gelAmount` —
// the GEL-equivalent of `amount` after applying the NBG rate for the
// transaction's date. Returns null while the rate is still loading;
// aggregators treat null as "skip" so totals snap to the converted
// value once rates arrive instead of briefly inflating.
export type ConvertedPayment = Payment & { gelAmount: number | null };

export function useConvertedPayments() {
  const { payments, isLoading, error } = usePayments();
  const toGel = useGelConverter();
  const converted = useMemo<ConvertedPayment[]>(
    () => payments.map((p) => ({ ...p, gelAmount: toGel(p.amount, p.currency, p.transactionDate) })),
    [payments, toGel]
  );
  return { payments: converted, isLoading, error };
}

/**
 * Toggle the `excludedFromAnalytics` flag on a payment or credit. The
 * caller passes `kind` so we hit the right collection — both schemas
 * have the same field, but they're separate entities.
 *
 * Used by the transaction detail panel toggle and by the assistant's
 * exclude_transaction / include_transaction tools. Both surfaces
 * share this hook so the InstantDB write happens in exactly one place.
 */
export function useTransactionExclude() {
  return async (kind: "payment" | "credit", id: string, excluded: boolean) => {
    if (kind === "payment") {
      await db.transact(db.tx.payments[id].update({ excludedFromAnalytics: excluded }));
    } else {
      await db.transact(db.tx.credits[id].update({ excludedFromAnalytics: excluded }));
    }
  };
}

export function useFailedPayments() {
  const { data, isLoading, error } = db.useQuery({ failedPayments: {} });

  const failedPayments = useMemo(() => {
    if (!data?.failedPayments) return [];
    return [...data.failedPayments].sort((a, b) => b.transactionDate - a.transactionDate);
  }, [data?.failedPayments]);

  return { failedPayments, isLoading, error };
}

export function useAllTransactions() {
  const { payments, isLoading: paymentsLoading } = usePayments();
  const { failedPayments, isLoading: failedLoading } = useFailedPayments();

  const allTransactions = useMemo(() => {
    const all = [
      ...payments.map((p) => ({ ...p, status: "success" as const })),
      ...failedPayments.map((f) => ({ ...f, status: "failed" as const, amount: null as number | null })),
    ];
    return all.sort((a, b) => b.transactionDate - a.transactionDate);
  }, [payments, failedPayments]);

  const groupedByDate = useMemo(() => {
    return groupBy(allTransactions, (tx) => getDateGroup(tx.transactionDate));
  }, [allTransactions]);

  return {
    transactions: allTransactions,
    groupedByDate,
    isLoading: paymentsLoading || failedLoading,
  };
}

export function useMonthlyStats() {
  const { payments } = usePayments();
  const { failedPayments } = useFailedPayments();

  return useMemo(() => {
    const now = new Date();
    const currentMonthStart = startOfMonth(now);
    const currentMonthEnd = endOfMonth(now);
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    const lastMonthEnd = endOfMonth(subMonths(now, 1));

    // Current month
    const currentMonthPayments = payments.filter((p) =>
      isWithinInterval(new Date(p.transactionDate), {
        start: currentMonthStart,
        end: currentMonthEnd,
      })
    );

    const currentMonthTotal = currentMonthPayments.reduce((sum, p) => sum + p.amount, 0);
    const currentMonthCount = currentMonthPayments.length;

    // Last month
    const lastMonthPayments = payments.filter((p) =>
      isWithinInterval(new Date(p.transactionDate), {
        start: lastMonthStart,
        end: lastMonthEnd,
      })
    );

    const lastMonthTotal = lastMonthPayments.reduce((sum, p) => sum + p.amount, 0);
    const lastMonthCount = lastMonthPayments.length;

    // Failed payments this month
    const currentMonthFailed = failedPayments.filter((p) =>
      isWithinInterval(new Date(p.transactionDate), {
        start: currentMonthStart,
        end: currentMonthEnd,
      })
    );

    // Change percentages
    const totalChange = lastMonthTotal > 0 ? ((currentMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 : 0;
    const countChange = lastMonthCount > 0 ? ((currentMonthCount - lastMonthCount) / lastMonthCount) * 100 : 0;

    return {
      currentMonth: {
        total: currentMonthTotal,
        count: currentMonthCount,
        failedCount: currentMonthFailed.length,
      },
      lastMonth: {
        total: lastMonthTotal,
        count: lastMonthCount,
      },
      totalChange,
      countChange,
    };
  }, [payments, failedPayments]);
}

export function useTopMerchants(limit: number = 10) {
  const { payments } = usePayments();

  return useMemo(() => {
    const merchantTotals: Record<string, { total: number; count: number }> = {};

    for (const payment of payments) {
      const merchant = payment.merchant || "Unknown";
      if (!merchantTotals[merchant]) {
        merchantTotals[merchant] = { total: 0, count: 0 };
      }
      merchantTotals[merchant].total += payment.amount;
      merchantTotals[merchant].count += 1;
    }

    return Object.entries(merchantTotals)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  }, [payments, limit]);
}

export function useSpendingByDay(days: number = 30) {
  const { payments } = usePayments();

  return useMemo(() => {
    const now = new Date();
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const recentPayments = payments.filter(
      (p) => new Date(p.transactionDate) >= startDate
    );

    const dailyTotals: Record<string, number> = {};

    for (const payment of recentPayments) {
      const date = formatLocalDay(payment.transactionDate);
      dailyTotals[date] = (dailyTotals[date] || 0) + payment.amount;
    }

    // Fill in missing days with 0. Step back using local calendar
    // arithmetic (setDate) rather than subtracting fixed milliseconds:
    // spring-forward days are 23h and fall-back days are 25h, so
    // `now - i * 86400000` double-counts or skips a day once a year
    // for DST-observing timezones.
    const result: { date: string; amount: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const date = formatLocalDay(day.getTime());
      result.push({
        date,
        amount: dailyTotals[date] || 0,
      });
    }

    return result;
  }, [payments, days]);
}
