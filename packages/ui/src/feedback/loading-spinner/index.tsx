import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

export type LoadingSpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface LoadingSpinnerProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Size of the spinner.
   * @default 'md'
   */
  size?: LoadingSpinnerSize;
  /**
   * Color of the spinner. Uses CSS variable by default.
   */
  color?: string;
  /**
   * Label for accessibility.
   * @default 'Loading'
   */
  label?: string;
}

const sizeStyles: Record<LoadingSpinnerSize, string> = {
  xs: 'w-3 h-3',
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
  xl: 'w-12 h-12',
};

/**
 * Loading spinner component for indicating loading state.
 *
 * @example
 * ```tsx
 * <LoadingSpinner />
 * <LoadingSpinner size="lg" />
 * <LoadingSpinner color="var(--ui-accent)" />
 * ```
 */
export function LoadingSpinner({
  size = 'md',
  color,
  label = 'Loading',
  className,
  ...props
}: LoadingSpinnerProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={clsx('inline-flex', className)}
      {...props}
    >
      <svg
        className={clsx(
          'animate-spin',
          sizeStyles[size],
        )}
        style={{ color: color ?? 'var(--ui-text-muted)' }}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * Full-page loading spinner overlay.
 */
export function LoadingOverlay({
  size = 'lg',
  label = 'Loading',
  className,
  ...props
}: LoadingSpinnerProps) {
  return (
    <div
      className={clsx(
        'fixed inset-0 z-50',
        'flex items-center justify-center',
        'bg-[var(--ui-background)]/80 backdrop-blur-sm',
        className,
      )}
      {...props}
    >
      <LoadingSpinner size={size} label={label} />
    </div>
  );
}

export default LoadingSpinner;
