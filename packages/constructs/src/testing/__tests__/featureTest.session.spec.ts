import { randomUUID } from 'node:crypto';
import { EnvironmentParser } from '@geekmidas/envkit';
import { serviceContext } from '@geekmidas/services';
import { Browser } from '@geekmidas/testkit/browser';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { z } from 'zod/v4';
import { TEST_DATABASE_CONFIG } from '../../../../testkit/test/globalSetup';
import { BetterAuth } from '../../auth';
import { KyselyDatabase } from '../../database/kysely';
import { RestApi } from '../../rest-api';
import { featureTest } from '../featureTest';
import type { TestManifest } from '../manifest';

/**
 * Session checks in a feature test, against a real auth server that
 * rate-limits in its database — the way an app runs more than one instance.
 *
 * A browser's request reaches the API carrying its own address in
 * `x-forwarded-for`; the API asks the auth server for the session and passes
 * that address on as `x-gkm-client-ip`, which the auth server honours only
 * from an internal caller. Both hops are dispatched in-process here, so they
 * have to present the loopback peer a request from this machine would — or
 * the address is dropped, every browser in every test becomes the same client
 * to Better Auth, and all of them fight over one `rateLimit` row.
 */

const schema = `ft_session_${randomUUID().slice(0, 8)}`;
const { host, port, user, password, database } = TEST_DATABASE_CONFIG;
const AUTH_DB_URL = `postgres://${user}:${password}@${host}:${port}/${database}?search_path=${schema}`;

const AUTH_URL = 'http://auth.session.localhost';
const API_URL = 'http://api.session.localhost';
const WEB_ORIGIN = 'http://web.session.localhost';

/** How many session checks one client gets per window. */
const CHECKS_PER_WINDOW = 2;

/** The client address each session check reached Better Auth with. */
const believed: (string | null)[] = [];

const env = {
	AUTH_DB_URL,
	AUTH_SECRET: 'a-signing-secret-that-is-at-least-32-chars',
	AUTH_URL,
	AUTH_TRUSTED_ORIGINS: WEB_ORIGIN,
	API_URL,
};

const authDb = new KyselyDatabase('AuthDb');
const auth = new BetterAuth('Auth', {
	database: authDb,
	path: 'apps/auth',
	options: {
		emailAndPassword: { enabled: true },
		// In the database, as an app with more than one instance keeps it — and
		// on in a test, where Better Auth would leave it off.
		rateLimit: {
			enabled: true,
			storage: 'database',
			customRules: {
				'/get-session': async (request: Request) => {
					believed.push(request.headers.get('x-gkm-client-ip'));
					return { window: 60, max: CHECKS_PER_WINDOW };
				},
			},
		},
	},
});

const api = new RestApi('Api', {
	path: 'apps/api',
	defaultAuthorizer: 'none',
	envParser: new EnvironmentParser(env),
}).auth(auth);

export const me = api
	.session(async ({ auth }) => auth.getSession())
	.get('/me')
	.output(z.object({ email: z.string().nullable() }))
	.handle(async ({ session }) => ({ email: session?.user.email ?? null }));

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
	},
	endpoints: [{ surface: 'Api', source: { file: 'endpoints', export: 'me' } }],
	env,
};

const it = featureTest({
	manifest,
	modules: { constructs: { authDb, auth, api }, endpoints: { me } },
});

/** Sign a browser up, and return the cookie its session travels in. */
async function signUp(browser: Browser): Promise<string> {
	const response = await browser.fetch(`${AUTH_URL}/api/auth/sign-up/email`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
		body: JSON.stringify({
			email: `${randomUUID()}@session.test`,
			password: 'correct horse battery',
			name: 'Ada',
		}),
	});
	expect(response.status).toBe(200);
	return browser.cookieHeader(AUTH_URL);
}

/** Ask the API who this browser is — a session check at the auth server. */
const whoAmI = (browser: Browser, cookie?: string) =>
	browser.fetch(`${API_URL}/me`, cookie ? { headers: { cookie } } : {});

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

describe('session checks in a feature test', () => {
	it('counts each browser as its own client', async ({ browser }) => {
		for (let check = 0; check < CHECKS_PER_WINDOW; check++) {
			expect((await whoAmI(browser)).status).toBe(200);
		}
		// Over its budget: the auth server answers 429, which the API does not
		// read as "signed out".
		expect((await whoAmI(browser)).status).toBe(500);

		// Another person, on another connection, has a budget of their own.
		// Were the address lost on the way, both would be one client and this
		// would be refused too.
		const grace = new Browser();
		expect((await whoAmI(grace)).status).toBe(200);

		// Each reached the auth server as the address its browser connected
		// from, carried by the API as `x-gkm-client-ip`.
		expect(believed).toContain(browser.address);
		expect(believed).toContain(grace.address);
	});

	it('answers two session checks made at once', async ({ browser }) => {
		const cookie = await signUp(browser);

		// Both reach the auth server inside this test's transaction. Neither
		// may abort it: a duplicate `rateLimit` row would, and everything after
		// it in the test would fail with 25P02.
		const responses = await Promise.all([
			whoAmI(browser, cookie),
			whoAmI(browser, cookie),
		]);
		expect(responses.map((response) => response.status)).toEqual([200, 200]);

		const bodies = await Promise.all(
			responses.map((response) => response.json()),
		);
		expect(bodies).toEqual([bodies[0], bodies[0]]);
		expect(bodies[0].email).toMatch(/@session\.test$/);

		// And the test goes on: the transaction is still there to read from.
		const later = await whoAmI(new Browser(), cookie);
		expect(await later.json()).toEqual(bodies[0]);
	});
});

/**
 * Tests in flight together, each holding its transaction open until every one
 * has checked a session. Were they the same client, the second test's insert
 * of the shared `rateLimit` row would wait on the first test's uncommitted
 * one — which is waiting here for the second — and none would finish.
 */
describe.concurrent('session checks in tests run together', () => {
	const TOGETHER = 3;
	let arrived = 0;
	let release!: () => void;
	const everyone = new Promise<void>((resolve) => {
		release = resolve;
	});

	for (let n = 0; n < TOGETHER; n++) {
		it(`checks a session alongside the others (${n + 1})`, async ({
			browser,
		}) => {
			expect((await whoAmI(browser)).status).toBe(200);

			if (++arrived === TOGETHER) release();
			const waited = await Promise.race([
				everyone.then(() => 'together' as const),
				new Promise<'alone'>((resolve) =>
					setTimeout(() => resolve('alone'), 3_000).unref(),
				),
			]);
			expect(waited).toBe('together');
		});
	}
});
