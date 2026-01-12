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
	/** Request body size in bytes */
	requestSize?: number;
	/** Response body size in bytes */
	responseSize?: number;
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
	/**
	 * Custom request ID getter for correlation with request context.
	 * If provided and returns a string, uses that ID instead of generating one.
	 * Useful for integrating with ServiceContext.getRequestId() from @geekmidas/services.
	 *
	 * @example
	 * // Integration with request context
	 * import { serviceContext } from '@geekmidas/services';
	 *
	 * const telescope = new Telescope({
	 *   storage: new InMemoryStorage(),
	 *   getRequestId: () => serviceContext.hasContext()
	 *     ? serviceContext.getRequestId()
	 *     : undefined,
	 * });
	 */
	getRequestId?: () => string | undefined;
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
	getRequestId?: () => string | undefined;
}

/**
 * WebSocket event types
 */
export type TelescopeEventType =
	| 'request'
	| 'exception'
	| 'log'
	| 'stats'
	| 'metrics'
	| 'connected';

/**
 * Real-time metrics snapshot for WebSocket broadcast
 */
export interface MetricsSnapshot {
	/** Timestamp of the snapshot */
	timestamp: number;
	/** Total requests in the time window */
	totalRequests: number;
	/** Requests per second */
	requestsPerSecond: number;
	/** Average duration in milliseconds */
	avgDuration: number;
	/** Error rate as percentage */
	errorRate: number;
	/** 50th percentile duration */
	p50: number;
	/** 95th percentile duration */
	p95: number;
	/** 99th percentile duration */
	p99: number;
	/** Status code distribution */
	statusDistribution: StatusDistribution;
}

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

// ============================================
// Metrics Types
// ============================================

/**
 * Time range for metrics queries
 */
export interface TimeRange {
	/** Start of time range */
	start: Date;
	/** End of time range */
	end: Date;
}

/**
 * A single point in a time series
 */
export interface TimeSeriesPoint {
	/** Unix timestamp in milliseconds */
	timestamp: number;
	/** Number of requests in this bucket */
	count: number;
	/** Average duration in milliseconds */
	avgDuration: number;
	/** Number of errors (4xx + 5xx) */
	errorCount: number;
}

/**
 * Aggregated request metrics
 */
export interface RequestMetrics {
	/** Total number of requests */
	totalRequests: number;
	/** Average duration in milliseconds */
	avgDuration: number;
	/** 50th percentile duration */
	p50Duration: number;
	/** 95th percentile duration */
	p95Duration: number;
	/** 99th percentile duration */
	p99Duration: number;
	/** Error rate as percentage (0-100) */
	errorRate: number;
	/** Success rate as percentage (0-100) */
	successRate: number;
	/** Requests per second (averaged over time range) */
	requestsPerSecond: number;
	/** Time series data for charts */
	timeSeries: TimeSeriesPoint[];
}

/**
 * Metrics for a specific endpoint (method + path pattern)
 */
export interface EndpointMetrics {
	/** HTTP method */
	method: string;
	/** Path pattern (e.g., /users/:id) */
	path: string;
	/** Total request count */
	count: number;
	/** Average duration in milliseconds */
	avgDuration: number;
	/** 95th percentile duration */
	p95Duration: number;
	/** Error rate as percentage */
	errorRate: number;
	/** Timestamp of last request */
	lastSeen: number;
}

/**
 * Status code distribution
 */
export interface StatusDistribution {
	/** 2xx responses */
	'2xx': number;
	/** 3xx responses */
	'3xx': number;
	/** 4xx responses */
	'4xx': number;
	/** 5xx responses */
	'5xx': number;
}

/**
 * Options for querying metrics
 */
export interface MetricsQueryOptions {
	/** Time range for the query */
	range?: TimeRange;
	/** Bucket size for time series in milliseconds (default: 60000 = 1 minute) */
	bucketSize?: number;
	/** Limit number of endpoints returned */
	limit?: number;
}

/**
 * A metrics bucket for aggregation (stored in memory/db)
 */
export interface MetricsBucket {
	/** Bucket timestamp (start of bucket) */
	timestamp: number;
	/** Bucket duration in milliseconds */
	bucketSize: number;
	/** Request count */
	count: number;
	/** Sum of durations (for calculating avg) */
	durationSum: number;
	/** Min duration */
	durationMin: number;
	/** Max duration */
	durationMax: number;
	/** Duration samples for percentile calculation */
	durationSamples: number[];
	/** Error count (4xx + 5xx) */
	errorCount: number;
	/** Status distribution */
	statusDistribution: StatusDistribution;
}

/**
 * Endpoint-specific metrics bucket
 */
export interface EndpointBucket {
	/** HTTP method */
	method: string;
	/** Path pattern */
	path: string;
	/** Request count */
	count: number;
	/** Sum of durations */
	durationSum: number;
	/** Duration samples for percentiles */
	durationSamples: number[];
	/** Error count */
	errorCount: number;
	/** Last seen timestamp */
	lastSeen: number;
}

/**
 * Detailed metrics for a specific endpoint
 */
export interface EndpointDetails {
	/** HTTP method */
	method: string;
	/** Path pattern */
	path: string;
	/** Total request count */
	count: number;
	/** Average duration in milliseconds */
	avgDuration: number;
	/** 50th percentile duration */
	p50Duration: number;
	/** 95th percentile duration */
	p95Duration: number;
	/** 99th percentile duration */
	p99Duration: number;
	/** Error rate as percentage */
	errorRate: number;
	/** Success rate as percentage */
	successRate: number;
	/** Timestamp of last request */
	lastSeen: number;
	/** Status distribution */
	statusDistribution: StatusDistribution;
	/** Time series data for this endpoint */
	timeSeries: TimeSeriesPoint[];
}
