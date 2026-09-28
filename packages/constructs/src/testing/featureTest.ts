/**
 * `featureTest`: an app, driven the way it runs deployed.
 *
 * A browser signs in and calls the API; the API calls the auth server; each
 * over its URL, each database in its own transaction. Nothing runs as a server:
 * every URL an app's constructs answer on is served in-process through MSW,
 * from the real handler, for the test that made the request. Everything else
 * with a real local equivalent — Postgres, Mailpit, MinIO — is used directly.
 *
 * ```ts
 * // test/config.ts
 * export const it = featureTest({
 *   modules: import.meta.glob(['../../constructs/*.ts', '../src/endpoints/**\/*.ts'], { eager: true }),
 *   database,
 *   browser: Browser,
 * });
 *
 * // a test
 * it('shows the signed-in user their profile', async ({ browser, mailbox }) => {
 *   await browser.auth.signIn.magicLink({ email: 'ada@shop.test' });
 *   await browser.visit((await mailbox('ada@shop.test').last()).link!);
 *   expect(await browser.api.get('/profile')).toMatchObject({ email: 'ada@shop.test' });
 * });
 * ```
 */

import { randomUUID } from 'node:crypto';
import { EnvironmentParser } from '@geekmidas/envkit';
import { provideKey } from '@geekmidas/manifest';
import { ServiceDiscovery, serviceContext } from '@geekmidas/services';
import { Browser as TestBrowser } from '@geekmidas/testkit/browser';
import {
	currentTestContext,
	installContextFetch,
	runAsServer,
	runInTestContext,
	testContextOf,
} from '@geekmidas/testkit/context';
import { createMailbox, type Mailbox } from '@geekmidas/testkit/mailbox';
import { TransactionRegistry } from '@geekmidas/testkit/transactions';
import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, test } from 'vitest';
import { BetterAuth } from '../auth';
import { KyselyDatabase } from '../database/kysely';
import { Email } from '../email';
import { Endpoint } from '../endpoints/Endpoint';
import { HonoEndpoint } from '../endpoints/HonoEndpointAdaptor';

export interface FeatureTestOptions<TBrowser extends TestBrowser, DB> {
	/**
	 * The modules an app's constructs and endpoints are exported from — what
	 * `import.meta.glob(…, { eager: true })` returns, or a list of modules.
	 * Discovery reads exports, as the build does.
	 */
	modules: Record<string, unknown> | readonly unknown[];
	/** The app's own database: what a test receives as `db`. */
	database?: KyselyDatabase<DB>;
	/** The browser each test gets — the app's subclass, with its clients. */
	browser?: new () => TBrowser;
	/** The environment `gkm test` injected. Defaults to `process.env`. */
	env?: Record<string, string | undefined>;
}

export interface FeatureContext<TBrowser extends TestBrowser, DB> {
	/** This test's browser, already the global `fetch`. */
	browser: TBrowser;
	/** The app database's transaction for this test, rolled back after it. */
	db: Kysely<DB>;
	/** The mail sent to an address during this test, read from Mailpit. */
	mailbox: (address: string) => Mailbox;
}

type FeatureFn<TBrowser extends TestBrowser, DB> = (
	context: FeatureContext<TBrowser, DB>,
) => unknown;

export interface FeatureIt<TBrowser extends TestBrowser, DB> {
	(name: string, fn: FeatureFn<TBrowser, DB>, timeout?: number): void;
	only(name: string, fn: FeatureFn<TBrowser, DB>, timeout?: number): void;
	skip(name: string, fn: FeatureFn<TBrowser, DB>, timeout?: number): void;
}

/** Everything one test owns, found again from its id. */
interface ContextState {
	transactions: TransactionRegistry;
	discovery: ServiceDiscovery<any>;
	/** One app per surface, with this test's services. */
	surfaces: Map<string, Promise<Hono>>;
	/** One auth server per construct, on this test's transaction. */
	auth: Map<BetterAuth, Promise<Hono>>;
	/** The addresses this test read mail for, cleared after it. */
	addresses: Set<string>;
}

