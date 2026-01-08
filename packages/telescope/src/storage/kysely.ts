import type { Kysely } from 'kysely';
import type {
	ExceptionEntry,
	LogEntry,
	QueryOptions,
	RequestEntry,
	TelescopeStats,
	TelescopeStorage,
} from '../types';

/**
 * Database table interface for telescope requests.
 * Use this to define your telescope_requests table in your Kysely database schema.
 */
export interface TelescopeRequestTable {
	id: string;
	method: string;
	path: string;
	url: string;
	headers: unknown;
	body: unknown | null;
	query: unknown | null;
	status: number;
	response_headers: unknown;
	response_body: unknown | null;
	duration: number;
	timestamp: Date;
	ip: string | null;
	user_id: string | null;
	tags: unknown | null;
}

/**
 * Database table interface for telescope exceptions.
 */
export interface TelescopeExceptionTable {
	id: string;
	name: string;
	message: string;
	stack: unknown;
	source: unknown | null;
	request_id: string | null;
	timestamp: Date;
	handled: boolean;
	tags: unknown | null;
}

/**
 * Database table interface for telescope logs.
 */
export interface TelescopeLogTable {
	id: string;
	level: string;
	message: string;
	context: unknown | null;
	request_id: string | null;
	timestamp: Date;
}

/**
 * Combined database interface for all telescope tables.
 * Use this to extend your database schema.
 *
 * @example
 * ```typescript
 * import type { TelescopeTables } from '@geekmidas/telescope/storage/kysely';
 *
 * interface Database extends TelescopeTables {
 *   users: UserTable;
 *   // ... other tables
 * }
 * ```
 */
export interface TelescopeTables {
	telescope_requests: TelescopeRequestTable;
	telescope_exceptions: TelescopeExceptionTable;
	telescope_logs: TelescopeLogTable;
}

/**
 * Configuration for KyselyStorage.
 */
export interface KyselyStorageConfig<DB> {
	/** Kysely database instance */
	db: Kysely<DB>;
	/**
	 * Table name prefix (default: 'telescope').
	 * Tables will be named: {prefix}_requests, {prefix}_exceptions, {prefix}_logs
	 */
	tablePrefix?: string;
}

/**
 * Kysely-based storage implementation for Telescope.
 * Stores telescope data in PostgreSQL, MySQL, or SQLite using Kysely.
 *
 * @template DB - Your Kysely database schema (must include TelescopeTables)
 *
 * @example
 * ```typescript
 * import { Kysely, PostgresDialect } from 'kysely';
 * import { KyselyStorage, type TelescopeTables } from '@geekmidas/telescope/storage/kysely';
 *
 * interface Database extends TelescopeTables {
 *   users: UserTable;
 * }
 *
 * const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
 * const storage = new KyselyStorage({ db });
 *
 * const telescope = new Telescope({ storage });
 * ```
 */
export class KyselyStorage<DB> implements TelescopeStorage {
	private readonly db: Kysely<DB>;
	private readonly requestsTable: string;
	private readonly exceptionsTable: string;
	private readonly logsTable: string;

	constructor(config: KyselyStorageConfig<DB>) {
		this.db = config.db;
		const prefix = config.tablePrefix ?? 'telescope';
		this.requestsTable = `${prefix}_requests`;
		this.exceptionsTable = `${prefix}_exceptions`;
		this.logsTable = `${prefix}_logs`;
	}

	// ============================================
	// Requests
	// ============================================

	async saveRequest(entry: RequestEntry): Promise<void> {
		const row = this.requestToRow(entry);
		await (this.db as any).insertInto(this.requestsTable).values(row).execute();
	}

	async saveRequests(entries: RequestEntry[]): Promise<void> {
		if (entries.length === 0) return;

		const rows = entries.map((e) => this.requestToRow(e));
		await (this.db as any)
			.insertInto(this.requestsTable)
			.values(rows)
			.execute();
	}

