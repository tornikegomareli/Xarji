import { useMemo } from "react";
import { db } from "../lib/instant";
import { monthKey, monthLabel } from "../ink/format";

export function useMonthlyTrend(months: number = 9) {
  const { data } = db.useQuery({ payments: {} });

  return useMemo(() => {
    const payments = data?.payments || [];
    const totals: Record<string, number> = {};
    for (const p of payments) {
      if (p.currency !== "GEL") continue;
      const k = monthKey(p.transactionDate);
      totals[k] = (totals[k] || 0) + p.amount;
    }
    const keys = Object.keys(totals).sort();
    const taken = keys.slice(-months);
    return taken.map((k) => ({ key: k, label: monthLabel(k), total: totals[k] }));
  }, [data?.payments, months]);
}
