import { useMemo } from "react";
import { startOfMonth, endOfMonth, isWithinInterval, subDays } from "date-fns";
import { useConvertedPayments, useFailedPayments } from "./useTransactions";

export function useSignals() {
  const { payments } = useConvertedPayments();
  const { failedPayments } = useFailedPayments();

  return useMemo(() => {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);
    const inMonth = (ts: number) => isWithinInterval(new Date(ts), { start: monthStart, end: monthEnd });

    const monthFailed = failedPayments.filter((f) => inMonth(f.transactionDate));
    // For card/total math we need a GEL-equivalent amount, so rows still
    // waiting on a rate (gelAmount === null) sit out. Largest-tx and
    // new-merchant detection still see the full set: those don't sum
    // amounts, they look at the row's existence + merchant string.
    // User-excluded transactions (excludedFromAnalytics) are skipped
    // from EVERY signal — the user explicitly said this isn't real
    // spending, so it shouldn't trigger a large-tx alert or count as
    // a new merchant.
    const monthPaymentsAll = payments.filter(
      (p) => !p.excludedFromAnalytics && inMonth(p.transactionDate)
    );
    const monthPaymentsForSums = monthPaymentsAll.filter((p) => p.gelAmount !== null);

    const repeatedMap: Record<string, number> = {};
    for (const f of monthFailed) {
      const k = f.merchant || "Unknown";
      repeatedMap[k] = (repeatedMap[k] || 0) + 1;
    }
    const repeatedDeclines = Object.entries(repeatedMap)
      .filter(([, n]) => n >= 2)
      .map(([merchant, count]) => ({ merchant, count }));

    const largeTx = [...monthPaymentsForSums]
      .sort((a, b) => (b.gelAmount as number) - (a.gelAmount as number))
      .slice(0, 4);

    const ninetyStart = subDays(now, 90);
    const priorMerchants = new Set(
      payments
        .filter((p) => !p.excludedFromAnalytics && new Date(p.transactionDate) < monthStart && new Date(p.transactionDate) > ninetyStart)
        .map((p) => p.merchant || "")
        .filter(Boolean)
    );
    const newMerchants = Array.from(
      new Set(
        monthPaymentsAll
          .map((p) => p.merchant || "")
          .filter((m) => m && !priorMerchants.has(m))
      )
    );

    const cardTotals: Record<string, { total: number; count: number }> = {};
    for (const p of monthPaymentsForSums) {
      const c = p.cardLastDigits || "—";
      if (!cardTotals[c]) cardTotals[c] = { total: 0, count: 0 };
      cardTotals[c].total += p.gelAmount as number;
      cardTotals[c].count += 1;
    }
    const cards = Object.entries(cardTotals)
      .map(([card, v]) => ({ card, ...v }))
      .sort((a, b) => b.total - a.total);

    const activeCount =
      (monthFailed.length > 0 ? 1 : 0) +
      (largeTx.length > 0 ? 1 : 0) +
      (newMerchants.length > 0 ? 1 : 0) +
      (cards.length > 1 ? 1 : 0);

    return {
      monthFailed,
      repeatedDeclines,
      largeTx,
      newMerchants,
      cards,
      activeCount,
    };
  }, [payments, failedPayments]);
}
