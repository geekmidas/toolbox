/**
 * `featureTest`: an app, driven the way it runs deployed.
 *
 * A browser signs in and calls the API; the API calls the auth server; each
 * over its URL, each database in its own transaction. Nothing runs as a server:
 * every URL an app's constructs answer on is served in-process through MSW,
 * from the real handler, for the test that made the request. Everything else
 * with a real local equivalent — Postgres, Mailpit, MinIO — is used directly.
 *
 * It is built from the test manifest `gkm test` writes — the constructs and
 * endpoints the app exports, and the environment the test stage resolved — so
 * a test declares none of it. `gkm test` also generates the configured `it`
 * and a `Browser` with a typed client per surface:
 *
 * ```ts
 * import { it } from '#test';
 *
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
import { type SetupServer, setupServer } from 'msw/node';
import { afterAll, beforeAll, test } from 'vitest';
import { BetterAuth } from '../auth';
import { KyselyDatabase } from '../database/kysely';
import { Email } from '../email';
import { Endpoint } from '../endpoints/Endpoint';
import { HonoEndpoint } from '../endpoints/HonoEndpointAdaptor';
import { Queue } from '../queue/Queue';
import { TestQueueAdaptor } from '../queue/TestQueueAdaptor';
import type { Subscriber } from '../subscribers/Subscriber';
import { TestSubscriberAdaptor } from '../subscribers/TestSubscriberAdaptor';
import { Topic } from '../topic/Topic';
import { loadTestManifest, type TestManifest } from './manifest';

export interface FeatureTestOptions<TBrowser extends TestBrowser> {
	/**
	 * What the app declares and the environment its test stage resolved.
	 * Defaults to the manifest `gkm test` names in `GKM_TEST_MANIFEST`.
	 */
	manifest?: TestManifest;
	/**
	 * The app's modules, already imported, by the absolute path the manifest
	 * records for them. The generated harness imports them statically, from
	 * inside the app, so they resolve the way the app's own code does — its
	 * tsconfig paths included. A module not here is imported by path.
	 */
	modules?: Readonly<Record<string, Record<string, unknown>>>;
	/** The browser each test gets — the generated one, with the app's clients. */
	browser?: new () => TBrowser;
	/**
	 * The database a test receives as `db`, by construct id. Defaults to the
	 * one the app's endpoints name with `.database()`.
	 */
	database?: string;
}

export interface FeatureContext<TBrowser extends TestBrowser, DB> {
	/** This test's browser, already the global `fetch`. */
	browser: TBrowser;
	/** The app database's transaction for this test, rolled back after it. */
	db: Kysely<DB>;
	/** The mail sent to an address during this test, read from Mailpit. */
	mailbox: (address: string) => Mailbox;
	/**
	 * What this test published to a topic or enqueued on a queue, in order.
	 * Nothing is delivered — a subscriber or a worker is tested on its own, by
	 * handing it events — so this is where publishing is asserted.
	 */
	published: (channel: { id: string }) => PublishedMessage[];
	/**
	 * A subscriber, run on its own — handed events rather than delivered them —
	 * with this test's services: its databases resolve to this test's
	 * transactions, as an endpoint's do.
	 */
	subscriber: <S extends Subscriber<any, any, any, any, any, any>>(
		subscriber: S,
	) => SubscriberAdaptorOf<S>;
	/** A queue's worker, run on its own with this test's services. */
	queue: <Q extends Queue<any, any, any, any>>(queue: Q) => QueueAdaptorOf<Q>;
}

type SubscriberAdaptorOf<S> =
	S extends Subscriber<
		infer TServices,
		infer TLogger,
		infer OutSchema,
		infer TEventPublisher,
		infer TEventPublisherServiceName,
		infer TSubscribedEvents
	>
		? TestSubscriberAdaptor<
				TServices,
				TLogger,
				OutSchema,
				TEventPublisher,
				TEventPublisherServiceName,
				TSubscribedEvents
			>
		: never;