/** Every test in flight in this process, by id. */
const contexts = new Map<string, ContextState>();

/** Databases already resolving to test transactions — patched once each. */
const bound = new WeakSet<KyselyDatabase>();

export function featureTest<
	TBrowser extends TestBrowser = TestBrowser,
	DB = unknown,
>(options: FeatureTestOptions<TBrowser, DB>): FeatureIt<TBrowser, DB> {
	const env = options.env ?? process.env;
	const envParser = new EnvironmentParser({ ...env });
	const found = discover(options.modules);
	const BrowserClass = (options.browser ?? TestBrowser) as new () => TBrowser;

	for (const database of found.databases) bindToTests(database);

	const network = setupServer(
		...surfaceHandlers(found.endpoints, env),
		...found.auths.map((auth) => authHandler(auth, env, envParser)),
	);

	const inbox = found.emails
		.map((email) => env[provideKey(email.id, 'inboxUrl')])
		.find(Boolean);
	const readMail = inbox ? createMailbox({ inbox }) : undefined;

	let restoreFetch: () => void = () => {};
	beforeAll(() => {
		network.listen({
			onUnhandledRequest(request, print) {
				// A real local service — Mailpit, MinIO — is used directly; only a
				// URL with nothing real behind it has to be answered here.
				if (isLocal(new URL(request.url))) return;
				print.error();
			},
		});
		// After MSW's interceptor, so the stamp is on before a request is caught.
		restoreFetch = installContextFetch();
	});
	afterAll(() => {
		restoreFetch();
		network.close();
	});

	const run = (fn: FeatureFn<TBrowser, DB>) => async (): Promise<void> => {
		const id = randomUUID();
		const state: ContextState = {
			transactions: new TransactionRegistry(),
			discovery: new ServiceDiscovery(envParser),
			surfaces: new Map(),
			auth: new Map(),
			addresses: new Set(),
		};
		contexts.set(id, state);

		try {
			await runInTestContext(id, async () => {
				const browser = new BrowserClass();
				const restore = browser.install();
				try {
					await fn({
						browser,
						db: options.database
							? await state.transactions.get(
									options.database.id,
									urlOf(options.database, envParser),
								)
							: (undefined as never),
						mailbox: (address) => {
							if (!readMail) throw new NoInbox();
							state.addresses.add(address);
							return readMail(address);
						},
					});
				} finally {
					restore();
				}
			});
		} finally {
			contexts.delete(id);
			await Promise.all([
				state.transactions.rollbackAll(),
				...[...state.addresses].map((address) => readMail?.(address).clear()),
			]);
		}
	};

	const it = ((name, fn, timeout) => test(name, run(fn), timeout)) as FeatureIt<
		TBrowser,
		DB
	>;
	it.only = (name, fn, timeout) => test.only(name, run(fn), timeout);
	it.skip = (name, fn, timeout) => test.skip(name, run(fn), timeout);
	return it;
}

/** What an app's modules export, sorted by what a test does with it. */
function discover(modules: FeatureTestOptions<any, any>['modules']) {
	const values = (
		Array.isArray(modules) ? modules : Object.values(modules)
	).flatMap((module) =>
		module && typeof module === 'object' ? Object.values(module) : [],
	);

	return {
		endpoints: values.filter((value): value is Endpoint<any, any, any, any> =>
			Endpoint.isEndpoint(value),
		),
		databases: values.filter(
			(value): value is KyselyDatabase => value instanceof KyselyDatabase,
		),
		auths: values.filter(
			(value): value is BetterAuth => value instanceof BetterAuth,
		),
		emails: values.filter((value): value is Email => value instanceof Email),
	};
}

/**
 * Make a database resolve, inside a test, to that test's transaction.
 *
 * Everything reaches a database through its service — an endpoint through
 * service discovery, the auth server through its tenant directly — so this is
 * the one place a test's connection can be handed over. Outside a test it is
 * the database it always was.
 */
