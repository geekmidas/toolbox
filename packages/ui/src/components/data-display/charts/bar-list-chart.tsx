'use client';

import { cn } from '../../../lib/utils';

export interface BarListItem {
  name: string;
  value: number;
}

export interface BarListChartProps<T extends BarListItem> {
  data: T[];
  /** Value formatter */
  valueFormatter?: (value: number) => string;
  /** Click handler */
  onItemClick?: (item: T) => void;
  /** Chart className */
  className?: string;
  /** Empty state message */
  emptyMessage?: string;
  /** Bar color */
  color?: string;
}

export function BarListChart<T extends BarListItem>({
  data,
  valueFormatter = (v) => v.toLocaleString(),
  onItemClick,
  className,
  emptyMessage = 'No data available',
  color = 'hsl(217, 91%, 60%)',
}: BarListChartProps<T>) {
  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value));

  return (
    <div className={cn('space-y-3', className)}>
      {data.map((item, index) => {
        const percentage = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
        const isClickable = !!onItemClick;

        return (
          <div
            key={index}
            className={cn(
              'group',
              isClickable && 'cursor-pointer',
            )}
            onClick={() => onItemClick?.(item)}
          >
            <div className="flex items-center justify-between mb-1">
              <span
                className={cn(
                  'text-sm truncate flex-1 mr-4',
                  isClickable && 'group-hover:text-foreground',
                )}
              >
                {item.name}
              </span>
              <span className="text-sm font-medium tabular-nums">
                {valueFormatter(item.value)}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  isClickable && 'group-hover:opacity-80',
                )}
                style={{
                  width: `${percentage}%`,
                  backgroundColor: color,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
