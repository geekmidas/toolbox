import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import * as api from '../api';
import type {
  ExceptionEntry,
  LogEntry,
  MetricsSnapshot,
  RequestEntry,
  StudioStats,
  WebSocketMessage,
} from '../types';

interface StudioContextValue {
  // Connection state
  connected: boolean;

  // Stats
  stats: StudioStats | null;

  // Data
  requests: RequestEntry[];
  logs: LogEntry[];
  exceptions: ExceptionEntry[];

  // Real-time metrics from WebSocket
  realtimeMetrics: MetricsSnapshot | null;

  // Loading state
  loading: boolean;

  // Actions
  refresh: () => Promise<void>;
  addRequest: (request: RequestEntry) => void;
  addLog: (log: LogEntry) => void;
  addException: (exception: ExceptionEntry) => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) {
    throw new Error('useStudio must be used within a StudioProvider');
  }
  return context;
}

interface StudioProviderProps {
  children: ReactNode;
}

export function StudioProvider({ children }: StudioProviderProps) {
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState<StudioStats | null>(null);
  const [requests, setRequests] = useState<RequestEntry[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionEntry[]>([]);
  const [realtimeMetrics, setRealtimeMetrics] =
    useState<MetricsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  // Load initial data
  const loadInitialData = useCallback(async () => {
    try {
      setLoading(true);
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

  // Refresh data
  const refresh = useCallback(async () => {
    await loadInitialData();
  }, [loadInitialData]);

  // Add new entries
  const addRequest = useCallback((request: RequestEntry) => {
    setRequests((prev) => [request, ...prev].slice(0, 100));
    setStats((prev) =>
      prev ? { ...prev, requests: prev.requests + 1 } : prev,
    );
  }, []);

  const addLog = useCallback((log: LogEntry) => {
    setLogs((prev) => [log, ...prev].slice(0, 100));
    setStats((prev) => (prev ? { ...prev, logs: prev.logs + 1 } : prev));
  }, []);

  const addException = useCallback((exception: ExceptionEntry) => {
    setExceptions((prev) => [exception, ...prev].slice(0, 100));
    setStats((prev) =>
      prev ? { ...prev, exceptions: prev.exceptions + 1 } : prev,
    );
  }, []);

  // Load data on mount
  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

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
              case 'request':
                addRequest(message.payload as RequestEntry);
                break;
              case 'exception':
                addException(message.payload as ExceptionEntry);
                break;
              case 'log':
                addLog(message.payload as LogEntry);
                break;
              case 'metrics':
                setRealtimeMetrics(message.payload as MetricsSnapshot);
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
  }, [addRequest, addLog, addException]);

  const value: StudioContextValue = {
    connected,
    stats,
    requests,
    logs,
    exceptions,
    realtimeMetrics,
    loading,
    refresh,
    addRequest,
    addLog,
    addException,
  };

  return (
    <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
  );
}
