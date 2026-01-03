import { Badge, MetricCard } from '@geekmidas/ui';
import { useEffect, useState } from 'react';
import { getEndpointMetrics, getMetrics, getStatusDistribution } from '../api';
import type {
  EndpointMetrics,
  RequestMetrics,
  StatusDistribution,
} from '../types';

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatNumber(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}

function formatPercent(p: number): string {
  return `${p.toFixed(1)}%`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function getMethodColor(
  method: string,
): 'default' | 'success' | 'warning' | 'danger' {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'success';
    case 'POST':
      return 'default';
    case 'PUT':
    case 'PATCH':
      return 'warning';
    case 'DELETE':
      return 'danger';
    default:
      return 'default';
  }
}

export function AnalyticsPage() {
  const [metrics, setMetrics] = useState<RequestMetrics | null>(null);
  const [endpoints, setEndpoints] = useState<EndpointMetrics[]>([]);
  const [statusDist, setStatusDist] = useState<StatusDistribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [metricsData, endpointsData, statusData] = await Promise.all([
          getMetrics(),
          getEndpointMetrics({ limit: 10 }),
          getStatusDistribution(),
        ]);
        setMetrics(metricsData);
        setEndpoints(endpointsData);
        setStatusDist(statusData);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load metrics');
      } finally {
        setLoading(false);
      }
    }

    fetchData();

    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !metrics) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Loading analytics...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-500">
        {error}
      </div>
    );
  }

  const totalStatus = statusDist
    ? statusDist['2xx'] +
      statusDist['3xx'] +
      statusDist['4xx'] +
      statusDist['5xx']
    : 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Request metrics and performance insights
        </p>
      </div>

      {/* Overview Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          title="Total Requests"
          value={formatNumber(metrics?.totalRequests ?? 0)}
          trend="neutral"
          trendValue={`${(metrics?.requestsPerSecond ?? 0).toFixed(1)}/s`}
        />
        <MetricCard
          title="Avg Duration"
          value={formatDuration(metrics?.avgDuration ?? 0)}
          trend="neutral"
          trendValue={`p95: ${formatDuration(metrics?.p95Duration ?? 0)}`}
        />
        <MetricCard
          title="Success Rate"
          value={formatPercent(metrics?.successRate ?? 100)}
          trend={
            (metrics?.successRate ?? 100) >= 99
              ? 'up'
              : (metrics?.successRate ?? 100) >= 95
                ? 'neutral'
                : 'down'
          }
        />
        <MetricCard
          title="Error Rate"
          value={formatPercent(metrics?.errorRate ?? 0)}
          trend={
            (metrics?.errorRate ?? 0) <= 1
              ? 'up'
              : (metrics?.errorRate ?? 0) <= 5
                ? 'neutral'
                : 'down'
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Distribution */}
        <div className="bg-card rounded-lg border p-4">
          <h2 className="text-sm font-medium mb-4">Status Distribution</h2>
          {statusDist && totalStatus > 0 ? (
            <div className="space-y-3">
              <StatusBar
                label="2xx Success"
                count={statusDist['2xx']}
                total={totalStatus}
                color="bg-green-500"
              />
              <StatusBar
                label="3xx Redirect"
                count={statusDist['3xx']}
                total={totalStatus}
                color="bg-blue-500"
              />
              <StatusBar
                label="4xx Client Error"
                count={statusDist['4xx']}
                total={totalStatus}
                color="bg-yellow-500"
              />
              <StatusBar
                label="5xx Server Error"
                count={statusDist['5xx']}
                total={totalStatus}
                color="bg-red-500"
              />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-8">
              No requests recorded yet
            </div>
          )}
        </div>

        {/* Latency Percentiles */}
        <div className="bg-card rounded-lg border p-4">
          <h2 className="text-sm font-medium mb-4">Latency Percentiles</h2>
          {metrics ? (
            <div className="space-y-3">
              <LatencyBar
                label="p50 (Median)"
                value={metrics.p50Duration}
                max={metrics.p99Duration || 1}
              />
              <LatencyBar
                label="p95"
                value={metrics.p95Duration}
                max={metrics.p99Duration || 1}
              />
              <LatencyBar
                label="p99"
                value={metrics.p99Duration}
                max={metrics.p99Duration || 1}
              />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-8">
              No requests recorded yet
            </div>
          )}
        </div>
      </div>

      {/* Time Series (placeholder for now) */}
      {metrics && metrics.timeSeries.length > 0 && (
        <div className="bg-card rounded-lg border p-4">
          <h2 className="text-sm font-medium mb-4">Request Volume</h2>
          <div className="h-32 flex items-end gap-1">
            {metrics.timeSeries.map((point, i) => {
              const maxCount = Math.max(
                ...metrics.timeSeries.map((p) => p.count),
                1,
              );
              const height = (point.count / maxCount) * 100;
              const hasErrors = point.errorCount > 0;
              return (
                <div
                  key={i}
                  className="flex-1 group relative"
                  title={`${formatTimestamp(point.timestamp)}: ${point.count} requests`}
                >
                  <div
                    className={`w-full rounded-t transition-all ${
                      hasErrors ? 'bg-red-500/80' : 'bg-primary/80'
                    } group-hover:opacity-80`}
                    style={{ height: `${Math.max(height, 2)}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>
              {metrics.timeSeries[0]
                ? formatTimestamp(metrics.timeSeries[0].timestamp)
                : ''}
            </span>
            <span>
              {metrics.timeSeries[metrics.timeSeries.length - 1]
                ? formatTimestamp(
                    metrics.timeSeries[metrics.timeSeries.length - 1]!
                      .timestamp,
                  )
                : ''}
            </span>
          </div>
        </div>
      )}

      {/* Top Endpoints */}
      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h2 className="text-sm font-medium">Top Endpoints</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Endpoint</th>
                <th className="text-right px-4 py-2 font-medium">Requests</th>
                <th className="text-right px-4 py-2 font-medium">Avg</th>
                <th className="text-right px-4 py-2 font-medium">p95</th>
                <th className="text-right px-4 py-2 font-medium">Error Rate</th>
                <th className="text-right px-4 py-2 font-medium">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No endpoints recorded yet
                  </td>
                </tr>
              ) : (
                endpoints.map((ep, i) => (
                  <tr key={i} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={getMethodColor(ep.method)} size="sm">
                          {ep.method}
                        </Badge>
                        <span className="font-mono text-xs">{ep.path}</span>
                      </div>
                    </td>
                    <td className="text-right px-4 py-2 font-mono">
                      {formatNumber(ep.count)}
                    </td>
                    <td className="text-right px-4 py-2 font-mono">
                      {formatDuration(ep.avgDuration)}
                    </td>
                    <td className="text-right px-4 py-2 font-mono">
                      {formatDuration(ep.p95Duration)}
                    </td>
                    <td className="text-right px-4 py-2">
                      <span
                        className={
                          ep.errorRate > 5
                            ? 'text-red-500'
                            : ep.errorRate > 1
                              ? 'text-yellow-500'
                              : 'text-green-500'
                        }
                      >
                        {formatPercent(ep.errorRate)}
                      </span>
                    </td>
                    <td className="text-right px-4 py-2 text-muted-foreground">
                      {formatTimestamp(ep.lastSeen)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const percent = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {formatNumber(count)} ({percent.toFixed(1)}%)
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function LatencyBar({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const percent = max > 0 ? (value / max) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span className="font-mono">{formatDuration(value)}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
