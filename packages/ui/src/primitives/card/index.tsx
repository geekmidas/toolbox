import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the card.
   */
  children: ReactNode;
  /**
   * Whether the card has a hover effect.
   */
  hoverable?: boolean;
  /**
   * Padding variant.
   * @default 'md'
   */
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the card header.
   */
  children: ReactNode;
}

export interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the card body.
   */
  children: ReactNode;
}

export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the card footer.
   */
  children: ReactNode;
}

const paddingStyles: Record<string, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

/**
 * Card component for containing related content.
 *
 * @example
 * ```tsx
 * <Card>
 *   <CardHeader>
 *     <h3>Title</h3>
 *   </CardHeader>
 *   <CardContent>
 *     <p>Content goes here</p>
 *   </CardContent>
 *   <CardFooter>
 *     <Button>Action</Button>
 *   </CardFooter>
 * </Card>
 * ```
 */
export function Card({
  children,
  hoverable = false,
  padding = 'md',
  className,
  ...props
}: CardProps) {
  return (
    <div
      className={clsx(
        'rounded-[var(--ui-radius-lg)]',
        'bg-[var(--ui-surface)] border border-[var(--ui-border)]',
        hoverable && 'transition-colors duration-[var(--ui-transition-fast)] hover:border-[var(--ui-border-hover)]',
        paddingStyles[padding],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Card header section.
 */
export function CardHeader({ children, className, ...props }: CardHeaderProps) {
  return (
    <div
      className={clsx(
        'border-b border-[var(--ui-border)] pb-4 mb-4',
        '-mx-4 px-4 -mt-4 pt-4 first:-mt-0 first:pt-0',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Card content section.
 */
export function CardContent({ children, className, ...props }: CardContentProps) {
  return (
    <div className={clsx('', className)} {...props}>
      {children}
    </div>
  );
}

/**
 * Card footer section.
 */
export function CardFooter({ children, className, ...props }: CardFooterProps) {
  return (
    <div
      className={clsx(
        'border-t border-[var(--ui-border)] pt-4 mt-4',
        '-mx-4 px-4 -mb-4 pb-4 last:-mb-0 last:pb-0',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export default Card;
