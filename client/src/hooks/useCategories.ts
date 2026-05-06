import { useMemo } from "react";
import { db, type Category } from "../lib/instant";
import { DEFAULT_CATEGORIES } from "../lib/utils";
import { useCategorizer } from "./useCategorizer";
import { useMerchantOverrides } from "./useMerchantOverrides";
import { id } from "@instantdb/react";

export function useCategories() {
  const { data, isLoading, error } = db.useQuery({ categories: {} });

  const categories = useMemo(() => {
    return data?.categories || [];
  }, [data?.categories]);

  return { categories, isLoading, error };
}

/**
 * DB categories merged with DEFAULT_CATEGORIES so every category is
 * visible even before the user has saved it to InstantDB. DB rows win
 * on name collision (preserving renames/recolors). Defaults that have
 * no DB counterpart appear with no budget fields set (unclassified).
 *
 * Use this anywhere you need "all categories including defaults" with
 * the full Category shape (budget fields). For display-only use cases
 * prefer `useCategorizer().allCategories` (returns InkCategory[]).
 */
export function useMergedCategories(): Category[] {
  const { categories: dbCats } = useCategories();

  return useMemo(() => {
    const dbByName = new Map<string, Category>();
    for (const c of dbCats) {
      if (c.name) dbByName.set(c.name.toLowerCase(), c);
    }
    const extras: Category[] = [];
    for (const def of DEFAULT_CATEGORIES) {
      if (!dbByName.has(def.name.toLowerCase())) {
        extras.push({ id: def.id, name: def.name, color: def.color, icon: def.icon, isDefault: true });
      }
    }
    return [...dbCats, ...extras];
  }, [dbCats]);
}

export function useCategoryActions() {
  // Read overrides synchronously so deleteCategory can clean up any
  // dangling rows in the same transact call. Without this, deleting
  // "Coffee shops" leaves merchantCategoryOverrides rows pointing at
  // a category id that no longer exists; the categorizer falls
  // through to the regex result on dangling lookups (defensive), but
  // the data still rots silently.
  const { overrides } = useMerchantOverrides();

  const addCategory = async (category: Omit<Category, "id">) => {
    const categoryId = id();
    await db.transact(
      db.tx.categories[categoryId].update(category)
    );
    return categoryId;
  };

  const updateCategory = async (categoryId: string, updates: Partial<Category>) => {
    await db.transact(
      db.tx.categories[categoryId].update(updates)
    );
  };

  const deleteCategory = async (categoryId: string) => {
    // Build the op list as `unknown[]` because db.tx returns a chainable
    // proxy whose op type isn't readily exposed by @instantdb/react. The
    // demo-db typings accept any[] anyway and the real InstantDB client
    // is typed against the same shape.
    const ops: unknown[] = [db.tx.categories[categoryId].delete()];
    for (const o of overrides) {
      if (o.categoryId === categoryId) {
        ops.push(db.tx.merchantCategoryOverrides[o.id].delete());
      }
    }
    await db.transact(ops as Parameters<typeof db.transact>[0]);
  };

  const initializeDefaultCategories = async () => {
    const operations = DEFAULT_CATEGORIES.map((cat) => {
      const catId = id();
      return db.tx.categories[catId].update({
        ...cat,
        isDefault: true,
      });
    });
    await db.transact(operations);
  };

  return {
    addCategory,
    updateCategory,
    deleteCategory,
    initializeDefaultCategories,
  };
}

export function useCategoryAnalytics() {
  const { categories } = useCategories();
  const { data: paymentsData } = db.useQuery({ payments: {} });
  const { categorizeName } = useCategorizer();

  return useMemo(() => {
    const payments = paymentsData?.payments || [];
    const categoryTotals: Record<string, { total: number; count: number; color: string }> = {};

    // Initialize with all categories
    for (const cat of categories) {
      categoryTotals[cat.name] = { total: 0, count: 0, color: cat.color };
    }

    // If no categories exist, use default names
    if (categories.length === 0) {
      for (const cat of DEFAULT_CATEGORIES) {
        categoryTotals[cat.name] = { total: 0, count: 0, color: cat.color };
      }
    }

    // Add "Other" category
    if (!categoryTotals["Other"]) {
      categoryTotals["Other"] = { total: 0, count: 0, color: "#6b7280" };
    }

    // Categorize payments — uses the override-aware categoriser so a
    // user's manual "Spotify → Subscriptions" override propagates here
    // even though the regex default puts it under "Other". Pass
    // payment.id so per-transaction overrides also flow through.
    for (const payment of payments) {
      const categoryName = categorizeName(payment.merchant ?? null, payment.id);
      if (categoryTotals[categoryName]) {
        categoryTotals[categoryName].total += payment.amount;
        categoryTotals[categoryName].count += 1;
      } else {
        categoryTotals["Other"].total += payment.amount;
        categoryTotals["Other"].count += 1;
      }
    }

    // Convert to array and sort by total
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
  }, [categories, paymentsData?.payments, categorizeName]);
}
