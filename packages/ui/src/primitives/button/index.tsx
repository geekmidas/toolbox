import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * The visual style variant of the button.
   * @default 'primary'
   */
  variant?: ButtonVariant;
  /**
   * The size of the button.
   * @default 'md'
   */
  size?: ButtonSize;
  /**
   * Whether the button is in a loading state.
   */
  loading?: boolean;
  /**
   * Icon to display before the button text.
   */
  leftIcon?: ReactNode;
  /**
   * Icon to display after the button text.
   */
  rightIcon?: ReactNode;
  /**
   * The content of the button.
   */
  children?: ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: clsx(
    'bg-[var(--ui-accent)] text-[var(--ui-background)]',
    'hover:bg-[var(--ui-accent-hover)]',
    'active:bg-[var(--ui-accent-muted)]',
    'disabled:bg-[var(--ui-border)] disabled:text-[var(--ui-text-muted)]',
  ),
  secondary: clsx(
    'bg-[var(--ui-surface)] text-[var(--ui-text)]',
    'border border-[var(--ui-border)]',
    'hover:bg-[var(--ui-surface-hover)] hover:border-[var(--ui-border-hover)]',
    'active:bg-[var(--ui-surface-active)]',
    'disabled:bg-[var(--ui-surface)] disabled:text-[var(--ui-text-muted)]',
  ),
  ghost: clsx(
    'bg-transparent text-[var(--ui-text)]',
    'hover:bg-[var(--ui-surface-hover)]',
    'active:bg-[var(--ui-surface-active)]',
    'disabled:text-[var(--ui-text-muted)]',
  ),
  danger: clsx(
    'bg-[var(--ui-error)] text-white',
    'hover:bg-[var(--ui-error-muted)]',
    'active:bg-[#b91c1c]',
    'disabled:bg-[var(--ui-border)] disabled:text-[var(--ui-text-muted)]',
  ),
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-base gap-2.5',
};

/**
 * Button component for user actions.
 *
 * @example
 * ```tsx
 * <Button variant="primary" onClick={() => console.log('clicked')}>
 *   Click me
 * </Button>
 * ```
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  leftIcon,
  rightIcon,
  children,
  disabled,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        // Base styles
        'inline-flex items-center justify-center',
        'font-medium rounded-[var(--ui-radius-md)]',
        'transition-colors duration-[var(--ui-transition-fast)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ui-background)]',
        'disabled:cursor-not-allowed',
        // Variant and size styles
        variantStyles[variant],
        sizeStyles[size],
        // Loading state
        loading && 'cursor-wait',
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <LoadingSpinner size={size} />
      ) : (
        <>
          {leftIcon && <span className="shrink-0">{leftIcon}</span>}
          {children}
          {rightIcon && <span className="shrink-0">{rightIcon}</span>}
        </>
      )}
    </button>
  );
}

function LoadingSpinner({ size }: { size: ButtonSize }) {
  const sizeClass = size === 'sm' ? 'w-3 h-3' : size === 'lg' ? 'w-5 h-5' : 'w-4 h-4';
  return (
    <svg
      className={clsx(sizeClass, 'animate-spin')}
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
  );
}

export default Button;
