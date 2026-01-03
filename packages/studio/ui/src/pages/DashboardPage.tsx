import { MetricCard, SparkBar } from '@geekmidas/ui';
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Database,
  FileText,
  Network,
} from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useStudio } from '../providers/StudioProvider';

export function DashboardPage() {
  const { stats, requests, exceptions, loading } = useStudio();

  // Calculate metrics from recent data
  const metrics = useMemo(() => {
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

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Requests"
          value={stats?.requests ?? 0}
          icon={<Network className="h-4 w-4" />}
          sparklineData={metrics.requestsPerMinute}
          description="last 60s"
        />

        <MetricCard
          title="Avg Duration"
          value={`${Math.round(metrics.avgDuration)}ms`}
          icon={<Clock className="h-4 w-4" />}
        />

        <MetricCard
          title="Error Rate"
          value={`${metrics.errorRate.toFixed(1)}%`}
          icon={<AlertTriangle className="h-4 w-4" />}
          trend={metrics.errorRate > 5 ? 'up' : 'neutral'}
          trendValue={metrics.errorRate > 5 ? 'High' : undefined}
        />

        <MetricCard
          title="Exceptions"
          value={stats?.exceptions ?? 0}
          icon={<AlertTriangle className="h-4 w-4" />}
          trend={(stats?.exceptions ?? 0) > 0 ? 'up' : 'neutral'}
        />
      </div>

      {/* Activity Chart */}
      {metrics.requestsPerMinute.length > 0 && (
        <div className="p-4 bg-surface rounded-lg border border-border">
          <h3 className="text-sm font-medium mb-3">Request Activity (last 60s)</h3>
          <SparkBar
            data={metrics.requestsPerMinute}
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
