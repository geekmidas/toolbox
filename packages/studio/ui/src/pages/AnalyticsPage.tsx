import {
  AreaTimeSeriesChart,
  Badge,
  BarListChart,
  createTimeRange,
  LatencyPercentilesChart,
  MetricCard,
  StatusDistributionChart,
  TimeRangeSelector,
  type TimeRange,
} from '@geekmidas/ui';
import { useCallback, useEffect, useState } from 'react';
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
): 'default' | 'success' | 'warning' | 'destructive' {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'success';
    case 'POST':
      return 'default';
    case 'PUT':
    case 'PATCH':
      return 'warning';
    case 'DELETE':
      return 'destructive';
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
  const [timeRange, setTimeRange] = useState<TimeRange>(() =>
    createTimeRange('1h'),
  );

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const timeRangeParams = {
        start: timeRange.start.toISOString(),
        end: timeRange.end.toISOString(),
      };
      const [metricsData, endpointsData, statusData] = await Promise.all([
        getMetrics(timeRangeParams),
        getEndpointMetrics({ limit: 10, ...timeRangeParams }),
        getStatusDistribution(timeRangeParams),
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
  }, [timeRange.start, timeRange.end]);

  useEffect(() => {
    fetchData();

    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

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


  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Request metrics and performance insights
          </p>
        </div>
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
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

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Distribution */}
        <div className="bg-card rounded-lg border p-4">
          <h2 className="text-sm font-medium mb-4">Status Distribution</h2>
          {statusDist ? (
            <StatusDistributionChart data={statusDist} />
          ) : (
            <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
              No requests recorded yet
            </div>
          )}
        </div>

        {/* Latency Percentiles */}
        <div className="bg-card rounded-lg border p-4">
          <h2 className="text-sm font-medium mb-4">Latency Percentiles</h2>
          {metrics ? (
            <LatencyPercentilesChart
              p50={metrics.p50Duration}
              p95={metrics.p95Duration}
              p99={metrics.p99Duration}
            />
          ) : (
            <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
              No requests recorded yet
            </div>
          )}
        </div>
      </div>

      {/* Request Volume Time Series */}
      <div className="bg-card rounded-lg border p-4">
        <h2 className="text-sm font-medium mb-4">Request Volume</h2>
        <AreaTimeSeriesChart
          data={(metrics?.timeSeries ?? []).map((p) => ({
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

      {/* Top Endpoints - Chart View */}
      <div className="bg-card rounded-lg border p-4">
        <h2 className="text-sm font-medium mb-4">Top Endpoints by Request Count</h2>
        <BarListChart
          data={endpoints.map((ep) => ({
            name: `${ep.method} ${ep.path}`,
            value: ep.count,
          }))}
          emptyMessage="No endpoints recorded yet"
        />
      </div>

      {/* Top Endpoints - Table View */}
      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h2 className="text-sm font-medium">Endpoint Details</h2>
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
                        <Badge variant={getMethodColor(ep.method)}>
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
