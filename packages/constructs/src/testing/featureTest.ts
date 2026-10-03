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
import { type FakerFactory, faker } from '@geekmidas/testkit/faker';
import { createMailbox, type Mailbox } from '@geekmidas/testkit/mailbox';
import { TransactionRegistry } from '@geekmidas/testkit/transactions';
import type { StandardSchemaV1 } from '@standard-schema/spec';
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
import type { Fake } from '../external-api';
import { Queue } from '../queue/Queue';
import { TestQueueAdaptor } from '../queue/TestQueueAdaptor';
import type { Subscriber } from '../subscribers/Subscriber';
import { TestSubscriberAdaptor } from '../subscribers/TestSubscriberAdaptor';
import { Topic } from '../topic/Topic';
import { loadTestManifest, type TestManifest } from './manifest';

/** How each database's test factory is built, keyed by its service name. */
export type FactoryBuilders = Record<string, (db: Kysely<any>) => unknown>;

export interface FeatureTestOptions<
	TBrowser extends TestBrowser,
	TFactories extends FactoryBuilders = {},
	TFakes extends FakeModules = {},
> {
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
	 * Each database's test factory — `createFactory` from
	 * `test/factories/<construct>.ts`, which the generated harness imports —
	 * keyed by the database's service name. Each is called once per test with
	 * that database's transaction, so what a test inserts through it is rolled
	 * back with everything else, and seen by the endpoints it calls.
	 */
	factories?: TFactories;
	/**
	 * Each external API's fake module — `test/fakes/<id>.ts`, which the
	 * generated harness imports — keyed by the API's construct id. Its default
	 * export is the fake, served at the URL the test stage resolved for it; its
	 * named exports are what a test reads through `fake(construct)`.
	 */
	fakes?: TFakes;
}

/** A fake's module: the fake as its default export, beside whatever it shares. */
export type FakeModule = { readonly default: Fake } & Record<string, unknown>;

/** Each external API's fake module, by construct id. */
export type FakeModules = Record<string, FakeModule>;

/** What `fake(construct)` hands a test: the module's named exports. */
export type FakeExports<
	TFakes extends FakeModules,
	TId extends string,
> = TId extends keyof TFakes ? Omit<TFakes[TId], 'default'> : never;

/** Each database's schema, keyed by its service name. */
export type DatabaseSchemas = Record<string, unknown>;

/**
 * The app's databases for this test, by service name — `db.get('database')`.
 *
 * Each is this test's transaction on that database: opened by whatever reaches
 * it first — the test, a factory, an endpoint — and the same one for all of
 * them, rolled back after the test.
 */
export interface TestDatabases<TDatabases extends DatabaseSchemas> {
	get<K extends keyof TDatabases & string>(
		name: K,
	): Promise<Kysely<TDatabases[K]>>;
}

/**
 * Each of the app's databases' test factory, by service name —
 * `await factories.get('database')`. Built on first use, on that database's
 * transaction for this test — the one `db.get` returns — and the same factory
 * for the rest of the test.
 */
export interface TestFactories<TFactories extends FactoryBuilders> {
	get<K extends keyof TFactories & string>(
		name: K,
	): Promise<ReturnType<TFactories[K]>>;
}

export interface FeatureContext<
	TBrowser extends TestBrowser,
	TDatabases extends DatabaseSchemas = {},
	TFactories extends FactoryBuilders = {},
	TFakes extends FakeModules = {},
