import { randomUUID } from 'node:crypto';
import { EnvironmentParser } from '@geekmidas/envkit';
import { serviceContext } from '@geekmidas/services';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../../testkit/test/globalSetup';
import { BetterAuth, type BetterAuthOptions } from '../auth';
import { KyselyDatabase } from '../database/kysely';

/**
 * The auth server as an app runs it: a real tenant on the test Postgres,
 * better-auth's own migrations, and its routes served through the Hono app
 * `server()` builds — requests in, cookies out.
 */

// A schema of its own in the shared test database, so runs never see each
// other's users; dropping a schema needs no connection to be killed.
const schema = `auth_spec_${randomUUID().slice(0, 8)}`;
const { host, port, user, password, database } = TEST_DATABASE_CONFIG;
const url = `postgres://${user}:${password}@${host}:${port}/${database}?search_path=${schema}`;

const AUTH_URL = 'http://auth.shop.localhost';
const WEB_ORIGIN = 'http://web.shop.localhost';

const tenant = new KyselyDatabase('AuthDb');

/** The environment a target resolves for `Auth`, plus overrides. */
function options(env: Record<string, string> = {}) {
	return {
		envParser: new EnvironmentParser({
			AUTH_DB_URL: url,
			AUTH_SECRET: 'a-signing-secret-that-is-at-least-32-chars',
			AUTH_URL,
			AUTH_TRUSTED_ORIGINS: WEB_ORIGIN,
			...env,
		}),
		context: serviceContext,
	};
}

/** An auth server with email sign-up, which better-auth leaves off. */
function auth(extra: Partial<BetterAuthOptions> = {}, basePath?: string) {
	return new BetterAuth('Auth', {
		database: tenant,
		path: 'apps/auth',
		...(basePath ? { basePath } : {}),
		options: { emailAndPassword: { enabled: true }, ...extra },
	});
}

const signUp = (email: string, origin = WEB_ORIGIN) =>
	new Request(`${AUTH_URL}/api/auth/sign-up/email`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin },
		body: JSON.stringify({
			email,
			password: 'correct horse battery',
			name: 'Ada',
		}),
	});

const email = (who: string) => `${who}-${randomUUID()}@shop.test`;

beforeAll(async () => {
	// The shared database testkit's setup creates in a full run; created here
	// when this project runs alone. Another setup may win the race.
	const server = new pg.Client({
		...TEST_DATABASE_CONFIG,
		database: 'postgres',
	});
	await server.connect();
	await server
		.query(`CREATE DATABASE "${database}"`)
		.catch((error: { code?: string }) => {
			if (error.code !== '42P04' && error.code !== '23505') throw error;
		});
	await server.end();

	const client = new pg.Client(TEST_DATABASE_CONFIG);
	await client.connect();
	await client.query(`CREATE SCHEMA "${schema}"`);
	await client.end();

	// better-auth's own tables, created as the owner — the tenant has no
	// separate owner URL here, so it falls back to its runtime one.
	const migrate = await auth().migrations(options());
	await migrate();
});

afterAll(async () => {
	const client = new pg.Client(TEST_DATABASE_CONFIG);
	await client.connect();
	await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
	await client.end();
});

describe('BetterAuth.declare', () => {
	it('declares its signing secret and one wildcard surface on its tenant', () => {
		const construct = new BetterAuth('Auth', {
			database: tenant,
			path: 'apps/auth',
		});

		expect(construct.service.serviceName).toBe('auth');
		expect(construct.declare()).toEqual([
			{ kind: 'secret', id: 'AuthSecret', provides: ['AUTH_SECRET'] },
			{
				kind: 'rest-api',
				id: 'Auth',
				path: 'apps/auth',
				provides: ['AUTH_URL', 'AUTH_TRUSTED_ORIGINS', 'AUTH_COOKIE_DOMAIN'],
				endpoints: [
					{
						id: 'AuthHandler',
						handler: 'Auth.handler',
						method: 'ANY',
						path: '/api/auth/*',
						dependencies: [{ target: 'AuthDb', kind: 'database' }],
						requires: ['AUTH_SECRET'],
					},
				],
			},
		]);
	});

	it('mounts its routes under the base path it was given', () => {
		const construct = auth({}, '/auth');

		expect(construct.basePath).toBe('/auth');
		expect(construct.declare()[1]).toMatchObject({
			endpoints: [{ path: '/auth/*' }],
		});
	});
});

