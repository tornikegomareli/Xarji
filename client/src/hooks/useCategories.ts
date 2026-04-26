import { useMemo } from "react";
import { db, type Category } from "../lib/instant";
import { DEFAULT_CATEGORIES } from "../lib/utils";
import { useCategorizer } from "./useCategorizer";
import { id } from "@instantdb/react";

export function useCategories() {
  const { data, isLoading, error } = db.useQuery({ categories: {} });

  const categories = useMemo(() => {
    return data?.categories || [];
  }, [data?.categories]);

  return { categories, isLoading, error };
}

export function useCategoryActions() {
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
    await db.transact(
      db.tx.categories[categoryId].delete()
    );
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
    // even though the regex default puts it under "Other".
    for (const payment of payments) {
      const categoryName = categorizeName(payment.merchant ?? null);
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
