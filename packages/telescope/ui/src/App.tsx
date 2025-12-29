import { useCallback, useEffect, useState } from 'react';
import * as api from './api';
import { ExceptionDetail } from './components/ExceptionDetail';
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

  const loadData = useCallback(async () => {
    try {
      const [statsData, requestsData, exceptionsData, logsData] =
        await Promise.all([
          api.getStats(),
          api.getRequests({ limit: 50 }),
          api.getExceptions({ limit: 50 }),
          api.getLogs({ limit: 50 }),
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
    loadData();
  }, [loadData]);

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
              case 'request':
                setRequests((prev) =>
                  [message.payload as RequestEntry, ...prev].slice(0, 100),
                );
                setStats((prev) =>
                  prev ? { ...prev, requests: prev.requests + 1 } : prev,
                );
                break;
              case 'exception':
                setExceptions((prev) =>
                  [message.payload as ExceptionEntry, ...prev].slice(0, 100),
                );
                setStats((prev) =>
                  prev ? { ...prev, exceptions: prev.exceptions + 1 } : prev,
                );
                break;
              case 'log':
                setLogs((prev) =>
                  [message.payload as LogEntry, ...prev].slice(0, 100),
                );
                setStats((prev) =>
                  prev ? { ...prev, logs: prev.logs + 1 } : prev,
                );
                break;
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
  }, []);

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
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 p-4 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-500">
              Loading...
            </div>
          ) : activeTab === 'requests' ? (
            requests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-center">
                <h3 className="text-lg mb-2">No requests yet</h3>
                <p className="text-sm">
                  Requests will appear here as they are captured.
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
                <h3 className="text-lg mb-2">No exceptions</h3>
                <p className="text-sm">
                  Exceptions will appear here when they occur.
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
              <h3 className="text-lg mb-2">No logs yet</h3>
              <p className="text-sm">
                Log entries will appear here as they are recorded.
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
