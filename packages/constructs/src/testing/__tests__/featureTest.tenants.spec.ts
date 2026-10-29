import { randomUUID } from 'node:crypto';
import { EnvironmentParser } from '@geekmidas/envkit';
import { serviceContext } from '@geekmidas/services';
import { NoWildcardSite } from '@geekmidas/testkit/browser';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { z } from 'zod/v4';
import { TEST_DATABASE_CONFIG } from '../../../../testkit/test/globalSetup';
import { BetterAuth } from '../../auth';
import { KyselyDatabase } from '../../database/kysely';
import { RestApi } from '../../rest-api';
import { StaticSite } from '../../site';
import { featureTest } from '../featureTest';
import type { TestManifest } from '../manifest';

/**
 * A multi-tenant app in a feature test: a site on every subdomain, and a
 * browser that signs in once and calls the app as two tenants by host.
 *
 * The auth server is real, so the wildcard in its trusted origins is checked
 * the way Better Auth checks it deployed — a tenant's host is let in, a host
 * two labels deep is not.
 */

const schema = `ft_tenants_${randomUUID().slice(0, 8)}`;
const { host, port, user, password, database } = TEST_DATABASE_CONFIG;
const AUTH_DB_URL = `postgres://${user}:${password}@${host}:${port}/${database}?search_path=${schema}`;

const AUTH_URL = 'http://auth.tenants.localhost';
const API_URL = 'http://api.tenants.localhost';
/** What the test stage resolves a wildcard site to: a port on the edge. */
const APP_URL = 'https://*.test.tenants.localhost:8443';
const TENANTS = 'https://*.test.tenants.localhost:8443';

const env = {
	AUTH_DB_URL,
	AUTH_SECRET: 'a-signing-secret-that-is-at-least-32-chars',
	AUTH_URL,
	AUTH_TRUSTED_ORIGINS: TENANTS,
	API_URL,
	API_TRUSTED_ORIGINS: TENANTS,
	APP_URL,
};

const authDb = new KyselyDatabase('AuthDb');
const auth = new BetterAuth('Auth', {
	database: authDb,
	path: 'apps/auth',
	options: { emailAndPassword: { enabled: true } },
});

const api = new RestApi('Api', {
	path: 'apps/api',
	defaultAuthorizer: 'none',
	envParser: new EnvironmentParser(env),
}).auth(auth);

/** Who is asking, and from which tenant's host — read off `Origin`. */
export const whoAmI = api
	.session(async ({ auth }) => auth.getSession())
	.get('/me')
	.output(
		z.object({ email: z.string().nullable(), tenant: z.string().nullable() }),
	)
	.handle(async ({ session, header }) => {
		const origin = header('origin');
		return {
			email: session?.user.email ?? null,
			tenant: origin ? new URL(origin).hostname.split('.')[0]! : null,
		};
	});

/**
 * Which hosts are tenants. Asked by the edge, which a feature test has none
 * of — a request goes straight to the surface — so it is declared, not called.
 */
export const tenantHosts = api.get('/tenants/hosts').handle(async () => ({}));

const app = new StaticSite('App', {
	path: 'apps/app',
	subdomain: '*',
	hosts: tenantHosts,
}).dependsOn([api, auth]);

const manifest: TestManifest = {
	stage: 'test',
	constructs: {
		AuthDb: {
			kind: 'database',
			source: { file: 'constructs', export: 'authDb' },
		},
		Auth: {
			kind: 'better-auth',
			source: { file: 'constructs', export: 'auth' },
		},
		Api: { kind: 'rest-api', source: { file: 'constructs', export: 'api' } },
		App: { kind: 'site', source: { file: 'constructs', export: 'app' } },
	},
	endpoints: [
		{ surface: 'Api', source: { file: 'endpoints', export: 'whoAmI' } },
		{ surface: 'Api', source: { file: 'endpoints', export: 'tenantHosts' } },
	],
	env,
};

const it = featureTest({
	manifest,
	modules: {
		constructs: { authDb, auth, api, app },
		endpoints: { whoAmI, tenantHosts },
	},
});

/** Sign up through the auth server, from whichever host `fetch` is on. */
function signUp(fetch: typeof globalThis.fetch, email: string) {
	return fetch(`${AUTH_URL}/api/auth/sign-up/email`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			email,
			password: 'correct horse battery',
			name: 'Ada',
		}),
	});
}

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
	try {
		await client.query(`CREATE SCHEMA "${schema}"`);
		const pending = await auth.pendingMigration({
			envParser: new EnvironmentParser(env),
			context: serviceContext,
		});
		await client.query(`SET search_path TO "${schema}"`);
		if (pending) await client.query(pending);
	} finally {
		await client.end();
	}
});

afterAll(async () => {
	const client = new pg.Client(TEST_DATABASE_CONFIG);
	await client.connect();
	await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
	await client.end();
});

describe('a browser on a tenant’s host', () => {
	it('signs in once and calls the app as two tenants', async ({ browser }) => {
		const email = `${randomUUID()}@tenants.test`;
		const acme = browser.on('acme');
		expect((await signUp(acme.fetch, email)).status).toBe(200);
		const cookie = await browser.cookieHeader(AUTH_URL);

		const me = async (tenant: string) => {
			const response = await browser
				.on(tenant)
				.fetch(`${API_URL}/me`, { headers: { cookie } });
			return response.json();
		};
		expect(await me('acme')).toEqual({ email, tenant: 'acme' });
		expect(await me('globex')).toEqual({ email, tenant: 'globex' });
	});

	it('knows the tenants’ address without being told', async ({ browser }) => {
		// The feature test read it off the stage's env, so `on` needs only the
		// slug — and a browser made by hand, with none, refuses one.
		expect(browser.on('acme').origin).toBe(
			'https://acme.test.tenants.localhost:8443',
		);
		const { Browser } = await import('@geekmidas/testkit/browser');
		expect(() => new Browser().on('acme')).toThrow(NoWildcardSite);
	});
});