> {
	/** This test's browser, already the global `fetch`. */
	browser: TBrowser;
	/**
	 * The app's own databases — not a tenant an auth server owns, not a
	 * reader — by service name: `await db.get('database')`. The same
	 * transaction the test's endpoints and factories use.
	 */
	db: TestDatabases<TDatabases>;
	/**
	 * Each of the app's databases' test factory, by service name —
	 * `await factories.get('database')` — on the same transaction `db.get`
	 * returns.
	 */
	factories: TestFactories<TFactories>;
	/**
	 * Testkit's faker — the one factories are handed — seeded from this test's
	 * name, so a failing test fails again with the same data, and so a test
	 * imports nothing to make some.
	 */
	faker: FakerFactory;
	/** The mail sent to an address during this test, read from Mailpit. */
	mailbox: (address: string) => Mailbox;
	/**
	 * What this test published to a topic or enqueued on a queue, in order.
	 *
	 * Also delivered: once each request the test makes has answered, a queue's
	 * messages reach its consumer and a topic's events every subscriber that
	 * named them, in this test's transaction — see {@link deliver}.
	 */
	published: (channel: { id: string }) => PublishedMessage[];
	/**
	 * A subscriber, run on its own — handed events rather than delivered them —
	 * with this test's services: its databases resolve to this test's
	 * transactions, as an endpoint's do.
	 */
	subscriber: <S extends Subscriber<any, any, any, any, any, any, any>>(
		subscriber: S,
	) => SubscriberAdaptorOf<S>;
	/**
	 * What an external API's fake shares — its module's named exports, from the
	 * same instance the test stage serves: `fake(push).outbox.sentTo(token)`.
	 * Keyed by the construct, as `queue(…)` and `published(…)` are, so a fake
	 * the app does not declare is a type error rather than a relative import.
	 */
	fake: <C extends { readonly id: keyof TFakes & string }>(
		construct: C,
	) => FakeExports<TFakes, C['id']>;
	/** A queue's worker, run on its own with this test's services. */
	queue: <Q extends Queue<any, any, any, any, any, any>>(
		queue: Q,
	) => QueueAdaptorOf<Q>;
}

type SubscriberAdaptorOf<S> =
	S extends Subscriber<
		infer TServices,
		infer TLogger,
		infer OutSchema,
		infer TEventPublisher,
		infer TSubscribedEvents,
		infer TDatabase,
		infer TDatabaseServiceName
	>
		? TestSubscriberAdaptor<
				TServices,
				TLogger,
				OutSchema,
				TEventPublisher,
				TSubscribedEvents,
				TDatabase,
				TDatabaseServiceName
			>
		: never;

type QueueAdaptorOf<Q> =
	Q extends Queue<
		infer TName,
		infer TMessage,
		infer TServices,
		infer TLogger,
		infer TDatabase,
		infer TDatabaseServiceName
	>
		? TestQueueAdaptor<
				TName,
				TMessage,
				TServices,
				TLogger,
				TDatabase,
				TDatabaseServiceName
			>
		: never;

/** The schema a database construct was declared with — what `db` is typed by. */
export type DatabaseOf<C> =
	C extends KyselyDatabase<infer DB, any> ? DB : unknown;

/** One message as it was published: its type and its payload. */
export interface PublishedMessage {
	type: string;
	payload: unknown;
}

type FeatureFn<
	TBrowser extends TestBrowser,
	TDatabases extends DatabaseSchemas,
	TFactories extends FactoryBuilders,
	TFakes extends FakeModules,
> = (
	context: FeatureContext<TBrowser, TDatabases, TFactories, TFakes>,
) => unknown;

export interface FeatureIt<
	TBrowser extends TestBrowser,
	TDatabases extends DatabaseSchemas = {},
	TFactories extends FactoryBuilders = {},
	TFakes extends FakeModules = {},
> {
	(
		name: string,
		fn: FeatureFn<TBrowser, TDatabases, TFactories, TFakes>,
		timeout?: number,
	): void;
	only(
		name: string,
		fn: FeatureFn<TBrowser, TDatabases, TFactories, TFakes>,
		timeout?: number,
	): void;
	skip(
		name: string,
		fn: FeatureFn<TBrowser, TDatabases, TFactories, TFakes>,
		timeout?: number,
	): void;
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
	/** This test's inbox, when the app sends mail — what `browser.signIn` reads. */
	mailbox?: (address: string) => Mailbox;
	/** What this test published, by topic or queue id. */
	published: Map<string, PublishedMessage[]>;
	/** What was published and is still to be delivered, in order. */
	pending: {
		channel: Topic<any, any> | Queue<any, any>;
		messages: PublishedMessage[];
	}[];
	/** Set while delivering, so a consumer's own requests do not deliver again. */
	delivering: boolean;
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
	/** Every topic subscriber, by the name it is exported as. */
	subscribers: {
		name: string;
		subscriber: Subscriber<any, any, any, any, any>;
	}[];
	readMail?: (address: string) => Mailbox;
}

