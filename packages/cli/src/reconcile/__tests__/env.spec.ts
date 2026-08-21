import type { ConstructManifest } from '@geekmidas/manifest';
import { provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { portKeys } from '../containers';
import { envFor } from '../env';
import { planFor } from '../plan';

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
	Sessions: { kind: 'cache', id: 'Sessions', provides: ['SESSIONS_URL'] },
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

const portsFor = (stage: string) => {
	const plan = planFor(manifest, stage, provisionOrder(manifest));

	return Object.fromEntries(
		portKeys(plan.containers).map((key, index) => [key, 20000 + index]),
	);
};

const env = (stage = 'development', mailFrom?: string) => {
	const plan = planFor(manifest, stage, provisionOrder(manifest));

	return envFor(plan, {
		ports: portsFor(stage),
		...(mailFrom ? { mailFrom } : {}),
	});
};

describe('envFor', () => {
	it('resolves one URL per construct', () => {
		expect(Object.keys(env()).sort()).toEqual([
			'AUTH_READER_URL',
			'AUTH_URL',
			'AWS_ACCESS_KEY_ID',
			'AWS_REGION',
			'AWS_SECRET_ACCESS_KEY',
			'EMAILS_PUBLISHER_CONNECTION_STRING',
			'EVENT_PUBLISHER_CONNECTION_STRING',
			'EVENT_SUBSCRIBER_CONNECTION_STRING',
			'MAIL_FROM',
			'MAIL_URL',
			'ORDERS_URL',
			'SESSIONS_URL',
			'UPLOADS_URL',
			'USERS_PUBLISHER_CONNECTION_STRING',
		]);
	});

	it('points a database at the port it was published on', () => {
		// Never the image default: the app reads a URL and never sees the port,
		// which is the whole reason allocation is free to move it.
		expect(env().ORDERS_URL).toContain(
			`@localhost:${portsFor('development').postgres}/orders`,
		);
	});

	it('names the stage-scoped database', () => {
		expect(env('test').ORDERS_URL).toContain('/orders_test');
	});

	it('puts a tenant in its parent’s database, on its own search path', () => {
		// A tenant is a schema, never a database of its own — that is what makes
		// pg-boss an instance of this rather than a special case.
		expect(env().AUTH_URL).toContain('/orders');
		expect(env().AUTH_URL).toContain('search_path=auth');
	});

	it('walks a reader to the database that actually exists', () => {
		// AuthReader → Auth → Orders. Reading the immediate parent would name a
		// database that was never created.
		expect(env().AUTH_READER_URL).toContain('/orders');
		expect(env().AUTH_READER_URL).toContain('search_path=auth');
	});

	it('gives object storage an endpoint so one client serves both', () => {
		// `?endpoint=` is the whole difference between S3 and MinIO — the client
		// is identical.
		expect(env().UPLOADS_URL).toMatch(/^s3:\/\/uploads\?/);
		expect(env().UPLOADS_URL).toContain('endpoint=http://localhost:');
	});

	it('always carries a region, never inheriting one', () => {
		// A bucket can live in a different region than the function reading it,
		// so a URL missing this breaks cross-region silently at runtime.
		expect(env().UPLOADS_URL).toContain('region=');
	});

	it('resolves mail to the same scheme a deployed provider gets', () => {
		expect(env().MAIL_URL).toMatch(/^smtp:\/\/localhost:\d+$/);
	});

	it('supplies a sending identity', () => {
		expect(env().MAIL_FROM).toBe('noreply@localhost');
	});

	it('lets the stage choose the sending identity', () => {
		expect(env('development', 'hello@myapp.test').MAIL_FROM).toBe(
			'hello@myapp.test',
		);
	});

	it('resolves the same keys whatever the stage', () => {
		// Only the value differs; the key an app reads is fixed, which is what
		// lets one construct serve both stages.
		expect(Object.keys(env('test')).sort()).toEqual(
			Object.keys(env('development')).sort(),
		);
	});

	it('resolves nothing without ports', () => {
		const plan = planFor(manifest, 'test', provisionOrder(manifest));

		expect(envFor(plan, { ports: {} })).toEqual({});
	});

	it('carries the cache token in the URL that addresses it', () => {
		// An address and the credential that opens it are one fact — the same
		// shape as a Postgres URL, and the reason the client takes one string.
		expect(env().SESSIONS_URL).toMatch(/^http:\/\/:[^@]+@localhost:\d+$/);
	});

	it('addresses a local bucket path-style', () => {
		// Virtual-host style would resolve `uploads.localhost`, which is not
		// MinIO and not anything.
		expect(env().UPLOADS_URL).toContain('forcePathStyle=true');
	});

	it('injects the credentials the S3 client resolves for MinIO', () => {
		// The URL deliberately carries none — deployed they come from the
		// execution role — so locally they arrive beside it, on the chain the
		// same client already reads.
		expect(env().AWS_ACCESS_KEY_ID).toBe('geekmidas');
		expect(env().AWS_SECRET_ACCESS_KEY).toBe('geekmidas');
	});

	it('gives a queue and a topic the same pg-boss connection', () => {
		// Both live in the database the app already declared, in pg-boss's own
		// schema — which is what makes it a schema tenant rather than a broker.
		const url = `@localhost:${portsFor('development').postgres}/orders?schema=pgboss`;

		expect(env().EMAILS_PUBLISHER_CONNECTION_STRING).toContain(url);
		expect(env().USERS_PUBLISHER_CONNECTION_STRING).toContain(url);
	});

	it('resolves the shared connection the local pollers open', () => {
		// One connection for every worker in the project: the generated pollers
		// subscribe each by name on it.
		expect(env().EVENT_SUBSCRIBER_CONNECTION_STRING).toBe(
			env().EVENT_PUBLISHER_CONNECTION_STRING,
		);
	});

	it('follows the stage into the queue database', () => {
		expect(env('test').EMAILS_PUBLISHER_CONNECTION_STRING).toContain(
			'/orders_test?schema=pgboss',
		);
	});
});
