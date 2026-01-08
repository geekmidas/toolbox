import type { TelescopeStorage } from '@geekmidas/telescope';
import type { Kysely } from 'kysely';

// ============================================
// Enums
// ============================================

/**
 * Sort direction for cursor-based pagination and sorting.
 */
export enum Direction {
	Asc = 'asc',
	Desc = 'desc',
}

/**
 * Filter operators for querying data.
 */
export enum FilterOperator {
	Eq = 'eq',
	Neq = 'neq',
	Gt = 'gt',
	Gte = 'gte',
	Lt = 'lt',
	Lte = 'lte',
	Like = 'like',
	Ilike = 'ilike',
	In = 'in',
	Nin = 'nin',
	IsNull = 'is_null',
	IsNotNull = 'is_not_null',
}

// ============================================
// Cursor Configuration
// ============================================

/**
 * Configuration for cursor-based pagination.
 */
export interface CursorConfig {
	/** The field to use for cursor-based pagination (e.g., 'id', 'created_at') */
	field: string;
	/** Sort direction for the cursor field */
	direction: Direction;
}

/**
 * Per-table cursor configuration overrides.
 */
export interface TableCursorConfig {
	[tableName: string]: CursorConfig;
}

// ============================================
// Monitoring Configuration
// ============================================

/**
 * Configuration for the monitoring feature (Telescope).
 */
export interface MonitoringOptions {
	/** Storage backend for monitoring data */
	storage: TelescopeStorage;
	/** Patterns to ignore when recording requests (supports wildcards) */
	ignorePatterns?: string[];
	/** Whether to record request/response bodies (default: true) */
	recordBody?: boolean;
	/** Maximum body size to record in bytes (default: 64KB) */
	maxBodySize?: number;
	/** Hours after which to prune old entries */
	pruneAfterHours?: number;
}

// ============================================
// Data Browser Configuration
// ============================================

/**
 * Configuration for the data browser feature.
 */
export interface DataBrowserOptions<DB = unknown> {
	/** Kysely database instance */
	db: Kysely<DB>;
	/** Default cursor configuration for all tables */
	cursor: CursorConfig;
	/** Per-table cursor overrides */
	tableCursors?: TableCursorConfig;
	/** Tables to exclude from browsing */
	excludeTables?: string[];
	/** Maximum rows per page (default: 50, max: 100) */
	defaultPageSize?: number;
	/** Whether to allow viewing of binary/blob columns (default: false) */
	showBinaryColumns?: boolean;
}

// ============================================
// Studio Configuration
// ============================================

/**
 * Configuration for the Studio dashboard.
 */
export interface StudioOptions<DB = unknown> {
	/** Monitoring configuration */
	monitoring: MonitoringOptions;
	/** Data browser configuration */
	data: DataBrowserOptions<DB>;
	/** Dashboard path (default: '/__studio') */
	path?: string;
	/** Whether Studio is enabled (default: true) */
	enabled?: boolean;
}

/**
 * Normalized Studio options with all defaults applied.
 */
export interface NormalizedStudioOptions<DB = unknown> {
	monitoring: Required<MonitoringOptions>;
	data: Required<DataBrowserOptions<DB>>;
	path: string;
	enabled: boolean;
}

// ============================================
// Table Introspection Types
// ============================================

/**
 * Generic column type classification.
 */
export type ColumnType =
	| 'string'
	| 'number'
	| 'boolean'
	| 'date'
	| 'datetime'
	| 'json'
	| 'binary'
	| 'uuid'
	| 'unknown';

/**
 * Information about a database column.
 */
export interface ColumnInfo {
	/** Column name */
	name: string;
	/** Generic column type */
	type: ColumnType;
	/** Raw database type (e.g., 'varchar', 'int4') */
	rawType: string;
	/** Whether the column allows NULL values */
	nullable: boolean;
	/** Whether this column is part of the primary key */
	isPrimaryKey: boolean;
	/** Whether this column is a foreign key */
	isForeignKey: boolean;
	/** Referenced table if foreign key */
	foreignKeyTable?: string;
	/** Referenced column if foreign key */
	foreignKeyColumn?: string;
	/** Default value expression */
	defaultValue?: string;
}

/**
 * Information about a database table.
 */
export interface TableInfo {
	/** Table name */
	name: string;
	/** Schema name (e.g., 'public') */
	schema: string;
	/** List of columns */
	columns: ColumnInfo[];
	/** Primary key column names */
	primaryKey: string[];
	/** Estimated row count (if available) */
	estimatedRowCount?: number;
}

/**
 * Complete schema information.
 */
export interface SchemaInfo {
	/** List of tables */
	tables: TableInfo[];
	/** When the schema was last introspected */
	updatedAt: Date;
}

// ============================================
// Query Types
// ============================================

/**
 * A single filter condition.
 */
export interface FilterCondition {
	/** Column to filter on */
	column: string;
	/** Filter operator */
	operator: FilterOperator;
	/** Value to compare against (optional for IsNull/IsNotNull operators) */
	value?: unknown;
}

/**
 * Sort configuration for a column.
 */
export interface SortConfig {
	/** Column to sort by */
	column: string;
	/** Sort direction */
	direction: Direction;
}

/**
 * Options for querying table data.
 */
export interface QueryOptions {
	/** Table to query */
	table: string;
	/** Filter conditions */
	filters?: FilterCondition[];
	/** Sort configuration */
	sort?: SortConfig[];
	/** Cursor for pagination */
	cursor?: string | null;
	/** Number of rows per page */
	pageSize?: number;
	/** Pagination direction */
	direction?: 'next' | 'prev';
}

/**
 * Result of a paginated query.
 */
export interface QueryResult<T = Record<string, unknown>> {
	/** Retrieved rows */
	rows: T[];
	/** Whether there are more rows */
	hasMore: boolean;
	/** Cursor for next page */
	nextCursor: string | null;
	/** Cursor for previous page */
	prevCursor: string | null;
	/** Estimated total row count */
	totalEstimate?: number;
}

// ============================================
// WebSocket Events
// ============================================

/**
 * Types of events broadcast via WebSocket.
 */
export type StudioEventType =
	| 'request'
	| 'exception'
	| 'log'
	| 'stats'
	| 'connected'
	| 'schema_updated';

/**
 * A WebSocket event payload.
 */
export interface StudioEvent<T = unknown> {
	/** Event type */
	type: StudioEventType;
	/** Event payload */
	payload: T;
	/** Event timestamp */
	timestamp: number;
}
