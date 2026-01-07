'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '../../../lib/utils';

export interface StatusDistributionData {
  '2xx': number;
  '3xx': number;
  '4xx': number;
  '5xx': number;
}

export interface StatusDistributionChartProps {
  data: StatusDistributionData;
  className?: string;
}

const STATUS_CONFIG = {
  '2xx': { label: '2xx Success', color: 'hsl(142, 71%, 45%)' },
  '3xx': { label: '3xx Redirect', color: 'hsl(217, 91%, 60%)' },
  '4xx': { label: '4xx Client Error', color: 'hsl(38, 92%, 50%)' },
  '5xx': { label: '5xx Server Error', color: 'hsl(0, 84%, 60%)' },
} as const;

export function StatusDistributionChart({
  data,
  className,
}: StatusDistributionChartProps) {
  const chartData = (
    Object.entries(data) as [keyof StatusDistributionData, number][]
  )
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({
      name: STATUS_CONFIG[key].label,
      value,
      color: STATUS_CONFIG[key].color,
    }));

  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  if (total === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
        No data available
      </div>
    );
  }

  return (
    <div className={cn('h-48', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={70}
            paddingAngle={2}
            dataKey="value"
            nameKey="name"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const item = payload[0]!;
              const percent = (((item.value as number) / total) * 100).toFixed(
                1,
              );
              return (
                <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
                  <p className="font-medium">{item.name}</p>
                  <p className="text-muted-foreground">
                    {(item.value as number).toLocaleString()} ({percent}%)
                  </p>
                </div>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap justify-center gap-4 mt-2">
        {chartData.map((item) => (
          <div key={item.name} className="flex items-center gap-2 text-xs">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-muted-foreground">{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
