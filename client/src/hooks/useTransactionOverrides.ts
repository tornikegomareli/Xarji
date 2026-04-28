import { useMemo } from "react";
import { id as instantId } from "@instantdb/react";
import { db, type TransactionCategoryOverride } from "../lib/instant";

export function useTransactionOverrides() {
  const { data } = db.useQuery({ transactionCategoryOverrides: {} });

  const overrides = useMemo<TransactionCategoryOverride[]>(
    () => data?.transactionCategoryOverrides ?? [],
    [data?.transactionCategoryOverrides]
  );

  const byPaymentId = useMemo(() => {
    const m = new Map<string, TransactionCategoryOverride>();
    for (const o of overrides) m.set(o.paymentId, o);
    return m;
  }, [overrides]);

  const setOverride = async (paymentId: string, categoryId: string): Promise<void> => {
    if (!paymentId) return;
    const existing = byPaymentId.get(paymentId);
    const opId = existing?.id ?? instantId();
    await db.transact(
      db.tx.transactionCategoryOverrides[opId].update({
        paymentId,
        categoryId,
        createdAt: existing?.createdAt ?? Date.now(),
      })
    );
  };

  const clearOverride = async (paymentId: string): Promise<void> => {
    const existing = byPaymentId.get(paymentId);
    if (!existing) return;
    await db.transact(db.tx.transactionCategoryOverrides[existing.id].delete());
  };

  return { overrides, byPaymentId, setOverride, clearOverride };
}