	async getRequests(options?: QueryOptions): Promise<RequestEntry[]> {
		let query = (this.db as any)
			.selectFrom(this.requestsTable)
			.selectAll()
			.orderBy('timestamp', 'desc');

		// Apply request-specific filters
		if (options?.method) {
			query = query.where('method', '=', options.method);
		}

		if (options?.status) {
			const statusFilter = options.status;
			if (statusFilter.endsWith('xx')) {
				// Handle status ranges like "2xx", "4xx", "5xx"
				const firstChar = statusFilter[0];
				if (firstChar) {
					const category = parseInt(firstChar, 10);
					const minStatus = category * 100;
					const maxStatus = minStatus + 99;
					query = query
						.where('status', '>=', minStatus)
						.where('status', '<=', maxStatus);
				}
			} else {
				// Handle exact status codes
				query = query.where('status', '=', parseInt(statusFilter, 10));
			}
		}

		query = this.applyQueryOptions(query, options);

		const rows = await query.execute();
		return rows.map((row: TelescopeRequestTable) => this.rowToRequest(row));
	}

	async getRequest(id: string): Promise<RequestEntry | null> {
		const row = await (this.db as any)
			.selectFrom(this.requestsTable)
			.selectAll()
			.where('id', '=', id)
			.executeTakeFirst();

		return row ? this.rowToRequest(row) : null;
	}

	// ============================================
	// Exceptions
	// ============================================

	async saveException(entry: ExceptionEntry): Promise<void> {
		const row = this.exceptionToRow(entry);
		await (this.db as any)
			.insertInto(this.exceptionsTable)
			.values(row)
			.execute();
	}

	async saveExceptions(entries: ExceptionEntry[]): Promise<void> {
		if (entries.length === 0) return;

		const rows = entries.map((e) => this.exceptionToRow(e));
		await (this.db as any)
			.insertInto(this.exceptionsTable)
			.values(rows)
			.execute();
	}

	async getExceptions(options?: QueryOptions): Promise<ExceptionEntry[]> {
		let query = (this.db as any)
			.selectFrom(this.exceptionsTable)
			.selectAll()
			.orderBy('timestamp', 'desc');

		query = this.applyQueryOptions(query, options);

		const rows = await query.execute();
		return rows.map((row: TelescopeExceptionTable) => this.rowToException(row));
	}

	async getException(id: string): Promise<ExceptionEntry | null> {
		const row = await (this.db as any)
			.selectFrom(this.exceptionsTable)
			.selectAll()
			.where('id', '=', id)
			.executeTakeFirst();

		return row ? this.rowToException(row) : null;
	}

	// ============================================
	// Logs
	// ============================================

	async saveLog(entry: LogEntry): Promise<void> {
		const row = this.logToRow(entry);
		await (this.db as any).insertInto(this.logsTable).values(row).execute();
	}

	async saveLogs(entries: LogEntry[]): Promise<void> {
		if (entries.length === 0) return;

		const rows = entries.map((e) => this.logToRow(e));
		await (this.db as any).insertInto(this.logsTable).values(rows).execute();
	}

	async getLogs(options?: QueryOptions): Promise<LogEntry[]> {
		let query = (this.db as any)
			.selectFrom(this.logsTable)
			.selectAll()
			.orderBy('timestamp', 'desc');

		// Apply log-specific filters
		if (options?.level) {
			query = query.where('level', '=', options.level);
		}

		query = this.applyQueryOptions(query, options);

		const rows = await query.execute();
		return rows.map((row: TelescopeLogTable) => this.rowToLog(row));
	}

	// ============================================
	// Cleanup
	// ============================================

	async prune(olderThan: Date): Promise<number> {
		const results = await Promise.all([
			(this.db as any)
				.deleteFrom(this.requestsTable)
				.where('timestamp', '<', olderThan)
				.executeTakeFirst(),
			(this.db as any)
				.deleteFrom(this.exceptionsTable)
				.where('timestamp', '<', olderThan)
				.executeTakeFirst(),
			(this.db as any)
				.deleteFrom(this.logsTable)
				.where('timestamp', '<', olderThan)
				.executeTakeFirst(),
		]);

		return results.reduce(
			(sum, result) => sum + Number(result.numDeletedRows ?? 0),
			0,
		);
	}

	// ============================================
	// Stats
	// ============================================

