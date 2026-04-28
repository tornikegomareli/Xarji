// Override-aware categoriser. Looks up the merchant's manual override
// first; falls back to the regex-based default. Both `categorize` (id)
// and `getCategory` (full record) are returned so call sites can keep
// the same shape they had with the static helpers in lib/utils.ts.
//
// Use this anywhere a single transaction needs a category, in place of
// the static `getCategory(merchant, raw)` / `categorizeId(...)` from
// lib/utils.ts. The static helpers stay around for code paths that
// need a synchronous answer without React state (e.g. data seeders).

import { useCallback, useMemo } from "react";
import {
  DEFAULT_CATEGORIES,
  categorizeId,
  getCategory as defaultGetCategory,
  type InkCategory,
} from "../lib/utils";
import { useMerchantOverrides } from "./useMerchantOverrides";
import { useTransactionOverrides } from "./useTransactionOverrides";
import { useCategories } from "./useCategories";

export interface Categorizer {
  /** Returns the category id (e.g. "groceries") for a merchant.
   *  Pass paymentId to honour per-transaction overrides (higher priority). */
  categorize: (merchant: string | null | undefined, raw?: string | null, paymentId?: string | null) => string;
  /** Returns the full InkCategory record with name + color + icon.
   *  Pass paymentId to honour per-transaction overrides (higher priority). */
  getCategory: (merchant: string | null | undefined, raw?: string | null, paymentId?: string | null) => InkCategory;
  /** Convenience for places that historically called `autoCategorize`
   *  to get the human-facing category name (e.g. "Groceries"). */
  categorizeName: (merchant: string | null | undefined) => string;
  /** Merged list of DEFAULT_CATEGORIES + DB-backed categories (DB wins
   *  on id collision so a renamed default uses the user's name).
   *  Use this anywhere you'd previously have hardcoded `DEFAULT_CATEGORIES`
   *  — pickers, dropdowns, lookup-by-id calls — so user-created
   *  categories show up consistently. */
  allCategories: InkCategory[];
}

export function useCategorizer(): Categorizer {
  const { byMerchant } = useMerchantOverrides();
  const { byPaymentId } = useTransactionOverrides();
  const { categories: dbCategories } = useCategories();

  // Merge DB categories with DEFAULT_CATEGORIES, deduping by *name*
  // (case-insensitive) rather than by id.
  //
  // Why name-based: persisted "default" rows (from
  // initializeDefaultCategories or the demo seed) use random UUIDs or
  // prefixed ids ("cat-groceries"), NOT the canonical ids hardcoded
  // in DEFAULT_CATEGORIES. An id-only merge produces a "Groceries"
  // (canonical id) AND a "Groceries" (UUID/cat- id) in the same list
  // — a duplicate the user sees in pickers and dropdowns, and the
  // wrong target for overrides since two ids both display as the
  // same name.
  //
  // DB rows win on name collision so user renames / recolors
  // propagate. The DB row's id is preserved so existing
  // merchantCategoryOverride rows pointing at it keep resolving.
  // Custom categories (DB rows with names that don't collide with
  // any default) are appended as-is.
  const allCategories = useMemo<InkCategory[]>(() => {
    const byName = new Map<string, InkCategory>();
    for (const c of DEFAULT_CATEGORIES) {
      byName.set(c.name.toLowerCase(), c);
    }
    for (const c of dbCategories) {
      byName.set(c.name.toLowerCase(), {
        id: c.id,
        name: c.name,
        color: c.color,
        icon: c.icon,
      });
    }
    return Array.from(byName.values());
  }, [dbCategories]);

  // Lookup table: canonical default id → entry in allCategories
  // (DB-backed if the user has the default seeded, hardcoded otherwise).
  // Built by mapping each DEFAULT_CATEGORIES entry's NAME to the merged
  // entry. Lets `getCategory` resolve a regex-derived "groceries" to
  // the user's renamed/recolored version of Groceries even though the
  // merged entry's id is a DB UUID.
  const byCanonicalId = useMemo(() => {
    const out = new Map<string, InkCategory>();
    for (const def of DEFAULT_CATEGORIES) {
      const merged = allCategories.find(
        (c) => c.name.toLowerCase() === def.name.toLowerCase()
      );
      if (merged) out.set(def.id, merged);
    }
    return out;
  }, [allCategories]);

  const getCategory = useCallback(
    (merchant: string | null | undefined, raw?: string | null, paymentId?: string | null): InkCategory => {
      // Per-transaction override wins over everything.
      if (paymentId) {
        const txOverride = byPaymentId.get(paymentId);
        if (txOverride) {
          const hit = allCategories.find((c) => c.id === txOverride.categoryId);
          if (hit) return hit;
        }
      }
      if (merchant) {
        const override = byMerchant.get(merchant.trim().toLowerCase());
        if (override) {
          const hit = allCategories.find((c) => c.id === override.categoryId);
          if (hit) return hit;
          // Override points at a category that no longer exists (deleted
          // or never created). Fall through to the regex categoriser
          // rather than returning a broken record. The dangling override
          // should be cleaned up by the delete-category code path; we
          // don't want this hot path silently fixing data.
        }
      }
      // Regex returns a canonical id like "groceries". Resolve via the
      // canonical-id → merged-entry map so renamed defaults propagate.
      const id = categorizeId(merchant, raw);
      return byCanonicalId.get(id) ?? defaultGetCategory(merchant, raw);
    },
    [byPaymentId, byMerchant, allCategories, byCanonicalId]
  );

  const categorize = useCallback(
    (merchant: string | null | undefined, raw?: string | null, paymentId?: string | null): string => {
      if (paymentId) {
        const txOverride = byPaymentId.get(paymentId);
        if (txOverride && allCategories.some((c) => c.id === txOverride.categoryId)) {
          return txOverride.categoryId;
        }
      }
      if (merchant) {
        const override = byMerchant.get(merchant.trim().toLowerCase());
        // Only honour an override if the target still exists. Dangling
        // overrides re-route to the regex result.
        if (override && allCategories.some((c) => c.id === override.categoryId)) {
          return override.categoryId;
        }
      }
      // Regex returns a canonical id; if the user has that default
      // seeded into DB under a UUID, return THAT id so callers grouping
      // by id agree with `getCategory()`.
      const canonicalId = categorizeId(merchant, raw);
      return byCanonicalId.get(canonicalId)?.id ?? canonicalId;
    },
    [byPaymentId, byMerchant, allCategories, byCanonicalId]
  );

  const categorizeName = useCallback(
    (merchant: string | null | undefined): string => getCategory(merchant).name,
    [getCategory]
  );

  return useMemo(
    () => ({ categorize, getCategory, categorizeName, allCategories }),
    [categorize, getCategory, categorizeName, allCategories]
  );
}
