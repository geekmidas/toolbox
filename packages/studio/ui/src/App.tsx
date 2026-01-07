import { Activity, Database, Gauge, Home } from 'lucide-react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { NavRail, NavRailItem, NavRailSection } from './components/NavRail';
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
  return (
    <div className="flex h-screen w-full bg-[#0a0a0a]">
      {/* Navigation Rail */}
      <NavRail>
        <NavRailSection>
          <NavRailItem to="/" icon={Home}>
            Dashboard
          </NavRailItem>
          <NavRailItem to="/database" icon={Database}>
            Database
          </NavRailItem>
          <NavRailItem
            to="/monitoring/requests"
            icon={Activity}
            matchPath="/monitoring"
          >
            Monitoring
          </NavRailItem>
          <NavRailItem to="/performance" icon={Gauge}>
            Performance
          </NavRailItem>
        </NavRailSection>
      </NavRail>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <StudioHeader />

        {/* Content */}
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/database" element={<DatabasePage />} />
            <Route path="/database/:table" element={<DatabasePage />} />
            <Route path="/monitoring" element={<MonitoringPage />}>
              <Route
                index
                element={<Navigate to="/monitoring/requests" replace />}
              />
              <Route path="requests" element={<RequestsPage />} />
              <Route path="requests/:id" element={<RequestsPage />} />
              <Route path="logs" element={<LogsPage />} />
              <Route path="exceptions" element={<ExceptionsPage />} />
              <Route path="exceptions/:id" element={<ExceptionsPage />} />
            </Route>
            <Route path="/performance" element={<PerformancePage />} />
            <Route
              path="/performance/endpoint"
              element={<EndpointDetailsPage />}
            />
            {/* Redirects for old routes */}
            <Route
              path="/requests/*"
              element={<Navigate to="/monitoring/requests" replace />}
            />
            <Route
              path="/logs"
              element={<Navigate to="/monitoring/logs" replace />}
            />
            <Route
              path="/exceptions/*"
              element={<Navigate to="/monitoring/exceptions" replace />}
            />
            <Route
              path="/analytics/*"
              element={<Navigate to="/performance" replace />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
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
