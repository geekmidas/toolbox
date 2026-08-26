import type { ConstructManifest } from '@geekmidas/manifest';
import { provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { planFor } from '../plan';
import {
	applyBuckets,
	applyPolicies,
	applyPostgres,
	type BucketClient,
	bucketNames,
	bucketPolicies,
	bucketPolicy,
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
	UploadsServer: {
		kind: 'file-server',
		id: 'UploadsServer',
		of: 'Uploads',
		open: ['brand/**'],
		provides: ['UPLOADS_SERVER_URL'],
	},
	// A second surface over the same bucket, which is a legitimate arrangement:
	// two cache behaviours, one origin.
	AssetsServer: {
		kind: 'file-server',
		id: 'AssetsServer',
		of: 'Uploads',
		open: ['avatars/*.png'],
		provides: ['ASSETS_SERVER_URL'],
	},
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

describe('bucket policies', () => {
	it('unions the open paths of every server over one bucket', () => {
		// The policy lives on the origin, so two servers contribute to one
		// document rather than the last one written winning.
		expect(bucketPolicies(plan())).toEqual([
			{ bucket: 'uploads', open: ['avatars/*.png', 'brand/**'] },
		]);
	});

	it('names only the open prefixes, and only for reading', () => {
		const document = JSON.parse(bucketPolicy('uploads', ['brand/**']));

		expect(document.Statement[0]).toMatchObject({
			Effect: 'Allow',
			Action: ['s3:GetObject'],
			Resource: ['arn:aws:s3:::uploads/brand/*'],
		});
	});

	it('leaves a bucket nothing serves without a policy', () => {
		const unserved = {
			Assets: { kind: 'objects', id: 'Assets', provides: ['ASSETS_URL'] },
		} as const satisfies ConstructManifest;

		expect(
			bucketPolicies(
				planFor(unserved, 'development', provisionOrder(unserved)),
			),
		).toEqual([]);
	});

	it('writes a policy once and leaves it alone after', async () => {
		// Idempotent like everything else here: reporting a change on every
		// start is what makes a converged reconcile untrustworthy.
		let stored: string | undefined;
		const writes: string[] = [];

		const client: BucketClient = {
			exists: async () => true,
			create: async () => {},
			policy: async () => stored,
			setPolicy: async (_bucket, document) => {
				writes.push(document);
				stored = document;
			},
		};

		const policies = bucketPolicies(plan());

		expect((await applyPolicies(client, policies))[0]?.created).toBe(true);
		expect((await applyPolicies(client, policies))[0]?.created).toBe(false);
		expect(writes).toHaveLength(1);
	});

	it('rewrites a policy that says something else', async () => {
		const client: BucketClient = {
			exists: async () => true,
			create: async () => {},
			policy: async () => '{"Version":"2012-10-17","Statement":[]}',
			setPolicy: async () => {},
		};

		expect(
			(await applyPolicies(client, bucketPolicies(plan())))[0],
		).toMatchObject({ created: true });
	});
});
