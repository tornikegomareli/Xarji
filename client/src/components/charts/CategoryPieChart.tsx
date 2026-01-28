import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { formatCurrency } from "../../lib/utils";

interface CategoryData {
  name: string;
  total: number;
  color: string;
  percentage: number;
  [key: string]: string | number;
}

interface CategoryPieChartProps {
  data: CategoryData[];
  height?: number;
  showLegend?: boolean;
}

export function CategoryPieChart({ data, height = 300, showLegend = true }: CategoryPieChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
          dataKey="total"
          nameKey="name"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          content={({ active, payload }) => {
            if (active && payload && payload.length) {
              const data = payload[0].payload as CategoryData;
              return (
                <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: data.color }}
                    />
                    <p className="text-sm font-medium text-slate-900">{data.name}</p>
                  </div>
                  <p className="text-lg font-semibold text-slate-900 mt-1">
                    {formatCurrency(data.total)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {data.percentage.toFixed(1)}% of total
                  </p>
                </div>
              );
            }
            return null;
          }}
        />
        {showLegend && (
          <Legend
            layout="vertical"
            align="right"
            verticalAlign="middle"
            content={({ payload }) => (
              <div className="space-y-2">
                {payload?.map((entry: any, index: number) => (
                  <div key={index} className="flex items-center gap-2 text-sm">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="text-slate-600">{entry.value}</span>
                  </div>
                ))}
              </div>
            )}
          />
        )}
      </PieChart>
    </ResponsiveContainer>
  );
}
