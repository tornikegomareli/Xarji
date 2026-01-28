import { Card, CardHeader, CardTitle, CardContent, StatsCard, Loading } from "../components/ui";
import { SpendingChart, CategoryPieChart } from "../components/charts";
import { TransactionList } from "../components/transactions";
import { useAllTransactions, useMonthlyStats, useSpendingByDay } from "../hooks/useTransactions";
import { useCategoryAnalytics } from "../hooks/useCategories";
import { formatCurrency } from "../lib/utils";
import { Wallet, TrendingUp, AlertTriangle, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

export function Dashboard() {
  const { transactions, isLoading: txLoading } = useAllTransactions();
  const monthlyStats = useMonthlyStats();
  const spendingByDay = useSpendingByDay(30);
  const { withPercentages: categoryData } = useCategoryAnalytics();

  const recentTransactions = transactions.slice(0, 5);

  if (txLoading) {
    return <Loading className="py-12" />;
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">
          Overview of your spending and transactions
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Spent This Month"
          value={formatCurrency(monthlyStats.currentMonth.total)}
          change={monthlyStats.totalChange}
          changeLabel="vs last month"
          icon={<Wallet className="w-5 h-5" />}
        />
        <StatsCard
          title="Transactions"
          value={monthlyStats.currentMonth.count.toString()}
          change={monthlyStats.countChange}
          changeLabel="vs last month"
          icon={<TrendingUp className="w-5 h-5" />}
        />
        <StatsCard
          title="Last Month"
          value={formatCurrency(monthlyStats.lastMonth.total)}
          icon={<Wallet className="w-5 h-5" />}
        />
        {monthlyStats.currentMonth.failedCount > 0 && (
          <StatsCard
            title="Failed Payments"
            value={monthlyStats.currentMonth.failedCount.toString()}
            icon={<AlertTriangle className="w-5 h-5" />}
            className="border-red-200 bg-red-50"
          />
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Spending Trend */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Spending Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <SpendingChart data={spendingByDay} height={280} />
          </CardContent>
        </Card>

        {/* Category Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>By Category</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryData.length > 0 ? (
              <CategoryPieChart data={categoryData} height={280} showLegend={false} />
            ) : (
              <div className="flex items-center justify-center h-[280px] text-sm text-slate-500">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Transactions</CardTitle>
          <Link
            to="/transactions"
            className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
          >
            View all
            <ArrowRight className="w-4 h-4" />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <TransactionList
            transactions={recentTransactions}
            showDateGroups={false}
          />
        </CardContent>
      </Card>
    </div>
  );
}
