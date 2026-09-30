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
