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
