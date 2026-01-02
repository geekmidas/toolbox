import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode, ButtonHTMLAttributes } from 'react';
import { createContext, useContext, useState, useCallback } from 'react';

// Context for sidebar state
interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('Sidebar components must be used within a SidebarProvider');
  }
  return context;
}

export interface SidebarProviderProps {
  /**
   * Default collapsed state.
   * @default false
   */
  defaultCollapsed?: boolean;
  /**
   * Controlled collapsed state.
   */
  collapsed?: boolean;
  /**
   * Callback when collapsed state changes.
   */
  onCollapsedChange?: (collapsed: boolean) => void;
  /**
   * Children elements.
   */
  children: ReactNode;
}

export interface SidebarProps extends HTMLAttributes<HTMLElement> {
  /**
   * The content of the sidebar.
   */
  children: ReactNode;
  /**
   * Width of the sidebar when expanded.
   * @default '240px'
   */
  width?: string;
  /**
   * Width of the sidebar when collapsed.
   * @default '64px'
   */
  collapsedWidth?: string;
}

export interface SidebarHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the sidebar header.
   */
  children: ReactNode;
}

export interface SidebarContentProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the sidebar body.
   */
  children: ReactNode;
}

export interface SidebarFooterProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the sidebar footer.
   */
  children: ReactNode;
}

export interface SidebarItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Icon for the sidebar item.
   */
  icon?: ReactNode;
  /**
   * Label for the sidebar item.
   */
  children: ReactNode;
  /**
   * Whether the item is currently active.
   */
  active?: boolean;
}

export interface SidebarGroupProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Label for the group.
   */
  label?: string;
  /**
   * The content of the group.
   */
  children: ReactNode;
}

/**
 * Provider for sidebar state management.
 */
export function SidebarProvider({
  defaultCollapsed = false,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  children,
}: SidebarProviderProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
  const collapsed = controlledCollapsed ?? internalCollapsed;

  const setCollapsed = useCallback(
    (value: boolean) => {
      if (controlledCollapsed === undefined) {
        setInternalCollapsed(value);
      }
      onCollapsedChange?.(value);
    },
    [controlledCollapsed, onCollapsedChange],
  );

  const toggle = useCallback(() => {
    setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

/**
 * Sidebar component for navigation.
 *
 * @example
 * ```tsx
 * <SidebarProvider>
 *   <Sidebar>
 *     <SidebarHeader>Logo</SidebarHeader>
 *     <SidebarContent>
 *       <SidebarItem icon={<HomeIcon />}>Home</SidebarItem>
 *     </SidebarContent>
 *     <SidebarFooter>Footer</SidebarFooter>
 *   </Sidebar>
 * </SidebarProvider>
 * ```
 */
export function Sidebar({
  children,
  width = '240px',
  collapsedWidth = '64px',
  className,
  style,
  ...props
}: SidebarProps) {
  const { collapsed } = useSidebar();

  return (
    <aside
      className={clsx(
        'h-full flex flex-col',
        'bg-[var(--ui-surface)] border-r border-[var(--ui-border)]',
        'transition-[width] duration-[var(--ui-transition-normal)]',
        className,
      )}
      style={{
        width: collapsed ? collapsedWidth : width,
        ...style,
      }}
      {...props}
    >
      {children}
    </aside>
  );
}

/**
 * Sidebar header section.
 */
export function SidebarHeader({ children, className, ...props }: SidebarHeaderProps) {
  const { collapsed } = useSidebar();

  return (
    <div
      className={clsx(
        'px-4 py-4',
        'border-b border-[var(--ui-border)]',
        collapsed && 'flex items-center justify-center',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Sidebar content section.
 */
export function SidebarContent({ children, className, ...props }: SidebarContentProps) {
  return (
    <div
      className={clsx(
        'flex-1 overflow-y-auto',
        'px-2 py-2',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Sidebar footer section.
 */
export function SidebarFooter({ children, className, ...props }: SidebarFooterProps) {
  const { collapsed } = useSidebar();

  return (
    <div
      className={clsx(
        'px-4 py-4',
        'border-t border-[var(--ui-border)]',
        collapsed && 'flex items-center justify-center',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Sidebar navigation item.
 */
export function SidebarItem({
  icon,
  children,
  active = false,
  className,
  ...props
}: SidebarItemProps) {
  const { collapsed } = useSidebar();

  return (
    <button
      className={clsx(
        'w-full flex items-center gap-3',
        'px-3 py-2 rounded-[var(--ui-radius-md)]',
        'text-sm font-medium',
        'transition-colors duration-[var(--ui-transition-fast)]',
        active
          ? 'bg-[var(--ui-accent)]/10 text-[var(--ui-accent)]'
          : 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)] hover:bg-[var(--ui-surface-hover)]',
        collapsed && 'justify-center px-0',
        className,
      )}
      {...props}
    >
      {icon && <span className="shrink-0 w-5 h-5">{icon}</span>}
      {!collapsed && <span className="truncate">{children}</span>}
    </button>
  );
}

/**
 * Sidebar group for organizing items.
 */
export function SidebarGroup({ label, children, className, ...props }: SidebarGroupProps) {
  const { collapsed } = useSidebar();

  return (
    <div className={clsx('py-2', className)} {...props}>
      {label && !collapsed && (
        <div className="px-3 py-2 text-xs font-semibold text-[var(--ui-text-subtle)] uppercase tracking-wider">
          {label}
        </div>
      )}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/**
 * Toggle button for the sidebar.
 */
export function SidebarTrigger({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { toggle, collapsed } = useSidebar();

  return (
    <button
      onClick={toggle}
      className={clsx(
        'p-2 rounded-[var(--ui-radius-md)]',
        'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]',
        'hover:bg-[var(--ui-surface-hover)]',
        'transition-colors duration-[var(--ui-transition-fast)]',
        className,
      )}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      {...props}
    >
      {children || (
        <svg
          className={clsx(
            'w-5 h-5 transition-transform',
            collapsed && 'rotate-180',
          )}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </button>
  );
}

export default Sidebar;
