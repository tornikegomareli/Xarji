import { useState, useMemo } from "react";
import { Card, CardContent, SearchInput, Tabs, TabsList, TabsTrigger } from "../components/ui";
import { TransactionList } from "../components/transactions";
import { useAllTransactions, usePayments, useFailedPayments } from "../hooks/useTransactions";
import { groupBy, getDateGroup } from "../lib/utils";

type FilterType = "all" | "success" | "failed";

export function Transactions() {
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");

  const { transactions, isLoading } = useAllTransactions();
  const { payments } = usePayments();
  const { failedPayments } = useFailedPayments();

  // Filter and search transactions
  const filteredTransactions = useMemo(() => {
    let result = transactions;

    // Apply filter
    if (filter === "success") {
      result = result.filter((tx) => tx.status === "success");
    } else if (filter === "failed") {
      result = result.filter((tx) => tx.status === "failed");
    }

    // Apply search
    if (search.trim()) {
      const searchLower = search.toLowerCase();
      result = result.filter(
        (tx) =>
          tx.merchant?.toLowerCase().includes(searchLower) ||
          tx.cardLastDigits?.includes(searchLower)
      );
    }

    return result;
  }, [transactions, filter, search]);

  // Group filtered transactions by date
  const filteredGroupedByDate = useMemo(() => {
    return groupBy(filteredTransactions, (tx) => getDateGroup(tx.transactionDate));
  }, [filteredTransactions]);

  const successCount = payments.length;
  const failedCount = failedPayments.length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Transactions</h1>
        <p className="text-sm text-slate-500 mt-1">
          View and manage all your transactions
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 max-w-md">
          <SearchInput
            placeholder="Search by merchant or card..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
          <TabsList>
            <TabsTrigger value="all">
              All ({transactions.length})
            </TabsTrigger>
            <TabsTrigger value="success">
              Success ({successCount})
            </TabsTrigger>
            <TabsTrigger value="failed">
              Failed ({failedCount})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Transaction List */}
      <Card>
        <CardContent className="p-0">
          <TransactionList
            transactions={filteredTransactions}
            groupedByDate={filteredGroupedByDate}
            isLoading={isLoading}
            showDateGroups={true}
          />
        </CardContent>
      </Card>
    </div>
  );
}
