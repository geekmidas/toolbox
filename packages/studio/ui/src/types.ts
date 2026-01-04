// ============================================================================
// Database Types
// ============================================================================

export interface ColumnInfo {
  name: string;
  type: string;
  rawType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  foreignKeyTable?: string;
  foreignKeyColumn?: string;
  defaultValue?: string;
}

export interface TableInfo {
  name: string;
  schema: string;
  columns: ColumnInfo[];
  primaryKey: string[];
  estimatedRowCount?: number;
}

export interface TableSummary {
  name: string;
  schema: string;
  columnCount: number;
  primaryKey: string[];
  estimatedRowCount?: number;
}

export interface SchemaInfo {
  tables: TableInfo[];
  updatedAt: string;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  hasMore: boolean;
  nextCursor: string | null;
  prevCursor: string | null;
}

export interface FilterConfig {
  column: string;
  operator: string;
  value: string;
}

export interface SortConfig {
  column: string;
  direction: 'asc' | 'desc';
}

// ============================================================================
// Monitoring Types (from Telescope)
// ============================================================================

export interface RequestEntry {
  id: string;
  method: string;
  path: string;
  status: number;
  duration: number;
  timestamp: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  ip?: string;
  userAgent?: string;
}

export interface ExceptionEntry {
  id: string;
  name: string;
  message: string;
  stack: string;
  timestamp: string;
  context?: Record<string, unknown>;
  request?: {
    method: string;
    path: string;
  };
}

export interface LogEntry {
  id: string;
  level: string;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  requestId?: string;
}

export interface StudioStats {
  requests: number;
  exceptions: number;
  logs: number;
}

export type WebSocketMessage =
  | { type: 'request'; payload: RequestEntry }
  | { type: 'exception'; payload: ExceptionEntry }
  | { type: 'log'; payload: LogEntry }
  | { type: 'metrics'; payload: MetricsSnapshot };

// ============================================================================
// Metrics Types
// ============================================================================

export interface TimeSeriesPoint {
  timestamp: number;
  count: number;
  avgDuration: number;
  errorCount: number;
}

export interface RequestMetrics {
  totalRequests: number;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
  errorRate: number;
  successRate: number;
  requestsPerSecond: number;
  timeSeries: TimeSeriesPoint[];
}

export interface EndpointMetrics {
  method: string;
  path: string;
  count: number;
  avgDuration: number;
  p95Duration: number;
  errorRate: number;
  lastSeen: number;
}

export interface EndpointDetails {
  method: string;
  path: string;
  count: number;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
  errorRate: number;
  successRate: number;
  lastSeen: number;
  statusDistribution: StatusDistribution;
  timeSeries: TimeSeriesPoint[];
}

export interface StatusDistribution {
  '2xx': number;
  '3xx': number;
  '4xx': number;
  '5xx': number;
}

export interface MetricsSnapshot {
  timestamp: number;
  totalRequests: number;
  requestsPerSecond: number;
  avgDuration: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  statusDistribution: StatusDistribution;
}
