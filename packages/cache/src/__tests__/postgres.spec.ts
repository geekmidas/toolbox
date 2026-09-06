import { describe, expect, it } from 'vitest';
import { cacheTableStatements, postgresCacheDriver } from '../postgres';

/**
 * The table a client ended up reading, without a database to ask.
 *
 * `PostgresCache` builds every statement against it, so the first query it
 * would send is the honest way to see which table it holds — and it is the
 * thing that was silently wrong: the driver took a URL and no table, so every
 * cache in a database read `cache`.
 */
async function tableOf(url: string): Promise<string> {
	const cache = postgresCacheDriver.create(url);
	let sql = '';

	// Stand in for the pool, so nothing connects.
	(cache as unknown as { pool: unknown }).pool = {
		query(text: string) {
			sql = text;
			return Promise.resolve({ rows: [] });
		},
	};

	await cache.get('k');

	return sql.match(/FROM\s+("[^"]+"(?:\."[^"]+")?)/)?.[1] ?? sql;
}

describe('postgresCacheDriver', () => {
	it('reads the table out of the URL', () => {
		// A database-backed cache has no address of its own, so the table is the
		// only thing in the URL that identifies which cache this is.
		return expect(
			tableOf('postgres://app@localhost/orders?table=cache_sessions'),
		).resolves.toContain('cache_sessions');
	});

	it('gives two caches on one database different tables', async () => {
		// Both resolve the *same* connection string — that is the whole problem
		// the parameter solves. Sharing a table would mean each reading the
		// other's entries and evicting the other's keys.
		const sessions = await tableOf(
			'postgres://app@localhost/orders?table=cache_sessions',
		);
		const rates = await tableOf(
			'postgres://app@localhost/orders?table=cache_rates',
		);

		expect(sessions).not.toBe(rates);
	});

	it('falls back to the default table when the URL names none', async () => {
		expect(await tableOf('postgres://app@localhost/orders')).toContain('cache');
	});

	it('does not pass the table on to pg as a connection parameter', () => {
		// A Postgres connection string carries libpq parameters, and an unknown
		// one is not guaranteed to be ignored.
		const cache = postgresCacheDriver.create(
			'postgres://app@localhost/orders?table=cache_sessions',
		);
		const pool = (cache as unknown as { pool: { options?: unknown } }).pool;

		expect(JSON.stringify(pool)).not.toContain('table=cache_sessions');
	});
});

describe('cacheTableStatements', () => {
	it('qualifies the table when it was given a schema', () => {
		const [create] = cacheTableStatements({ table: 'app.cache_sessions' });

		expect(create?.sql).toContain('"app"."cache_sessions"');
	});

	it('asks about both schema and name when checking existence', () => {
		// Checking the name alone would find a `cache_sessions` in any schema and
		// skip creating the one this cache actually reads.
		const [create] = cacheTableStatements({ table: 'app.cache_sessions' });

		expect(create?.exists?.values).toEqual(['app', 'cache_sessions']);
	});
});
