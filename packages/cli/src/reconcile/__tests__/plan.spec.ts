import { type ConstructManifest, provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import {
	CacheIsAmbiguous,
	CacheNeedsDatabase,
	containerFor,
	PgBossNeedsDatabase,
	type PlanOptions,
	planFor,
	resourceName,
} from '../plan';

/** A database, a tenant, a reader on the tenant, a bucket, and mail. */
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
	Emails: {
		kind: 'queue',
		id: 'Emails',
		provides: ['EMAILS_PUBLISHER_CONNECTION_STRING'],
	},
	Users: {
		kind: 'topic',
		id: 'Users',
		provides: ['USERS_PUBLISHER_CONNECTION_STRING'],
	},
} as const satisfies ConstructManifest;

const plan = (stage: string, options?: PlanOptions) =>
	planFor(manifest, stage, provisionOrder(manifest), options);

describe('resourceName', () => {
	it('leaves the default stage unsuffixed', () => {
		// So a developer's psql history and saved connections survive this change.
		expect(resourceName('Orders', 'database', 'development')).toBe('orders');
	});

	it('suffixes a database with an underscore', () => {
		// A hyphen would need quoting in every Postgres identifier.
		expect(resourceName('Orders', 'database', 'test')).toBe('orders_test');
	});

	it('suffixes a bucket with a hyphen', () => {
		// Underscores are not valid in bucket names on some providers.
		expect(resourceName('Uploads', 'objects', 'test')).toBe('uploads-test');
	});

	it('suffixes derived kinds like their parent', () => {
		expect(resourceName('AuthReader', 'database-reader', 'test')).toBe(
			'authreader_test',
		);
	});

	it('handles stages beyond dev and test', () => {
		expect(resourceName('Orders', 'database', 'preview')).toBe(
			'orders_preview',
		);
	});
});

describe('containerFor', () => {
	it('maps every database kind onto one Postgres', () => {
		// A tenant lives inside its parent's container, not beside it.
		expect(containerFor('database')).toBe('postgres');
		expect(containerFor('database-schema')).toBe('postgres');
		expect(containerFor('database-reader')).toBe('postgres');
	});

	it('maps objects onto minio', () => {
		expect(containerFor('objects')).toBe('minio');
	});

	it('maps email onto mailpit whatever will deliver it deployed', () => {
		// One local container for every provider: the inbox you can actually
		// open, and the provider survives only as a host in the URL.
		expect(containerFor('email')).toBe('mailpit');
	});

	it('maps a cache onto the proxy the client actually speaks to', () => {
		expect(containerFor('cache')).toBe('redis-http');
	});

	it('maps a queue and a topic onto the broker, not onto one of their own', () => {
		expect(containerFor('queue', 'rabbitmq')).toBe('rabbitmq');
		expect(containerFor('topic', 'sns')).toBe('localstack');
	});

	it('maps a queue onto the declared database under pg-boss', () => {
		// The default, and the reason pg-boss needs no container: its queues are
		// tables in a database the app already declared.
		expect(containerFor('queue', 'pgboss')).toBe('postgres');
		expect(containerFor('topic')).toBe('postgres');
	});
});