type QueueAdaptorOf<Q> =
	Q extends Queue<infer TName, infer TMessage, infer TServices, infer TLogger>
		? TestQueueAdaptor<TName, TMessage, TServices, TLogger>
		: never;

/** The schema a database construct was declared with — what `db` is typed by. */
export type DatabaseOf<C> =
	C extends KyselyDatabase<infer DB, any> ? DB : unknown;

/** One message as it was published: its type and its payload. */
export interface PublishedMessage {
	type: string;
	payload: unknown;
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
	/** What this test published, by topic or queue id. */
	published: Map<string, PublishedMessage[]>;
}

/** Every test in flight in this process, by id. */
const contexts = new Map<string, ContextState>();

/** Databases already resolving to test transactions — patched once each. */
const bound = new WeakSet<KyselyDatabase>();

/** What the manifest points at, imported: the app's own instances. */
interface LoadedApp {
	envParser: EnvironmentParser<{}>;
	endpoints: Endpoint<any, any, any, any>[];
	databases: KyselyDatabase[];
	auths: BetterAuth[];
	emails: Email[];
	/** Every topic and queue — what a test's publishing is recorded for. */
	channels: (Topic<any, any> | Queue<any, any>)[];
	/** What `db` is. */
	database?: KyselyDatabase;
	readMail?: (address: string) => Mailbox;
}

export function featureTest<
	TBrowser extends TestBrowser = TestBrowser,
	DB = unknown,