function bindToTests(database: KyselyDatabase): void {
	if (bound.has(database)) return;
	bound.add(database);

	const service = database.service as { register: (options: any) => unknown };
	const register = service.register;

	service.register = (options) => {
		const context = currentTestContext();
		const state = context && contexts.get(context.id);
		if (!state) return register(options);

		return state.transactions.get(
			database.id,
			urlOf(database, options.envParser),
		);
	};
}

function urlOf(database: { id: string }, envParser: EnvironmentParser<{}>) {
	return envParser
		.create((get) => ({ url: get(provideKey(database.id, 'url')).string() }))
		.parse().url;
}

/** Each surface's endpoints, served at its URL for the test that asked. */
function surfaceHandlers(
	endpoints: Endpoint<any, any, any, any>[],
	env: Record<string, string | undefined>,
) {
	const bySurface = new Map<string, Endpoint<any, any, any, any>[]>();
	for (const endpoint of endpoints) {
		const surface = endpoint.surface?.id;
		if (!surface) continue;
		bySurface.set(surface, [...(bySurface.get(surface) ?? []), endpoint]);
	}

	return [...bySurface].flatMap(([surface, served]) => {
		const base = env[provideKey(surface, 'url')];
		if (!base) return [];

		return http.all(`${trim(base)}/*`, ({ request }) =>
			serve(request, async (state) => {
				let app = state.surfaces.get(surface);
				if (!app) {
					app = Promise.resolve().then(() => {
						const hono = new Hono();
						HonoEndpoint.addRoutes(served, state.discovery, hono);
						return hono;
					});
					state.surfaces.set(surface, app);
				}
				return (await app).fetch(request);
			}),
		);
	});
}

/** An auth server, served at its URL, on the transaction of the test that asked. */
function authHandler(
	auth: BetterAuth,
	env: Record<string, string | undefined>,
	envParser: EnvironmentParser<{}>,
) {
	const base = trim(env[provideKey(auth.id, 'url')] ?? '');

	return http.all(`${base}${auth.basePath}/*`, ({ request }) =>
		serve(request, async (state) => {
			let app = state.auth.get(auth);
			if (!app) {
				app = auth
					.server({ envParser, context: serviceContext })
					.then(({ app }) => app);
				state.auth.set(auth, app);
			}
			return (await app).fetch(request);
		}),
	);
}

/** Handle a request as the server side of the test it was made for. */
async function serve(
	request: Request,
	handle: (state: ContextState) => Promise<Response>,
): Promise<Response> {
	const id = testContextOf(request);
	const state = id ? contexts.get(id) : undefined;
	if (!id || !state) throw new UnknownTestContext(request.url, id);

	return runAsServer(id, () => handle(state));
}

function trim(url: string): string {
	return url.replace(/\/$/, '');
}

function isLocal(url: URL): boolean {
	return (
		url.hostname === 'localhost' ||
		url.hostname === '127.0.0.1' ||
		url.hostname.endsWith('.localhost')
	);
}

/** A request reached an in-process server without a test to belong to. */
export class UnknownTestContext extends Error {
	constructor(
		readonly url: string,
		readonly id: string | undefined,
	) {
		super(
			id
				? `${url} was requested for test ${id}, which is not running. A ` +
						`request that outlives its test — an un-awaited call — lands here.`
				: `${url} was requested outside any test. Make the request inside a ` +
						`featureTest, so it reaches that test's transactions.`,
		);
		this.name = 'UnknownTestContext';
	}
}

/** `mailbox` was used in an app that declares no Email construct. */
export class NoInbox extends Error {
	constructor() {
		super(
			`mailbox() reads the inbox of the app's Email construct, and none was ` +
				`found in featureTest's modules — or \`gkm test\` did not inject its ` +
				`<ID>_INBOX_URL.`,
		);
		this.name = 'NoInbox';
	}
}
