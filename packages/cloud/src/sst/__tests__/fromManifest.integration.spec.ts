import {
	type ConstructManifest,
	PUBLIC,
	PUBLIC_PREFIX,
	providedKeyFor,
	schemeBase,
} from '@geekmidas/manifest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseNeedsVpc } from '../aws/Database';
import { EmailNeedsSender } from '../aws/Email';
import { CacheIsAmbiguous, ProvidesMismatch } from '../errors';
import { describeRoutes, fromManifest } from '../fromManifest';

/**
 * A whole manifest through the adapter: every kind provisioned in order,
 * each checked against the keys it declared, the site built against its API's
 * address, and each surface told who calls it. SST's components are recording
 * stubs (`test/sst-globals.ts`), so this runs without a deploy.
 */

const stack = {} as never;
const vpc = { subnets: ['subnet-1'], securityGroups: ['sg-1'] } as never;

const keys = (id: string, kind: string, roles: string[]) =>
	roles.map((role) => providedKeyFor(id, kind as never, role));
const SURFACE = ['url', 'trustedOrigins', 'cookieDomain'];

function manifest(): ConstructManifest {
	return {
		Uploads: {
			kind: 'objects',
			id: 'Uploads',
			versioned: true,
			provides: keys('Uploads', 'objects', ['url']),
		},
		Files: {
			kind: 'file-server',
			id: 'Files',
			of: 'Uploads',
			provides: keys('Files', 'file-server', ['url']),
		},
		Emails: {
			kind: 'queue',
			id: 'Emails',
			fifo: true,
			provides: keys('Emails', 'queue', ['publisherConnectionString']),
		},
		Users: {
			kind: 'topic',
			id: 'Users',
			provides: keys('Users', 'topic', ['publisherConnectionString']),
		},
		Orders: {
			kind: 'database',
			id: 'Orders',
			engine: 'postgres',
			provides: keys('Orders', 'database', ['url']),
		},
		OrdersReader: {
			kind: 'database-reader',
			id: 'OrdersReader',
			of: 'Orders',
			provides: keys('OrdersReader', 'database-reader', ['url']),
		},
		Sessions: {
			kind: 'cache',
			id: 'Sessions',
			provides: keys('Sessions', 'cache', ['url']),
		},
		Api: {
			kind: 'rest-api',
			id: 'Api',
			path: 'apps/api',
			endpoints: [
				{
					id: 'ListOrders',
					handler: 'orders.handler',
					method: 'GET',
					path: '/orders',
					dependencies: [{ target: 'Orders', kind: 'database' }],
				},
				{
					id: 'Health',
					handler: 'health.handler',
					method: 'GET',
					path: '/health',
					dependencies: [],
				},
			],
			calls: [{ target: 'Auth', kind: 'rest-api' }],
			provides: keys('Api', 'rest-api', SURFACE),
		},
		Auth: {
			kind: 'rest-api',
			id: 'Auth',
			path: 'apps/auth',
			endpoints: [],
			provides: keys('Auth', 'rest-api', SURFACE),
		},
		Web: {
			kind: 'site',
			id: 'Web',
			variant: 'static',
			app: { path: 'apps/web' },
			dependencies: [
				{ target: 'Api', kind: 'rest-api' },
				{ target: 'Users', kind: 'topic' },
			],
			provides: keys('Web', 'site', ['url']),
		},
		Mail: {
			kind: 'email',
			id: 'Mail',
			provides: keys('Mail', 'email', ['url', 'from']),
		},
		AuthSecret: {
			kind: 'secret',
			id: 'AuthSecret',
			provides: keys('AuthSecret', 'secret', ['value']),
		},
	} as unknown as ConstructManifest;
}

const overrides = {
	Orders: { vpc },
	Mail: { from: 'hello@shop.test', url: 'smtp://relay.test:587' },
};

const argsOf = (component: unknown) =>
	(component as { args: Record<string, unknown> }).args;

