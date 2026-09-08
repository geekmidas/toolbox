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
	requests: TelescopeRequestTable;
	exceptions: TelescopeExceptionTable;
	logs: TelescopeLogTable;
}

/**
 * Configuration for KyselyStorage.
 */
export interface KyselyStorageConfig<DB> {
	/** Kysely database instance */
	db: Kysely<DB>;
	/**
	 * The schema holding `requests`, `exceptions` and `logs`.
	 *
	 * Normally omitted. A telescope derived from a database gets a schema of its
	 * own and a role whose `search_path` is pinned to it, so an unqualified name
	 * already resolves there — which is the same rule every other tenant here
	 * follows, and the reason a connection string never has to remember where
	 * its tables live.
	 *
	 * Name one only when the connection is *not* pinned: a shared pool, a
	 * migration run as an owner whose `search_path` finds `public` first.
	 */
	schema?: string;
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

	/**
	 * Unqualified, and deliberately.
	 *
	 * These were `telescope_requests`, `telescope_exceptions` and
	 * `telescope_logs` — a prefix, which is what you reach for when the tables
	 * have to share a schema with an application's own. They do not: a telescope
	 * derived from a database is a schema tenant, so the names are just the
	 * names, and `DROP SCHEMA telescope CASCADE` is the whole cleanup.
	 */
	private readonly requestsTable = 'requests';
	private readonly exceptionsTable = 'exceptions';
	private readonly logsTable = 'logs';

	constructor(config: KyselyStorageConfig<DB>) {
		// `withSchema` only where the connection is not already pinned to one.
		this.db = config.schema
			? (config.db.withSchema(config.schema) as Kysely<DB>)
			: config.db;
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
 * SQL migration to create telescope's tables.
 *
 * Pass a schema to have them created in one, and to have `down` drop the whole
 * schema rather than three tables. Pass nothing where the connection's
 * `search_path` already places them.
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
export function getTelescopeMigration(schema?: string): {
	up: string;
	down: string;
} {
	// Qualified only when a schema is named. Unqualified otherwise, so the
	// connection's `search_path` places them — the same rule the tables
	// themselves follow at query time.
	const q = (name: string) => (schema ? `${schema}.${name}` : name);
	const idx = (name: string) => (schema ? `${schema}_${name}` : name);

	return {
		up: `${schema ? `CREATE SCHEMA IF NOT EXISTS ${schema};\n` : ''}
-- Telescope requests
CREATE TABLE IF NOT EXISTS ${q('requests')} (
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

CREATE INDEX IF NOT EXISTS idx_${idx('requests')}_timestamp
  ON ${q('requests')} (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_${idx('requests')}_path
  ON ${q('requests')} (path);
CREATE INDEX IF NOT EXISTS idx_${idx('requests')}_status
  ON ${q('requests')} (status);

-- Telescope exceptions
CREATE TABLE IF NOT EXISTS ${q('exceptions')} (
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

CREATE INDEX IF NOT EXISTS idx_${idx('exceptions')}_timestamp
  ON ${q('exceptions')} (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_${idx('exceptions')}_request_id
  ON ${q('exceptions')} (request_id);

-- Telescope logs
CREATE TABLE IF NOT EXISTS ${q('logs')} (
  id VARCHAR(21) PRIMARY KEY,
  level VARCHAR(10) NOT NULL,
  message TEXT NOT NULL,
  context JSONB,
  request_id VARCHAR(21),
  timestamp TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_${idx('logs')}_timestamp
  ON ${q('logs')} (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_${idx('logs')}_level
  ON ${q('logs')} (level);
CREATE INDEX IF NOT EXISTS idx_${idx('logs')}_request_id
  ON ${q('logs')} (request_id);
`,
		// A schema tenant drops whole; only the unqualified case drops tables.
		down: schema
			? `DROP SCHEMA IF EXISTS ${schema} CASCADE;\n`
			: `
DROP TABLE IF EXISTS logs;
DROP TABLE IF EXISTS exceptions;
DROP TABLE IF EXISTS requests;
`,
	};
}
