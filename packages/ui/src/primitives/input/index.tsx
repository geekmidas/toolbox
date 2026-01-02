import { clsx } from 'clsx';
import type { InputHTMLAttributes, ReactNode, forwardRef } from 'react';
import { forwardRef as reactForwardRef } from 'react';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /**
   * The size of the input.
   * @default 'md'
   */
  size?: InputSize;
  /**
   * Whether the input has an error state.
   */
  error?: boolean;
  /**
   * Icon to display at the start of the input.
   */
  leftIcon?: ReactNode;
  /**
   * Icon to display at the end of the input.
   */
  rightIcon?: ReactNode;
}

const sizeStyles: Record<InputSize, string> = {
  sm: 'h-8 px-2.5 text-sm',
  md: 'h-10 px-3 text-sm',
  lg: 'h-12 px-4 text-base',
};

const iconSizeStyles: Record<InputSize, string> = {
  sm: 'px-8',
  md: 'px-10',
  lg: 'px-12',
};

/**
 * Input component for text entry.
 *
 * @example
 * ```tsx
 * <Input placeholder="Search..." />
 * <Input size="lg" leftIcon={<SearchIcon />} />
 * ```
 */
export const Input = reactForwardRef<HTMLInputElement, InputProps>(
  function Input(
    {
      size = 'md',
      error = false,
      leftIcon,
      rightIcon,
      className,
      disabled,
      ...props
    },
    ref,
  ) {
    const hasLeftIcon = !!leftIcon;
    const hasRightIcon = !!rightIcon;

    return (
      <div className="relative">
        {leftIcon && (
          <div
            className={clsx(
              'absolute left-0 top-0 h-full flex items-center justify-center',
              'text-[var(--ui-text-muted)] pointer-events-none',
              size === 'sm' ? 'w-8' : size === 'lg' ? 'w-12' : 'w-10',
            )}
          >
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          className={clsx(
            // Base styles
            'w-full rounded-[var(--ui-radius-md)]',
            'bg-[var(--ui-surface)] text-[var(--ui-text)]',
            'border transition-colors duration-[var(--ui-transition-fast)]',
            'placeholder:text-[var(--ui-text-subtle)]',
            // Focus styles
            'focus:outline-none focus:ring-2 focus:ring-offset-2',
            'focus:ring-offset-[var(--ui-background)]',
            // State styles
            error
              ? 'border-[var(--ui-error)] focus:ring-[var(--ui-error)]/50'
              : 'border-[var(--ui-border)] hover:border-[var(--ui-border-hover)] focus:border-[var(--ui-accent)] focus:ring-[var(--ui-accent)]/50',
            // Disabled styles
            'disabled:cursor-not-allowed disabled:opacity-50',
            'disabled:bg-[var(--ui-surface-hover)]',
            // Size styles
            sizeStyles[size],
            // Icon padding
            hasLeftIcon && (size === 'sm' ? 'pl-8' : size === 'lg' ? 'pl-12' : 'pl-10'),
            hasRightIcon && (size === 'sm' ? 'pr-8' : size === 'lg' ? 'pr-12' : 'pr-10'),
            className,
          )}
          disabled={disabled}
          {...props}
        />
        {rightIcon && (
          <div
            className={clsx(
              'absolute right-0 top-0 h-full flex items-center justify-center',
              'text-[var(--ui-text-muted)] pointer-events-none',
              size === 'sm' ? 'w-8' : size === 'lg' ? 'w-12' : 'w-10',
            )}
          >
            {rightIcon}
          </div>
        )}
      </div>
    );
  },
);

export default Input;
