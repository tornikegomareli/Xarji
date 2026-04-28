import { useMemo } from "react";
import { useConvertedPayments } from "./useTransactions";
import { monthKey, monthLabel } from "../ink/format";

export function useMonthlyTrend(months: number = 9) {
  const { payments } = useConvertedPayments();

  return useMemo(() => {
    const totals: Record<string, number> = {};
    for (const p of payments) {
      if (p.excludedFromAnalytics) continue;
      if (p.gelAmount === null) continue;
      const k = monthKey(p.transactionDate);
      totals[k] = (totals[k] || 0) + p.gelAmount;
    }
    const keys = Object.keys(totals).sort();
    const taken = keys.slice(-months);
    return taken.map((k) => ({ key: k, label: monthLabel(k), total: totals[k] }));
  }, [payments, months]);
}
