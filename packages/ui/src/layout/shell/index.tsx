import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export interface ShellProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the shell.
   */
  children: ReactNode;
}

export interface ShellSidebarProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The sidebar content.
   */
  children: ReactNode;
}

export interface ShellContentProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The main content.
   */
  children: ReactNode;
}

export interface ShellHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The header content.
   */
  children: ReactNode;
}

export interface ShellMainProps extends HTMLAttributes<HTMLElement> {
  /**
   * The main section content.
   */
  children: ReactNode;
}

/**
 * Shell layout component for application structure.
 * Provides a consistent layout with sidebar, header, and main content areas.
 *
 * @example
 * ```tsx
 * <Shell>
 *   <ShellSidebar>
 *     <Sidebar>...</Sidebar>
 *   </ShellSidebar>
 *   <ShellContent>
 *     <ShellHeader>
 *       <Header>...</Header>
 *     </ShellHeader>
 *     <ShellMain>
 *       <p>Main content</p>
 *     </ShellMain>
 *   </ShellContent>
 * </Shell>
 * ```
 */
export function Shell({ children, className, ...props }: ShellProps) {
  return (
    <div
      className={clsx(
        'h-screen flex overflow-hidden',
        'bg-[var(--ui-background)] text-[var(--ui-text)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Sidebar container in the shell layout.
 */
export function ShellSidebar({ children, className, ...props }: ShellSidebarProps) {
  return (
    <div
      className={clsx('shrink-0', className)}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Content area container (includes header and main).
 */
export function ShellContent({ children, className, ...props }: ShellContentProps) {
  return (
    <div
      className={clsx('flex-1 flex flex-col overflow-hidden', className)}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Header container in the shell layout.
 */
export function ShellHeader({ children, className, ...props }: ShellHeaderProps) {
  return (
    <div className={clsx('shrink-0', className)} {...props}>
      {children}
    </div>
  );
}

/**
 * Main content area in the shell layout.
 */
export function ShellMain({ children, className, ...props }: ShellMainProps) {
  return (
    <main
      className={clsx('flex-1 overflow-auto', className)}
      {...props}
    >
      {children}
    </main>
  );
}

export default Shell;
