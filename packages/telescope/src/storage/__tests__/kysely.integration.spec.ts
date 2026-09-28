import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POSTGRES_PORT } from '../../../../testkit/test/ports';
import type { ExceptionEntry, LogEntry, RequestEntry } from '../../types';
import { getTelescopeMigration, KyselyStorage } from '../kysely';

/** A schema of its own, so runs cannot see each other's rows. */
const SCHEMA = `telescope_it_${process.pid}`;

const HOUR = 3_600_000;
const now = Date.now();

function request(overrides: Partial<RequestEntry> = {}): RequestEntry {
	return {
		id: `r${Math.random().toString(36).slice(2, 12)}`,
		method: 'GET',
		path: '/users',
		url: 'http://localhost/users',
		headers: { accept: 'application/json' },
		query: {},
		status: 200,
		responseHeaders: {},
		duration: 12.5,
		timestamp: new Date(now),
		...overrides,
	};
}

function exception(overrides: Partial<ExceptionEntry> = {}): ExceptionEntry {
	return {
		id: `e${Math.random().toString(36).slice(2, 12)}`,
		name: 'TypeError',
		message: 'x is undefined',
		stack: [{ file: 'a.ts', line: 1, column: 2 }],
		handled: false,
		timestamp: new Date(now),
		...overrides,
	} as ExceptionEntry;
}

function log(overrides: Partial<LogEntry> = {}): LogEntry {
	return {
		id: `l${Math.random().toString(36).slice(2, 12)}`,
		level: 'info',
		message: 'hello',
		timestamp: new Date(now),
		...overrides,
	};
}

