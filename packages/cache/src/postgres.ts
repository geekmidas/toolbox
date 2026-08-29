/**
 * A cache that lives in a database you already have.
 *
 * The backend with no infrastructure. A cache is a table; the database is the
 * one the application already declared, so an idle stage costs nothing extra
 * and there is one fewer thing to provision, secure and pay for. It is slower
 * than Redis and that is the trade: for session lookups, rate-limit counters and
 * memoised API responses at ordinary volumes, a primary-key hit on a small table
 * is not the thing that will be slow.
 *
 * **The table is provisioned, not created on first use.** That is the one place
 * this differs from pg-boss, and the reason is the role split: a handler
 * connects as a role that may read and write rows and may not create anything,
 * so a driver issuing `CREATE TABLE` would fail on exactly the deployment where
 * the roles are doing their job. The DDL is exported instead — see
 * {@link cacheTableStatements} — and applied by whatever applies the rest.
 *
 * Reads filter on expiry and delete lazily, so an expired row is never returned
 * even if nothing has swept it; a sweep is an optimisation, not a correctness
 * requirement.
 */

import pg, { type Pool } from 'pg';
import type { Cache } from './index';
import type { CacheDriver } from './registry';

export interface PostgresCacheOptions {
	/**
	 * The table to keep entries in, schema-qualified if it needs to be.
	 *
	 * Defaults to `cache`. It resolves against the connection's `search_path`,
	 * which the role carries — so a tenant's cache lands in the tenant's schema
	 * without anything here knowing the schema's name.
	 */
	table?: string;
}

const DEFAULT_TABLE = 'cache';

export class PostgresCache implements Cache {
	private readonly table: string;

	constructor(
		private readonly pool: Pool,
		options: PostgresCacheOptions = {},
	) {
		this.table = options.table ?? DEFAULT_TABLE;
	}

	async get<T>(key: string): Promise<T | undefined> {
		const { rows } = await this.query<{ value: T }>(
			`SELECT value FROM ${this.identifier()}
			 WHERE key = $1 AND (expires_at IS NULL OR expires_at > now())`,
			[key],
		);

		return rows[0]?.value;
	}

	async set<T>(key: string, value: T, ttl?: number): Promise<void> {
		// `now() + interval` computed by the server, not by this process: a
		// client whose clock is minutes off would otherwise write entries that
		// expire early or late, and clock skew is not a thing to debug through a
		// cache.
		await this.query(
			`INSERT INTO ${this.identifier()} (key, value, expires_at)
			 VALUES ($1, $2::jsonb, ${ttl === undefined ? 'NULL' : "now() + ($3 || ' seconds')::interval"})
			 ON CONFLICT (key) DO UPDATE
			 SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
			ttl === undefined
				? [key, JSON.stringify(value)]
				: [key, JSON.stringify(value), String(ttl)],
		);
	}

	async delete(key: string): Promise<void> {
		await this.query(`DELETE FROM ${this.identifier()} WHERE key = $1`, [key]);
	}

	async ttl(key: string): Promise<number> {
		const { rows } = await this.query<{ seconds: number | null }>(
			`SELECT EXTRACT(EPOCH FROM (expires_at - now()))::int AS seconds
			 FROM ${this.identifier()}
			 WHERE key = $1 AND (expires_at IS NULL OR expires_at > now())`,
			[key],
		);

		const row = rows[0];
		if (!row) return 0;

		// A row with no expiry has no time *left* to report. Zero is what the
		// interface says a missing key returns, and "never expires" is closer to
		// that than to any number this could invent.
		return row.seconds ?? 0;
	}

	/**
	 * Delete every expired entry.
	 *
	 * Optional: reads already ignore them. Worth running occasionally so the
	 * table does not grow without bound in a workload that writes many keys once.
	 */
	async sweep(): Promise<number> {
		const { rowCount } = await this.query(
			`DELETE FROM ${this.identifier()} WHERE expires_at <= now()`,
		);

		return rowCount ?? 0;
	}

	private async query<T>(
		sql: string,
		values: unknown[] = [],
	): Promise<{ rows: T[]; rowCount: number | null }> {
		const result = await this.pool.query(sql, values);

		return { rows: result.rows as T[], rowCount: result.rowCount };
	}

	/**
	 * The table name as an identifier.
	 *
	 * Quoted per segment so a schema-qualified name stays two identifiers rather
	 * than becoming one with a dot in it. The name comes from configuration
	 * rather than from a request, so this is defence rather than sanitisation.
	 */
	private identifier(): string {
		return quote(this.table);
	}
}

/**
 * The `postgres://` driver.
 *
 * One pool per URL, cached for the life of the process: a cache that opened a
 * connection per call would be slower than the thing it exists to speed up, and
 * a Lambda reusing a warm container should reuse the pool with it.
 *
 * `pg` is imported at the top of this module rather than lazily, because the
 * *module* is the lazy boundary — an app caching in Redis never imports
 * `@geekmidas/cache/postgres` and so never resolves the driver behind it. Same
 * arrangement `@geekmidas/storage/aws` uses for the AWS SDK.
 */
export const postgresCacheDriver: CacheDriver = {
	scheme: 'postgres:',
	create(url) {
		const existing = pools.get(url);
		if (existing) return new PostgresCache(existing);

		const pool = new pg.Pool({ connectionString: url });
		pools.set(url, pool);

		return new PostgresCache(pool);
	},
};

const pools = new Map<string, Pool>();

/**
 * The DDL a Postgres-backed cache needs, for whoever applies DDL.
 *
 * Generation only, in the shape `@geekmidas/db/pg/roles` uses — the same
 * statements run in-process from `gkm dev` and from a provisioner inside a VPC,
 * and one implementation is what stops "works locally, fails deployed".
 *
 * Run as the schema's **owner**. The role a handler connects as cannot create a
 * table, which is the point of the split and the reason this is not done lazily.
 */
export function cacheTableStatements(options: PostgresCacheOptions = {}): {
	describe: string;
	exists?: { sql: string; values: unknown[] };
	sql: string;
}[] {
	const table = options.table ?? DEFAULT_TABLE;
	const [schema, name] = table.includes('.')
		? (table.split('.') as [string, string])
		: [undefined, table];
	const qualified = quote(table);

	return [
		{
			describe: `cache table ${table}`,
			exists: {
				sql: schema
					? 'SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2'
					: 'SELECT 1 FROM information_schema.tables WHERE table_name = $1',
				values: schema ? [schema, name] : [name],
			},
			sql: `CREATE TABLE ${qualified} (
				key text PRIMARY KEY,
				value jsonb NOT NULL,
				expires_at timestamptz
			)`,
		},
		{
			// Only the expiring rows: a partial index stays small in a cache whose
			// entries mostly never expire, and the sweep only ever looks at those.
			describe: `cache expiry index on ${table}`,
			sql: `CREATE INDEX IF NOT EXISTS ${indexName(table)}
			      ON ${qualified} (expires_at) WHERE expires_at IS NOT NULL`,
		},
	];
}

/** A possibly schema-qualified name, quoted per segment. */
function quote(table: string): string {
	return table
		.split('.')
		.map((part) => `"${part.replace(/"/g, '""')}"`)
		.join('.');
}

function indexName(table: string): string {
	return `"${table.replace(/[^a-zA-Z0-9]/g, '_')}_expires_at_idx"`;
}
