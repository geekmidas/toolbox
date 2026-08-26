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
	AuthApi: {
		kind: 'rest-api',
		id: 'AuthApi',
		provides: [
			'AUTH_API_URL',
			'AUTH_API_TRUSTED_ORIGINS',
			'AUTH_API_COOKIE_DOMAIN',
		],
		endpoints: [],
	},
	Console: {
		kind: 'site',
		id: 'Console',
		variant: 'static',
		path: 'apps/console',
		dependencies: [
			{ target: 'AuthApi', kind: 'rest-api' },
			{ target: 'Orders', kind: 'database' },
		],
		provides: ['CONSOLE_URL'],
	},
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
		addresses: {
			AuthApi: 'http://localhost:3000',
			Console: 'http://localhost:5173',
		},
		...(mailFrom ? { mailFrom } : {}),
	});
};

describe('envFor', () => {
	it('resolves one URL per construct', () => {
		expect(Object.keys(env()).sort()).toEqual([
			'AUTH_API_TRUSTED_ORIGINS',
			'AUTH_API_URL',
			'AUTH_READER_URL',
			'AUTH_URL',
			'AWS_ACCESS_KEY_ID',
			'AWS_REGION',
			'AWS_SECRET_ACCESS_KEY',
			'CONSOLE_URL',
			'EMAILS_PUBLISHER_CONNECTION_STRING',
			'EVENT_PUBLISHER_CONNECTION_STRING',
			'EVENT_SUBSCRIBER_CONNECTION_STRING',
			'MAIL_FROM',
			'MAIL_URL',
			'ORDERS_URL',
			'SESSIONS_URL',
			'UPLOADS_URL',
			'USERS_PUBLISHER_CONNECTION_STRING',
			// The site's own copy of its API's address, under the name its
			// bundler inlines. No database URL has one: `PUBLIC` decides which
			// values may be prefixed, and a connection string never may.
			'VITE_AUTH_API_URL',
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

	it('answers a surface on the app’s own port, not a container’s', () => {
		// The first kind whose address belongs to something gkm starts rather
		// than something Docker published.
		expect(env().AUTH_API_URL).toBe('http://localhost:3000');
	});

	it('derives who may call a surface from its inbound edges', () => {
		// Better Auth rejects an untrusted origin whether or not it is a browser,
		// so a sibling service calling it needs to be on this list — and the one
		// thing that declared it calls this surface is the console's edge.
		expect(env().AUTH_API_TRUSTED_ORIGINS).toBe('http://localhost:5173');
	});

	it('leaves a surface out of its own origin list', () => {
		// A surface does not need permission to call itself, and putting its own
		// address on the list would make every surface sharing a port trust
		// every other one — which is not an edge anybody declared.
		expect(env().AUTH_API_TRUSTED_ORIGINS).not.toContain(
			'http://localhost:3000',
		);
	});

	it('scopes no cookie domain across one host', () => {
		// Everything local is `localhost` on a different port, and cookies ignore
		// the port — so there is nothing for a Domain attribute to widen, and
		// `.localhost` is not a domain a browser accepts.
		expect(env().AUTH_API_COOKIE_DOMAIN).toBeUndefined();
	});

	it('gives a site its API’s address under the name its bundler inlines', () => {
		// The same value the server reads, renamed — not a second derivation, so
		// the two cannot come to disagree about where the API is.
		expect(env().VITE_AUTH_API_URL).toBe('http://localhost:3000');
	});

	it('keeps a credential-bearing URL out of a bundle', () => {
		// `PUBLIC` decides what may be prefixed. A database URL carries its
		// password, so no prefixed form of it exists at all.
		expect(
			Object.keys(env()).some((key) => key.startsWith('VITE_ORDERS')),
		).toBe(false);
	});

	it('scopes a cookie to the domain a surface and its callers share', () => {
		const plan = planFor(manifest, 'development', provisionOrder(manifest));

		const env = envFor(plan, {
			ports: portsFor('development'),
			addresses: {
				AuthApi: 'https://api.example.com',
				Console: 'https://console.example.com',
			},
		});

		expect(env.AUTH_API_COOKIE_DOMAIN).toBe('.example.com');
	});
});
