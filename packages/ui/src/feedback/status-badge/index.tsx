import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export type StatusBadgeStatus = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'pending';

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * The status to display.
   */
  status: StatusBadgeStatus;
  /**
   * Label text.
   */
  children?: ReactNode;
  /**
   * Whether to show the status dot.
   * @default true
   */
  showDot?: boolean;
  /**
   * Whether the dot should pulse.
   * @default false
   */
  pulse?: boolean;
  /**
   * Size of the badge.
   * @default 'md'
   */
  size?: 'sm' | 'md';
}

const statusColors: Record<StatusBadgeStatus, { bg: string; text: string; dot: string }> = {
  success: {
    bg: 'bg-[var(--ui-success)]/10',
    text: 'text-[var(--ui-success)]',
    dot: 'bg-[var(--ui-success)]',
  },
  warning: {
    bg: 'bg-[var(--ui-warning)]/10',
    text: 'text-[var(--ui-warning)]',
    dot: 'bg-[var(--ui-warning)]',
  },
  error: {
    bg: 'bg-[var(--ui-error)]/10',
    text: 'text-[var(--ui-error)]',
    dot: 'bg-[var(--ui-error)]',
  },
  info: {
    bg: 'bg-[var(--ui-info)]/10',
    text: 'text-[var(--ui-info)]',
    dot: 'bg-[var(--ui-info)]',
  },
  neutral: {
    bg: 'bg-[var(--ui-surface)]',
    text: 'text-[var(--ui-text-muted)]',
    dot: 'bg-[var(--ui-text-muted)]',
  },
  pending: {
    bg: 'bg-[var(--ui-surface)]',
    text: 'text-[var(--ui-text-muted)]',
    dot: 'bg-[var(--ui-warning)]',
  },
};

/**
 * Status badge component for displaying status with optional label.
 *
 * @example
 * ```tsx
 * <StatusBadge status="success">Active</StatusBadge>
 * <StatusBadge status="error" pulse>Disconnected</StatusBadge>
 * <StatusBadge status="pending" showDot />
 * ```
 */
export function StatusBadge({
  status,
  children,
  showDot = true,
  pulse = false,
  size = 'md',
  className,
  ...props
}: StatusBadgeProps) {
  const colors = statusColors[status];

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5',
        'rounded-full',
        'font-medium',
        colors.bg,
        colors.text,
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
        className,
      )}
      {...props}
    >
      {showDot && (
        <span className="relative flex shrink-0">
          <span
            className={clsx(
              'rounded-full',
              colors.dot,
              size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2',
            )}
          />
          {pulse && (
            <span
              className={clsx(
                'absolute inset-0 rounded-full animate-ping',
                colors.dot,
                'opacity-75',
              )}
            />
          )}
        </span>
      )}
      {children}
    </span>
  );
}

/**
 * Get status badge props from HTTP status code.
 */
export function getStatusFromCode(code: number): StatusBadgeStatus {
  if (code >= 200 && code < 300) return 'success';
  if (code >= 300 && code < 400) return 'info';
  if (code >= 400 && code < 500) return 'warning';
  if (code >= 500) return 'error';
  return 'neutral';
}

export default StatusBadge;
