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
import { Activity, Database, Gauge, Home } from 'lucide-react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { StudioHeader } from './components/StudioHeader';
import { DashboardPage } from './pages/DashboardPage';
import { DatabasePage } from './pages/DatabasePage';
import { EndpointDetailsPage } from './pages/EndpointDetailsPage';
import { ExceptionsPage } from './pages/ExceptionsPage';
import { LogsPage } from './pages/LogsPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { PerformancePage } from './pages/PerformancePage';
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
            <Link to="/database">
              <SidebarItem icon={Database} active={isActive('/database')}>
                Database
              </SidebarItem>
            </Link>
            <Link to="/monitoring/requests">
              <SidebarItem icon={Activity} active={isActive('/monitoring')}>
                Monitoring
              </SidebarItem>
            </Link>
            <Link to="/performance">
              <SidebarItem icon={Gauge} active={isActive('/performance')}>
                Performance
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
            <Route path="/database" element={<DatabasePage />} />
            <Route path="/database/:table" element={<DatabasePage />} />
            <Route path="/monitoring" element={<MonitoringPage />}>
              <Route index element={<Navigate to="/monitoring/requests" replace />} />
              <Route path="requests" element={<RequestsPage />} />
              <Route path="requests/:id" element={<RequestsPage />} />
              <Route path="logs" element={<LogsPage />} />
              <Route path="exceptions" element={<ExceptionsPage />} />
              <Route path="exceptions/:id" element={<ExceptionsPage />} />
            </Route>
            <Route path="/performance" element={<PerformancePage />} />
            <Route path="/performance/endpoint" element={<EndpointDetailsPage />} />
            {/* Redirects for old routes */}
            <Route path="/requests/*" element={<Navigate to="/monitoring/requests" replace />} />
            <Route path="/logs" element={<Navigate to="/monitoring/logs" replace />} />
            <Route path="/exceptions/*" element={<Navigate to="/monitoring/exceptions" replace />} />
            <Route path="/analytics/*" element={<Navigate to="/performance" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ShellContent>
      </ShellMain>
    </Shell>
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
