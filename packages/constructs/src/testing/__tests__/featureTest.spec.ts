import { randomUUID } from 'node:crypto';
import { EnvironmentParser } from '@geekmidas/envkit';
import { UnauthorizedError } from '@geekmidas/errors';
import { serviceContext } from '@geekmidas/services';
import { magicLink } from 'better-auth/plugins';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { TEST_DATABASE_CONFIG } from '../../../../testkit/test/globalSetup';
import { MAILPIT_SMTP_PORT, MAILPIT_URL } from '../../../../testkit/test/ports';
import { ensureServices } from '../../../../testkit/test/services';

/**
 * A small app, declared the way a real one is — an app database, the auth
 * server's schema tenant, a mailer, an API that reads its session from
 * `.auth()` — and driven the way `featureTest` drives any app: a browser signs
 * in through the real auth server, the API asks that server who is calling,
 * and every database is rolled back after each test.
 */
const run = randomUUID().slice(0, 8);
const appSchema = `feature_app_${run}`;
const authSchema = `feature_auth_${run}`;
const { host, port, user, password, database: name } = TEST_DATABASE_CONFIG;
const postgres = `postgres://${user}:${password}@${host}:${port}/${name}`;

const API_URL = 'http://api.shop.test';
const AUTH_URL = 'http://auth.shop.test';

// What `gkm test` injects. Set before any construct reads it: a surface takes
// its environment when it is built.
Object.assign(process.env, {
	DATABASE_URL: `${postgres}?search_path=${appSchema}`,
	AUTH_DATABASE_URL: `${postgres}?search_path=${authSchema}`,
	API_URL,
	AUTH_URL,
	AUTH_SECRET: 'a-signing-secret-that-is-at-least-32-chars',
	AUTH_TRUSTED_ORIGINS: `${API_URL},${AUTH_URL}`,
	// The session cookie has to reach the API on a sibling host — exactly the
	// wiring a browser's cookie rules check.
	AUTH_COOKIE_DOMAIN: 'shop.test',
	MAILER_URL: `smtp://localhost:${MAILPIT_SMTP_PORT}`,
	MAILER_FROM: 'noreply@shop.test',
	MAILER_INBOX_URL: MAILPIT_URL,
});

const { BetterAuth } = await import('../../auth');
const { KyselyDatabase } = await import('../../database/kysely');
const { Email } = await import('../../email');
const { RestApi } = await import('../../rest-api');
const { featureTest } = await import('../featureTest');

interface AppDB {
	notes: { text: string };
}

const database = new KyselyDatabase<AppDB, 'Database'>('Database');
const authDatabase = database.schema<Record<string, never>, 'AuthDatabase'>(
	'AuthDatabase',
);
const mailer = new Email('Mailer', { templates: {} });

const auth = new BetterAuth('Auth', {
	path: 'apps/auth',
	database: authDatabase,
	options: async (options) => {
		const mail = await mailer.service.register(options);
		return {
			emailAndPassword: { enabled: true },
			plugins: [
				magicLink({
					sendMagicLink: async ({ email, url }) => {
						await mail.send({ to: email, subject: 'Sign in', text: url });
					},
				}),
			],
		};
	},
});

const api = new RestApi('Api', {
	path: '.',
	defaultAuthorizer: 'none',
}).auth(auth);

const signedIn = api.database(database).session(async ({ auth }) => {
	const session = await auth.getSession();
	if (!session) throw new UnauthorizedError('No active session');
	return session;
});

const me = signedIn
	.get('/me')
	.output(z.object({ email: z.string() }))
	.handle(async ({ session }) => ({ email: session.user.email }));

const addNote = signedIn
	.post('/notes')
	.body(z.object({ text: z.string() }))
	.output(z.object({ count: z.number() }))
	.handle(async ({ db, body }) => {
		await db.insertInto('notes').values({ text: body.text }).execute();
		const { count } = await db
			.selectFrom('notes')
			.select(db.fn.countAll<number>().as('count'))
			.executeTakeFirstOrThrow();
		return { count: Number(count) };
	});

