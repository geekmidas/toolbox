import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POSTGRES_PORT } from '../../../testkit/test/ports';
import {
	cacheTableStatements,
	PostgresCache,
	postgresCacheDriver,
} from '../postgres';

/**
 * The database-backed cache against a real Postgres: the provisioned DDL, then
 * every operation through it. Each run keeps its table in a schema of its own,
 * dropped afterwards, so runs never read each other's entries.
 */

const schema = `cache_spec_${Math.random().toString(36).slice(2, 8)}`;
const table = `${schema}.entries`;
const url = `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/postgres`;

const pool = new pg.Pool({ connectionString: url });
const cache = new PostgresCache(pool, { table });

beforeAll(async () => {
	await pool.query(`CREATE SCHEMA "${schema}"`);

	for (const statement of cacheTableStatements({ table })) {
		if (statement.exists) {
			const { rowCount } = await pool.query(
				statement.exists.sql,
				statement.exists.values,
			);
			if (rowCount) continue;
		}
		await pool.query(statement.sql);
	}
});

afterAll(async () => {
	await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
	await pool.end();
});

describe('PostgresCache', () => {
	it('round-trips structured values, overwriting on a second set', async () => {
		await cache.set('user', { id: 1 });
		await cache.set('user', { id: 2, roles: ['admin'] });

		expect(await cache.get('user')).toEqual({ id: 2, roles: ['admin'] });
	});

	it('reports a missing key as undefined with no time left', async () => {
		expect(await cache.get('missing')).toBeUndefined();
		expect(await cache.ttl('missing')).toBe(0);
	});

	it('reports the time left on an expiring entry, and none on a permanent one', async () => {
		await cache.set('expiring', 'v', 60);
		await cache.set('permanent', 'v');

		const left = await cache.ttl('expiring');
		expect(left).toBeGreaterThan(55);
		expect(left).toBeLessThanOrEqual(60);
		expect(await cache.ttl('permanent')).toBe(0);
	});

	it('never returns an expired entry, and the sweep removes it', async () => {
		// Expires the moment it is written, by the server's clock.
		await cache.set('stale', 'v', 0);
		await cache.set('fresh', 'v', 60);

		expect(await cache.get('stale')).toBeUndefined();
		expect(await cache.ttl('stale')).toBe(0);

		expect(await cache.sweep()).toBeGreaterThanOrEqual(1);
		const { rows } = await pool.query(
			`SELECT key FROM "${schema}".entries WHERE key = ANY($1)`,
			[['stale', 'fresh']],
		);
		expect(rows.map((row) => row.key)).toEqual(['fresh']);
	});

	it('deletes', async () => {
		await cache.set('gone', 'v');
		await cache.delete('gone');

		expect(await cache.get('gone')).toBeUndefined();
	});

	it('is reached through the driver, with the table from the URL', async () => {
		const viaUrl = postgresCacheDriver.create(
			`${url}?table=${encodeURIComponent(table)}`,
		);
		await cache.set('shared', { through: 'driver' });

		expect(await viaUrl.get('shared')).toEqual({ through: 'driver' });
		// The driver's pool is its own; release it so the run can exit.
		await (viaUrl as unknown as { pool: pg.Pool }).pool.end();
	});
});

describe('cacheTableStatements', () => {
	it('defaults to an unqualified `cache` table found by name alone', () => {
		const [create, index] = cacheTableStatements();

		expect(create!.exists).toEqual({
			sql: expect.stringContaining('WHERE table_name = $1'),
			values: ['cache'],
		});
		expect(create!.sql).toContain('CREATE TABLE "cache"');
		expect(index!.sql).toContain('"cache_expires_at_idx"');
	});
});
