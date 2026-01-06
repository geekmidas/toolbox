import {
  AreaTimeSeriesChart,
  Badge,
  LatencyPercentilesChart,
  MetricCard,
  StatusDistributionChart,
  TimeRangeSelector,
  createTimeRange,
  type TimeRange,
} from '@geekmidas/ui';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getEndpointDetails, getRequests } from '../api';
import type { EndpointDetails, RequestEntry } from '../types';

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

function formatTimestamp(ts: number | string): string {
  return new Date(ts).toLocaleString();
}

function getMethodVariant(
  method: string,
): 'get' | 'post' | 'put' | 'patch' | 'delete' | 'default' {
  const m = method.toLowerCase();
  if (m === 'get' || m === 'post' || m === 'put' || m === 'patch' || m === 'delete') {
    return m;
  }
  return 'default';
}

function getStatusColor(status: number): string {
  if (status >= 200 && status < 300) return 'text-green-500';
  if (status >= 300 && status < 400) return 'text-blue-500';
  if (status >= 400 && status < 500) return 'text-amber-500';
  return 'text-red-500';
}

export function EndpointDetailsPage() {
  const [searchParams] = useSearchParams();
  const method = searchParams.get('method') ?? '';
  const path = searchParams.get('path') ?? '';

  const [details, setDetails] = useState<EndpointDetails | null>(null);
  const [recentRequests, setRecentRequests] = useState<RequestEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>(() =>
    createTimeRange('1h'),
  );

  const fetchData = useCallback(async () => {
    if (!method || !path) {
      setError('Missing method or path');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const timeRangeParams = {
        start: timeRange.start.toISOString(),
        end: timeRange.end.toISOString(),
      };

      const [detailsData, requestsData] = await Promise.all([
        getEndpointDetails(method, path, timeRangeParams),
        getRequests({ method, search: path, limit: 20 }),
      ]);

      setDetails(detailsData);
      setRecentRequests(requestsData);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load endpoint details',
      );
    } finally {
      setLoading(false);
    }
  }, [method, path, timeRange.start, timeRange.end]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!method || !path) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Missing endpoint method or path
      </div>
    );
  }

  if (loading && !details) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Loading endpoint details...
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            to="/performance"
            className="p-2 rounded-md hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <Badge variant={getMethodVariant(method)}>{method}</Badge>
              <h1 className="text-xl font-semibold font-mono">{path}</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Last seen: {details ? formatTimestamp(details.lastSeen) : 'N/A'}
            </p>
          </div>
        </div>
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      </div>

      {details && (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              title="Total Requests"
              value={formatNumber(details.count)}
              trend="neutral"
            />
            <MetricCard
              title="Avg Duration"
              value={formatDuration(details.avgDuration)}
              trend="neutral"
              trendValue={`p95: ${formatDuration(details.p95Duration)}`}
            />
            <MetricCard
              title="Success Rate"
              value={formatPercent(details.successRate)}
              trend={
                details.successRate >= 99
                  ? 'up'
                  : details.successRate >= 95
                    ? 'neutral'
                    : 'down'
              }
            />
            <MetricCard
              title="Error Rate"
              value={formatPercent(details.errorRate)}
              trend={
                details.errorRate <= 1
                  ? 'up'
                  : details.errorRate <= 5
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
              <StatusDistributionChart data={details.statusDistribution} />
            </div>

            {/* Latency Percentiles */}
            <div className="bg-card rounded-lg border p-4">
              <h2 className="text-sm font-medium mb-4">Latency Percentiles</h2>
              <LatencyPercentilesChart
                p50={details.p50Duration}
                p95={details.p95Duration}
                p99={details.p99Duration}
              />
            </div>
          </div>

          {/* Request Volume Time Series */}
          <div className="bg-card rounded-lg border p-4">
            <h2 className="text-sm font-medium mb-4">Request Volume</h2>
            <AreaTimeSeriesChart
              data={details.timeSeries.map((p) => ({
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
        </>
      )}

      {/* Recent Requests */}
      <div className="bg-card rounded-lg border">
        <div className="p-4 border-b">
          <h2 className="text-sm font-medium">Recent Requests</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Duration</th>
                <th className="text-left px-4 py-2 font-medium">Timestamp</th>
                <th className="text-left px-4 py-2 font-medium">ID</th>
              </tr>
            </thead>
            <tbody>
              {recentRequests.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No recent requests
                  </td>
                </tr>
              ) : (
                recentRequests.map((req) => (
                  <tr key={req.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <span className={getStatusColor(req.status)}>
                        {req.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono">
                      {formatDuration(req.duration)}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {formatTimestamp(req.timestamp)}
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        to={`/monitoring/requests/${req.id}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {req.id.slice(0, 8)}...
                      </Link>
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
