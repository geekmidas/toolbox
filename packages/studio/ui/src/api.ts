import type {
  EndpointMetrics,
  ExceptionEntry,
  FilterConfig,
  LogEntry,
  QueryResult,
  RequestEntry,
  RequestMetrics,
  SchemaInfo,
  SortConfig,
  StatusDistribution,
  StudioStats,
  TableInfo,
  TableSummary,
} from './types';

const BASE_URL = '/__studio';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

// ============================================================================
// Database API
// ============================================================================

export async function getSchema(refresh = false): Promise<SchemaInfo> {
  const url = refresh ? '/api/schema?refresh=true' : '/api/schema';
  return fetchJson(url);
}

export async function getTables(): Promise<{ tables: TableSummary[] }> {
  return fetchJson('/api/tables');
}

export async function getTableInfo(tableName: string): Promise<TableInfo> {
  return fetchJson(`/api/tables/${encodeURIComponent(tableName)}`);
}

export interface QueryOptions {
  pageSize?: number;
  cursor?: string;
  filters?: FilterConfig[];
  sort?: SortConfig[];
}

export async function queryTable(
  tableName: string,
  options: QueryOptions = {},
): Promise<QueryResult> {
  const params = new URLSearchParams();

  if (options.pageSize) {
    params.set('pageSize', String(options.pageSize));
  }

  if (options.cursor) {
    params.set('cursor', options.cursor);
  }

  if (options.filters) {
    for (const filter of options.filters) {
      params.set(`filter[${filter.column}][${filter.operator}]`, filter.value);
    }
  }

  if (options.sort && options.sort.length > 0) {
    const sortStr = options.sort
      .map((s) => `${s.column}:${s.direction}`)
      .join(',');
    params.set('sort', sortStr);
  }

  const queryStr = params.toString();
  const url = `/api/tables/${encodeURIComponent(tableName)}/rows${queryStr ? `?${queryStr}` : ''}`;

  return fetchJson(url);
}

// ============================================================================
// Monitoring API (from Telescope)
// ============================================================================

export async function getStats(): Promise<StudioStats> {
  return fetchJson('/api/stats');
}

export interface MonitoringQueryOptions {
  limit?: number;
  search?: string;
  method?: string;
  status?: string;
  level?: string;
}

export async function getRequests(
  options: MonitoringQueryOptions = {},
): Promise<RequestEntry[]> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.search) params.set('search', options.search);
  if (options.method) params.set('method', options.method);
  if (options.status) params.set('status', options.status);

  const queryStr = params.toString();
  return fetchJson(`/api/requests${queryStr ? `?${queryStr}` : ''}`);
}

export async function getRequest(id: string): Promise<RequestEntry> {
  return fetchJson(`/api/requests/${encodeURIComponent(id)}`);
}

export async function getExceptions(
  options: MonitoringQueryOptions = {},
): Promise<ExceptionEntry[]> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.search) params.set('search', options.search);

  const queryStr = params.toString();
  return fetchJson(`/api/exceptions${queryStr ? `?${queryStr}` : ''}`);
}

export async function getException(id: string): Promise<ExceptionEntry> {
  return fetchJson(`/api/exceptions/${encodeURIComponent(id)}`);
}

export async function getLogs(
  options: MonitoringQueryOptions = {},
): Promise<LogEntry[]> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.search) params.set('search', options.search);
  if (options.level) params.set('level', options.level);

  const queryStr = params.toString();
  return fetchJson(`/api/logs${queryStr ? `?${queryStr}` : ''}`);
}

// ============================================================================
// Metrics API
// ============================================================================

export interface MetricsQueryOptions {
  start?: string;
  end?: string;
  bucketSize?: number;
  limit?: number;
}

export async function getMetrics(
  options: MetricsQueryOptions = {},
): Promise<RequestMetrics> {
  const params = new URLSearchParams();
  if (options.start) params.set('start', options.start);
  if (options.end) params.set('end', options.end);
  if (options.bucketSize) params.set('bucketSize', String(options.bucketSize));

  const queryStr = params.toString();
  return fetchJson(`/api/metrics${queryStr ? `?${queryStr}` : ''}`);
}

export async function getEndpointMetrics(
  options: MetricsQueryOptions = {},
): Promise<EndpointMetrics[]> {
  const params = new URLSearchParams();
  if (options.start) params.set('start', options.start);
  if (options.end) params.set('end', options.end);
  if (options.limit) params.set('limit', String(options.limit));

  const queryStr = params.toString();
  return fetchJson(`/api/metrics/endpoints${queryStr ? `?${queryStr}` : ''}`);
}

export async function getStatusDistribution(
  options: MetricsQueryOptions = {},
): Promise<StatusDistribution> {
  const params = new URLSearchParams();
  if (options.start) params.set('start', options.start);
  if (options.end) params.set('end', options.end);

  const queryStr = params.toString();
  return fetchJson(`/api/metrics/status${queryStr ? `?${queryStr}` : ''}`);
}

// ============================================================================
// WebSocket
// ============================================================================

export function createWebSocket(): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}${BASE_URL}/ws`;
  return new WebSocket(wsUrl);
}
