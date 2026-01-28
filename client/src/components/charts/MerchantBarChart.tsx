import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency } from "../../lib/utils";

interface MerchantData {
  name: string;
  total: number;
  count: number;
}

interface MerchantBarChartProps {
  data: MerchantData[];
  height?: number;
}

export function MerchantBarChart({ data, height = 300 }: MerchantBarChartProps) {
  // Truncate long merchant names
  const formattedData = data.map((d) => ({
    ...d,
    displayName: d.name.length > 20 ? d.name.substring(0, 20) + "..." : d.name,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={formattedData}
        layout="vertical"
        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={true} vertical={false} />
        <XAxis
          type="number"
          tickFormatter={(value) => `${value.toFixed(0)}`}
          stroke="#94a3b8"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="displayName"
          stroke="#94a3b8"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={120}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (active && payload && payload.length) {
              const data = payload[0].payload as MerchantData;
              return (
                <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3">
                  <p className="text-sm font-medium text-slate-900">{data.name}</p>
                  <p className="text-lg font-semibold text-primary-600 mt-1">
                    {formatCurrency(data.total)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {data.count} transaction{data.count !== 1 ? "s" : ""}
                  </p>
                </div>
              );
            }
            return null;
          }}
        />
        <Bar dataKey="total" fill="#f97316" radius={[0, 4, 4, 0]} barSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}
