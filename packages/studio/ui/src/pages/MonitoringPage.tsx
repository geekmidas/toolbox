import { AlertTriangle, FileText, Network } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

const tabs = [
  { path: '/monitoring/requests', label: 'Requests', icon: Network },
  { path: '/monitoring/logs', label: 'Logs', icon: FileText },
  { path: '/monitoring/exceptions', label: 'Exceptions', icon: AlertTriangle },
] as const;

export function MonitoringPage() {
  const location = useLocation();

  return (
    <div className="flex flex-col h-full">
      {/* Tab Bar */}
      <div className="bg-surface border-b border-border px-4">
        <nav className="flex gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = location.pathname.startsWith(tab.path);

            return (
              <NavLink
                key={tab.path}
                to={tab.path}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'text-accent border-accent'
                    : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
