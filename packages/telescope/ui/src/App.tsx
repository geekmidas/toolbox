import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import { ExceptionDetail } from './components/ExceptionDetail';
import {
  type ExceptionFilters,
  FilterBar,
  type LogFilters,
  type RequestFilters,
} from './components/FilterBar';
import { LogDetail } from './components/LogDetail';
import { RequestDetail } from './components/RequestDetail';
import type {
  ExceptionEntry,
  LogEntry,
  RequestEntry,
  Tab,
  TelescopeStats,
  WebSocketMessage,
} from './types';

const DEFAULT_REQUEST_FILTERS: RequestFilters = {
  search: '',
  method: '',
  status: '',
};

const DEFAULT_LOG_FILTERS: LogFilters = {
  search: '',
  level: '',
};

const DEFAULT_EXCEPTION_FILTERS: ExceptionFilters = {
  search: '',
};

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('requests');
  const [stats, setStats] = useState<TelescopeStats | null>(null);
  const [requests, setRequests] = useState<RequestEntry[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionEntry[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<RequestEntry | null>(
    null,
  );
  const [selectedException, setSelectedException] =
    useState<ExceptionEntry | null>(null);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);

  // Filter state
  const [requestFilters, setRequestFilters] = useState<RequestFilters>(
    DEFAULT_REQUEST_FILTERS,
  );
  const [logFilters, setLogFilters] = useState<LogFilters>(DEFAULT_LOG_FILTERS);
  const [exceptionFilters, setExceptionFilters] = useState<ExceptionFilters>(
    DEFAULT_EXCEPTION_FILTERS,
  );

  // Track if we have active filters to show filtered count
  const hasRequestFilters =
    requestFilters.search || requestFilters.method || requestFilters.status;
  const hasLogFilters = logFilters.search || logFilters.level;
  const hasExceptionFilters = exceptionFilters.search;

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load initial data and stats
  const loadInitialData = useCallback(async () => {
    try {
      const [statsData, requestsData, exceptionsData, logsData] =
        await Promise.all([
          api.getStats(),
          api.getRequests({ limit: 100 }),
          api.getExceptions({ limit: 100 }),
          api.getLogs({ limit: 100 }),
        ]);

      setStats(statsData);
      setRequests(requestsData);
      setExceptions(exceptionsData);
      setLogs(logsData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Fetch requests with filters
  const fetchRequests = useCallback(async (filters: RequestFilters) => {
    try {
      const data = await api.getRequests({
        limit: 100,
        search: filters.search || undefined,
        method: filters.method || undefined,
        status: filters.status || undefined,
      });
      setRequests(data);
    } catch (error) {
      console.error('Failed to fetch requests:', error);
    }
  }, []);

  // Fetch logs with filters
  const fetchLogs = useCallback(async (filters: LogFilters) => {
    try {
      const data = await api.getLogs({
        limit: 100,
        search: filters.search || undefined,
        level: filters.level || undefined,
      });
      setLogs(data);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    }
  }, []);

  // Fetch exceptions with filters
  const fetchExceptions = useCallback(async (filters: ExceptionFilters) => {
    try {
      const data = await api.getExceptions({
        limit: 100,
        search: filters.search || undefined,
      });
      setExceptions(data);
    } catch (error) {
      console.error('Failed to fetch exceptions:', error);
    }
  }, []);

  // Handle request filter changes with debounce
  const handleRequestFiltersChange = useCallback(
    (filters: RequestFilters) => {
      setRequestFilters(filters);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        fetchRequests(filters);
      }, 300);
    },
    [fetchRequests],
  );

  // Handle log filter changes with debounce
  const handleLogFiltersChange = useCallback(
    (filters: LogFilters) => {
      setLogFilters(filters);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        fetchLogs(filters);
      }, 300);
    },
    [fetchLogs],
  );

  // Handle exception filter changes with debounce
  const handleExceptionFiltersChange = useCallback(
    (filters: ExceptionFilters) => {
      setExceptionFilters(filters);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        fetchExceptions(filters);
      }, 300);
    },
    [fetchExceptions],
  );

  // Clear filters and reload
  const clearFilters = useCallback(() => {
    setRequestFilters(DEFAULT_REQUEST_FILTERS);
    setLogFilters(DEFAULT_LOG_FILTERS);
    setExceptionFilters(DEFAULT_EXCEPTION_FILTERS);

    // Reload without filters
    fetchRequests(DEFAULT_REQUEST_FILTERS);
    fetchLogs(DEFAULT_LOG_FILTERS);
    fetchExceptions(DEFAULT_EXCEPTION_FILTERS);
  }, [fetchRequests, fetchLogs, fetchExceptions]);

  // Helper to check if a new WebSocket entry matches current filters
  const matchesRequestFilters = useCallback(
    (request: RequestEntry, filters: RequestFilters) => {
      if (
        filters.search &&
        !request.path.toLowerCase().includes(filters.search.toLowerCase())
      ) {
        return false;
      }
      if (filters.method && request.method !== filters.method) {
        return false;
      }
      if (filters.status) {
        const statusCategory = Math.floor(request.status / 100);
        const filterCategory = parseInt(filters.status[0], 10);
        if (statusCategory !== filterCategory) {
          return false;
        }
      }
      return true;
    },
    [],
  );

  const matchesLogFilters = useCallback(
    (log: LogEntry, filters: LogFilters) => {
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
    },
    [],
  );

  const matchesExceptionFilters = useCallback(
    (exception: ExceptionEntry, filters: ExceptionFilters) => {
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        if (
          !exception.name.toLowerCase().includes(searchLower) &&
          !exception.message.toLowerCase().includes(searchLower)
        ) {
          return false;
        }
      }
      return true;
    },
    [],
  );

  // WebSocket connection for real-time updates
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        ws = api.createWebSocket();

        ws.onopen = () => {
          setConnected(true);
        };

        ws.onclose = () => {
          setConnected(false);
          reconnectTimeout = setTimeout(connect, 3000);
        };

        ws.onerror = () => {
          ws?.close();
        };

        ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);

            switch (message.type) {
              case 'request': {
                const newRequest = message.payload as RequestEntry;
                setStats((prev) =>
                  prev ? { ...prev, requests: prev.requests + 1 } : prev,
                );
                // Only add to list if it matches current filters
                setRequestFilters((currentFilters) => {
                  if (matchesRequestFilters(newRequest, currentFilters)) {
                    setRequests((prev) => [newRequest, ...prev].slice(0, 100));
                  }
                  return currentFilters;
                });
                break;
              }
              case 'exception': {
                const newException = message.payload as ExceptionEntry;
                setStats((prev) =>
                  prev ? { ...prev, exceptions: prev.exceptions + 1 } : prev,
                );
                setExceptionFilters((currentFilters) => {
                  if (matchesExceptionFilters(newException, currentFilters)) {
                    setExceptions((prev) =>
                      [newException, ...prev].slice(0, 100),
                    );
                  }
                  return currentFilters;
                });
                break;
              }
              case 'log': {
                const newLog = message.payload as LogEntry;
                setStats((prev) =>
                  prev ? { ...prev, logs: prev.logs + 1 } : prev,
                );
                setLogFilters((currentFilters) => {
                  if (matchesLogFilters(newLog, currentFilters)) {
                    setLogs((prev) => [newLog, ...prev].slice(0, 100));
                  }
                  return currentFilters;
                });
                break;
              }
            }
          } catch {
            // Ignore parse errors
          }
        };
      } catch {
        reconnectTimeout = setTimeout(connect, 3000);
      }
    }

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      ws?.close();
    };
  }, [matchesRequestFilters, matchesLogFilters, matchesExceptionFilters]);

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const formatDuration = (ms: number) => {
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: 'bg-green-500/20 text-green-400',
      POST: 'bg-blue-500/20 text-blue-400',
      PUT: 'bg-amber-500/20 text-amber-400',
      PATCH: 'bg-purple-500/20 text-purple-400',
      DELETE: 'bg-red-500/20 text-red-400',
    };
    return colors[method] || 'bg-slate-500/20 text-slate-400';
  };

  const getStatusColor = (status: number) => {
    if (status >= 500) return 'bg-red-500/20 text-red-400';
    if (status >= 400) return 'bg-amber-500/20 text-amber-400';
    if (status >= 300) return 'bg-blue-500/20 text-blue-400';
    return 'bg-green-500/20 text-green-400';
  };

  const getLogLevelColor = (level: string) => {
    const colors: Record<string, string> = {
      debug: 'bg-slate-500/20 text-slate-400',
      info: 'bg-blue-500/20 text-blue-400',
      warn: 'bg-amber-500/20 text-amber-400',
      error: 'bg-red-500/20 text-red-400',
    };
    return colors[level] || 'bg-slate-500/20 text-slate-400';
  };

  const closeDetail = () => {
    setSelectedRequest(null);
    setSelectedException(null);
    setSelectedLog(null);
  };

  return (
    <div className="flex flex-col min-h-screen bg-bg-primary font-mono text-slate-100">
      {/* Header */}
      <header className="bg-bg-secondary border-b border-border px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <span className="text-blue-400">&#128301;</span> Telescope
        </h1>
        <div className="flex items-center gap-6">
          {stats && (
            <>
              <div className="text-sm text-slate-400">
                <span className="font-semibold text-slate-100">
                  {stats.requests}
                </span>{' '}
                requests
              </div>
              <div className="text-sm text-slate-400">
                <span className="font-semibold text-slate-100">
                  {stats.exceptions}
                </span>{' '}
                exceptions
              </div>
              <div className="text-sm text-slate-400">
                <span className="font-semibold text-slate-100">
                  {stats.logs}
                </span>{' '}
                logs
              </div>
            </>
          )}
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span
              className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
            />
            {connected ? 'Live' : 'Disconnected'}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col">
        {/* Tabs */}
        <div className="flex bg-bg-secondary border-b border-border">
          {(['requests', 'exceptions', 'logs'] as Tab[]).map((tab) => (
            <button
              key={tab}
              className={`px-6 py-3 text-sm capitalize border-b-2 transition-colors ${
                activeTab === tab
                  ? 'text-blue-400 border-blue-400'
                  : 'text-slate-400 border-transparent hover:text-slate-100 hover:bg-bg-tertiary'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
              {tab === 'requests' && hasRequestFilters && (
                <span className="ml-2 text-xs text-slate-500">
                  ({requests.length})
                </span>
              )}
              {tab === 'logs' && hasLogFilters && (
                <span className="ml-2 text-xs text-slate-500">
                  ({logs.length})
                </span>
              )}
              {tab === 'exceptions' && hasExceptionFilters && (
                <span className="ml-2 text-xs text-slate-500">
                  ({exceptions.length})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Filter Bar */}
        <FilterBar
          tab={activeTab}
          requestFilters={requestFilters}
          logFilters={logFilters}
          exceptionFilters={exceptionFilters}
          onRequestFiltersChange={handleRequestFiltersChange}
          onLogFiltersChange={handleLogFiltersChange}
          onExceptionFiltersChange={handleExceptionFiltersChange}
          onClear={clearFilters}
        />

        {/* Content */}
        <div className="flex-1 p-4 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-500">
              Loading...
            </div>
          ) : activeTab === 'requests' ? (
            requests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-center">
                <h3 className="text-lg mb-2">
                  {hasRequestFilters
                    ? 'No matching requests'
                    : 'No requests yet'}
                </h3>
                <p className="text-sm">
                  {hasRequestFilters
                    ? 'Try adjusting your filters.'
                    : 'Requests will appear here as they are captured.'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {requests.map((request) => (
                  <div
                    key={request.id}
                    className="bg-bg-secondary border border-border rounded-lg p-4 cursor-pointer transition-colors hover:border-blue-500 hover:bg-bg-tertiary flex items-center gap-4"
                    onClick={() => setSelectedRequest(request)}
                  >
                    <span
                      className={`font-semibold px-2 py-1 rounded text-xs min-w-16 text-center ${getMethodColor(request.method)}`}
                    >
                      {request.method}
                    </span>
                    <span className="flex-1 truncate">{request.path}</span>
                    <span
                      className={`text-sm px-2 py-1 rounded ${getStatusColor(request.status)}`}
                    >
                      {request.status}
                    </span>
                    <span className="text-xs text-slate-500 min-w-16 text-right">
                      {formatDuration(request.duration)}
                    </span>
                    <span className="text-xs text-slate-500 min-w-20 text-right">
                      {formatTime(request.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )
          ) : activeTab === 'exceptions' ? (
            exceptions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-center">
                <h3 className="text-lg mb-2">
                  {hasExceptionFilters
                    ? 'No matching exceptions'
                    : 'No exceptions'}
                </h3>
                <p className="text-sm">
                  {hasExceptionFilters
                    ? 'Try adjusting your filters.'
                    : 'Exceptions will appear here when they occur.'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {exceptions.map((exception) => (
                  <div
                    key={exception.id}
                    className="bg-bg-secondary border border-border rounded-lg p-4 cursor-pointer transition-colors hover:border-blue-500 hover:bg-bg-tertiary"
                    onClick={() => setSelectedException(exception)}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-semibold text-red-400">
                        {exception.name}
                      </span>
                      <span className="text-xs text-slate-500">
                        {formatTime(exception.timestamp)}
                      </span>
                    </div>
                    <span className="text-sm text-slate-400 truncate block">
                      {exception.message}
                    </span>
                  </div>
                ))}
              </div>
            )
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-center">
              <h3 className="text-lg mb-2">
                {hasLogFilters ? 'No matching logs' : 'No logs yet'}
              </h3>
              <p className="text-sm">
                {hasLogFilters
                  ? 'Try adjusting your filters.'
                  : 'Log entries will appear here as they are recorded.'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="bg-bg-secondary border border-border rounded-lg p-4 cursor-pointer transition-colors hover:border-blue-500 hover:bg-bg-tertiary flex items-start gap-4"
                  onClick={() => setSelectedLog(log)}
                >
                  <span
                    className={`font-semibold px-2 py-1 rounded text-xs min-w-14 text-center ${getLogLevelColor(log.level)}`}
                  >
                    {log.level}
                  </span>
                  <span className="flex-1 wrap-break-word">{log.message}</span>
                  <span className="text-xs text-slate-500 min-w-20 text-right">
                    {formatTime(log.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Detail Panels */}
      {selectedRequest && (
        <RequestDetail request={selectedRequest} onClose={closeDetail} />
      )}

      {selectedException && (
        <ExceptionDetail exception={selectedException} onClose={closeDetail} />
      )}

      {selectedLog && <LogDetail log={selectedLog} onClose={closeDetail} />}
    </div>
  );
}