/** A Pulumi-ish input as the value it resolves to. */
const settle = async (value: unknown): Promise<unknown> =>
	typeof value === 'object' && value && 'apply' in value
		? (value as { apply: (fn: (v: unknown) => unknown) => unknown }).apply(
				(v) => v,
			)
		: value;

describe('fromManifest', () => {
	afterEach(() => vi.restoreAllMocks());

	it('provisions every declaration, each supplying exactly what it declared', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const provisioned = fromManifest(stack, manifest(), overrides, {
			cache: 'db',
			email: 'smtp',
		});

		expect(Object.keys(provisioned).sort()).toEqual(
			Object.keys(manifest()).sort(),
		);
	});

	it('maps each declaration’s options onto its component', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const provisioned = fromManifest(stack, manifest(), overrides, {
			cache: 'db',
			email: 'smtp',
		});

		// A bucket something serves lets CloudFront read it; its declared
		// versioning is carried in this provider's word for it.
		expect(argsOf(provisioned.Uploads)).toMatchObject({
			versioning: true,
			access: 'cloudfront',
		});
		expect(argsOf(provisioned.Emails)).toMatchObject({ fifo: true });
		// The declared Postgres major, not whatever the default is that month.
		expect(argsOf(provisioned.Orders)).toMatchObject({ vpc, version: '18' });
	});

	it('builds the site against the addresses its edges resolve to', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const provisioned = fromManifest(stack, manifest(), overrides, {
			cache: 'db',
		});
		const env = argsOf(provisioned.Web).environment as Record<string, unknown>;

		const apiKey = `${PUBLIC_PREFIX.static}${providedKeyFor('Api', 'rest-api', 'url')}`;
		expect(env[apiKey]).toBe(provisioned.Api!.provides().url);
		// A topic has nothing a browser may see, so the site gets nothing from it.
		expect(PUBLIC.topic ?? []).toEqual([]);
		expect(Object.keys(env)).toEqual([apiKey]);
	});

	it('keeps a db-backed cache in the declared database, in its own table', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const provisioned = fromManifest(stack, manifest(), overrides, {
			cache: 'db',
		});
		const url = String(await settle(provisioned.Sessions!.provides().url));

		expect(url).toContain('db.stub.rds.amazonaws.com');
		expect(url).toMatch(/sessions/i);
	});

	it('tells each surface who calls it once everything exists', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const provisioned = fromManifest(stack, manifest(), overrides, {
			cache: 'db',
		});
		const origin = (id: string) =>
			new URL(String(provisioned[id]!.provides().url)).origin;

		// The site depends on the API, so its origin is on the API's list.
		expect(await settle(provisioned.Api!.provides().trustedOrigins)).toContain(
			origin('Web'),
		);
		// The API calls the auth server, so it is on the auth server's list.
		expect(await settle(provisioned.Auth!.provides().trustedOrigins)).toContain(
			origin('Api'),
		);
	});

	it('builds nothing for a mobile app, and has the surfaces it calls trust its scheme', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});

		const provisioned = fromManifest(
			stack,
			{
				...manifest(),
				App: {
					kind: 'mobile-app',
					id: 'App',
					variant: 'expo',
					app: { path: 'apps/app' },
					dependencies: [{ target: 'Auth', kind: 'rest-api' }],
					provides: ['APP_SCHEME'],
				},
			} as ConstructManifest,
			overrides,
			{ cache: 'db' },
		);

		// EAS and the stores ship it — this stack has nothing to create for it.
		expect(provisioned.App).toBeUndefined();
		const origins = String(
			await settle(provisioned.Auth!.provides().trustedOrigins),
		).split(',');
		// The bare scheme deployed: the one the store build registers.
		const scheme = `${schemeBase($app.name)}://`;
		expect(origins).toContain(scheme);
		expect(origins).toContain(`${scheme}*`);
	});

	it('prints every route and exactly what it can reach', () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});

		fromManifest(stack, manifest(), overrides, { cache: 'db' });

		expect(log.mock.calls.map(([line]) => line)).toEqual(
			describeRoutes(manifest()),
		);
		expect(describeRoutes(manifest())).toEqual([
			'Api:',
			'  GET /orders → Orders (database)',
			'  GET /health → nothing',
			'  calls Auth (origin only; grants nothing)',
			'Auth:',
			'  (no routes)',
		]);
	});

	describe('schema tenants', () => {
		const tenants = (roles?: false) =>
			({
				Orders: {
					kind: 'database',
					id: 'Orders',
					engine: 'postgres',
					schema: 'app',
					...(roles === false ? { roles: false } : {}),
					provides: keys('Orders', 'database', ['url']),
				},
				OrdersReader: {
					kind: 'database-reader',
					id: 'OrdersReader',
					of: 'Orders',
					provides: keys('OrdersReader', 'database-reader', ['url']),
				},
				AuthDb: {
					kind: 'database-schema',
					id: 'AuthDb',
					of: 'Orders',
					schema: 'authdb',
					provides: keys('AuthDb', 'database-schema', ['url']),
				},
				// A tenant of a tenant still lives in the one cluster.
				AuditDb: {
					kind: 'database-schema',
					id: 'AuditDb',
					of: 'AuthDb',
					schema: 'audit',
					provides: keys('AuditDb', 'database-schema', ['url']),
				},
			}) as unknown as ConstructManifest;

		it('gives each tenant its own role, and the reader the database’s read-only one', async () => {
			vi.spyOn(console, 'log').mockImplementation(() => {});

			const provisioned = fromManifest(stack, tenants(), { Orders: { vpc } });
			const url = async (id: string) =>
				String(await settle(provisioned[id]!.provides().url));

			// Each connects as its own role, never the master.
			expect(await url('AuthDb')).toContain('authdb:');
			expect(await url('AuditDb')).toContain('auditdb:');
			expect(await url('OrdersReader')).toContain('orders_reader:');
			expect(await url('Orders')).not.toContain('postgres:stub-password');
		});

		it('falls back to the master everywhere under roles: false', async () => {
			vi.spyOn(console, 'log').mockImplementation(() => {});

			const provisioned = fromManifest(stack, tenants(false), {
				Orders: { vpc },
			});

			expect(
				String(await settle(provisioned.AuthDb!.provides().url)),
			).toContain('postgres:stub-password');
		});
	});

	it('takes an existing cache and mailer rather than creating them', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const provisioned = fromManifest(
			stack,
			manifest(),
			{
				...overrides,
				Sessions: { url: 'https://:token@cache.upstash.test' },
				Mail: { ...overrides.Mail, region: 'af-south-1' },
			},
			{ cache: 'upstash', email: 'ses' },
		);

		expect(await settle(provisioned.Sessions!.provides().url)).toBe(
			'https://:token@cache.upstash.test',
		);
		expect(provisioned.Mail!.provides().url).toBe('smtp://relay.test:587');
	});

	describe('refuses', () => {
		it('a database with no VPC to live in', () => {
			expect(() =>
				fromManifest(
					stack,
					manifest(),
					{ Mail: overrides.Mail },
					{ cache: 'db' },
				),
			).toThrow(DatabaseNeedsVpc);
		});

		it('a mailer with no sending identity', () => {
			expect(() =>
				fromManifest(stack, manifest(), { Orders: { vpc } }, { cache: 'db' }),
			).toThrow(EmailNeedsSender);
		});

		it('a db-backed cache when two databases could hold it', () => {
			const two = {
				...manifest(),
				Billing: {
					kind: 'database',
					id: 'Billing',
					engine: 'postgres',
					provides: keys('Billing', 'database', ['url']),
				},
			} as unknown as ConstructManifest;

			expect(() =>
				fromManifest(
					stack,
					two,
					{ ...overrides, Billing: { vpc } },
					{ cache: 'db' },
				),
			).toThrow(CacheIsAmbiguous);
		});

		it('a component supplying keys the declaration did not name', () => {
			const drifted = {
				...manifest(),
				Users: { ...manifest().Users, provides: [] },
			} as unknown as ConstructManifest;

			expect(() =>
				fromManifest(stack, drifted, overrides, { cache: 'db' }),
			).toThrow(ProvidesMismatch);
		});
	});
});