export function featureTest<
	TBrowser extends TestBrowser = TestBrowser,
	TDatabases extends DatabaseSchemas = {},
	TFactories extends FactoryBuilders = {},
	TFakes extends FakeModules = {},
>(
	options: FeatureTestOptions<TBrowser, TFactories, TFakes> = {},
): FeatureIt<TBrowser, TDatabases, TFactories, TFakes> {
	const manifest = options.manifest ?? loadTestManifest();
	const BrowserClass = (options.browser ?? TestBrowser) as new () => TBrowser;

	let app: LoadedApp;
	let factoryDatabases: [string, KyselyDatabase][] = [];
	let owned: KyselyDatabase[] = [];
	let network: SetupServer;
	let restoreFetch: () => void = () => {};

	beforeAll(async () => {
		app = await load(manifest, options.modules ?? {});
		owned = ownDatabases(app, manifest);
		factoryDatabases = databasesFor(options.factories ?? {}, owned);
		for (const database of app.databases) bindToTests(database);

		network = setupServer(
			...surfaceHandlers(app.endpoints, manifest.env),
			...app.auths.map((auth) =>
				authHandler(auth, manifest.env, app.envParser),
			),
			...Object.entries(options.fakes ?? {}).flatMap(([id, module]) =>
				fakeHandler(id, module.default, manifest.env),
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
		const restoreStamp = installContextFetch();
		// Outermost: once a request the test made has answered, what it
		// published is delivered before the test sees the response.
		const stamped = globalThis.fetch;
		globalThis.fetch = deliveringFetch(stamped, (id) => {
			const state = contexts.get(id);
			return state ? deliver(app, state, id) : Promise.resolve();
		});
		restoreFetch = () => {
			globalThis.fetch = stamped;
			restoreStamp();
		};
	});
	afterAll(() => {
		restoreFetch();
		network?.close();
	});

	const run =
		(name: string, fn: FeatureFn<TBrowser, TDatabases, TFactories, TFakes>) =>
		async (): Promise<void> => {
			const id = randomUUID();
			faker.seed(seedOf(name));
			const state: ContextState = {
				transactions: new TransactionRegistry(),
				discovery: new ServiceDiscovery(app.envParser),
				surfaces: new Map(),
				auth: new Map(),
				addresses: new Set(),
				published: new Map(),
				pending: [],
				delivering: false,
			};
			const readMail = app.readMail;
			if (readMail) {
				state.mailbox = (address) => {
					state.addresses.add(address);
					return readMail(address);
				};
			}
			contexts.set(id, state);
			// Before anything resolves them: a publisher is a service, so the one this
			// test's endpoints get is whichever is registered under its name first.
			await state.discovery.register(recorders(app.channels, state));

			try {
				await runInTestContext(id, async () => {
					const browser = new BrowserClass();
					const restore = browser.install();
					try {
						// A database's transaction for this test, opened on first use —
						// the registry hands everyone in the test the same one.
						const transaction = (database: KyselyDatabase) =>
							state.transactions.get(
								database.id,
								urlOf(database, app.envParser),
								database.clientConfig,
							) as Promise<Kysely<any>>;
						const db: TestDatabases<any> = {
							get: (name) => {
								const database = owned.find(
									(candidate) => candidate.service.serviceName === name,
								);
								if (!database) {
									throw new UnknownDatabase(
										name,
										owned.map((candidate) => candidate.service.serviceName),
									);
								}
								return transaction(database);
							},
						};
						const built = new Map<string, Promise<unknown>>();
						const factories: TestFactories<any> = {
							get: (name) => {
								const database = factoryDatabases.find(
									([candidate]) => candidate === name,
								)?.[1];
								if (!database) {
									throw new UnknownFactory(
										name,
										factoryDatabases.map(([candidate]) => candidate),
									);
								}
								let factory = built.get(name);
								if (!factory) {
									factory = transaction(database).then(
										options.factories![name]!,
									);
									built.set(name, factory);
								}
								return factory as Promise<any>;
							},
						};
						await fn({
							browser,
							db: db as TestDatabases<TDatabases>,
							factories: factories as TestFactories<TFactories>,
							faker,
							mailbox: (address) => {
								if (!state.mailbox) throw new NoInbox();
								return state.mailbox(address);
							},
							published: (channel) => [
								...(state.published.get(channel.id) ?? []),
							],
							fake: (construct) =>
								fakeExports(options.fakes ?? {}, construct.id),
							// A consumer run by hand delivers what it published, as a
							// request does.
							subscriber: (subscriber) =>
								thenDeliver(
									new TestSubscriberAdaptor(subscriber, state.discovery),
									() => deliver(app, state, id),
								) as SubscriberAdaptorOf<typeof subscriber>,
							queue: (queue) =>
								thenDeliver(new TestQueueAdaptor(queue, state.discovery), () =>
									deliver(app, state, id),
								) as QueueAdaptorOf<typeof queue>,
						} as FeatureContext<TBrowser, TDatabases, TFactories, TFakes>);
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

	const it = ((name, fn, timeout) =>
		test(name, run(name, fn), timeout)) as FeatureIt<
		TBrowser,
		TDatabases,
		TFactories,
		TFakes
	>;
	it.only = (name, fn, timeout) => test.only(name, run(name, fn), timeout);
	it.skip = (name, fn, timeout) => test.skip(name, run(name, fn), timeout);
	return it;
}

/**
 * A test's faker seed, from its name: the same test draws the same data on
 * every run, and two tests draw different data.
 */
function seedOf(name: string): number {
	let hash = 0;
	for (const char of name) {
		hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
	}
	return hash >>> 0;
}

/**
 * Import what the manifest points at.
 *
 * The same modules the app runs, so a construct here *is* the app's construct —
 * the one its endpoints were built from — never a copy declared again.
 */
async function load(
	manifest: TestManifest,
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
	const subscribers = (
		await Promise.all(
			(manifest.subscribers ?? []).map(async ({ source }) => ({
				name: source.export,
				subscriber: await imported(source),
			})),
		)
	).filter(
		(
			entry,
		): entry is {
			name: string;
			subscriber: Subscriber<any, any, any, any, any>;
		} =>
			(entry.subscriber as { __IS_SUBSCRIBER__?: unknown })
				?.__IS_SUBSCRIBER__ === true,
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
		subscribers,
		...(inbox ? { readMail: createMailbox({ inbox }) } : {}),
	};
}

/**
 * A publisher that records rather than sends, under the name a topic or queue
 * is injected by — `services.users` — which is also the one `.event(users, …)`
 * publishes through.
 */
function recorders(
	channels: LoadedApp['channels'],
	state: ContextState,
): { serviceName: string; register: () => unknown }[] {
	return channels.map((channel) => {
		const publisher = {
			async publish(messages: PublishedMessage[]) {
				const sent = messages.map(({ type, payload }) => ({ type, payload }));
				state.published.set(channel.id, [
					...(state.published.get(channel.id) ?? []),
					...sent,
				]);
				state.pending.push({ channel, messages: sent });
			},
		};
		return {
			serviceName: channel.service.serviceName,
			register: () => publisher,
		};
	});
}

/**
 * The databases a test is handed: the app's own. A schema tenant an auth server
 * owns is reached through that server, as the app reaches it, and a reader is
 * the same database through a read-only role — neither is another database to
 * test against.
 */
function ownDatabases(
	app: LoadedApp,
	manifest: TestManifest,
): KyselyDatabase[] {
	const owners = new Set(app.auths.map((auth) => auth.databaseId));
	return app.databases.filter(
		(database) =>
			!owners.has(database.id) &&
			manifest.constructs[database.id]?.kind !== 'database-reader',
	);
}

/** Each factory's database, found by the service name it is keyed by. */
function databasesFor(
	factories: FactoryBuilders,
	databases: KyselyDatabase[],
): [string, KyselyDatabase][] {
	return Object.keys(factories).map((name) => {
		const database = databases.find(
			(candidate) => candidate.service.serviceName === name,
		);
		if (!database) {
			throw new UnknownFactory(
				name,
				databases.map((candidate) => candidate.service.serviceName),
			);
		}
		return [name, database];
	});
}

/**
 * Make a database resolve, inside a test, to that test's transaction.
 *
 * Everything reaches a database through its service — an endpoint through
 * service discovery, the auth server through its tenant directly — so this is
 * the one place a test's connection can be handed over. Outside a test it is
 * the database it always was.
 */
/** Rounds of delivery before a chain of consumers is called a loop. */
const MAX_DELIVERY_ROUNDS = 25;

/**
 * Deliver what this test published, in-process, as the broker would — and
 * keep delivering what the consumers publish in turn, until nothing is left.
 *
 * - A queue's messages go to its one consumer, as a batch.
 * - A topic's events go to every subscriber that named their type, and only
 *   those: fan-out, as the filter policy (SNS) or the per-subscriber queue
 *   (pg-boss) does it.
 * - Each payload is checked against the consumer's schema first. Turning an
 *   SNS envelope or an SQS record into `{ type, payload }` is each adaptor's
 *   job and tested there; what is tested here is what the handler is handed.
 * - Consumers run as the server side of this test, so their databases are
 *   this test's transactions and their writes roll back with it.
 * - A consumer that throws fails the test. Deployed, the message would be
 *   retried; here a retry would only hide the bug.
 */
async function deliver(
	app: LoadedApp,
	state: ContextState,
	id: string,
): Promise<void> {
	if (state.delivering) return;
	state.delivering = true;
	try {
		for (let round = 0; state.pending.length > 0; round++) {
			if (round === MAX_DELIVERY_ROUNDS) {
				throw new DeliveryDidNotSettle(MAX_DELIVERY_ROUNDS, [
					...new Set(state.pending.map(({ channel }) => channel.id)),
				]);
			}
			for (const { channel, messages } of state.pending.splice(0)) {
				if (channel instanceof Queue) {
					await toQueue(channel, messages, state, id);
				} else {
					await toSubscribers(channel, messages, app, state, id);
				}
			}
		}
	} finally {
		state.delivering = false;
	}
}

async function toQueue(
	queue: Queue<any, any>,
	messages: PublishedMessage[],
	state: ContextState,
	id: string,
): Promise<void> {
	const payloads: unknown[] = [];
	for (const message of messages) {
		payloads.push(
			await accepted(queue.messageSchema, message, `queue '${queue.name}'`),
		);
	}

	await runAsServer(id, () =>
		new TestQueueAdaptor(queue, state.discovery).invoke({ messages: payloads }),
	).catch((error: unknown) => {
		throw new DeliveryFailed(`queue '${queue.name}'`, messages, error);
	});
}

async function toSubscribers(
	topic: Topic<any, any>,
	messages: PublishedMessage[],
	app: LoadedApp,
	state: ContextState,
	id: string,
): Promise<void> {
	for (const { name, subscriber } of app.subscribers) {
		if (subscriber.topicName !== topic.name) continue;

		const named = messages.filter(({ type }) =>
			(subscriber.subscribedEvents ?? []).includes(type),
		);
		if (named.length === 0) continue;

		const consumer = `subscriber '${name}'`;
		const events: PublishedMessage[] = [];
		for (const message of named) {
			const schema = (topic.eventSchemas as Record<string, unknown>)[
				message.type
			];
			events.push({
				type: message.type,
				payload: await accepted(schema, message, consumer),
			});
		}

		await runAsServer(id, () =>
			new TestSubscriberAdaptor(subscriber, state.discovery).invoke({
				events,
			} as never),
		).catch((error: unknown) => {
			throw new DeliveryFailed(consumer, named, error);
		});
	}
}

/** The payload, if the consumer's schema takes it — what the handler is handed. */
async function accepted(
	schema: unknown,
	message: PublishedMessage,
	consumer: string,
): Promise<unknown> {
	const standard = (schema as StandardSchemaV1 | undefined)?.['~standard'];
	if (!standard) return message.payload;

	const result = await standard.validate(message.payload);
	if (result.issues) {
		throw new MessageRejected(consumer, message, result.issues);
	}
	return result.value;
}

/** `fetch`, delivering what the test published once each of its requests answers. */
function deliveringFetch(
	inner: typeof fetch,
	settle: (id: string) => Promise<void>,
): typeof fetch {
	return async (input, init) => {
		const context = currentTestContext();
		const response = await inner(input, init);
		// The test's own requests only: a handler's requests are part of the one
		// being served, and a consumer's are part of a delivery already running.
		if (context?.side === 'client') await settle(context.id);
		return response;
	};
}

/** An adaptor whose `invoke` delivers what it published before returning. */
function thenDeliver<
	T extends { invoke: (...args: any[]) => Promise<unknown> },
>(adaptor: T, settle: () => Promise<void>): T {
	const invoke = adaptor.invoke.bind(adaptor);
	adaptor.invoke = (async (...args: unknown[]) => {
		const result = await invoke(...args);
		await settle();
		return result;
	}) as T['invoke'];
	return adaptor;
}

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
			database.clientConfig,
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

/**
 * An external API's app fake, answering at the URL the test stage resolved for
 * it — so a handler that calls Polar calls the fake, and the test sets up
 * nothing.
 *
 * Not per test, unlike a surface: a fake stands in for somebody else's server,
 * which no test's transaction reaches. An image fake has no handler here — its
 * container answers on localhost, which is let through.
 */
function fakeHandler(
	id: string,
	fake: Fake,
	env: Record<string, string | undefined>,
) {
	const base = env[provideKey(id, 'url')];
	if (fake.kind !== 'app' || !base) return [];

	return [
		http.all(`${trim(base)}/*`, ({ request }) => fake.handler.fetch(request)),
	];
}

/**
 * A fake module's named exports — what `fake(construct)` returns. The default
 * export is the fake being served; everything else is what the fake chose to
 * share with a test.
 */
function fakeExports(fakes: FakeModules, id: string) {
	const module = fakes[id];
	if (!module) throw new NoFakeFor(id, Object.keys(fakes));
	if (module.default.kind === 'image') throw new ImageFakeHasNoState(id);

	const { default: _served, ...shared } = module;
	return shared as never;
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

/** What `signInWithMagicLink` uses of a better-auth client. */
export interface MagicLinkAuthClient<TSession> {
	signIn: {
		magicLink(input: {
			email: string;
		}): Promise<{ error?: { message?: string } | null }>;
	};
	getSession(): Promise<{ data: TSession | null }>;
}

/**
 * Sign a test's browser in the way a person does: ask the auth server for a
 * magic link, open the email it sent, follow the link.
 *
 * What the generated `browser.signIn(email)` calls. The address's mail is
 * cleared first — so the link is this request's, not one an earlier test left
 * — and cleared again after the test, like any address a test reads. Returns
 * the session the auth server then reports, as better-auth hands it back.
 */
export async function signInWithMagicLink<TSession>(
	browser: TestBrowser,
	auth: MagicLinkAuthClient<TSession>,
	email: string = freshAddress(),
): Promise<TSession> {
	const context = currentTestContext();
	const state = context && contexts.get(context.id);
	if (!state) throw new UnknownTestContext('signIn', context?.id);
	if (!state.mailbox) throw new NoInbox();

	const inbox = state.mailbox(email);
	await inbox.clear();

	const requested = await auth.signIn.magicLink({ email });
	if (requested.error) {
		throw new SignInFailed(
			email,
			`the auth server refused the magic link: ${requested.error.message ?? 'no reason given'}`,
		);
	}

	const mail = await inbox.last();
	if (!mail.link) throw new SignInFailed(email, 'its email held no link');
	await browser.visit(mail.link);

	const { data } = await auth.getSession();
	if (!data) {
		throw new SignInFailed(
			email,
			'the auth server reported no session after the link was opened',
		);
	}
	return data;
}

/**
 * An address nobody else signs in as — what `browser.signIn()` uses when the
 * test does not care who it is.
 *
 * Unique rather than only seeded: tests in other files run at the same time,
 * against the same Mailpit and the same unique columns, and a seeded address
 * repeats wherever two tests share a name. The readable half is the seeded
 * faker's, so a failure still names somebody.
 */
function freshAddress(): string {
	const name = faker.internet
		.username()
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');

	return `${name}.${randomUUID().slice(0, 8)}@example.test`;
}

/** `browser.signIn` finished without a session. */
export class SignInFailed extends Error {
	constructor(
		readonly email: string,
		readonly reason: string,
	) {
		super(`Signing ${email} in failed: ${reason}.`);
		this.name = 'SignInFailed';
	}
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

/** `db.get(name)` named no database the test is handed. */
export class UnknownDatabase extends Error {
	constructor(
		readonly database: string,
		readonly known: readonly string[],
	) {
		super(
			`db.get('${database}') names no database of this app's. ` +
				(known.length > 0
					? `Its databases: ${known.join(', ')}. `
					: 'It declares no database of its own. ') +
				`A tenant an auth server owns is reached through that server, and a ` +
				`reader through the database it reads.`,
		);
		this.name = 'UnknownDatabase';
	}
}

/** A factory keyed by a service name no database the app declares has. */
export class UnknownFactory extends Error {
	constructor(
		readonly factory: string,
		readonly known: readonly string[],
	) {
		super(
			`There is a test factory for '${factory}', and no database this app ` +
				`declares is called that. ` +
				(known.length > 0
					? `Its databases: ${known.join(', ')}. `
					: 'It declares no database. ') +
				`Name the file after the database construct: test/factories/<construct>.ts.`,
		);
		this.name = 'UnknownFactory';
	}
}

/** A published message the consumer's own schema refuses. */
export class MessageRejected extends Error {
	constructor(
		readonly consumer: string,
		readonly published: PublishedMessage,
		readonly issues: ReadonlyArray<StandardSchemaV1.Issue>,
	) {
		super(
			`${consumer} refuses '${published.type}': ${issues
				.map((issue) => issue.message)
				.join('; ')}. What is published must be what the consumer's schema ` +
				'takes — fix the producer, or the schema.',
		);
		this.name = 'MessageRejected';
	}
}

/** A consumer that threw while handling what the test published. */
export class DeliveryFailed extends Error {
	constructor(
		readonly consumer: string,
		readonly messages: readonly PublishedMessage[],
		override readonly cause: unknown,
	) {
		super(
			`${consumer} failed handling ${messages
				.map(({ type }) => `'${type}'`)
				.join(', ')}: ${(cause as Error)?.message ?? String(cause)}. ` +
				'Deployed, the message would be retried; here the failure is the result.',
			{ cause },
		);
		this.name = 'DeliveryFailed';
	}
}

/** Consumers that kept publishing to each other without settling. */
export class DeliveryDidNotSettle extends Error {
	constructor(
		readonly rounds: number,
		readonly channels: readonly string[],
	) {
		super(
			`Delivery did not settle after ${rounds} rounds — consumers are still ` +
				`publishing to ${channels.join(', ')}. A consumer that publishes to ` +
				'what triggers it loops forever deployed too.',
		);
		this.name = 'DeliveryDidNotSettle';
	}
}

/** `fake(construct)` for an external API with no fake module. */
export class NoFakeFor extends Error {
	constructor(
		readonly id: string,
		readonly available: readonly string[],
	) {
		super(
			`'${id}' has no fake: there is no test/fakes/${id}.ts for this app` +
				(available.length ? ` (fakes: ${available.join(', ')})` : '') +
				'. Add one, exporting what the test should read.',
		);
		this.name = 'NoFakeFor';
	}
}

/** `fake(construct)` for a fake that runs as a container, holding no module state. */
export class ImageFakeHasNoState extends Error {
	constructor(readonly id: string) {
		super(
			`'${id}' is faked by a container image, which shares no state with the ` +
				"test. Assert through the provider's own API instead.",
		);
		this.name = 'ImageFakeHasNoState';
	}
}
