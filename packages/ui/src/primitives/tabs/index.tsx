import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode, ButtonHTMLAttributes } from 'react';
import { createContext, useContext, useState, useCallback } from 'react';

// Context for tabs state
interface TabsContextValue {
  activeTab: string;
  setActiveTab: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('Tabs components must be used within a Tabs provider');
  }
  return context;
}

export interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The default active tab value.
   */
  defaultValue: string;
  /**
   * Controlled active tab value.
   */
  value?: string;
  /**
   * Callback when the active tab changes.
   */
  onValueChange?: (value: string) => void;
  /**
   * The content of the tabs.
   */
  children: ReactNode;
}

export interface TabsListProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the tabs list.
   */
  children: ReactNode;
}

export interface TabsTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * The value of the tab.
   */
  value: string;
  /**
   * The content of the tab trigger.
   */
  children: ReactNode;
}

export interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The value of the tab.
   */
  value: string;
  /**
   * The content of the tab panel.
   */
  children: ReactNode;
}

/**
 * Tabs component for organizing content into separate views.
 *
 * @example
 * ```tsx
 * <Tabs defaultValue="tab1">
 *   <TabsList>
 *     <TabsTrigger value="tab1">Tab 1</TabsTrigger>
 *     <TabsTrigger value="tab2">Tab 2</TabsTrigger>
 *   </TabsList>
 *   <TabsContent value="tab1">Content 1</TabsContent>
 *   <TabsContent value="tab2">Content 2</TabsContent>
 * </Tabs>
 * ```
 */
export function Tabs({
  defaultValue,
  value,
  onValueChange,
  children,
  className,
  ...props
}: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const activeTab = value ?? internalValue;

  const setActiveTab = useCallback(
    (newValue: string) => {
      if (value === undefined) {
        setInternalValue(newValue);
      }
      onValueChange?.(newValue);
    },
    [value, onValueChange],
  );

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className={clsx('', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

/**
 * Container for tab triggers.
 */
export function TabsList({ children, className, ...props }: TabsListProps) {
  return (
    <div
      role="tablist"
      className={clsx(
        'inline-flex items-center gap-1',
        'p-1 rounded-[var(--ui-radius-md)]',
        'bg-[var(--ui-surface)] border border-[var(--ui-border)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Tab trigger button.
 */
export function TabsTrigger({
  value,
  children,
  className,
  ...props
}: TabsTriggerProps) {
  const { activeTab, setActiveTab } = useTabsContext();
  const isActive = activeTab === value;

  return (
    <button
      role="tab"
      aria-selected={isActive}
      className={clsx(
        'px-3 py-1.5 text-sm font-medium',
        'rounded-[var(--ui-radius-sm)]',
        'transition-colors duration-[var(--ui-transition-fast)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-accent)]',
        isActive
          ? 'bg-[var(--ui-background)] text-[var(--ui-text)] shadow-sm'
          : 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)] hover:bg-[var(--ui-surface-hover)]',
        className,
      )}
      onClick={() => setActiveTab(value)}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * Tab content panel.
 */
export function TabsContent({
  value,
  children,
  className,
  ...props
}: TabsContentProps) {
  const { activeTab } = useTabsContext();
  const isActive = activeTab === value;

  if (!isActive) {
    return null;
  }

  return (
    <div
      role="tabpanel"
      className={clsx('mt-4', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export default Tabs;
