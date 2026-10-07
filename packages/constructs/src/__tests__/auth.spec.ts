import { randomUUID } from 'node:crypto';
import { expo } from '@better-auth/expo';
import { EnvironmentParser } from '@geekmidas/envkit';
import { serviceContext } from '@geekmidas/services';
import { magicLink } from 'better-auth/plugins';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../../testkit/test/globalSetup';
import {
	AuthServerUnreachable,
	BetterAuth,
	type BetterAuthOptions,
	deviceLink,
	ExpoPluginRequired,
	SessionCheckFailed,
} from '../auth';
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

	// better-auth's own tables, from the SQL `gkm migration` would commit — the
	// tenant has no separate owner URL here, so it compares as its runtime one.
	await applyPending();
});

/** Apply what better-auth says the tenant is missing, in the tenant's schema. */
async function applyPending(): Promise<string | undefined> {
	const pending = await auth().pendingMigration(options());
	if (!pending) return undefined;

	const client = new pg.Client(TEST_DATABASE_CONFIG);
	await client.connect();
	try {
		await client.query(`SET search_path TO "${schema}"`);
		await client.query(pending);
	} finally {
		await client.end();
	}

	return pending;
}

describe('BetterAuth.pendingMigration', () => {
	// The setup above applied it, so what is left is the proof it was all of it:
	// a second comparison finds nothing, which is what lets `gkm migration`
	// say "up to date" instead of writing an empty file.
	it('is nothing once its SQL has been applied', async () => {
		expect(await auth().pendingMigration(options())).toBeUndefined();
	});

	it('is SQL that runs again where its tables already exist', async () => {
		// Recompiled against an empty schema, then run twice: the second time is
		// a database Better Auth set up at runtime, before migrations were files.
		const fresh = `${schema}_again`;
		const client = new pg.Client(TEST_DATABASE_CONFIG);
		await client.connect();
		try {
			await client.query(`CREATE SCHEMA "${fresh}"`);
			const pending = await auth().pendingMigration(
				options({
					AUTH_DB_URL: url.replace(
						`search_path=${schema}`,
						`search_path=${fresh}`,
					),
				}),
			);
			expect(pending).toContain('create table if not exists "user"');

			await client.query(`SET search_path TO "${fresh}"`);
			await client.query(pending!);
			await client.query(pending!);
		} finally {
			await client.query(`DROP SCHEMA IF EXISTS "${fresh}" CASCADE`);
			await client.end();
		}
	});

	it('names the tenant its tables live in', () => {
		expect(auth().databaseId).toBe('AuthDb');
	});
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

	// Whatever `options` reaches — the mailer a magic link goes through — is
	// invisible to the graph unless declared; declared, it is an edge on the
	// handler beside the database.
	it('declares what its options use as edges on its handler', () => {
		const mailer = new KyselyDatabase('Mailer');
		const construct = new BetterAuth('Auth', {
			database: tenant,
			path: 'apps/auth',
			dependsOn: [mailer],
		});

		const surface = construct
			.declare()
			.find((declaration) => declaration.kind === 'rest-api');

		expect(
			surface?.kind === 'rest-api' && surface.endpoints[0]?.dependencies,
		).toEqual([
			{ target: 'AuthDb', kind: 'database' },
			{ target: 'Mailer', kind: 'database' },
		]);
	});

	// The same list hands `options` its clients, so a magic-link plugin sends
	// through the declared mailer with nothing imported and registered by hand.
	it('hands options a client for each construct it depends on', async () => {
		const registered: unknown[] = [];
		const mailer = {
			id: 'Mailer',
			declare: () => [],
			service: {
				serviceName: 'mailer' as const,
				register: async (options: unknown) => {
					registered.push(options);
					return { send: (to: string) => `sent to ${to}` };
				},
			},
		};

		let sent: string | undefined;
		const construct = new BetterAuth('Auth', {
			database: tenant,
			path: 'apps/auth',
			dependsOn: [mailer],
			options: async ({ services }) => {
				// Typed from `dependsOn`: `services.mailer` is the mailer's client.
				sent = services.mailer.send('ada@shop.test');
				return {};
			},
		});

		const given = options();
		await construct.pluginIds(given);

		expect(sent).toBe('sent to ada@shop.test');
		// Registered with the options this call was given.
		expect(registered).toEqual([given]);
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

	it('trusts the derived origins plus any its options add', async () => {
		// Better Auth enforces the list (and relaxes it under a test runner), so
		// what is asserted is the list this construct hands it.
		const partner = 'http://partner.test';
		const { auth: server } = await auth({ trustedOrigins: [partner] }).server(
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

		// The options it was registered with, and `services` — empty, with
		// nothing in `dependsOn`.
		expect(seen).toEqual({ ...opts, services: {} });
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

describe('BetterAuth with a mobile app among its callers', () => {
	const SCHEME = 'shop';
	const DEVICE_URL = 'http://192.168.1.20:3002';
	/** What a target derives once `App` declares `.dependsOn([auth])`. */
	const mobile = (env: Record<string, string> = {}) =>
		options({
			AUTH_TRUSTED_ORIGINS: [WEB_ORIGIN, `${SCHEME}://`, `${SCHEME}://*`].join(
				',',
			),
			AUTH_DEVICE_URL: DEVICE_URL,
			...env,
		});

	/**
	 * An auth server whose magic links are kept rather than sent — with the
	 * origin check on: Better Auth turns it off under a test runner unless told
	 * otherwise, and these requests are about exactly that check.
	 */
	function withMagicLink() {
		const sent: string[] = [];
		const construct = auth({
			advanced: { disableOriginCheck: false },
			plugins: [
				expo(),
				magicLink({
					sendMagicLink: async ({ url }) => {
						sent.push(url);
					},
				}),
			],
		});
		return { construct, sent };
	}

	const askForLink = (callbackURL: string, origin: string) =>
		new Request(`${AUTH_URL}/api/auth/sign-in/magic-link`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin },
			body: JSON.stringify({ email: email('ada'), callbackURL }),
		});

	it('refuses to start without the Expo plugin once a mobile app calls it', async () => {
		// The app signs in through it; without it every request the app makes
		// would be refused, so the server says so when it is built instead.
		const failure = await auth()
			.server(mobile())
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(ExpoPluginRequired);
		expect(failure).toMatchObject({
			server: 'Auth',
			origins: [`${SCHEME}://`, `${SCHEME}://*`],
		});
	});

	it('starts with the Expo plugin the app gave it', async () => {
		const { auth: server } = await auth({ plugins: [expo()] }).server(mobile());
		const ids = server.options.plugins?.map((plugin) => plugin.id);

		expect(ids).toContain('expo');
	});

	it('needs no Expo plugin where nothing but browsers call it', async () => {
		const { auth: server } = await auth().server(options());
		const ids = server.options.plugins?.map((plugin) => plugin.id) ?? [];

		expect(ids).not.toContain('expo');
	});

	it('needs none for a native origin the app trusts by hand, outside the graph', async () => {
		const { auth: server } = await auth({
			trustedOrigins: ['partner://'],
		}).server(options());

		expect(server.options.trustedOrigins).toContain('partner://');
	});

	it('builds a link the app asked for on the address a phone reaches', async () => {
		const { construct, sent } = withMagicLink();
		const { app } = await construct.server(mobile());

		const response = await app.request(
			askForLink(`${SCHEME}://signed-in`, `${SCHEME}://`),
		);

		expect(response.status).toBe(200);
		expect(new URL(sent[0]!).origin).toBe(DEVICE_URL);
		expect(new URL(sent[0]!).searchParams.get('callbackURL')).toBe(
			`${SCHEME}://signed-in`,
		);
	});

	it('accepts an app’s sign-in with only what the Expo client sends — no Origin header', async () => {
		// React Native's fetch sends no Origin. The Expo client sends its scheme
		// as \`expo-origin\` instead, and the server plugin is what turns that
		// into the origin Better Auth checks. Apps once set \`Origin\` to the
		// auth server's own URL by hand to get past this; this is the request
		// without that.
		const { construct, sent } = withMagicLink();
		const { app } = await construct.server(mobile());

		const response = await app.request(
			new Request(`${AUTH_URL}/api/auth/sign-in/magic-link`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'expo-origin': `${SCHEME}://`,
				},
				body: JSON.stringify({
					email: email('ada'),
					callbackURL: `${SCHEME}://signed-in`,
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(sent).toHaveLength(1);
	});

	it('hands the app the session when the emailed link is opened outside it', async () => {
		// The link opens in the phone's browser, which gets the session cookie —
		// the app does not. Better Auth's Expo plugin carries it on the redirect
		// back into the app, as ?cookie=, for a scheme this server trusts: the
		// dev build's, and Expo Go's exp:// address on this machine.
		for (const callbackURL of [
			`${SCHEME}://signed-in`,
			'exp://192.168.1.20:8081/--/signed-in',
		]) {
			const { construct, sent } = withMagicLink();
			const { app } = await construct.server(
				mobile({
					AUTH_TRUSTED_ORIGINS: [
						WEB_ORIGIN,
						`${SCHEME}://`,
						`${SCHEME}://*`,
						'exp://192.168.1.20:*',
						'exp://192.168.1.20:*/**',
					].join(','),
				}),
			);
			await app.request(
				new Request(`${AUTH_URL}/api/auth/sign-in/magic-link`, {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						'expo-origin': `${SCHEME}://`,
					},
					body: JSON.stringify({ email: email('ada'), callbackURL }),
				}),
			);

			// Opened from the email: no cookie, no origin — just the link.
			const link = new URL(sent[0]!);
			const opened = await app.request(
				`${AUTH_URL}${link.pathname}${link.search}`,
			);
			const location = new URL(opened.headers.get('location')!);

			expect(`${location.protocol}//${location.host}`).toBe(
				`${new URL(callbackURL).protocol}//${new URL(callbackURL).host}`,
			);
			expect(location.searchParams.get('cookie')).toMatch(/session_token=/);
		}
	});

	it('refuses the same request from a scheme nothing declared', async () => {
		const { construct, sent } = withMagicLink();
		const { app } = await construct.server(mobile());

		const response = await app.request(
			new Request(`${AUTH_URL}/api/auth/sign-in/magic-link`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'expo-origin': 'evil://',
				},
				body: JSON.stringify({
					email: email('ada'),
					callbackURL: 'evil://signed-in',
				}),
			}),
		);

		expect(response.status).toBe(403);
		expect(sent).toHaveLength(0);
	});

	it('leaves a browser’s link on the server’s own address', async () => {
		const { construct, sent } = withMagicLink();
		const { app } = await construct.server(mobile());

		await app.request(askForLink('/dashboard', WEB_ORIGIN));

		expect(new URL(sent[0]!).origin).toBe(AUTH_URL);
	});
});

describe('deviceLink', () => {
	const link = (callbackURL: string) =>
		`http://auth-dev.shop.localhost:28006/api/auth/magic-link/verify?token=t&callbackURL=${encodeURIComponent(callbackURL)}`;

	it('moves an app’s link to the device address, path and token kept', () => {
		expect(
			deviceLink(link('shop-dev://home'), 'http://192.168.1.20:3002'),
		).toBe(
			'http://192.168.1.20:3002/api/auth/magic-link/verify?token=t&callbackURL=shop-dev%3A%2F%2Fhome',
		);
	});

	it('leaves a browser’s link alone, relative or absolute', () => {
		expect(deviceLink(link('/home'), 'http://192.168.1.20:3002')).toBe(
			link('/home'),
		);
		expect(
			deviceLink(link('https://shop.com/home'), 'http://192.168.1.20:3002'),
		).toBe(link('https://shop.com/home'));
	});
});

describe('BetterAuth.verify', () => {
	// The real server, reached the way a surface reaches it: over HTTP at
	// AUTH_URL — served by MSW from the construct's own app rather than a
	// listening port.
	const network = setupServer();
	beforeAll(() => network.listen({ onUnhandledRequest: 'error' }));
	afterAll(() => network.close());

	const serve = async (construct: BetterAuth) => {
		const { app } = await construct.server(options());
		network.use(http.all(`${AUTH_URL}/*`, ({ request }) => app.fetch(request)));
	};

	it('answers with the session a cookie belongs to', async () => {
		const construct = auth();
		await serve(construct);
		const who = email('ada');

		const created = await fetch(signUp(who));
		const cookie = created.headers
			.getSetCookie()
			.map((c) => c.split(';')[0])
			.join('; ');

		const session = await construct.verify(
			new Headers({ cookie }),
			options().envParser,
		);

		expect(session?.user.email).toBe(who);
	});

	it('answers null for a request with no session', async () => {
		const construct = auth();
		await serve(construct);

		expect(
			await construct.verify(new Headers(), options().envParser),
		).toBeNull();
	});

	it('refuses to read a failing server as signed out', async () => {
		network.use(
			http.all(`${AUTH_URL}/*`, () => new HttpResponse(null, { status: 503 })),
		);

		await expect(
			auth().verify(new Headers(), options().envParser),
		).rejects.toBeInstanceOf(SessionCheckFailed);
	});
});

describe('BetterAuth.service — what .dependsOn([auth]) hands a caller', () => {
	// Another app's process: given the auth server's URL and nothing else.
	const caller = () => ({
		envParser: new EnvironmentParser({ AUTH_URL }),
		context: serviceContext,
	});

	const network = setupServer();
	beforeAll(() => network.listen({ onUnhandledRequest: 'error' }));
	afterEach(() => network.resetHandlers());
	afterAll(() => network.close());

	/** Every request the auth server's URL receives, answered by `answer`. */
	const record = (answer: () => Response) => {
		const seen: Request[] = [];
		network.use(
			http.all(`${AUTH_URL}/*`, ({ request }) => {
				seen.push(request);
				return answer();
			}),
		);
		return seen;
	};

	it('starts with only the URL — no secret, no tenant, no mailer', async () => {
		const client = await auth().service.register(caller());

		expect(client.api.getSession).toBeTypeOf('function');
	});

	it('answers the session a real server gives a signed-in cookie, and null without one', async () => {
		const { app } = await auth().server(options());
		network.use(http.all(`${AUTH_URL}/*`, ({ request }) => app.fetch(request)));
		const who = email('ada');
		const cookie = (await fetch(signUp(who))).headers
			.getSetCookie()
			.map((c) => c.split(';')[0])
			.join('; ');

		const client = await auth().service.register(caller());

		const session = await client.api.getSession({
			headers: new Headers({ cookie }),
		});
		expect(session?.user.email).toBe(who);
		expect(session?.session.userId).toBe(session?.user.id);
		expect(await client.api.getSession({ headers: new Headers() })).toBeNull();
	});

	it('asks <basePath>/get-session, forwarding only the session headers', async () => {
		const seen = record(() => HttpResponse.json(null));
		const client = await auth({}, '/auth').service.register(caller());

		await client.api.getSession({
			headers: {
				cookie: 'better-auth.session_token=abc',
				authorization: 'Bearer t0ken',
				'x-forwarded-for': '203.0.113.7',
				'x-internal': 'not for the auth server',
			},
		});

		expect(seen).toHaveLength(1);
		expect(seen[0]!.method).toBe('GET');
		expect(seen[0]!.url).toBe(`${AUTH_URL}/auth/get-session`);
		expect(seen[0]!.headers.get('cookie')).toBe(
			'better-auth.session_token=abc',
		);
		expect(seen[0]!.headers.get('authorization')).toBe('Bearer t0ken');
		expect(seen[0]!.headers.get('x-forwarded-for')).toBe('203.0.113.7');
		expect(seen[0]!.headers.get('x-internal')).toBeNull();
	});

	it('reads a 401 as signed out', async () => {
		record(() =>
			HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
		);
		const client = await auth().service.register(caller());

		expect(
			await client.api.getSession({ headers: { cookie: 'stale=1' } }),
		).toBeNull();
	});

	it('refuses to read a 5xx as signed out', async () => {
		record(() => new HttpResponse(null, { status: 502 }));
		const client = await auth().service.register(caller());

		const failure = await client.api
			.getSession({ headers: {} })
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(SessionCheckFailed);
		expect(failure).toMatchObject({ authenticator: 'Auth', status: 502 });
	});

	it('says which server it could not reach, and where', async () => {
		record(() => HttpResponse.error());
		const client = await auth().service.register(caller());

		const failure = await client.api
			.getSession({ headers: {} })
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(AuthServerUnreachable);
		expect(failure).toMatchObject({
			authenticator: 'Auth',
			url: `${AUTH_URL}/api/auth/get-session`,
		});
		expect((failure as Error).message).toContain('AUTH_URL');
	});
});
