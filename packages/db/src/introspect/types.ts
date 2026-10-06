import type { Kysely } from 'kysely';
import type { Direction } from '../pagination';

/**
 * Filter operators a row query accepts.
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

/**
 * The column a table's rows are paged by, and in which direction.
 */
export interface CursorConfig {
	/** A column whose values are unique and ordered, e.g. `id` or `created_at`. */
	field: string;
	direction: Direction;
}

/**
 * Options for a {@link DataBrowser}.
 */
export interface DataBrowserOptions<DB = unknown> {
	db: Kysely<DB>;
	/**
	 * The schemas to read tables from (default: `['public']`). Every schema the
	 * database has is listed by `listSchemas` regardless; this is which of them
	 * are browsable.
	 */
	schemas?: string[];
	/**
	 * The cursor every table pages by. When omitted, a table pages by its
	 * primary key when that is a single column, ascending — the one ordering
	 * that is unique for any table that has one.
	 */
	cursor?: CursorConfig;
	/** Per-table cursors, by table name, for tables the default does not fit. */
	tableCursors?: Record<string, CursorConfig>;
	/** Tables left out of introspection, by name. */
	excludeTables?: string[];
	/** Rows per page when a query names none (default: 50, at most 100). */
	defaultPageSize?: number;
}

/**
 * A column's type, classified independently of the engine.
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

export interface ColumnInfo {
	name: string;
	type: ColumnType;
	/** The engine's own type name, e.g. `varchar` or `int4`. */
	rawType: string;
	nullable: boolean;
	isPrimaryKey: boolean;
	isForeignKey: boolean;
	/** The table a foreign key references. */
	foreignKeyTable?: string;
	/** The column a foreign key references. */
	foreignKeyColumn?: string;
	/** The default value expression, as the database stores it. */
	defaultValue?: string;
}

export interface TableInfo {
	name: string;
	schema: string;
	columns: ColumnInfo[];
	/** Primary key column names, in key order. */
	primaryKey: string[];
	/** Postgres's planner estimate, when it has one. */
	estimatedRowCount?: number;
}

export interface SchemaInfo {
	tables: TableInfo[];
	/** When the schema was introspected. */
	updatedAt: Date;
}

export interface FilterCondition {
	column: string;
	operator: FilterOperator;
	/** Omitted for `is_null` / `is_not_null`. */
	value?: unknown;
}

export interface SortConfig {
	column: string;
	direction: Direction;
}

export interface QueryOptions {
	table: string;
	/** The schema the table lives in (default: the first browsable schema). */
	schema?: string;
	filters?: FilterCondition[];
	sort?: SortConfig[];
	cursor?: string | null;
	pageSize?: number;
}

export interface QueryResult<T = Record<string, unknown>> {
	rows: T[];
	hasMore: boolean;
	/** Null when there is no next page, or the table has no cursor column. */
	nextCursor: string | null;
	prevCursor: string | null;
}