	async getStats(): Promise<TelescopeStats> {
		const [requestsResult, exceptionsResult, logsResult] = await Promise.all([
			(this.db as any)
				.selectFrom(this.requestsTable)
				.select((eb: any) => [
					eb.fn.count('id').as('count'),
					eb.fn.min('timestamp').as('oldest'),
					eb.fn.max('timestamp').as('newest'),
				])
				.executeTakeFirst(),
			(this.db as any)
				.selectFrom(this.exceptionsTable)
				.select((eb: any) => [
					eb.fn.count('id').as('count'),
					eb.fn.min('timestamp').as('oldest'),
					eb.fn.max('timestamp').as('newest'),
				])
				.executeTakeFirst(),
			(this.db as any)
				.selectFrom(this.logsTable)
				.select((eb: any) => [
					eb.fn.count('id').as('count'),
					eb.fn.min('timestamp').as('oldest'),
					eb.fn.max('timestamp').as('newest'),
				])
				.executeTakeFirst(),
		]);

		const allDates = [
			requestsResult?.oldest,
			requestsResult?.newest,
			exceptionsResult?.oldest,
			exceptionsResult?.newest,
			logsResult?.oldest,
			logsResult?.newest,
		]
			.filter((d): d is Date => d != null)
			.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

		const newestDate = allDates[allDates.length - 1];
		return {
			requests: Number(requestsResult?.count ?? 0),
			exceptions: Number(exceptionsResult?.count ?? 0),
			logs: Number(logsResult?.count ?? 0),
			oldestEntry: allDates[0] ? new Date(allDates[0]) : undefined,
			newestEntry: newestDate ? new Date(newestDate) : undefined,
		};
	}

	// ============================================
	// Private Helpers
	// ============================================

	private applyQueryOptions(query: any, options?: QueryOptions): any {
		if (!options) {
			return query.limit(50);
		}

		if (options.after) {
			query = query.where('timestamp', '>=', options.after);
		}

		if (options.before) {
			query = query.where('timestamp', '<=', options.before);
		}

		if (options.search) {
			// Search in relevant text fields - using ILIKE for case-insensitive
			// This is a simple implementation; for production you'd want full-text search
			query = query.where((eb: any) =>
				eb.or([
					eb('message', 'ilike', `%${options.search}%`),
					eb('path', 'ilike', `%${options.search}%`),
					eb('url', 'ilike', `%${options.search}%`),
				]),
			);
		}

		// Tags filter would require array contains operation
		// which is database-specific (PostgreSQL: @>, etc.)

		const limit = options.limit ?? 50;
		const offset = options.offset ?? 0;

		return query.limit(limit).offset(offset);
	}

	private requestToRow(entry: RequestEntry): TelescopeRequestTable {
		return {
			id: entry.id,
			method: entry.method,
			path: entry.path,
			url: entry.url,
			headers: entry.headers,
			body: entry.body ?? null,
			query: entry.query ?? null,
			status: entry.status,
			response_headers: entry.responseHeaders,
			response_body: entry.responseBody ?? null,
			duration: entry.duration,
			timestamp: entry.timestamp,
			ip: entry.ip ?? null,
			user_id: entry.userId ?? null,
			tags: entry.tags ?? null,
		};
	}

	private rowToRequest(row: TelescopeRequestTable): RequestEntry {
		return {
			id: row.id,
			method: row.method,
			path: row.path,
			url: row.url,
			headers: this.parseJson(row.headers) as Record<string, string>,
			body: row.body ? this.parseJson(row.body) : undefined,
			query: row.query
				? (this.parseJson(row.query) as Record<string, string>)
				: undefined,
			status: row.status,
			responseHeaders: this.parseJson(row.response_headers) as Record<
				string,
				string
			>,
			responseBody: row.response_body
				? this.parseJson(row.response_body)
				: undefined,
			duration: row.duration,
			timestamp: new Date(row.timestamp),
			ip: row.ip ?? undefined,
			userId: row.user_id ?? undefined,
			tags: row.tags ? (this.parseJson(row.tags) as string[]) : undefined,
		};
	}

	private exceptionToRow(entry: ExceptionEntry): TelescopeExceptionTable {
		return {
			id: entry.id,
			name: entry.name,
			message: entry.message,
			stack: entry.stack,
			source: entry.source ?? null,
			request_id: entry.requestId ?? null,
			timestamp: entry.timestamp,
			handled: entry.handled,
			tags: entry.tags ?? null,
		};
	}

	private rowToException(row: TelescopeExceptionTable): ExceptionEntry {
		return {
			id: row.id,
			name: row.name,
			message: row.message,
			stack: this.parseJson(row.stack) as ExceptionEntry['stack'],
			source: row.source
				? (this.parseJson(row.source) as ExceptionEntry['source'])
				: undefined,
			requestId: row.request_id ?? undefined,
			timestamp: new Date(row.timestamp),
			handled: row.handled,
			tags: row.tags ? (this.parseJson(row.tags) as string[]) : undefined,
		};
	}

