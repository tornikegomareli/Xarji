import { useMemo } from "react";
import { id as instantId } from "@instantdb/react";
import { db, type MerchantCategoryOverride } from "../lib/instant";

export function useMerchantOverrides() {
  const { data } = db.useQuery({ merchantCategoryOverrides: {} });

  const overrides = useMemo<MerchantCategoryOverride[]>(
    () => data?.merchantCategoryOverrides ?? [],
    [data?.merchantCategoryOverrides]
  );

  // Indexed-by-merchant lookup. Merchant names land in user-visible
  // strings so we lower-case for matching, otherwise "Wolt" and "wolt"
  // would override independently and the UI would silently disagree
  // with itself.
  const byMerchant = useMemo(() => {
    const m = new Map<string, MerchantCategoryOverride>();
    for (const o of overrides) m.set(o.merchant.toLowerCase(), o);
    return m;
  }, [overrides]);

  const setOverride = async (merchant: string, categoryId: string): Promise<void> => {
    const key = merchant.trim();
    if (!key) return;
    const existing = byMerchant.get(key.toLowerCase());
    const opId = existing?.id ?? instantId();
    await db.transact(
      db.tx.merchantCategoryOverrides[opId].update({
        merchant: key,
        categoryId,
        createdAt: existing?.createdAt ?? Date.now(),
      })
    );
  };

  const clearOverride = async (merchant: string): Promise<void> => {
    const existing = byMerchant.get(merchant.trim().toLowerCase());
    if (!existing) return;
    await db.transact(db.tx.merchantCategoryOverrides[existing.id].delete());
  };

  return { overrides, byMerchant, setOverride, clearOverride };
}