describe('planFor', () => {
	it('deduplicates containers across constructs of the same kind', () => {
		// Three database constructs, one Postgres.
		expect(plan('development').containers.sort()).toEqual([
			'mailpit',
			'minio',
			'postgres',
		]);
	});

	it('gives mail a container but nothing to provision', () => {
		// Mailpit accepts whatever is sent to it, so there is nothing to create
		// inside it — but it still resolves a URL, so it stays in the plan.
		const { containers, resources } = plan('test');
		const mail = resources.find((r) => r.id === 'Mail');

		expect(containers).toContain('mailpit');
		expect(mail?.provisions).toBe(false);
	});

	it('marks resources that must be created', () => {
		const { resources } = plan('test');

		expect(resources.find((r) => r.id === 'Orders')?.provisions).toBe(true);
		expect(resources.find((r) => r.id === 'Uploads')?.provisions).toBe(true);
	});

	it('carries a tenant’s schema through to the applier', () => {
		expect(plan('test').resources.find((r) => r.id === 'Auth')?.schema).toBe(
			'auth',
		);
	});

	it('keeps parents ahead of the constructs derived from them', () => {
		expect(plan('development').resources.map((r) => r.id)).toEqual([
			'Orders',
			'Auth',
			'AuthReader',
			'Uploads',
			'Mail',
			'Emails',
			'Users',
		]);
	});

	it('records the parent of a derived resource', () => {
		const auth = plan('test').resources.find((r) => r.id === 'Auth');

		expect(auth?.of).toBe('Orders');
	});

	it('leaves a resource that provisions itself with no parent', () => {
		const orders = plan('test').resources.find((r) => r.id === 'Orders');

		expect(orders).not.toHaveProperty('of');
	});

	it('names every resource for the stage', () => {
		expect(
			Object.fromEntries(plan('test').resources.map((r) => [r.id, r.name])),
		).toEqual({
			Orders: 'orders_test',
			Auth: 'auth_test',
			AuthReader: 'authreader_test',
			Uploads: 'uploads-test',
			Mail: 'mail-test',
			Emails: 'emails-test',
			Users: 'users-test',
		});
	});

	it('derives the same env keys whatever the stage', () => {
		// Only the value differs between stages; the key an app reads is fixed,
		// which is what lets one construct serve both.
		const keys = (stage: string) => plan(stage).resources.map((r) => r.envKey);

		expect(keys('test')).toEqual(keys('development'));
		expect(keys('test')).toEqual([
			'ORDERS_URL',
			'AUTH_URL',
			'AUTH_READER_URL',
			'UPLOADS_URL',
			'MAIL_URL',
			'EMAILS_PUBLISHER_CONNECTION_STRING',
			'USERS_PUBLISHER_CONNECTION_STRING',
		]);
	});

	it('starts the same containers whatever the stage', () => {
		// The stage names resources; it never names infrastructure.
		expect(plan('test').containers).toEqual(plan('development').containers);
	});

	it('puts a queue and a topic in the backend the project selected', () => {
		expect(plan('test', { events: 'sns' }).containers).toContain('localstack');
		expect(plan('test', { events: 'rabbitmq' }).containers).toContain(
			'rabbitmq',
		);
	});

	it('adds no container for pg-boss', () => {
		// It is a schema tenant in a database the manifest already declares, so
		// mapping it to a container of its own would start a second Postgres.
		expect(plan('test', { events: 'pgboss' }).containers).toEqual(
			plan('test').containers,
		);
	});

	it('starts no broker for a project that declared no queue or topic', () => {
		// Config selects *which* backend, never *whether* one exists — that is
		// what the declarations are for, and rabbitmq for a project with nothing
		// to publish is the container this design refuses to invent.
		const queueless = {
			Orders: { kind: 'database', id: 'Orders' },
		} as const satisfies ConstructManifest;

		expect(
			planFor(queueless, 'test', provisionOrder(queueless), {
				events: 'rabbitmq',
			}).containers,
		).toEqual(['postgres']);
	});

	it('refuses pg-boss with nowhere to live', () => {
		// The fix is a line of application code either way, so it is worth the
		// error rather than a Postgres started to hold only a queue.
		const homeless = {
			Emails: { kind: 'queue', id: 'Emails' },
		} as const satisfies ConstructManifest;

		expect(() =>
			planFor(homeless, 'test', provisionOrder(homeless), {
				events: 'pgboss',
			}),
		).toThrow(PgBossNeedsDatabase);
	});

	it('starts no database for pg-boss when nothing declared one', () => {
		expect(planFor({}, 'test', [], { events: 'pgboss' }).containers).toEqual(
			[],
		);
	});

	it('starts the Redis a cache proxy cannot run without', () => {
		// The plan is what decides what must be running, so a container that
		// cannot run alone names its companion here rather than in the compose
		// file, where nothing would be waiting on it.
		const cached = {
			Sessions: { kind: 'cache', id: 'Sessions' },
		} as const satisfies ConstructManifest;

		expect(
			planFor(cached, 'test', provisionOrder(cached)).containers.sort(),
		).toEqual(['redis', 'redis-http']);
	});

	it('merges in containers no construct implies', () => {
		// What the workspace `services:` block becomes: a list of exceptions.
		expect(plan('test', { extraContainers: ['redis'] }).containers).toContain(
			'redis',
		);
	});

	it('does not duplicate an extra container a construct already implies', () => {
		const { containers } = plan('test', { extraContainers: ['postgres'] });

		expect(containers.filter((c) => c === 'postgres')).toHaveLength(1);
	});

	it('plans nothing for an empty manifest', () => {
		expect(planFor({}, 'test', [])).toEqual({
			stage: 'test',
			events: 'pgboss',
			cache: 'upstash',
			containers: [],
			resources: [],
		});
	});

	it('ignores kinds that need no container', () => {
		// A function is not a resource; it appears in the manifest but plans
		// nothing here.
		const withUnknown = planFor(
			{ Orders: { kind: 'database', id: 'Orders' } },
			'test',
			['Orders', 'SomethingElse'],
		);

		expect(withUnknown.resources).toHaveLength(1);
	});
});

