import { useState } from "react";
import { db } from "../lib/instant";
import { usePayments, useFailedPayments } from "./useTransactions";
import { useCategories } from "./useCategories";
import { useCredits } from "./useCredits";

export function useDeleteAllData() {
  const { payments } = usePayments();
  const { failedPayments } = useFailedPayments();
  const { categories } = useCategories();
  const { credits } = useCredits();
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteAllData = async () => {
    setIsDeleting(true);
    try {
      const operations = [
        ...payments.map((p) => db.tx.payments[p.id].delete()),
        ...failedPayments.map((f) => db.tx.failedPayments[f.id].delete()),
        ...credits.map((c) => db.tx.credits[c.id].delete()),
        ...categories.map((c) => db.tx.categories[c.id].delete()),
      ];

      if (operations.length > 0) {
        await db.transact(operations);
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const totalCount =
    payments.length + failedPayments.length + credits.length + categories.length;

  return { deleteAllData, isDeleting, totalCount };
}
