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

export interface Categorizer {
  /** Returns the category id (e.g. "groceries") for a merchant. */
  categorize: (merchant: string | null | undefined, raw?: string | null) => string;
  /** Returns the full InkCategory record with name + color + icon. */
  getCategory: (merchant: string | null | undefined, raw?: string | null) => InkCategory;
  /** Convenience for places that historically called `autoCategorize`
   *  to get the human-facing category name (e.g. "Groceries"). */
  categorizeName: (merchant: string | null | undefined) => string;
}

export function useCategorizer(): Categorizer {
  const { byMerchant } = useMerchantOverrides();

  const getCategory = useCallback(
    (merchant: string | null | undefined, raw?: string | null): InkCategory => {
      if (merchant) {
        const override = byMerchant.get(merchant.trim().toLowerCase());
        if (override) {
          const hit = DEFAULT_CATEGORIES.find((c) => c.id === override.categoryId);
          if (hit) return hit;
        }
      }
      return defaultGetCategory(merchant, raw);
    },
    [byMerchant]
  );

  const categorize = useCallback(
    (merchant: string | null | undefined, raw?: string | null): string => {
      if (merchant) {
        const override = byMerchant.get(merchant.trim().toLowerCase());
        if (override) return override.categoryId;
      }
      return categorizeId(merchant, raw);
    },
    [byMerchant]
  );

  const categorizeName = useCallback(
    (merchant: string | null | undefined): string => getCategory(merchant).name,
    [getCategory]
  );

  return useMemo(() => ({ categorize, getCategory, categorizeName }), [categorize, getCategory, categorizeName]);
}
