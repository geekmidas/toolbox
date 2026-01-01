/**
 * Stack frame from a parsed error stack trace
 */
export interface StackFrame {
  file: string;
  line: number;
  column: number;
  function: string;
  /** Whether this frame is from application code (vs node_modules) */
  isApp: boolean;
}

/**
 * Source code context around an error
 */
export interface SourceContext {
  file: string;
  line: number;
  column: number;
  lines: Array<{ num: number; code: string; highlight: boolean }>;
}

/**
 * Recorded HTTP request entry
 */
export interface RequestEntry {
  id: string;
  method: string;
  path: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
  status: number;
  responseHeaders: Record<string, string>;
  responseBody?: unknown;
  duration: number;
  timestamp: Date;
  ip?: string;
  userId?: string;
  tags?: string[];
}

/**
 * Recorded exception entry
 */
export interface ExceptionEntry {
  id: string;
  name: string;
  message: string;
  stack: StackFrame[];
  source?: SourceContext;
  requestId?: string;
  timestamp: Date;
  handled: boolean;
  tags?: string[];
}

/**
 * Recorded log entry
 */
export interface LogEntry {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
  requestId?: string;
  timestamp: Date;
}

/**
 * Query options for retrieving entries
 */
export interface QueryOptions {
  limit?: number;
  offset?: number;
  before?: Date;
  after?: Date;
  search?: string;
  tags?: string[];
  /** Filter requests by HTTP method */
  method?: string;
  /** Filter requests by status code (e.g., "2xx", "4xx", "500") */
  status?: string;
  /** Filter logs by level */
  level?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Storage interface for Telescope data
 * Implementations can use memory, database, or any other backend
 */
export interface TelescopeStorage {
  // Requests
  saveRequest(entry: RequestEntry): Promise<void>;
  saveRequests?(entries: RequestEntry[]): Promise<void>;
  getRequests(options?: QueryOptions): Promise<RequestEntry[]>;
  getRequest(id: string): Promise<RequestEntry | null>;

  // Exceptions
  saveException(entry: ExceptionEntry): Promise<void>;
  saveExceptions?(entries: ExceptionEntry[]): Promise<void>;
  getExceptions(options?: QueryOptions): Promise<ExceptionEntry[]>;
  getException(id: string): Promise<ExceptionEntry | null>;

  // Logs
  saveLog(entry: LogEntry): Promise<void>;
  saveLogs?(entries: LogEntry[]): Promise<void>;
  getLogs(options?: QueryOptions): Promise<LogEntry[]>;

  // Cleanup
  prune(olderThan: Date): Promise<number>;

  // Stats
  getStats(): Promise<TelescopeStats>;
}

/**
 * Statistics about stored entries
 */
export interface TelescopeStats {
  requests: number;
  exceptions: number;
  logs: number;
  oldestEntry?: Date;
  newestEntry?: Date;
}

/**
 * Redaction configuration for Telescope.
 * Uses @pinojs/redact for immutable, selective redaction.
 */
export type TelescopeRedactOptions =
  | boolean
  | string[]
  | {
      /** Paths to redact using dot/bracket notation (e.g., 'headers.authorization', '*.password') */
      paths: string[];
      /** Replacement value (default: '[REDACTED]') */
      censor?: string;
    };

/**
 * Configuration options for Telescope
 */
export interface TelescopeOptions {
  /** Storage backend for persisting data */
  storage: TelescopeStorage;
  /** Whether telescope is enabled (default: true) */
  enabled?: boolean;
  /** Dashboard path (default: '/__telescope') */
  path?: string;
  /** Whether to record request/response bodies (default: true) */
  recordBody?: boolean;
  /** Maximum body size to record in bytes (default: 64KB) */
  maxBodySize?: number;
  /** URL patterns to ignore (default: []) */
  ignorePatterns?: string[];
  /** Auto-prune entries older than this many hours (default: undefined - no auto-prune) */
  pruneAfterHours?: number;
  /**
   * Redaction configuration for sensitive data.
   * - `true`: Enable redaction with default sensitive paths
   * - `string[]`: Custom paths to redact (merged with defaults)
   * - `{ paths, censor }`: Full control over redaction
   * - `false` or `undefined`: No redaction (default)
   *
   * @example
   * // Enable with defaults
   * redact: true
   *
   * @example
   * // Add custom paths (merged with defaults)
   * redact: ['user.ssn', 'payment.cardNumber']
   *
   * @example
   * // Full control
   * redact: { paths: ['headers.authorization'], censor: '***' }
   */
  redact?: TelescopeRedactOptions;
}

/**
 * Normalized telescope options with defaults applied
 */
export interface NormalizedTelescopeOptions {
  storage: TelescopeStorage;
  enabled: boolean;
  path: string;
  recordBody: boolean;
  maxBodySize: number;
  ignorePatterns: string[];
  pruneAfterHours?: number;
}

/**
 * WebSocket event types
 */
export type TelescopeEventType =
  | 'request'
  | 'exception'
  | 'log'
  | 'stats'
  | 'connected';

/**
 * WebSocket event payload
 */
export interface TelescopeEvent<T = unknown> {
  type: TelescopeEventType;
  payload: T;
  timestamp: number;
}

/**
 * Context stored during request processing
 */
export interface RequestContext {
  id: string;
  startTime: number;
  method: string;
  path: string;
  url: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
  ip?: string;
}
