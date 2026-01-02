import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export interface HeaderProps extends HTMLAttributes<HTMLElement> {
  /**
   * The content of the header.
   */
  children: ReactNode;
  /**
   * Whether to show a border at the bottom.
   * @default true
   */
  bordered?: boolean;
  /**
   * Whether the header is sticky.
   * @default false
   */
  sticky?: boolean;
}

export interface HeaderLeftProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the left section.
   */
  children: ReactNode;
}

export interface HeaderCenterProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the center section.
   */
  children: ReactNode;
}

export interface HeaderRightProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the right section.
   */
  children: ReactNode;
}

export interface HeaderTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  /**
   * The title text.
   */
  children: ReactNode;
  /**
   * Optional subtitle text.
   */
  subtitle?: string;
}

/**
 * Header component for page or section headers.
 *
 * @example
 * ```tsx
 * <Header>
 *   <HeaderLeft>
 *     <SidebarTrigger />
 *   </HeaderLeft>
 *   <HeaderCenter>
 *     <HeaderTitle>Dashboard</HeaderTitle>
 *   </HeaderCenter>
 *   <HeaderRight>
 *     <Button>Settings</Button>
 *   </HeaderRight>
 * </Header>
 * ```
 */
export function Header({
  children,
  bordered = true,
  sticky = false,
  className,
  ...props
}: HeaderProps) {
  return (
    <header
      className={clsx(
        'h-14 px-4 flex items-center justify-between gap-4',
        'bg-[var(--ui-background)]',
        bordered && 'border-b border-[var(--ui-border)]',
        sticky && 'sticky top-0 z-40',
        className,
      )}
      {...props}
    >
      {children}
    </header>
  );
}

/**
 * Left section of the header.
 */
export function HeaderLeft({ children, className, ...props }: HeaderLeftProps) {
  return (
    <div
      className={clsx('flex items-center gap-3', className)}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Center section of the header.
 */
export function HeaderCenter({ children, className, ...props }: HeaderCenterProps) {
  return (
    <div
      className={clsx('flex-1 flex items-center justify-center', className)}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Right section of the header.
 */
export function HeaderRight({ children, className, ...props }: HeaderRightProps) {
  return (
    <div
      className={clsx('flex items-center gap-3', className)}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Title component for the header.
 */
export function HeaderTitle({ children, subtitle, className, ...props }: HeaderTitleProps) {
  return (
    <div className="flex flex-col">
      <h1
        className={clsx(
          'text-lg font-semibold text-[var(--ui-text)]',
          className,
        )}
        {...props}
      >
        {children}
      </h1>
      {subtitle && (
        <p className="text-sm text-[var(--ui-text-muted)]">{subtitle}</p>
      )}
    </div>
  );
}

export default Header;
