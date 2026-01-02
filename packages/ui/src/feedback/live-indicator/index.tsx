import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

export type LiveIndicatorStatus = 'connected' | 'connecting' | 'disconnected';

export interface LiveIndicatorProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Connection status.
   * @default 'disconnected'
   */
  status?: LiveIndicatorStatus;
  /**
   * Label to display.
   */
  label?: string;
  /**
   * Whether to show the label.
   * @default true
   */
  showLabel?: boolean;
}

const statusConfig: Record<LiveIndicatorStatus, { color: string; label: string; pulse: boolean }> = {
  connected: {
    color: 'bg-[var(--ui-success)]',
    label: 'Live',
    pulse: true,
  },
  connecting: {
    color: 'bg-[var(--ui-warning)]',
    label: 'Connecting',
    pulse: true,
  },
  disconnected: {
    color: 'bg-[var(--ui-text-muted)]',
    label: 'Offline',
    pulse: false,
  },
};

/**
 * Live indicator component for showing connection status.
 *
 * @example
 * ```tsx
 * <LiveIndicator status="connected" />
 * <LiveIndicator status="connecting" label="Reconnecting..." />
 * <LiveIndicator status="disconnected" />
 * ```
 */
export function LiveIndicator({
  status = 'disconnected',
  label,
  showLabel = true,
  className,
  ...props
}: LiveIndicatorProps) {
  const config = statusConfig[status];
  const displayLabel = label ?? config.label;

  return (
    <div
      className={clsx(
        'inline-flex items-center gap-2',
        className,
      )}
      {...props}
    >
      <span className="relative flex shrink-0">
        <span
          className={clsx(
            'w-2 h-2 rounded-full',
            config.color,
          )}
        />
        {config.pulse && (
          <span
            className={clsx(
              'absolute inset-0 rounded-full animate-ping',
              config.color,
              'opacity-75',
            )}
          />
        )}
      </span>
      {showLabel && (
        <span className="text-xs font-medium text-[var(--ui-text-muted)]">
          {displayLabel}
        </span>
      )}
    </div>
  );
}

export default LiveIndicator;
