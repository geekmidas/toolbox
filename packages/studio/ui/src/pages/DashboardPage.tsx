import {
  AreaTimeSeriesChart,
  Badge,
  MetricCard,
  SparkBar,
} from '@geekmidas/ui';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  Network,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getEndpointMetrics, getMetrics } from '../api';
import { useStudio } from '../providers/StudioProvider';
import type { EndpointMetrics, RequestMetrics } from '../types';

export function DashboardPage() {
  const { stats, requests, exceptions, loading, realtimeMetrics, connected } =
    useStudio();

  // Fetch aggregated metrics and endpoint data
  const [metricsData, setMetricsData] = useState<RequestMetrics | null>(null);
  const [endpoints, setEndpoints] = useState<EndpointMetrics[]>([]);

  const fetchMetrics = useCallback(async () => {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const timeRange = {
        start: oneHourAgo.toISOString(),
        end: now.toISOString(),
      };

      const [metrics, endpointData] = await Promise.all([
        getMetrics(timeRange),
        getEndpointMetrics({ limit: 5, ...timeRange }),
      ]);

      setMetricsData(metrics);
      setEndpoints(endpointData);
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // Calculate local metrics from recent data for sparkline
  const localMetrics = useMemo(() => {
    if (!requests.length) {
      return {
        avgDuration: 0,
        errorRate: 0,
        requestsPerMinute: [],
      };
    }

    const totalDuration = requests.reduce((sum, r) => sum + r.duration, 0);
    const avgDuration = totalDuration / requests.length;

    const errorCount = requests.filter((r) => r.status >= 400).length;
    const errorRate = (errorCount / requests.length) * 100;

    // Group requests by minute for spark chart
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const recentRequests = requests.filter(
      (r) => new Date(r.timestamp).getTime() > oneMinuteAgo,
    );

    // Create 6 buckets of 10 seconds each
    const buckets = Array(6).fill(0);
    for (const r of recentRequests) {
      const age = now - new Date(r.timestamp).getTime();
      const bucket = Math.floor(age / 10000);
      if (bucket >= 0 && bucket < 6) {
        buckets[5 - bucket]++;
      }
    }

    return {
      avgDuration,
      errorRate,
      requestsPerMinute: buckets,
    };
  }, [requests]);

  // Sort endpoints by p95 latency for "slowest" view
  const slowestEndpoints = useMemo(() => {
    return [...endpoints].sort((a, b) => b.p95Duration - a.p95Duration);
  }, [endpoints]);

  // Calculate service health
  const serviceHealth = useMemo(() => {
    const errorRate = realtimeMetrics?.errorRate ?? localMetrics.errorRate;
    const hasRecentErrors = exceptions.some((e) => {
      const age = Date.now() - new Date(e.timestamp).getTime();
      return age < 5 * 60 * 1000; // Last 5 minutes
    });

    if (errorRate > 10 || hasRecentErrors) {
      return { status: 'unhealthy', label: 'Issues Detected', color: 'red' };
    }
    if (errorRate > 5) {
      return { status: 'degraded', label: 'Degraded', color: 'yellow' };
    }
    return { status: 'healthy', label: 'Healthy', color: 'green' };
  }, [realtimeMetrics, localMetrics.errorRate, exceptions]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Service Health Banner */}
      <div
        className={`flex items-center gap-3 p-4 rounded-lg border ${
          serviceHealth.color === 'green'
            ? 'bg-green-500/10 border-green-500/30'
            : serviceHealth.color === 'yellow'
              ? 'bg-yellow-500/10 border-yellow-500/30'
              : 'bg-red-500/10 border-red-500/30'
        }`}
      >
        <CheckCircle2
          className={`h-5 w-5 ${
            serviceHealth.color === 'green'
              ? 'text-green-500'
              : serviceHealth.color === 'yellow'
                ? 'text-yellow-500'
                : 'text-red-500'
          }`}
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">Service Status:</span>
            <span
              className={
                serviceHealth.color === 'green'
                  ? 'text-green-500'
                  : serviceHealth.color === 'yellow'
                    ? 'text-yellow-500'
                    : 'text-red-500'
              }
            >
              {serviceHealth.label}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {connected ? 'Real-time monitoring active' : 'Connecting...'}
          </p>
        </div>
        {realtimeMetrics && (
          <div className="text-right text-sm">
            <div className="text-muted-foreground">
              {realtimeMetrics.requestsPerSecond.toFixed(1)} req/s
            </div>
            <div className="text-muted-foreground">
              p95: {formatDuration(realtimeMetrics.p95)}
            </div>
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Requests"
          value={metricsData?.totalRequests ?? stats?.requests ?? 0}
          icon={<Network className="h-4 w-4" />}
          sparklineData={localMetrics.requestsPerMinute}
          description="last hour"
          trend="neutral"
          trendValue={`${(metricsData?.requestsPerSecond ?? 0).toFixed(1)}/s`}
        />

        <MetricCard
          title="Avg Duration"
          value={formatDuration(
            metricsData?.avgDuration ?? localMetrics.avgDuration,
          )}
          icon={<Clock className="h-4 w-4" />}
          trend="neutral"
          trendValue={`p95: ${formatDuration(metricsData?.p95Duration ?? 0)}`}
        />

        <MetricCard
          title="Success Rate"
          value={`${(metricsData?.successRate ?? 100 - localMetrics.errorRate).toFixed(1)}%`}
          icon={<TrendingUp className="h-4 w-4" />}
          trend={
            (metricsData?.successRate ?? 100) >= 99
              ? 'up'
              : (metricsData?.successRate ?? 100) >= 95
                ? 'neutral'
                : 'down'
          }
        />

        <MetricCard
          title="Exceptions"
          value={stats?.exceptions ?? 0}
          icon={<AlertTriangle className="h-4 w-4" />}
          trend={(stats?.exceptions ?? 0) > 0 ? 'down' : 'up'}
          trendValue={(stats?.exceptions ?? 0) > 0 ? 'Active' : 'None'}
        />
      </div>

      {/* Request Volume Chart */}
      {metricsData?.timeSeries && metricsData.timeSeries.length > 0 && (
        <div className="p-4 bg-surface rounded-lg border border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium">Request Volume (last hour)</h3>
            <Link
              to="/analytics"
              className="text-xs text-accent hover:underline"
            >
              View Analytics →
            </Link>
          </div>
          <AreaTimeSeriesChart
            data={metricsData.timeSeries.map((p) => ({
              timestamp: p.timestamp,
              value: p.count,
              secondaryValue: p.errorCount,
            }))}
            primaryLabel="Requests"
            secondaryLabel="Errors"
            primaryColor="blue"
            secondaryColor="red"
          />
        </div>
      )}

      {/* Fallback to sparkline if no time series data */}
      {(!metricsData?.timeSeries || metricsData.timeSeries.length === 0) &&
        localMetrics.requestsPerMinute.length > 0 && (
          <div className="p-4 bg-surface rounded-lg border border-border">
            <h3 className="text-sm font-medium mb-3">
              Request Activity (last 60s)
            </h3>
            <SparkBar
              data={localMetrics.requestsPerMinute}
              height={60}
              color="var(--color-accent)"
            />
          </div>
        )}

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <QuickLinkCard
          to="/requests"
          icon={<Network className="h-5 w-5" />}
          title="Requests"
          description="View HTTP requests and responses"
          count={stats?.requests}
        />
        <QuickLinkCard
          to="/logs"
          icon={<FileText className="h-5 w-5" />}
          title="Logs"
          description="Browse application logs"
          count={stats?.logs}
        />
        <QuickLinkCard
          to="/database"
          icon={<Database className="h-5 w-5" />}
          title="Database"
          description="Browse and query your database"
        />
      </div>

      {/* Slowest Endpoints */}
      {slowestEndpoints.length > 0 && (
        <div className="bg-surface rounded-lg border border-border">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              <h3 className="font-medium">Slowest Endpoints</h3>
            </div>
            <Link
              to="/analytics"
              className="text-sm text-accent hover:underline flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-border">
            {slowestEndpoints.slice(0, 5).map((endpoint, i) => (
              <Link
                key={`${endpoint.method}-${endpoint.path}`}
                to={`/analytics/endpoint?method=${encodeURIComponent(endpoint.method)}&path=${encodeURIComponent(endpoint.path)}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover transition-colors"
              >
                <span className="text-xs text-muted-foreground w-4">
                  #{i + 1}
                </span>
                <Badge variant={getMethodVariant(endpoint.method)}>
                  {endpoint.method}
                </Badge>
                <span className="flex-1 truncate text-sm font-mono">
                  {endpoint.path}
                </span>
                <div className="text-right">
                  <div className="text-sm font-medium text-amber-500">
                    {formatDuration(endpoint.p95Duration)}
                  </div>
                  <div className="text-xs text-muted-foreground">p95</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Requests */}
        <div className="bg-surface rounded-lg border border-border">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="font-medium">Recent Requests</h3>
            <Link
              to="/requests"
              className="text-sm text-accent hover:underline flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-border">
            {requests.slice(0, 5).map((request) => (
              <Link
                key={request.id}
                to={`/requests/${request.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover transition-colors"
              >
                <MethodBadge method={request.method} />
                <span className="flex-1 truncate text-sm">{request.path}</span>
                <StatusBadge status={request.status} />
                <span className="text-xs text-muted-foreground">
                  {formatDuration(request.duration)}
                </span>
              </Link>
            ))}
            {requests.length === 0 && (
              <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                No requests yet
              </div>
            )}
          </div>
        </div>

        {/* Recent Exceptions */}
        <div className="bg-surface rounded-lg border border-border">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="font-medium">Recent Exceptions</h3>
            <Link
              to="/exceptions"
              className="text-sm text-accent hover:underline flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-border">
            {exceptions.slice(0, 5).map((exception) => (
              <Link
                key={exception.id}
                to={`/exceptions/${exception.id}`}
                className="block px-4 py-2.5 hover:bg-surface-hover transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-red-400">
                    {exception.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(exception.timestamp)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground truncate">
                  {exception.message}
                </p>
              </Link>
            ))}
            {exceptions.length === 0 && (
              <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                No exceptions - great!
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickLinkCard({
  to,
  icon,
  title,
  description,
  count,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  count?: number;
}) {
  return (
    <Link
      to={to}
      className="group p-4 bg-surface rounded-lg border border-border hover:border-accent/50 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-md bg-surface-hover text-muted-foreground group-hover:text-accent transition-colors">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{title}</h3>
            {count !== undefined && (
              <span className="text-xs text-muted-foreground">({count})</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-accent transition-colors" />
      </div>
    </Link>
  );
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: 'bg-blue-500/20 text-blue-400',
    POST: 'bg-green-500/20 text-green-400',
    PUT: 'bg-amber-500/20 text-amber-400',
    PATCH: 'bg-purple-500/20 text-purple-400',
    DELETE: 'bg-red-500/20 text-red-400',
  };
  return (
    <span
      className={`text-xs font-medium px-1.5 py-0.5 rounded ${colors[method] || 'bg-slate-500/20 text-slate-400'}`}
    >
      {method}
    </span>
  );
}

function StatusBadge({ status }: { status: number }) {
  const color =
    status >= 500
      ? 'text-red-400'
      : status >= 400
        ? 'text-amber-400'
        : status >= 300
          ? 'text-blue-400'
          : 'text-green-400';
  return <span className={`text-xs font-medium ${color}`}>{status}</span>;
}

function formatDuration(ms: number) {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString();
}

function getMethodVariant(
  method: string,
): 'get' | 'post' | 'put' | 'patch' | 'delete' | 'secondary' {
  const variants: Record<
    string,
    'get' | 'post' | 'put' | 'patch' | 'delete' | 'secondary'
  > = {
    GET: 'get',
    POST: 'post',
    PUT: 'put',
    PATCH: 'patch',
    DELETE: 'delete',
  };
  return variants[method.toUpperCase()] || 'secondary';
}
