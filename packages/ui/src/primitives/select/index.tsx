import { clsx } from 'clsx';
import type { SelectHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';

export type SelectSize = 'sm' | 'md' | 'lg';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /**
   * The size of the select.
   * @default 'md'
   */
  size?: SelectSize;
  /**
   * Whether the select has an error state.
   */
  error?: boolean;
  /**
   * Options for the select.
   */
  options?: SelectOption[];
  /**
   * Placeholder text when no option is selected.
   */
  placeholder?: string;
  /**
   * Children elements (alternative to options prop).
   */
  children?: ReactNode;
}

const sizeStyles: Record<SelectSize, string> = {
  sm: 'h-8 px-2.5 pr-8 text-sm',
  md: 'h-10 px-3 pr-10 text-sm',
  lg: 'h-12 px-4 pr-12 text-base',
};

const iconSizeStyles: Record<SelectSize, string> = {
  sm: 'w-8',
  md: 'w-10',
  lg: 'w-12',
};

/**
 * Select component for choosing from a list of options.
 *
 * @example
 * ```tsx
 * <Select
 *   options={[
 *     { value: 'a', label: 'Option A' },
 *     { value: 'b', label: 'Option B' },
 *   ]}
 *   placeholder="Select an option"
 * />
 * ```
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      size = 'md',
      error = false,
      options,
      placeholder,
      children,
      className,
      disabled,
      ...props
    },
    ref,
  ) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={clsx(
            // Base styles
            'w-full appearance-none rounded-[var(--ui-radius-md)]',
            'bg-[var(--ui-surface)] text-[var(--ui-text)]',
            'border transition-colors duration-[var(--ui-transition-fast)]',
            'cursor-pointer',
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
            className,
          )}
          disabled={disabled}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options
            ? options.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.label}
                </option>
              ))
            : children}
        </select>
        {/* Chevron icon */}
        <div
          className={clsx(
            'absolute right-0 top-0 h-full flex items-center justify-center',
            'text-[var(--ui-text-muted)] pointer-events-none',
            iconSizeStyles[size],
          )}
        >
          <svg
            className="w-4 h-4"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </div>
    );
  },
);

export default Select;
