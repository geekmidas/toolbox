import { randomUUID } from 'node:crypto';
import { CamelCasePlugin, type Kysely, sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../test/globalSetup';
import {
	connectionConfig,
	openBoundTransaction,
	TransactionRegistry,
} from '../transactions';

/**
 * Two "databases" the way an app and its auth server see them: the app's, and
 * a schema tenant reached through its own `search_path`. Committed setup, so
 * what each test does can be checked against what was already there.
 */
const schema = `tx_spec_${randomUUID().slice(0, 8)}`;
const { host, port, user, password, database } = TEST_DATABASE_CONFIG;
const base = `postgres://${user}:${password}@${host}:${port}/${database}`;
const appUrl = base;
const tenantUrl = `${base}?search_path=${schema}`;

const committed = async (query: string) => {
	const client = new pg.Client(TEST_DATABASE_CONFIG);
	await client.connect();
	try {
		return (await client.query(query)).rows;
	} finally {
		await client.end();
	}
};

beforeAll(async () => {
	await committed(`CREATE SCHEMA "${schema}"`);
	await committed(`CREATE TABLE "${schema}".users (email text)`);
	await committed(`CREATE TABLE public."${schema}_notes" (text text)`);
});

afterAll(async () => {
	await committed(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
	await committed(`DROP TABLE IF EXISTS public."${schema}_notes"`);
});

describe('openBoundTransaction', () => {
	it('rolls back everything the test wrote', async () => {
		const tx = await openBoundTransaction(tenantUrl);
		await sql`INSERT INTO users VALUES ('ada@shop.test')`.execute(tx.db);
		await tx.rollback();

		expect(await committed(`SELECT * FROM "${schema}".users`)).toEqual([]);
	});

	it('lets code under test use transactions without committing the test’s', async () => {
		const tx = await openBoundTransaction(tenantUrl);

		// What better-auth does: its own transaction, and a pinned connection.
		await tx.db.transaction().execute(async (trx) => {
			await sql`INSERT INTO users VALUES ('ada@shop.test')`.execute(trx);
		});
		await tx.db
			.connection()
			.execute((conn) =>
				sql`INSERT INTO users VALUES ('bob@shop.test')`.execute(conn),
			);

		const inside = await sql<{
			email: string;
		}>`SELECT email FROM users`.execute(tx.db);
		expect(inside.rows.map((r) => r.email).sort()).toEqual([
			'ada@shop.test',
			'bob@shop.test',
		]);

		await tx.rollback();
		expect(await committed(`SELECT * FROM "${schema}".users`)).toEqual([]);
	});

	it('undoes only the inner work when code under test rolls back', async () => {
		const tx = await openBoundTransaction(tenantUrl);
		await sql`INSERT INTO users VALUES ('kept@shop.test')`.execute(tx.db);

		await tx.db
			.transaction()
			.execute(async (trx) => {
				await sql`INSERT INTO users VALUES ('undone@shop.test')`.execute(trx);
				throw new Error('handler failed');
			})
			.catch(() => {});

		const rows = await sql<{ email: string }>`SELECT email FROM users`.execute(
			tx.db,
		);
		expect(rows.rows.map((r) => r.email)).toEqual(['kept@shop.test']);
		await tx.rollback();
	});
	// Deployed, a statement outside a transaction is its own: a duplicate key
	// fails that insert and nothing else. Better Auth's rate limiter is built on
	// it — two requests both insert the row, the loser reads the winner's and
	// carries on — and in one test both requests share this one connection.
	it('lets a statement fail on its own, as it does deployed', async () => {
		await committed(
			`CREATE TABLE "${schema}".limits (key text PRIMARY KEY, hits int)`,
		);
		const tx = await openBoundTransaction(tenantUrl);
		const insert = () =>
			sql`INSERT INTO limits VALUES ('client|/get-session', 1)`.execute(tx.db);

		const [first, second] = await Promise.allSettled([insert(), insert()]);
		expect(first.status).toBe('fulfilled');
		expect(second).toMatchObject({
			status: 'rejected',
			reason: { code: '23505' },
		});

		// The test's transaction is still open, and the winner's row in it.
		await sql`UPDATE limits SET hits = hits + 1`.execute(tx.db);
		const rows = await sql<{
			hits: number;
		}>`SELECT hits FROM limits`.execute(tx.db);
		expect(rows.rows).toEqual([{ hits: 2 }]);
		await tx.rollback();
	});

	it('still fails a transaction the code opened with the statement in it', async () => {
		await committed(`CREATE TABLE "${schema}".once (key text PRIMARY KEY)`);
		const tx = await openBoundTransaction(tenantUrl);

		const result = tx.db.transaction().execute(async (trx) => {
			await sql`INSERT INTO once VALUES ('a')`.execute(trx);
			await sql`INSERT INTO once VALUES ('a')`.execute(trx).catch(() => {});
			// Deployed, Postgres refuses everything after the failure until the
			// transaction ends; so it does here.
			await sql`SELECT 1`.execute(trx);
		});

		await expect(result).rejects.toMatchObject({ code: '25P02' });
		const rows = await sql`SELECT * FROM once`.execute(tx.db);
		expect(rows.rows).toEqual([]);
		await tx.rollback();
	});

	// A test that expects a statement to fail wraps it in a savepoint of its
	// own and rolls back to it. The wrapper's own savepoint around each
	// statement must not release it in between.
	it('keeps a savepoint the test opened, to roll back to', async () => {
		await committed(`CREATE TABLE "${schema}".refusals (key text PRIMARY KEY)`);
		const tx = await openBoundTransaction(tenantUrl);
		await sql`INSERT INTO refusals VALUES ('kept')`.execute(tx.db);

		await sql`savepoint refused`.execute(tx.db);
		await expect(
			sql`INSERT INTO refusals VALUES ('kept')`.execute(tx.db),
		).rejects.toMatchObject({ code: '23505' });
		await sql`rollback to savepoint refused`.execute(tx.db);

		await sql`INSERT INTO refusals VALUES ('after')`.execute(tx.db);
		const rows = await sql<{
			key: string;
		}>`SELECT key FROM refusals ORDER BY key`.execute(tx.db);
		expect(rows.rows.map((r) => r.key)).toEqual(['after', 'kept']);
		await tx.rollback();
	});

	// Breaking the transaction on purpose — so the code under test answers 500
	// — needs the failure to abort it, as inside a `begin`.
	it('lets a failure abort the transaction inside a savepoint the test opened', async () => {
		const tx = await openBoundTransaction(tenantUrl);
		await sql`INSERT INTO users VALUES ('ada@shop.test')`.execute(tx.db);

		await sql`savepoint broken`.execute(tx.db);
		await expect(sql`select 1 / 0`.execute(tx.db)).rejects.toMatchObject({
			code: '22012',
		});
		await expect(sql`SELECT 1`.execute(tx.db)).rejects.toMatchObject({
			code: '25P02',
		});
		await sql`rollback to savepoint broken`.execute(tx.db);

		const rows = await sql<{ email: string }>`SELECT email FROM users`.execute(
			tx.db,
		);
		expect(rows.rows).toEqual([{ email: 'ada@shop.test' }]);
		await tx.rollback();
	});

	it('nests savepoints the test opened as Postgres does', async () => {
		const tx = await openBoundTransaction(tenantUrl);
		const emails = async () =>
			(
				await sql<{
					email: string;
				}>`SELECT email FROM users ORDER BY email`.execute(tx.db)
			).rows.map((r) => r.email);

		// ROLLBACK TO keeps the savepoint open: it can be rolled back to again.
		await sql`SAVEPOINT a`.execute(tx.db);
		await sql`INSERT INTO users VALUES ('a@shop.test')`.execute(tx.db);
		await sql`savepoint "B"`.execute(tx.db);
		await sql`INSERT INTO users VALUES ('b@shop.test')`.execute(tx.db);
		await sql`ROLLBACK TO a`.execute(tx.db);
		expect(await emails()).toEqual([]);
		await sql`INSERT INTO users VALUES ('again@shop.test')`.execute(tx.db);
		await sql`rollback to savepoint a`.execute(tx.db);
		expect(await emails()).toEqual([]);

		// RELEASE a ends b with it. Rolling back to b then fails, and aborts
		// the transaction; `guard` is what recovers from that.
		await sql`release a`.execute(tx.db);
		await sql`savepoint guard`.execute(tx.db);
		await sql`savepoint a`.execute(tx.db);
		await sql`savepoint b`.execute(tx.db);
		await sql`release savepoint a`.execute(tx.db);
		await expect(
			sql`rollback to savepoint b`.execute(tx.db),
		).rejects.toMatchObject({ code: '3B001' });
		await sql`rollback to savepoint guard`.execute(tx.db);
		await sql`release savepoint guard`.execute(tx.db);

		// With none left open, a failing statement fails alone again.
		await sql`INSERT INTO users VALUES ('c@shop.test')`.execute(tx.db);
		await expect(sql`select 1 / 0`.execute(tx.db)).rejects.toMatchObject({
			code: '22012',
		});
		expect(await emails()).toEqual(['c@shop.test']);
		await tx.rollback();
	});

	// The code under test is handed this Kysely in place of its own. Built
	// without the database's plugins, it wrote `signedUpAt` to a table whose
	// column is `signed_up_at`, and a test failed on code production ran fine.
	it('builds the client the database’s own config describes', async () => {
		await committed(
			`CREATE TABLE "${schema}".members (signed_up_at text NOT NULL)`,
		);
		const tx = await openBoundTransaction(tenantUrl, {
			plugins: [new CamelCasePlugin()],
		});
		const db = tx.db as unknown as Kysely<{
			members: { signedUpAt: string };
		}>;

		await db.insertInto('members').values({ signedUpAt: 'today' }).execute();

		expect(await db.selectFrom('members').selectAll().execute()).toEqual([
			{ signedUpAt: 'today' },
		]);
		await tx.rollback();
	});
});

describe('TransactionRegistry', () => {
	it('gives each database its own transaction, as deployed', async () => {
		const registry = new TransactionRegistry();
		const app = await registry.get('Database', appUrl);
		const tenant = await registry.get('AuthDatabase', tenantUrl);

		await sql`INSERT INTO users VALUES ('ada@shop.test')`.execute(tenant);

		// The app's connection is another transaction: it cannot see what the
		// tenant has not committed — as in production, where it never reads the
		// tenant's tables at all.
		const fromApp = await sql
			.raw(`SELECT * FROM "${schema}".users`)
			.execute(app);
		expect(fromApp.rows).toEqual([]);

		await sql.raw(`INSERT INTO "${schema}_notes" VALUES ('hi')`).execute(app);
		await registry.rollbackAll();

		expect(await committed(`SELECT * FROM "${schema}".users`)).toEqual([]);
		expect(await committed(`SELECT * FROM public."${schema}_notes"`)).toEqual(
			[],
		);
	});

	it('hands back the same transaction to every caller, even while opening', async () => {
		const registry = new TransactionRegistry();

		const [first, second] = await Promise.all([
			registry.get('Database', appUrl),
			registry.get('Database', appUrl),
		]);

		expect(first).toBe(second);
		await registry.rollbackAll();
	});
});

describe('connectionConfig', () => {
	it('turns ?search_path= into the startup option Postgres reads', () => {
		expect(connectionConfig(tenantUrl)).toEqual({
			connectionString: base,
			options: `-c search_path=${schema}`,
		});
		expect(connectionConfig(appUrl)).toEqual({ connectionString: appUrl });
	});
});