describe('cache backends', () => {
	const withCache = {
		Sessions: { kind: 'cache', id: 'Sessions' },
	} as const satisfies ConstructManifest;

	const withDatabase = {
		...withCache,
		Orders: { kind: 'database', id: 'Orders' },
	} as const satisfies ConstructManifest;

	it('runs the HTTP proxy for upstash, so dev speaks what prod speaks', () => {
		const plan = planFor(withCache, 'development', provisionOrder(withCache));

		// The proxy and the Redis behind it: the client speaks HTTP with a token
		// wherever it runs.
		expect(plan.containers.sort()).toEqual(['redis', 'redis-http']);
	});

	it('runs plain Redis for elasticache, which speaks the wire protocol', () => {
		const plan = planFor(withCache, 'development', provisionOrder(withCache), {
			cache: 'elasticache',
		});

		expect(plan.containers).toEqual(['redis']);
	});

	it('starts nothing at all for a cache in the database', () => {
		const plan = planFor(
			withDatabase,
			'development',
			provisionOrder(withDatabase),
			{ cache: 'db' },
		);

		// The same relationship pg-boss has: a table in a database that already
		// exists, so there is no second container and no second credential.
		expect(plan.containers).toEqual(['postgres']);
	});

	it('refuses a database-backed cache with no database', () => {
		// Starting a Postgres to hold only a cache would be the container this
		// design refuses to invent.
		expect(() =>
			planFor(withCache, 'development', provisionOrder(withCache), {
				cache: 'db',
			}),
		).toThrow(CacheNeedsDatabase);
	});

	it('resolves the backend into an edge, so nothing downstream re-derives it', () => {
		// `cache: 'db'` names something that is *in the graph*, unlike upstash or
		// elasticache — so it becomes the same `of` that `orders.cache()` sets,
		// and every reader follows an edge instead of testing a string.
		const plan = planFor(
			withDatabase,
			'development',
			provisionOrder(withDatabase),
			{ cache: 'db' },
		);

		expect(plan.resources.find((r) => r.id === 'Sessions')?.of).toBe('Orders');
	});

	it('leaves a cache that named its own database alone', () => {
		// The declaration is the stronger statement: config choosing otherwise
		// would move a cache the app said lives somewhere.
		const named = {
			Orders: { kind: 'database', id: 'Orders' },
			Reports: { kind: 'database', id: 'Reports' },
			Sessions: { kind: 'cache', id: 'Sessions', of: 'Reports' },
		} as const satisfies ConstructManifest;

		const plan = planFor(named, 'development', provisionOrder(named), {
			cache: 'db',
		});

		expect(plan.resources.find((r) => r.id === 'Sessions')?.of).toBe('Reports');
	});

	it('refuses to guess which database, rather than picking the first', () => {
		// A cache silently landing in the wrong database surfaces as missing rows
		// much later, so two candidates is an error and not a coin toss.
		const two = {
			Orders: { kind: 'database', id: 'Orders' },
			Reports: { kind: 'database', id: 'Reports' },
			Sessions: { kind: 'cache', id: 'Sessions' },
		} as const satisfies ConstructManifest;

		expect(() =>
			planFor(two, 'development', provisionOrder(two), { cache: 'db' }),
		).toThrow(CacheIsAmbiguous);
	});
});
