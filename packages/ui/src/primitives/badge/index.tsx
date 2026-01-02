import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'method-get'
  | 'method-post'
  | 'method-put'
  | 'method-patch'
  | 'method-delete';

export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * The visual style variant of the badge.
   * @default 'default'
   */
  variant?: BadgeVariant;
  /**
   * The size of the badge.
   * @default 'md'
   */
  size?: BadgeSize;
  /**
   * The content of the badge.
   */
  children: ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-[var(--ui-surface)] text-[var(--ui-text-muted)] border-[var(--ui-border)]',
  success: 'bg-[var(--ui-success)]/10 text-[var(--ui-success)] border-[var(--ui-success)]/20',
  warning: 'bg-[var(--ui-warning)]/10 text-[var(--ui-warning)] border-[var(--ui-warning)]/20',
  error: 'bg-[var(--ui-error)]/10 text-[var(--ui-error)] border-[var(--ui-error)]/20',
  info: 'bg-[var(--ui-info)]/10 text-[var(--ui-info)] border-[var(--ui-info)]/20',
  'method-get': 'bg-[var(--ui-method-get)]/10 text-[var(--ui-method-get)] border-[var(--ui-method-get)]/20',
  'method-post': 'bg-[var(--ui-method-post)]/10 text-[var(--ui-method-post)] border-[var(--ui-method-post)]/20',
  'method-put': 'bg-[var(--ui-method-put)]/10 text-[var(--ui-method-put)] border-[var(--ui-method-put)]/20',
  'method-patch': 'bg-[var(--ui-method-patch)]/10 text-[var(--ui-method-patch)] border-[var(--ui-method-patch)]/20',
  'method-delete': 'bg-[var(--ui-method-delete)]/10 text-[var(--ui-method-delete)] border-[var(--ui-method-delete)]/20',
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0.5 text-xs',
  md: 'px-2 py-1 text-xs',
};

/**
 * Badge component for status indicators and labels.
 *
 * @example
 * ```tsx
 * <Badge variant="success">Active</Badge>
 * <Badge variant="method-get">GET</Badge>
 * ```
 */
export function Badge({
  variant = 'default',
  size = 'md',
  children,
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center',
        'font-medium rounded-[var(--ui-radius-sm)]',
        'border',
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/**
 * Helper to get the badge variant for an HTTP method.
 */
export function getMethodBadgeVariant(method: string): BadgeVariant {
  const upperMethod = method.toUpperCase();
  switch (upperMethod) {
    case 'GET':
      return 'method-get';
    case 'POST':
      return 'method-post';
    case 'PUT':
      return 'method-put';
    case 'PATCH':
      return 'method-patch';
    case 'DELETE':
      return 'method-delete';
    default:
      return 'default';
  }
}

/**
 * Helper to get the badge variant for an HTTP status code.
 */
export function getStatusBadgeVariant(status: number): BadgeVariant {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 300 && status < 400) return 'info';
  if (status >= 400 && status < 500) return 'warning';
  if (status >= 500) return 'error';
  return 'default';
}

export default Badge;
