import {
  Shell,
  ShellContent,
  ShellHeader,
  ShellMain,
  ShellSidebar,
  Sidebar,
  SidebarItem,
  SidebarSection,
} from '@geekmidas/ui';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Database,
  FileText,
  Home,
  Network,
} from 'lucide-react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { StudioHeader } from './components/StudioHeader';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { DashboardPage } from './pages/DashboardPage';
import { DatabasePage } from './pages/DatabasePage';
import { ExceptionsPage } from './pages/ExceptionsPage';
import { LogsPage } from './pages/LogsPage';
import { RequestsPage } from './pages/RequestsPage';
import { StudioProvider } from './providers/StudioProvider';

function AppLayout() {
  const location = useLocation();
  const currentPath = location.pathname;

  const isActive = (path: string) => {
    if (path === '/') {
      return currentPath === '/' || currentPath === '';
    }
    return currentPath.startsWith(path);
  };

  return (
    <Shell>
      <ShellSidebar>
        <Sidebar>
          <SidebarSection>
            <Link to="/">
              <SidebarItem icon={Home} active={isActive('/')}>
                Dashboard
              </SidebarItem>
            </Link>
          </SidebarSection>

          <SidebarSection title="Monitoring">
            <Link to="/requests">
              <SidebarItem icon={Network} active={isActive('/requests')}>
                Requests
              </SidebarItem>
            </Link>
            <Link to="/logs">
              <SidebarItem icon={FileText} active={isActive('/logs')}>
                Logs
              </SidebarItem>
            </Link>
            <Link to="/exceptions">
              <SidebarItem
                icon={AlertTriangle}
                active={isActive('/exceptions')}
              >
                Exceptions
              </SidebarItem>
            </Link>
            <Link to="/analytics">
              <SidebarItem icon={BarChart3} active={isActive('/analytics')}>
                Analytics
              </SidebarItem>
            </Link>
          </SidebarSection>

          <SidebarSection title="Data">
            <Link to="/database">
              <SidebarItem icon={Database} active={isActive('/database')}>
                Database
              </SidebarItem>
            </Link>
          </SidebarSection>

          <SidebarSection title="Inspect">
            <Link to="/services">
              <SidebarItem icon={Activity} active={isActive('/services')}>
                Services
              </SidebarItem>
            </Link>
          </SidebarSection>
        </Sidebar>
      </ShellSidebar>

      <ShellMain>
        <ShellHeader>
          <StudioHeader />
        </ShellHeader>

        <ShellContent>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/requests" element={<RequestsPage />} />
            <Route path="/requests/:id" element={<RequestsPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/exceptions" element={<ExceptionsPage />} />
            <Route path="/exceptions/:id" element={<ExceptionsPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/database" element={<DatabasePage />} />
            <Route path="/database/:table" element={<DatabasePage />} />
            <Route path="/services" element={<ComingSoon title="Services" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ShellContent>
      </ShellMain>
    </Shell>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      <div className="text-center">
        <h2 className="text-lg font-medium mb-2">{title}</h2>
        <p className="text-sm">Coming soon...</p>
      </div>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <StudioProvider>
        <AppLayout />
      </StudioProvider>
    </BrowserRouter>
  );
}
