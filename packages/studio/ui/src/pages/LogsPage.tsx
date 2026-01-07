import { LogLevelBadge, NoResults } from '@geekmidas/ui';
import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import { useStudio } from '../providers/StudioProvider';
import type { LogEntry } from '../types';

interface LogFilters {
  search: string;
  level: string;
}

export function LogsPage() {
  const { logs: realtimeLogs } = useStudio();

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<LogFilters>({
    search: '',
    level: '',
  });

  // Merge realtime logs with fetched logs
  useEffect(() => {
    setLogs((prev) => {
      const existingIds = new Set(prev.map((l) => l.id));
      const newLogs = realtimeLogs.filter((l) => !existingIds.has(l.id));
      if (newLogs.length > 0) {
        return [...newLogs, ...prev].slice(0, 100);
      }
      return prev;
    });
  }, [realtimeLogs]);

  // Load logs
  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getLogs({
        limit: 100,
        search: filters.search || undefined,
        level: filters.level || undefined,
      });
      setLogs(data);
    } catch (error) {
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Filter logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (
        filters.search &&
        !log.message.toLowerCase().includes(filters.search.toLowerCase())
      ) {
        return false;
      }
      if (filters.level && log.level !== filters.level) {
        return false;
      }
      return true;
    });
  }, [logs, filters]);

  const hasFilters = filters.search || filters.level;

  const clearFilters = () => {
    setFilters({ search: '', level: '' });
  };

  return (
    <div className="flex h-full">
      {/* Log List */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Filter Bar */}
        <div className="p-4 border-b border-border bg-surface flex items-center gap-4">
          <input
            type="text"
            placeholder="Search logs..."
            value={filters.search}
            onChange={(e) =>
              setFilters((f) => ({ ...f, search: e.target.value }))
            }
            className="flex-1 bg-background border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
          />
          <select
            value={filters.level}
            onChange={(e) =>
              setFilters((f) => ({ ...f, level: e.target.value }))
            }
            className="bg-background border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
          >
            <option value="">All Levels</option>
            <option value="trace">Trace</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
            <option value="fatal">Fatal</option>
          </select>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        {/* Log List */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              Loading...
            </div>
          ) : filteredLogs.length === 0 ? (
            <NoResults
              title={hasFilters ? 'No matching logs' : 'No logs yet'}
              description={
                hasFilters
                  ? 'Try adjusting your filters.'
                  : 'Log entries will appear here as they are recorded.'
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className={`bg-surface border rounded-lg p-4 cursor-pointer transition-colors hover:border-accent/50 flex items-start gap-4 ${
                    selectedLog?.id === log.id
                      ? 'border-accent'
                      : 'border-border'
                  }`}
                  onClick={() => setSelectedLog(log)}
                >
                  <LogLevelBadge level={log.level as any} size="sm" />
                  <span className="flex-1 text-sm break-words">
                    {log.message}
                  </span>
                  <span className="text-xs text-muted-foreground min-w-20 text-right shrink-0">
                    {formatTime(log.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Log Detail Panel */}
      {selectedLog && (
        <LogDetailPanel
          log={selectedLog}
          onClose={() => setSelectedLog(null)}
        />
      )}
    </div>
  );
}

function LogDetailPanel({
  log,
  onClose,
}: {
  log: LogEntry;
  onClose: () => void;
}) {
  return (
    <div className="w-[500px] border-l border-border bg-surface flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <LogLevelBadge level={log.level as any} size="md" />
          <span className="text-sm text-muted-foreground">
            {formatTime(log.timestamp)}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-surface-hover rounded"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div>
          <h4 className="text-sm font-medium mb-2">Message</h4>
          <p className="text-sm bg-background rounded p-3 break-words">
            {log.message}
          </p>
        </div>

        {log.requestId && (
          <div>
            <h4 className="text-sm font-medium mb-2">Request ID</h4>
            <p className="text-sm font-mono bg-background rounded p-3">
              {log.requestId}
            </p>
          </div>
        )}

        {log.context && Object.keys(log.context).length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Context</h4>
            <pre className="bg-background rounded p-3 text-xs overflow-auto max-h-[400px]">
              {JSON.stringify(log.context, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString();
}
