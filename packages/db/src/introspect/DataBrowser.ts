import type { Kysely, SelectQueryBuilder } from 'kysely';
import { Direction, decodeCursor, encodeCursor } from '../pagination';
import { TableNotFound } from './errors';
import { applyFilters, applySorting } from './filtering';
import { introspectSchema, listSchemas } from './introspection';
import type {
	CursorConfig,
	DataBrowserOptions,
	QueryOptions,
	QueryResult,
	SchemaInfo,
	TableInfo,
} from './types';

/** How long an introspected schema is reused before it is read again. */
const SCHEMA_TTL_MS = 60 * 1000;
const MAX_PAGE_SIZE = 100;

/**
 * Reads a Postgres database's structure and pages through its rows, read-only.
 *
 * @example
 * ```typescript
 * const browser = new DataBrowser({ db });
 *
 * const { tables } = await browser.getSchema();
 * const page = await browser.query({ table: 'users', pageSize: 20 });
 * const next = await browser.query({ table: 'users', cursor: page.nextCursor });
 * ```
 */
export class DataBrowser<DB = unknown> {
	readonly db: Kysely<DB>;
	readonly schemas: string[];
	private readonly cursor?: CursorConfig;
	private readonly tableCursors: Record<string, CursorConfig>;
	private readonly excludeTables: string[];
	private readonly defaultPageSize: number;
	private schemaCache?: { info: SchemaInfo; expires: number };

	constructor(options: DataBrowserOptions<DB>) {
		this.db = options.db;
		this.schemas = options.schemas ?? ['public'];
		this.cursor = options.cursor;
		this.tableCursors = options.tableCursors ?? {};
		this.excludeTables = options.excludeTables ?? [];
		this.defaultPageSize = options.defaultPageSize ?? 50;
	}

	/** Every schema the database has, browsable or not. */
	listSchemas(): Promise<string[]> {
		return listSchemas(this.db);
	}

	/**
	 * The browsable tables. Cached for a minute, since a migration is rare and
	 * introspection is several catalog queries per table.
	 */
	async getSchema(forceRefresh = false): Promise<SchemaInfo> {
		const now = Date.now();
		if (!forceRefresh && this.schemaCache && now < this.schemaCache.expires) {
			return this.schemaCache.info;
		}

		const info = await introspectSchema(this.db, {
			schemas: this.schemas,
			excludeTables: this.excludeTables,
		});
		this.schemaCache = { info, expires: now + SCHEMA_TTL_MS };
		return info;
	}

	/** One table, or null when it is not browsable. */
	async getTableInfo(
		tableName: string,
		schema = this.schemas[0] ?? 'public',
	): Promise<TableInfo | null> {
		const { tables } = await this.getSchema();
		return (
			tables.find((t) => t.name === tableName && t.schema === schema) ?? null
		);
	}

	/**
	 * A page of a table's rows, filtered and sorted.
	 *
	 * @throws {TableNotFound} the table is not browsable
	 * @throws {ColumnNotFound} a filter or sort names a column it does not have
	 * @throws {UnsupportedFilterOperator} a filter's operator does not apply
	 * @throws {InvalidCursor} the cursor did not come from a previous page
	 */
	async query(options: QueryOptions): Promise<QueryResult> {
		const schema = options.schema ?? this.schemas[0] ?? 'public';
		const table = await this.getTableInfo(options.table, schema);
		if (!table) {
			throw new TableNotFound(options.table, schema);
		}

		const cursor = this.getCursorConfig(table);
		const pageSize = Math.min(
			options.pageSize ?? this.defaultPageSize,
			MAX_PAGE_SIZE,
		);

		// The table was found by introspection; the query's static types only
		// know the tables the application declared.
		let query = (this.db as Kysely<any>)
			.withSchema(schema)
			.selectFrom(table.name)
			.selectAll() as SelectQueryBuilder<any, any, Record<string, unknown>>;

		if (options.filters?.length) {
			query = applyFilters(query, options.filters, table);
		}

		if (options.sort?.length) {
			query = applySorting(query, options.sort, table);
		} else if (cursor) {
			query = query.orderBy(cursor.field, cursor.direction);
		}

		if (options.cursor && cursor) {
			const after = decodeCursor(options.cursor);
			const operator = cursor.direction === Direction.Asc ? '>' : '<';
			query = query.where(cursor.field, operator, after);
		}

		// One more row than the page, so whether there is a next page is known
		// without counting.
		const rows = await query.limit(pageSize + 1).execute();
		const hasMore = rows.length > pageSize;
		const page = hasMore ? rows.slice(0, pageSize) : rows;

		const last = page[page.length - 1];
		const first = page[0];

		return {
			rows: page,
			hasMore,
			nextCursor:
				hasMore && cursor && last ? encodeCursor(last[cursor.field]) : null,
			// Only known to exist when this page was reached through a cursor.
			prevCursor:
				options.cursor && cursor && first
					? encodeCursor(first[cursor.field])
					: null,
		};
	}

	/**
	 * The cursor a table pages by: its own, the default, or its primary key
	 * when that is one column. Undefined means the table has nothing unique to
	 * page by, so it is read a page at a time with no next cursor.
	 */
	getCursorConfig(table: TableInfo): CursorConfig | undefined {
		const configured = this.tableCursors[table.name] ?? this.cursor;
		if (configured) return configured;

		const [key, ...rest] = table.primaryKey;
		if (key && rest.length === 0) {
			return { field: key, direction: Direction.Asc };
		}

		return undefined;
	}
}
