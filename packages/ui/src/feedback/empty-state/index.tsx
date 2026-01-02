import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Icon to display.
   */
  icon?: ReactNode;
  /**
   * Title text.
   */
  title: string;
  /**
   * Description text.
   */
  description?: string;
  /**
   * Action element (e.g., button).
   */
  action?: ReactNode;
  /**
   * Size variant.
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg';
}

const sizeStyles = {
  sm: {
    container: 'py-8',
    icon: 'w-8 h-8',
    title: 'text-sm',
    description: 'text-xs',
  },
  md: {
    container: 'py-12',
    icon: 'w-12 h-12',
    title: 'text-base',
    description: 'text-sm',
  },
  lg: {
    container: 'py-16',
    icon: 'w-16 h-16',
    title: 'text-lg',
    description: 'text-base',
  },
};

/**
 * Empty state component for displaying when no data is available.
 *
 * @example
 * ```tsx
 * <EmptyState
 *   icon={<InboxIcon />}
 *   title="No messages"
 *   description="You don't have any messages yet."
 *   action={<Button>Send a message</Button>}
 * />
 * ```
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  className,
  ...props
}: EmptyStateProps) {
  const styles = sizeStyles[size];

  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center text-center',
        styles.container,
        className,
      )}
      {...props}
    >
      {icon && (
        <div
          className={clsx(
            'mb-4 text-[var(--ui-text-subtle)]',
            styles.icon,
          )}
        >
          {icon}
        </div>
      )}
      <h3
        className={clsx(
          'font-medium text-[var(--ui-text)]',
          styles.title,
        )}
      >
        {title}
      </h3>
      {description && (
        <p
          className={clsx(
            'mt-1 text-[var(--ui-text-muted)] max-w-sm',
            styles.description,
          )}
        >
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export default EmptyState;
