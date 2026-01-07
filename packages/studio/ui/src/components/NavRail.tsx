import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@geekmidas/ui';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const STORAGE_KEY = 'studio-nav-collapsed';

interface NavRailContextValue {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

const NavRailContext = createContext<NavRailContextValue>({
  collapsed: false,
  setCollapsed: () => {},
});

export function useNavRail() {
  return useContext(NavRailContext);
}

interface NavRailProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}

export function NavRail({ children, header, footer }: NavRailProps) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'true';
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  return (
    <NavRailContext.Provider value={{ collapsed, setCollapsed }}>
      <TooltipProvider delayDuration={0}>
        <nav
          className={`
            flex flex-col h-full
            bg-[#0d0d0d] border-r border-white/[0.06]
            transition-all duration-200 ease-out
            ${collapsed ? 'w-[52px]' : 'w-[180px]'}
          `}
        >
          {/* Toggle button */}
          <div className="flex items-center justify-end h-12 px-2">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="
                p-1.5 rounded-md
                text-white/40 hover:text-white/70
                hover:bg-white/[0.06]
                transition-colors
              "
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </button>
          </div>

          {header && (
            <div className="px-2 mb-2">
              {header}
            </div>
          )}

          {/* Navigation items */}
          <div className="flex-1 flex flex-col gap-0.5 px-2">
            {children}
          </div>

          {footer && (
            <div className="px-2 py-2 border-t border-white/[0.06]">
              {footer}
            </div>
          )}
        </nav>
      </TooltipProvider>
    </NavRailContext.Provider>
  );
}

interface NavRailItemProps {
  to: string;
  icon: LucideIcon;
  children: React.ReactNode;
  matchPath?: string;
}

export function NavRailItem({ to, icon: Icon, children, matchPath }: NavRailItemProps) {
  const { collapsed } = useNavRail();
  const location = useLocation();

  // Special handling for root path
  const isActive = matchPath
    ? location.pathname.startsWith(matchPath)
    : to === '/'
      ? location.pathname === '/'
      : location.pathname === to || location.pathname.startsWith(to + '/');

  const content = (
    <Link
      to={to}
      className={`
        relative flex items-center gap-3
        px-3 py-2 rounded-md
        text-sm font-medium
        transition-colors duration-150
        ${collapsed ? 'justify-center px-0' : ''}
        ${isActive
          ? 'text-white bg-white/[0.08]'
          : 'text-white/60 hover:text-white/90 hover:bg-white/[0.04]'
        }
      `}
    >
      {/* Active indicator bar */}
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-emerald-500 rounded-full" />
      )}

      <Icon className={`h-[18px] w-[18px] shrink-0 ${collapsed ? '' : 'ml-0.5'}`} />

      {!collapsed && (
        <span className="truncate">{children}</span>
      )}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {content}
        </TooltipTrigger>
        <TooltipContent
          side="right"
          sideOffset={8}
          className="bg-[#1a1a1a] text-white border-white/10"
        >
          {children}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

interface NavRailSectionProps {
  title?: string;
  children: React.ReactNode;
}

export function NavRailSection({ title, children }: NavRailSectionProps) {
  const { collapsed } = useNavRail();

  return (
    <div className="flex flex-col gap-0.5">
      {title && !collapsed && (
        <div className="px-3 py-2 text-[11px] font-medium text-white/30 uppercase tracking-wider">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}
