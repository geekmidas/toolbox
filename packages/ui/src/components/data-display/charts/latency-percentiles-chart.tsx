'use client';

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '../../../lib/utils';

export interface LatencyPercentilesChartProps {
  p50: number;
  p95: number;
  p99: number;
  className?: string;
  /** Custom formatter for duration values (default: ms/s format) */
  valueFormatter?: (ms: number) => string;
}

function defaultFormatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const PERCENTILE_COLORS = {
  p50: 'hsl(217, 91%, 60%)',
  p95: 'hsl(38, 92%, 50%)',
  p99: 'hsl(0, 84%, 60%)',
};

export function LatencyPercentilesChart({
  p50,
  p95,
  p99,
  className,
  valueFormatter = defaultFormatDuration,
}: LatencyPercentilesChartProps) {
  const chartData = [
    { name: 'p50', label: 'p50 (Median)', value: p50, color: PERCENTILE_COLORS.p50 },
    { name: 'p95', label: 'p95', value: p95, color: PERCENTILE_COLORS.p95 },
    { name: 'p99', label: 'p99', value: p99, color: PERCENTILE_COLORS.p99 },
  ];

  if (p99 === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
        No data available
      </div>
    );
  }

  return (
    <div className={cn('h-48', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" barSize={20}>
          <XAxis
            type="number"
            tickFormatter={valueFormatter}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={90}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const item = payload[0]!.payload as (typeof chartData)[number];
              return (
                <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
                  <p className="font-medium">{item.label}</p>
                  <p className="text-muted-foreground">
                    {valueFormatter(item.value)}
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
