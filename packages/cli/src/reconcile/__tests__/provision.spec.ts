import type { ConstructManifest } from '@geekmidas/manifest';
import { provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { planFor } from '../plan';
import {
	applyBuckets,
	applyPostgres,
	bucketNames,
	postgresStatements,
	quoteIdentifier,
	type SqlClient,
} from '../provision';

const manifest = {
	Orders: { kind: 'database', id: 'Orders', provides: ['ORDERS_URL'] },
	Auth: {
		kind: 'database-schema',
		id: 'Auth',
		of: 'Orders',
		schema: 'auth',
		provides: ['AUTH_URL'],
	},
	AuthReader: {
		kind: 'database-reader',
		id: 'AuthReader',
		of: 'Auth',
		provides: ['AUTH_READER_URL'],
	},
	Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
	Mail: { kind: 'email', id: 'Mail', provides: ['MAIL_URL', 'MAIL_FROM'] },
} as const satisfies ConstructManifest;

const plan = (stage = 'development') =>
	planFor(manifest, stage, provisionOrder(manifest));

/** A Postgres that starts empty and remembers what was created in it. */
function fakePostgres(existing: string[] = []) {
	const present = new Set(existing);
	const ran: string[] = [];

	const client: SqlClient = {
		async query(_database, sql, values) {
			if (sql.startsWith('SELECT')) {
				return present.has(String(values?.[0])) ? [{ '?column?': 1 }] : [];
			}

			ran.push(sql);
			// Remember it, so a second pass converges rather than repeating.
			const name = sql.match(/"([^"]+)"/)?.[1];
			if (name) present.add(name);

			return [];
		},
	};

	return { client, ran };
}

describe('postgresStatements', () => {
	it('creates a database for each declared one', () => {
		expect(postgresStatements(plan()).map((s) => s.describe)).toContain(
			'database orders',
		);
	});

	it('creates a tenant’s schema inside its parent’s database', () => {
		// Never a database of its own — that is what makes pg-boss an instance of
		// this rather than a special case.
		const schema = postgresStatements(plan()).find((s) =>
			s.describe.startsWith('schema'),
		);

		expect(schema?.database).toBe('orders');
	});

	it('creates nothing for a reader', () => {
		// A reader is grants on an endpoint that already exists.
		expect(postgresStatements(plan()).map((s) => s.id)).not.toContain(
			'AuthReader',
		);
	});

	it('creates nothing for mail', () => {
		expect(postgresStatements(plan()).map((s) => s.id)).not.toContain('Mail');
	});

	it('names resources for the stage', () => {
		expect(postgresStatements(plan('test')).map((s) => s.describe)).toContain(
			'database orders_test',
		);
	});

	it('puts databases before the schemas inside them', () => {
		const ids = postgresStatements(plan()).map((s) => s.id);

		expect(ids.indexOf('Orders')).toBeLessThan(ids.indexOf('Auth'));
	});
});

describe('quoteIdentifier', () => {
	it('quotes a name', () => {
		expect(quoteIdentifier('orders_test')).toBe('"orders_test"');
	});

	it('escapes an embedded quote', () => {
		// DDL cannot be parameterised, so this is the one place a name could ever
		// be more than a name.
		expect(quoteIdentifier('a"b')).toBe('"a""b"');
	});
});

describe('applyPostgres', () => {
	it('creates what is missing', async () => {
		const { client, ran } = fakePostgres();
		const applied = await applyPostgres(client, postgresStatements(plan()));

		expect(applied.every((a) => a.created)).toBe(true);
		expect(ran.some((sql) => sql.includes('CREATE DATABASE "orders"'))).toBe(
			true,
		);
	});

	it('creates nothing that already exists', async () => {
		const { client, ran } = fakePostgres(['orders', 'auth']);
		const applied = await applyPostgres(client, postgresStatements(plan()));

		expect(applied.every((a) => !a.created)).toBe(true);
		expect(ran).toEqual([]);
	});

	it('is convergent — applying twice creates once', async () => {
		// The property that lets `gkm dev` do this on every start.
		const { client, ran } = fakePostgres();
		const statements = postgresStatements(plan());

		await applyPostgres(client, statements);
		const second = await applyPostgres(client, statements);

		expect(second.every((a) => !a.created)).toBe(true);
		expect(ran).toHaveLength(2);
	});

	it('drops nothing', async () => {
		// The line is drawn at data: this creates, and never resets.
		const { client, ran } = fakePostgres();
		await applyPostgres(client, postgresStatements(plan()));

		expect(ran.some((sql) => /DROP|TRUNCATE|DELETE/i.test(sql))).toBe(false);
	});
});

describe('bucketNames', () => {
	it('names a bucket per declared object storage', () => {
		expect(bucketNames(plan())).toEqual(['uploads']);
	});

	it('names buckets for the stage', () => {
		expect(bucketNames(plan('test'))).toEqual(['uploads-test']);
	});
});

describe('applyBuckets', () => {
	it('creates a missing bucket', async () => {
		const created: string[] = [];
		const applied = await applyBuckets(
			{ exists: async () => false, create: async (b) => void created.push(b) },
			['uploads'],
		);

		expect(created).toEqual(['uploads']);
		expect(applied[0].created).toBe(true);
	});

	it('leaves an existing bucket alone', async () => {
		const created: string[] = [];
		const applied = await applyBuckets(
			{ exists: async () => true, create: async (b) => void created.push(b) },
			['uploads'],
		);

		expect(created).toEqual([]);
		expect(applied[0].created).toBe(false);
	});
});