describe('KyselyStorage on Postgres', () => {
	let db: Kysely<any>;
	let storage: KyselyStorage<any>;

	beforeAll(async () => {
		db = new Kysely({
			dialect: new PostgresDialect({
				pool: new pg.Pool({
					connectionString: `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`,
				}),
			}),
		});
		await sql.raw(getTelescopeMigration(SCHEMA).up).execute(db);
		storage = new KyselyStorage({ db, schema: SCHEMA });
	});

	afterAll(async () => {
		await sql.raw(getTelescopeMigration(SCHEMA).down).execute(db);
		await db.destroy();
	});

	beforeEach(async () => {
		await storage.prune(new Date(now + 10 * HOUR));
	});

	describe('requests', () => {
		it('round-trips every field, JSON columns included', async () => {
			const entry = request({
				body: { name: 'Ada' },
				query: { page: '2' },
				responseBody: [1, 2],
				ip: '1.2.3.4',
				userId: 'u1',
				tags: ['api'],
			});

			await storage.saveRequest(entry);

			expect(await storage.getRequest(entry.id)).toEqual(entry);
		});

		it('leaves optional fields undefined', async () => {
			const entry = request();
			await storage.saveRequest({ ...entry, query: undefined as never });

			const saved = await storage.getRequest(entry.id);

			expect(saved).toMatchObject({ id: entry.id, body: undefined });
			expect(saved?.ip).toBeUndefined();
			expect(saved?.tags).toBeUndefined();
		});

		it('answers null for an id it does not have', async () => {
			expect(await storage.getRequest('missing')).toBeNull();
		});

		it('saves a batch, and does nothing with an empty one', async () => {
			await storage.saveRequests([]);
			await storage.saveRequests([request(), request()]);

			expect(await storage.getRequests()).toHaveLength(2);
		});

		it('filters by method, status class, exact status and time', async () => {
			await storage.saveRequests([
				request({ method: 'GET', status: 200 }),
				request({ method: 'POST', status: 201 }),
				request({ method: 'GET', status: 404 }),
				request({
					method: 'GET',
					status: 500,
					timestamp: new Date(now - 2 * HOUR),
				}),
			]);

			expect(await storage.getRequests({ method: 'POST' })).toHaveLength(1);
			expect(await storage.getRequests({ status: '2xx' })).toHaveLength(2);
			expect(await storage.getRequests({ status: '404' })).toHaveLength(1);
			expect(
				await storage.getRequests({ after: new Date(now - HOUR) }),
			).toHaveLength(3);
			expect(
				await storage.getRequests({ before: new Date(now - HOUR) }),
			).toHaveLength(1);
		});

		it('pages with limit and offset', async () => {
			await storage.saveRequests(
				Array.from({ length: 5 }, (_, i) =>
					request({ timestamp: new Date(now - i * 1000) }),
				),
			);

			const page = await storage.getRequests({ limit: 2, offset: 2 });

			expect(page).toHaveLength(2);
		});

		it('searches paths and URLs', async () => {
			await storage.saveRequests([
				request({ path: '/orders', url: 'http://localhost/orders' }),
				request(),
			]);

			const found = await storage.getRequests({ search: 'order' });

			expect(found.map((r) => r.path)).toEqual(['/orders']);
		});
	});

	describe('exceptions', () => {
		it('round-trips an exception with its source and request', async () => {
			const entry = exception({
				source: { file: 'a.ts', line: 3, code: 'throw x' },
				requestId: 'r1',
				tags: ['db'],
			} as Partial<ExceptionEntry>);

			await storage.saveException(entry);

			expect(await storage.getException(entry.id)).toEqual(entry);
			expect(await storage.getException('missing')).toBeNull();
		});

		it('saves a batch and lists them', async () => {
			await storage.saveExceptions([]);
			await storage.saveExceptions([exception(), exception()]);

			expect(await storage.getExceptions({ limit: 10 })).toHaveLength(2);
		});
	});

	describe('logs', () => {
		it('saves logs with context and filters by level', async () => {
			await storage.saveLog(log({ context: { user: 'u1' }, requestId: 'r1' }));
			await storage.saveLogs([]);
			await storage.saveLogs([log({ level: 'error' }), log({ level: 'warn' })]);

			const errors = await storage.getLogs({ level: 'error' });
			const all = await storage.getLogs();

			expect(errors).toHaveLength(1);
			expect(all).toHaveLength(3);
			expect(all.find((l) => l.requestId)).toMatchObject({
				context: { user: 'u1' },
				requestId: 'r1',
			});
		});

		it('searches log messages', async () => {
			await storage.saveLogs([log({ message: 'payment failed' }), log()]);

			const found = await storage.getLogs({ search: 'payment' });

			expect(found.map((l) => l.message)).toEqual(['payment failed']);
		});
	});

	describe('prune and stats', () => {
		it('reports nothing for an empty store', async () => {
			expect(await storage.getStats()).toEqual({
				requests: 0,
				exceptions: 0,
				logs: 0,
				oldestEntry: undefined,
				newestEntry: undefined,
			});
		});

		it('counts entries and spans their dates', async () => {
			await storage.saveRequest(request({ timestamp: new Date(now - HOUR) }));
			await storage.saveException(exception());
			await storage.saveLog(log({ timestamp: new Date(now + HOUR) }));

			const stats = await storage.getStats();

			expect(stats).toMatchObject({ requests: 1, exceptions: 1, logs: 1 });
			expect(stats.oldestEntry?.getTime()).toBe(now - HOUR);
			expect(stats.newestEntry?.getTime()).toBe(now + HOUR);
		});

		it('prunes everything older than the cutoff across all tables', async () => {
			await storage.saveRequest(
				request({ timestamp: new Date(now - 2 * HOUR) }),
			);
			await storage.saveException(
				exception({ timestamp: new Date(now - 2 * HOUR) }),
			);
			await storage.saveLog(log({ timestamp: new Date(now - 2 * HOUR) }));
			await storage.saveLog(log());

			expect(await storage.prune(new Date(now - HOUR))).toBe(3);
			expect((await storage.getStats()).logs).toBe(1);
		});
	});
});

describe('KyselyStorage without a schema', () => {
	it('uses the connection as it is', async () => {
		const db = new Kysely<any>({
			dialect: new PostgresDialect({
				pool: new pg.Pool({
					connectionString: `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`,
				}),
			}),
		});
		const schema = `telescope_bare_${process.pid}`;
		await sql.raw(getTelescopeMigration(schema).up).execute(db);
		const pinned = db.withSchema(schema);

		try {
			const storage = new KyselyStorage({ db: pinned });
			await storage.saveLog(log({ message: 'pinned' }));

			expect((await storage.getLogs()).map((l) => l.message)).toEqual([
				'pinned',
			]);
		} finally {
			await sql.raw(getTelescopeMigration(schema).down).execute(db);
			await db.destroy();
		}
	});

	it('writes an unqualified migration when no schema is named', () => {
		const { up, down } = getTelescopeMigration();

		expect(up).not.toContain('CREATE SCHEMA');
		expect(up).toContain('CREATE TABLE IF NOT EXISTS requests');
		expect(down).toContain('requests');
	});
});