describe('BetterAuth.server', () => {
	it('signs a user up, and serves their session from the cookie it set', async () => {
		const { app } = await auth().server(options());

		const created = await app.request(signUp(email('ada')));
		expect(created.status).toBe(200);
		const cookie = created.headers.get('set-cookie')!;
		expect(cookie).toContain('better-auth.session_token=');

		const session = await app.request(`${AUTH_URL}/api/auth/get-session`, {
			headers: { cookie: cookie.split(';')[0]!, origin: WEB_ORIGIN },
		});
		expect(await session.json()).toMatchObject({ user: { name: 'Ada' } });

		const anonymous = await app.request(`${AUTH_URL}/api/auth/get-session`, {
			headers: { origin: WEB_ORIGIN },
		});
		expect(await anonymous.json()).toBeNull();
	});

	it('answers CORS for the origins the graph trusts, and no others', async () => {
		const { app } = await auth().server(options());
		const preflight = (origin: string) =>
			app.request(`${AUTH_URL}/api/auth/sign-up/email`, {
				method: 'OPTIONS',
				headers: { origin, 'access-control-request-method': 'POST' },
			});

		const trusted = await preflight(WEB_ORIGIN);
		expect(trusted.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
		expect(trusted.headers.get('access-control-allow-credentials')).toBe(
			'true',
		);

		const stranger = await preflight('http://evil.test');
		expect(stranger.headers.get('access-control-allow-origin')).toBeNull();
	});

	it('trusts the derived origins plus any its options add, through service.register', async () => {
		// What a handler gets from `.dependsOn([auth])`. Better Auth enforces
		// the list (and relaxes it under a test runner), so what is asserted is
		// the list this construct hands it.
		const partner = 'http://partner.test';
		const server = await auth({ trustedOrigins: [partner] }).service.register(
			options({
				AUTH_TRUSTED_ORIGINS: `${WEB_ORIGIN}, http://admin.shop.localhost`,
			}),
		);

		expect(server.options.trustedOrigins).toEqual([
			WEB_ORIGIN,
			'http://admin.shop.localhost',
			partner,
		]);
		expect(server.options.baseURL).toBe(AUTH_URL);
		expect(server.options.basePath).toBe('/api/auth');
		expect(server.options.advanced?.crossSubDomainCookies).toBeUndefined();
	});

	it('adds the origins its options name to the ones the graph derived', async () => {
		const partner = 'http://partner.test';
		const { app } = await auth({ trustedOrigins: [partner] }).server(options());

		expect((await app.request(signUp(email('pat'), partner))).status).toBe(200);
		// The derived origin still works: the configured list adds to it.
		expect((await app.request(signUp(email('web')))).status).toBe(200);
	});

	it('hands options given as a function the register options', async () => {
		let seen: unknown;
		const opts = options();
		const construct = new BetterAuth('Auth', {
			database: tenant,
			path: 'apps/auth',
			options: async (registered) => {
				seen = registered;
				return { emailAndPassword: { enabled: true } };
			},
		});

		const { app } = await construct.server(opts);

		expect(seen).toBe(opts);
		expect((await app.request(signUp(email('fn')))).status).toBe(200);
	});

	it('widens the session cookie to the derived domain, and only then', async () => {
		const widened = await auth().server(
			options({ AUTH_COOKIE_DOMAIN: 'shop.localhost' }),
		);
		const wide = await widened.app.request(signUp(email('w')));
		expect(wide.headers.get('set-cookie')).toMatch(/Domain=shop\.localhost/i);

		const plain = await auth().server(options());
		const narrow = await plain.app.request(signUp(email('n')));
		expect(narrow.headers.get('set-cookie')).not.toMatch(/Domain=/i);
	});
});
