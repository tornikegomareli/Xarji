import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { formatCurrency } from "../../lib/utils";

interface SpendingChartProps {
  data: { date: string; amount: number }[];
  height?: number;
}

export function SpendingChart({ data, height = 300 }: SpendingChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f97316" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(date) => format(new Date(date), "MMM d")}
          stroke="#94a3b8"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={(value) => `${value.toFixed(0)}`}
          stroke="#94a3b8"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={50}
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (active && payload && payload.length && label) {
              return (
                <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3">
                  <p className="text-sm text-slate-500">
                    {format(new Date(label as string), "MMMM d, yyyy")}
                  </p>
                  <p className="text-lg font-semibold text-slate-900">
                    {formatCurrency(payload[0].value as number)}
                  </p>
                </div>
              );
            }
            return null;
          }}
        />
        <Area
          type="monotone"
          dataKey="amount"
          stroke="#f97316"
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#colorAmount)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
