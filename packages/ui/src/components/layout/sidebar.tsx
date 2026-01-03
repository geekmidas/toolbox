'use client';

import { type VariantProps, cva } from 'class-variance-authority';
import { type LucideIcon, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import * as React from 'react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';

const sidebarVariants = cva(
  'flex flex-col border-r border-border bg-surface transition-all duration-200',
  {
    variants: {
      collapsed: {
        true: 'w-16',
        false: 'w-64',
      },
    },
    defaultVariants: {
      collapsed: false,
    },
  },
);

export interface SidebarProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof sidebarVariants> {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}

const SidebarContext = React.createContext<{
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}>({
  collapsed: false,
  setCollapsed: () => {},
});

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a Sidebar');
  }
  return context;
}

const Sidebar = React.forwardRef<HTMLDivElement, SidebarProps>(
  (
    {
      className,
      collapsed: controlledCollapsed,
      onCollapsedChange,
      header,
      footer,
      children,
      ...props
    },
    ref,
  ) => {
    const [internalCollapsed, setInternalCollapsed] = React.useState(false);
    const collapsed = controlledCollapsed ?? internalCollapsed;

    const setCollapsed = React.useCallback(
      (value: boolean) => {
        setInternalCollapsed(value);
        onCollapsedChange?.(value);
      },
      [onCollapsedChange],
    );

    return (
      <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
        <TooltipProvider delayDuration={0}>
          <div
            ref={ref}
            className={cn(sidebarVariants({ collapsed, className }))}
            {...props}
          >
            {header && (
              <div className="flex h-14 items-center border-b border-border px-4">
                {header}
              </div>
            )}
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-1 p-2">{children}</div>
            </ScrollArea>
            {footer && (
              <div className="border-t border-border p-2">{footer}</div>
            )}
          </div>
        </TooltipProvider>
      </SidebarContext.Provider>
    );
  },
);
Sidebar.displayName = 'Sidebar';

export interface SidebarToggleProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

const SidebarToggle = React.forwardRef<HTMLButtonElement, SidebarToggleProps>(
  ({ className, ...props }, ref) => {
    const { collapsed, setCollapsed } = useSidebar();

    return (
      <Button
        ref={ref}
        variant="ghost"
        size="icon"
        className={cn('h-8 w-8', className)}
        onClick={() => setCollapsed(!collapsed)}
        {...props}
      >
        {collapsed ? (
          <PanelLeftOpen className="h-4 w-4" />
        ) : (
          <PanelLeftClose className="h-4 w-4" />
        )}
        <span className="sr-only">
          {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        </span>
      </Button>
    );
  },
);
SidebarToggle.displayName = 'SidebarToggle';

export interface SidebarSectionProps
  extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
}

const SidebarSection = React.forwardRef<HTMLDivElement, SidebarSectionProps>(
  ({ className, title, children, ...props }, ref) => {
    const { collapsed } = useSidebar();

    return (
      <div
        ref={ref}
        className={cn('flex flex-col gap-1', className)}
        {...props}
      >
        {title && !collapsed && (
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {title}
          </div>
        )}
        {title && collapsed && (
          <div className="mx-auto my-1 h-px w-6 bg-border" />
        )}
        {children}
      </div>
    );
  },
);
SidebarSection.displayName = 'SidebarSection';

export interface SidebarItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon;
  active?: boolean;
  badge?: React.ReactNode;
}

const SidebarItem = React.forwardRef<HTMLButtonElement, SidebarItemProps>(
  ({ className, icon: Icon, active, badge, children, ...props }, ref) => {
    const { collapsed } = useSidebar();

    const button = (
      <button
        ref={ref}
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          active && 'bg-surface-hover text-foreground',
          collapsed && 'justify-center px-0',
          className,
        )}
        {...props}
      >
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        {!collapsed && <span className="flex-1 truncate">{children}</span>}
        {!collapsed && badge && <span>{badge}</span>}
      </button>
    );

    if (collapsed) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right" className="flex items-center gap-2">
            {children}
            {badge}
          </TooltipContent>
        </Tooltip>
      );
    }

    return button;
  },
);
SidebarItem.displayName = 'SidebarItem';

export interface SidebarLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  icon?: LucideIcon;
  active?: boolean;
  badge?: React.ReactNode;
}

const SidebarLink = React.forwardRef<HTMLAnchorElement, SidebarLinkProps>(
  ({ className, icon: Icon, active, badge, children, ...props }, ref) => {
    const { collapsed } = useSidebar();

    const link = (
      <a
        ref={ref}
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          active && 'bg-surface-hover text-foreground',
          collapsed && 'justify-center px-0',
          className,
        )}
        {...props}
      >
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        {!collapsed && <span className="flex-1 truncate">{children}</span>}
        {!collapsed && badge && <span>{badge}</span>}
      </a>
    );

    if (collapsed) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right" className="flex items-center gap-2">
            {children}
            {badge}
          </TooltipContent>
        </Tooltip>
      );
    }

    return link;
  },
);
SidebarLink.displayName = 'SidebarLink';

export {
  Sidebar,
  SidebarToggle,
  SidebarSection,
  SidebarItem,
  SidebarLink,
  sidebarVariants,
};