>(options: FeatureTestOptions<TBrowser> = {}): FeatureIt<TBrowser, DB> {
	const manifest = options.manifest ?? loadTestManifest();
	const BrowserClass = (options.browser ?? TestBrowser) as new () => TBrowser;

	let app: LoadedApp;
	let network: SetupServer;
	let restoreFetch: () => void = () => {};

	beforeAll(async () => {
		app = await load(manifest, options.database, options.modules ?? {});
		for (const database of app.databases) bindToTests(database);

		network = setupServer(
			...surfaceHandlers(app.endpoints, manifest.env),
			...app.auths.map((auth) =>
				authHandler(auth, manifest.env, app.envParser),
			),
		);
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
		network?.close();
	});

	const run = (fn: FeatureFn<TBrowser, DB>) => async (): Promise<void> => {
		const id = randomUUID();
		const state: ContextState = {
			transactions: new TransactionRegistry(),
			discovery: new ServiceDiscovery(app.envParser),
			surfaces: new Map(),
			auth: new Map(),
			addresses: new Set(),
			published: new Map(),
		};
		contexts.set(id, state);
		// Before anything resolves them: a publisher is a service, so the one this
		// test's endpoints get is whichever is registered under its name first.
		await state.discovery.register(recorders(app.channels, state));

		try {
			await runInTestContext(id, async () => {
				const browser = new BrowserClass();
				const restore = browser.install();
				try {
					await fn({
						browser,
						db: app.database
							? ((await state.transactions.get(
									app.database.id,
									urlOf(app.database, app.envParser),
								)) as Kysely<DB>)
							: (undefined as never),
						mailbox: (address) => {
							if (!app.readMail) throw new NoInbox();
							state.addresses.add(address);
							return app.readMail(address);
						},
						published: (channel) => [
							...(state.published.get(channel.id) ?? []),
						],
						subscriber: (subscriber) =>
							new TestSubscriberAdaptor(
								subscriber,
								state.discovery,
							) as SubscriberAdaptorOf<typeof subscriber>,
						queue: (queue) =>
							new TestQueueAdaptor(queue, state.discovery) as QueueAdaptorOf<
								typeof queue
							>,
					});
				} finally {
					restore();
				}
			});
		} finally {
			contexts.delete(id);
			await Promise.all([
				state.transactions.rollbackAll(),
				...[...state.addresses].map((address) =>
					app.readMail?.(address).clear(),
				),
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

/**
 * Import what the manifest points at.
 *
 * The same modules the app runs, so a construct here *is* the app's construct —
 * the one its endpoints were built from — never a copy declared again.
 */
async function load(
	manifest: TestManifest,
	database: string | undefined,
	modules: Readonly<Record<string, Record<string, unknown>>>,
): Promise<LoadedApp> {
	const envParser = new EnvironmentParser({ ...manifest.env });
	const imported = async ({
		file,
		export: name,
	}: {
		file: string;
		export: string;
	}) =>
		// Imported by path only as a fallback: from inside `node_modules`, a
		// dynamic import is left to Node, which knows nothing of the app's
		// tsconfig paths — `~/router.ts` resolves in the app and not here.
		(modules[file] ?? ((await import(file)) as Record<string, unknown>))[name];

	const constructs = await Promise.all(
		Object.values(manifest.constructs).map(({ source }) => imported(source)),
	);
	const endpoints = (
		await Promise.all(manifest.endpoints.map(({ source }) => imported(source)))
	).filter((value): value is Endpoint<any, any, any, any> =>
		Endpoint.isEndpoint(value),
	);

	const unique = <T>(values: T[]) => [...new Set(values)];
	const databases = unique(
		constructs.filter(
			(value): value is KyselyDatabase => value instanceof KyselyDatabase,
		),
	);
	const auths = unique(
		constructs.filter(
			(value): value is BetterAuth => value instanceof BetterAuth,
		),
	);
	const emails = unique(
		constructs.filter((value): value is Email => value instanceof Email),
	);
	const channels = unique(
		constructs.filter(
			(value): value is Topic<any, any> | Queue<any, any> =>
				value instanceof Topic || value instanceof Queue,
		),
	);

	const inbox = emails
		.map((email) => manifest.env[provideKey(email.id, 'inboxUrl')])
		.find(Boolean);

	return {
		envParser,
		endpoints,
		databases,
		auths,
		emails,
		channels,
		database: databaseOf(databases, endpoints, database),
		...(inbox ? { readMail: createMailbox({ inbox }) } : {}),
	};
}

/**
 * A publisher that records rather than sends, under every name a topic or
 * queue is injected by — `users`, and the older `usersPublisher`.
 */
function recorders(
	channels: LoadedApp['channels'],
	state: ContextState,
): { serviceName: string; register: () => unknown }[] {
	return channels.flatMap((channel) => {
		const publisher = {
			async publish(messages: PublishedMessage[]) {
				state.published.set(channel.id, [
					...(state.published.get(channel.id) ?? []),
					...messages.map(({ type, payload }) => ({ type, payload })),
				]);
			},
		};
		return [channel.service.serviceName, channel.publisher.serviceName].map(
			(serviceName) => ({ serviceName, register: () => publisher }),
		);
	});
}

/**
 * The database a test sees as `db`: the one named, or else the one the
 * endpoints were given with `.database()` — found by the service they hold,
 * which is the construct's own.
 */
function databaseOf(
	databases: KyselyDatabase[],
	endpoints: Endpoint<any, any, any, any>[],
	named: string | undefined,
): KyselyDatabase | undefined {
	if (named) {
		const found = databases.find(({ id }) => id === named);
		if (!found)
			throw new UnknownDatabase(
				named,
				databases.map(({ id }) => id),
			);
		return found;
	}

	const services = new Set<unknown>(
		endpoints.map((e) => e.databaseService).filter(Boolean),
	);
	return databases.find((database) => services.has(database.service));
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

	// The whole origin, not only `basePath`: the auth server answers its own
	// host deployed, and a redirect it issues — to `/` after verifying a magic
	// link — lands on it. Paths it does not route get its own 404.
	return http.all(`${base}/*`, ({ request }) =>
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

/** `featureTest({ database })` named a database the app does not declare. */
export class UnknownDatabase extends Error {
	constructor(
		readonly id: string,
		readonly declared: string[],
	) {
		super(
			`featureTest was asked for the database '${id}', and the app declares ` +
				`${declared.length ? declared.map((d) => `'${d}'`).join(', ') : 'none'}.`,
		);
		this.name = 'UnknownDatabase';
	}
}