const it = featureTest({
	modules: [{ database, authDatabase, mailer, auth, api, me, addNote }],
	database,
});

const committed = async (query: string) => {
	const client = new pg.Client(TEST_DATABASE_CONFIG);
	await client.connect();
	try {
		return (await client.query(query)).rows;
	} finally {
		await client.end();
	}
};

beforeAll(async () => {
	await ensureServices('mailpit');
	// The shared database testkit's setup creates in a full run; created here
	// when this project runs alone. Another setup may win the race.
	const server = new pg.Client({
		...TEST_DATABASE_CONFIG,
		database: 'postgres',
	});
	await server.connect();
	await server
		.query(`CREATE DATABASE "${name}"`)
		.catch((error: { code?: string }) => {
			if (error.code !== '42P04' && error.code !== '23505') throw error;
		});
	await server.end();

	await committed(`CREATE SCHEMA "${appSchema}"`);
	await committed(`CREATE SCHEMA "${authSchema}"`);
	await committed(`CREATE TABLE "${appSchema}".notes (text text)`);
	const migrate = await auth.migrations({
		envParser: new EnvironmentParser({ ...process.env }),
		context: serviceContext,
	});
	await migrate();
}, 120_000);

afterAll(async () => {
	await committed(`DROP SCHEMA IF EXISTS "${appSchema}" CASCADE`);
	await committed(`DROP SCHEMA IF EXISTS "${authSchema}" CASCADE`);
});

const email = () => `ada-${randomUUID()}@shop.test`;

const json = (body: unknown) => ({
	method: 'POST',
	headers: { 'content-type': 'application/json', origin: AUTH_URL },
	body: JSON.stringify(body),
});

describe('featureTest', () => {
	it('signs in by magic link and reads the session back through the API', async ({
		browser,
		mailbox,
	}) => {
		const address = email();

		// The app's auth server, served in-process on this test's transaction;
		// the email goes over real SMTP to Mailpit.
		const sent = await browser.fetch(
			`${AUTH_URL}/api/auth/sign-in/magic-link`,
			json({ email: address, callbackURL: `${API_URL}/me` }),
		);
		expect(sent.status).toBe(200);

		// Opening the link verifies it, sets the cookie, and follows the redirect
		// to /me — which asks the auth server, over HTTP, whose cookie that is.
		const link = (await mailbox(address).last()).link!;
		const landed = await browser.visit(link);

		expect(await landed.json()).toEqual({ email: address });
	});

	it('refuses the API to a browser that has not signed in', async ({
		browser,
	}) => {
		const response = await browser.fetch(`${API_URL}/me`);

		expect(response.status).toBe(401);
	});

	it('shares the app database’s transaction with the test, and rolls it back', async ({
		browser,
		db,
	}) => {
		await browser.fetch(
			`${AUTH_URL}/api/auth/sign-up/email`,
			json({ email: email(), password: 'correct horse battery', name: 'Ada' }),
		);

		const response = await browser.fetch(`${API_URL}/notes`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: 'first' }),
		});

		// A fresh transaction: the note from any earlier test is gone.
		expect(await response.json()).toEqual({ count: 1 });
		// And the test sees what the API wrote.
		expect(await db.selectFrom('notes').selectAll().execute()).toEqual([
			{ text: 'first' },
		]);
	});

	it('starts the next test from nothing', async ({ db }) => {
		expect(await db.selectFrom('notes').selectAll().execute()).toEqual([]);
	});

	test('refuses a request that belongs to no test', async () => {
		const response = await fetch(`${API_URL}/me`);

		expect(response.status).toBe(500);
	});

	test('committed nothing, in either database', async () => {
		expect(await committed(`SELECT * FROM "${appSchema}".notes`)).toEqual([]);
		expect(await committed(`SELECT * FROM "${authSchema}"."user"`)).toEqual([]);
	});
});
