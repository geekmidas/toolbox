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
/**
 * Which catalogue an existence check is asking about.
 *
 * Namespaced, because Postgres is: a role named `auth` and a schema named
 * `auth` are different objects, and a fake that keeps one set of names reports
 * the schema as already there the moment the role is created.
 */
const CATALOGUES: [RegExp, string][] = [
	[/pg_roles/, 'role'],
	[/pg_database/, 'database'],
	[/information_schema\.schemata/, 'schema'],
];

function fakePostgres(existing: string[] = []) {
	// A bare name is taken as present in every catalogue — the shorthand the
	// tests use for "this already exists", where which catalogue is not the
	// point being made.
	const present = new Set(
		existing.flatMap((name) => [
			`role:${name}`,
			`database:${name}`,
			`schema:${name}`,
		]),
	);
	const ran: string[] = [];

	const client: SqlClient = {
		async query(_database, sql, values) {
			if (sql.startsWith('SELECT')) {
				const catalogue =
					CATALOGUES.find(([pattern]) => pattern.test(sql))?.[1] ?? 'unknown';

				return present.has(`${catalogue}:${values?.[0]}`)
					? [{ '?column?': 1 }]
					: [];
			}

			ran.push(sql);

			// Remember it, so a second pass converges rather than repeating.
			const created = sql.match(/^CREATE (ROLE|DATABASE|SCHEMA) "([^"]+)"/);
			if (created?.[1] && created[2]) {
				present.add(`${created[1].toLowerCase()}:${created[2]}`);
			}

			return [];
		},
	};

	return { client, ran };
}

describe('the cache table', () => {
	const withCache = {
		Orders: {
			kind: 'database',
			id: 'Orders',
			schema: 'app',
			provides: ['ORDERS_URL'],
		},
		Sessions: { kind: 'cache', id: 'Sessions', provides: ['SESSIONS_URL'] },
	} as const satisfies ConstructManifest;

	const cachePlan = (cache: 'db' | 'upstash') =>
		planFor(withCache, 'development', provisionOrder(withCache), { cache });

	it('is created for a parentless cache when the backend is the database', () => {
		// `cache: 'db'` puts a cache that named no parent in whichever database
		// the app declared — the shape a project gets by configuring the backend
		// rather than by wiring the construct. Reading only `of` here emitted the
		// `postgres://` URL and skipped the table it names, so every request
		// failed on a relation that did not exist.
		const statements = postgresStatements(cachePlan('db')).filter(
			(s) => s.id === 'Sessions',
		);

		expect(statements.length).toBeGreaterThan(0);
		expect(statements.every((s) => s.database === 'orders')).toBe(true);
	});

	it('gives two caches in one database a table each', () => {
		// Sharing a table would mean sharing a keyspace: each would read the
		// other's entries and evict the other's keys.
		const twoCaches = {
			Orders: {
				kind: 'database',
				id: 'Orders',
				schema: 'app',
				provides: ['ORDERS_URL'],
			},
			Sessions: { kind: 'cache', id: 'Sessions', provides: ['SESSIONS_URL'] },
			Rates: {
				kind: 'cache',
				id: 'Rates',
				of: 'Orders',
				provides: ['RATES_URL'],
			},
		} as const satisfies ConstructManifest;

		const created = postgresStatements(
			planFor(twoCaches, 'development', provisionOrder(twoCaches), {
				cache: 'db',
			}),
		).map((s) => s.create);

		expect(created).toContainEqual(
			expect.stringContaining('"app"."cache_sessions"'),
		);
		expect(created).toContainEqual(
			expect.stringContaining('"app"."cache_rates"'),
		);
	});

	it('creates it in the schema the reading role resolves names in', () => {
		// The driver names the table unqualified and lets `search_path` place it.
		// Created from the master connection, whose path is `public`, it lands
		// where the application cannot see it.
		expect(
			postgresStatements(cachePlan('db')).map((s) => s.create),
		).toContainEqual(expect.stringContaining('"app"."cache_sessions"'));
	});

	it('hands it to the owner and grants the runtime role', () => {
		// Default privileges are granted *for the owner role*, so nothing covers
		// a table the master created — and `roleStatements` grants what exists
		// when it runs, which is before this table does.
		const created = postgresStatements(cachePlan('db')).map((s) => s.create);

		expect(created).toContainEqual(
			'ALTER TABLE "app"."cache_sessions" OWNER TO "orders_owner"',
		);
		expect(created).toContainEqual(
			expect.stringContaining(
				'GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."cache_sessions"',
			),
		);
	});

	it('is not created when the cache lives somewhere else', () => {
		expect(
			postgresStatements(cachePlan('upstash')).some((s) => s.id === 'Sessions'),
		).toBe(false);
	});
});

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
	/** Statements that ask whether they are needed, as opposed to grants. */
	const checked = (statements: readonly { exists?: unknown }[]) =>
		statements.filter((s) => s.exists);

	it('creates what is missing', async () => {
		const { client, ran } = fakePostgres();
		const statements = postgresStatements(plan());
		const applied = await applyPostgres(client, statements);

		// Grants report unchanged by design — they run every time and re-granting
		// is a no-op — so the claim is about the statements that ask first.
		expect(applied.filter((a) => a.created)).toHaveLength(
			checked(statements).length,
		);
		expect(ran.some((sql) => sql.includes('CREATE DATABASE "orders"'))).toBe(
			true,
		);
	});

	it('creates nothing that already exists', async () => {
		const { client, ran } = fakePostgres([
			'orders',
			'auth',
			'auth_owner',
			'auth_reader',
		]);
		const applied = await applyPostgres(client, postgresStatements(plan()));

		expect(applied.every((a) => !a.created)).toBe(true);
		// Only the grants, which are idempotent and cost one round trip each.
		expect(ran.every((sql) => /^(GRANT|ALTER)/.test(sql))).toBe(true);
	});

	it('is convergent — applying twice creates once', async () => {
		// The property that lets `gkm dev` do this on every start.
		const { client } = fakePostgres();
		const statements = postgresStatements(plan());

		await applyPostgres(client, statements);
		const second = await applyPostgres(client, statements);

		expect(second.every((a) => !a.created)).toBe(true);
	});

	it('drops nothing', async () => {
		// The line is drawn at data: this creates, and never resets.
		const { client, ran } = fakePostgres();
		await applyPostgres(client, postgresStatements(plan()));

		expect(ran.some((sql) => /DROP|TRUNCATE/i.test(sql))).toBe(false);
	});

	it('gives a handler’s role no ability to create anything', async () => {
		// The whole point of the split: a compromised handler cannot DROP TABLE,
		// because its role holds no such grant.
		const { client, ran } = fakePostgres();
		await applyPostgres(client, postgresStatements(plan(), 'toolbox'));

		const runtimeGrants = ran.filter(
			(sql) => sql.includes('TO "auth"') && sql.startsWith('GRANT'),
		);

		expect(runtimeGrants.length).toBeGreaterThan(0);
		expect(
			runtimeGrants.every((sql) => !/CREATE|ALL PRIVILEGES/.test(sql)),
		).toBe(true);
	});

	it('owns the schema from the moment it exists', async () => {
		// Creating it as the master and granting afterwards leaves a window
		// where the master owns objects the owner is supposed to.
		const { client, ran } = fakePostgres();
		await applyPostgres(client, postgresStatements(plan(), 'toolbox'));

		expect(
			ran.some((sql) =>
				/CREATE SCHEMA "auth" AUTHORIZATION "auth_owner"/.test(sql),
			),
		).toBe(true);
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