	private logToRow(entry: LogEntry): TelescopeLogTable {
		return {
			id: entry.id,
			level: entry.level,
			message: entry.message,
			context: entry.context ?? null,
			request_id: entry.requestId ?? null,
			timestamp: entry.timestamp,
		};
	}

	private rowToLog(row: TelescopeLogTable): LogEntry {
		return {
			id: row.id,
			level: row.level as LogEntry['level'],
			message: row.message,
			context: row.context
				? (this.parseJson(row.context) as Record<string, unknown>)
				: undefined,
			requestId: row.request_id ?? undefined,
			timestamp: new Date(row.timestamp),
		};
	}

	/**
	 * Parse a JSON value that may already be parsed (e.g., from jsonb columns).
	 */
	private parseJson(value: unknown): unknown {
		if (typeof value === 'object' && value !== null) {
			return value;
		}
		if (typeof value === 'string') {
			try {
				return JSON.parse(value);
			} catch {
				return value;
			}
		}
		return value;
	}
}

/**
 * SQL migration to create telescope tables.
 * Use this to set up the required tables in your database.
 *
 * @example
 * ```typescript
 * import { getTelescopeMigration } from '@geekmidas/telescope/storage/kysely';
 *
 * // In your migration file
 * export async function up(db: Kysely<any>): Promise<void> {
 *   const migration = getTelescopeMigration();
 *   await db.schema.executeRaw(migration.up).execute();
 * }
 *
 * export async function down(db: Kysely<any>): Promise<void> {
 *   const migration = getTelescopeMigration();
 *   await db.schema.executeRaw(migration.down).execute();
 * }
 * ```
 */
export function getTelescopeMigration(tablePrefix = 'telescope'): {
	up: string;
	down: string;
} {
	return {
		up: `
-- Telescope requests table
CREATE TABLE IF NOT EXISTS ${tablePrefix}_requests (
  id VARCHAR(21) PRIMARY KEY,
  method VARCHAR(10) NOT NULL,
  path TEXT NOT NULL,
  url TEXT NOT NULL,
  headers JSONB NOT NULL,
  body JSONB,
  query JSONB,
  status INTEGER NOT NULL,
  response_headers JSONB NOT NULL,
  response_body JSONB,
  duration DOUBLE PRECISION NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  ip VARCHAR(45),
  user_id VARCHAR(255),
  tags JSONB
);

CREATE INDEX IF NOT EXISTS idx_${tablePrefix}_requests_timestamp
  ON ${tablePrefix}_requests (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_${tablePrefix}_requests_path
  ON ${tablePrefix}_requests (path);
CREATE INDEX IF NOT EXISTS idx_${tablePrefix}_requests_status
  ON ${tablePrefix}_requests (status);

-- Telescope exceptions table
CREATE TABLE IF NOT EXISTS ${tablePrefix}_exceptions (
  id VARCHAR(21) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  stack JSONB NOT NULL,
  source JSONB,
  request_id VARCHAR(21),
  timestamp TIMESTAMPTZ NOT NULL,
  handled BOOLEAN NOT NULL DEFAULT FALSE,
  tags JSONB
);

CREATE INDEX IF NOT EXISTS idx_${tablePrefix}_exceptions_timestamp
  ON ${tablePrefix}_exceptions (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_${tablePrefix}_exceptions_request_id
  ON ${tablePrefix}_exceptions (request_id);

-- Telescope logs table
CREATE TABLE IF NOT EXISTS ${tablePrefix}_logs (
  id VARCHAR(21) PRIMARY KEY,
  level VARCHAR(10) NOT NULL,
  message TEXT NOT NULL,
  context JSONB,
  request_id VARCHAR(21),
  timestamp TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_${tablePrefix}_logs_timestamp
  ON ${tablePrefix}_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_${tablePrefix}_logs_level
  ON ${tablePrefix}_logs (level);
CREATE INDEX IF NOT EXISTS idx_${tablePrefix}_logs_request_id
  ON ${tablePrefix}_logs (request_id);
`,
		down: `
DROP TABLE IF EXISTS ${tablePrefix}_logs;
DROP TABLE IF EXISTS ${tablePrefix}_exceptions;
DROP TABLE IF EXISTS ${tablePrefix}_requests;
`,
	};
}
