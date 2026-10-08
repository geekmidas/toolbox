/**
 * Driver registration for generated entry points.
 *
 * A construct declares that it needs object storage and is handed one URL; the
 * scheme in that URL picks the driver that builds the client. Which drivers
 * exist is therefore the *entry point's* decision, not the construct's and not
 * the application's — an app that never talks to S3 should never resolve the AWS
 * SDK, and application code that registers a driver has named a provider in the
 * one layer this design keeps provider-free.
 *
 * So the generated entries register: `gkm dev`'s server for local development,
 * and each Lambda handler for its own target. Registration is an explicit call
 * rather than an import side effect, because a side-effecting module is exactly
 * what a bundler is entitled to drop.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
	type CacheBackend,
	DEFAULT_CACHE,
	type EventsBackend,
	holdsEveryCache,
} from '../types.js';

/** The `s3://` driver, which serves MinIO locally and S3 deployed. */
const S3 = {
	imports: `import { registerStorageDriver } from '@geekmidas/storage';\nimport { s3Driver } from '@geekmidas/storage/aws';`,
	setup: 'registerStorageDriver(s3Driver);',
};

/** What a generated entry needs in order to register the drivers it uses. */
export interface RuntimeDrivers {
	/** Import lines, or `''` when there is nothing to register. */
	imports: string;
	/** The registration calls, or `''`. */
	setup: string;
}

/** @deprecated The same shape, from when only storage had drivers. */
export type StorageDrivers = RuntimeDrivers;

const NONE: RuntimeDrivers = { imports: '', setup: '' };

/** The Redis wire protocol's drivers: both schemes, plain and TLS. */
const REDIS: RuntimeDrivers = {
	imports: `import { registerCacheDriver } from '@geekmidas/cache';\nimport { redisCacheDriver, redissCacheDriver } from '@geekmidas/cache/redis';`,
	setup:
		'registerCacheDriver(redisCacheDriver);\nregisterCacheDriver(redissCacheDriver);',
};

/**
 * The cache driver for a backend — exactly one, never all three.
 *
 * Keyed off the *backend* rather than off a dependency, because unlike storage
 * the backend already says which driver is right: a project caching in Postgres
 * resolves `pg` and never `ioredis`, and one caching in Upstash resolves
 * neither. That is the whole reason the drivers live behind separate subpaths.
 *
 * Both HTTP schemes are registered for Upstash, because the local proxy speaks
 * `http://` and Upstash speaks `https://`, and an entry that registered one
 * would work in exactly one of the two places.
 */
const CACHE_DRIVERS: Record<CacheBackend, RuntimeDrivers> = {
	upstash: {
		imports: `import { registerCacheDriver } from '@geekmidas/cache';\nimport { upstashCacheDriver, upstashInsecureCacheDriver } from '@geekmidas/cache/upstash';`,
		setup:
			'registerCacheDriver(upstashCacheDriver);\nregisterCacheDriver(upstashInsecureCacheDriver);',
	},
	elasticache: REDIS,
	// The stack's own Redis speaks the same wire protocol — and a managed
	// Redis set in its place may be `rediss://`.
	redis: REDIS,
	db: {
		imports: `import { registerCacheDriver } from '@geekmidas/cache';\nimport { postgresCacheDriver } from '@geekmidas/cache/postgres';`,
		setup: 'registerCacheDriver(postgresCacheDriver);',
	},
};

/**
 * The events drivers for a broker — only its own, so a bundle never resolves
 * another broker's client library.
 *
 * Keyed off the backend, as the cache is: the target already says which broker
 * carries the app's topics and queues. SNS registers SQS beside it, because on
 * AWS a topic is `sns://` and a queue is `sqs://`, and an entry registering one
 * would publish to topics and fail on the first queue.
 */
const EVENTS_DRIVERS: Record<EventsBackend, RuntimeDrivers> = {
	pgboss: {
		imports: `import { registerEventsDriver } from '@geekmidas/events';\nimport { pgbossEventsDriver } from '@geekmidas/events/pgboss';`,
		setup: 'registerEventsDriver(pgbossEventsDriver);',
	},
	sns: {
		imports: `import { registerEventsDriver } from '@geekmidas/events';\nimport { snsEventsDriver } from '@geekmidas/events/sns';\nimport { sqsEventsDriver } from '@geekmidas/events/sqs';`,
		setup:
			'registerEventsDriver(snsEventsDriver);\nregisterEventsDriver(sqsEventsDriver);',
	},
	rabbitmq: {
		imports: `import { registerEventsDriver } from '@geekmidas/events';\nimport { rabbitmqEventsDriver } from '@geekmidas/events/rabbitmq';`,
		setup: 'registerEventsDriver(rabbitmqEventsDriver);',
	},
};

/**
 * Everything a generated entry should register: object storage, the cache,
 * and the events broker.
 *
 * Merged here rather than threaded separately, because a generated file has one
 * import block and one setup block whatever fills them.
 */
export function driversFor(options: {
	appRoot: string;
	/**
	 * The cache backends actually in play — normally one, and more than one only
	 * where an app declares two caches that live in different places.
	 *
	 * Absent or empty means nothing declared a cache, so no cache driver is
	 * registered at all.
	 */
	cache?: CacheBackend | readonly CacheBackend[] | false;
	/**
	 * The events brokers in play — see {@link eventsBackendsIn}. Absent or
	 * empty means nothing declared a topic or a queue, so no events driver is
	 * registered and `@geekmidas/events` is never resolved.
	 */
	events?: EventsBackend | readonly EventsBackend[] | false;
}): RuntimeDrivers {
	const backends = listOf(options.cache);
	const brokers = listOf(options.events);

	const parts = [
		storageDriversFor(options.appRoot),
		...[...new Set(backends)].map(
			(backend) => CACHE_DRIVERS[backend] ?? CACHE_DRIVERS[DEFAULT_CACHE.aws],
		),
		...[...new Set(brokers)].map((broker) => EVENTS_DRIVERS[broker]),
	].filter((part) => part.imports || part.setup);

	if (parts.length === 0) return NONE;

	return {
		imports: parts.map((part) => part.imports).join('\n'),
		setup: parts.map((part) => part.setup).join('\n'),
	};
}

function listOf<T extends string>(
	value: T | readonly T[] | false | undefined,
): readonly T[] {
	if (value === false || value === undefined) return [];
	return typeof value === 'string' ? [value] : (value as readonly T[]);
}

/**
 * Which events brokers an app's entry has to speak: the target's, when the app
 * declares a `Topic` or a `Queue` — and none at all when it declares neither,
 * so a project without events never resolves `@geekmidas/events`.
 *
 * A worker on pg-boss counts too: a server schedules its crons through the
 * pg-boss broker, which the plan provisions for a declared worker beside a
 * declared database (`workerBroker` in `reconcile/plan.ts`) whether or not
 * anything publishes.
 */
export function eventsBackendsIn(
	manifest: Record<string, { kind: string }>,
	configured: EventsBackend,
): EventsBackend[] {
	const kinds = new Set(Object.values(manifest).map((d) => d.kind));
	const declared =
		kinds.has('topic') ||
		kinds.has('queue') ||
		(configured === 'pgboss' && kinds.has('worker') && kinds.has('database'));

	return declared ? [configured] : [];
}

/**
 * Which cache backends an app's entry actually has to speak.
 *
 * The config answers this for a cache that named nowhere, and the *declaration*
 * answers it for one that named a database — `orders.cache('Sessions')` is a
 * statement about the application, so a deployment cannot move that cache and
 * the entry cannot register a driver for somewhere else.
 *
 * Reading only the config is how an entry ends up registering the Upstash
 * driver for a URL the target composed as `postgres://`, which fails at the
 * first request with `UnregisteredCacheScheme` and a stack that points at the
 * cache rather than at the config that disagreed.
 */
export function cacheBackendsIn(
	manifest: Record<string, { kind: string; of?: string }>,
	configured: CacheBackend,
): CacheBackend[] {
	const caches = Object.values(manifest).filter((d) => d.kind === 'cache');

	// The stack's own Redis holds every cache, one that named a database too.
	return [
		...new Set(
			caches.map((c) =>
				c.of && !holdsEveryCache(configured) ? 'db' : configured,
			),
		),
	];
}

/**
 * The drivers an app's entry points should register.
 *
 * Keyed off the dependency rather than off a declared bucket, because the entry
 * is generated before discovery has run on the watcher's rebuild path — and an
 * app that installed `@geekmidas/storage` has already paid for the SDK it would
 * otherwise resolve lazily.
 *
 * "Installed" the way Node resolves it: the app's own `package.json`, or any
 * directory above it. A workspace that lists `@geekmidas/storage` once, at its
 * root, is the common case — and reading only the app's file registered no S3
 * driver there, so the first service to inject a bucket threw
 * `UnregisteredStorageScheme`. A queue whose consumer depended on one logged
 * that once and was never polled.
 */
export function storageDriversFor(appRoot: string): RuntimeDrivers {
	return installedFrom(appRoot, '@geekmidas/storage') ? S3 : NONE;
}

/**
 * Whether `pkg` is a dependency of the app at `appRoot` the way Node resolves
 * it: listed in the app's own `package.json`, or in any directory above it.
 */
export function installedFrom(appRoot: string, pkg: string): boolean {
	for (let dir = resolve(appRoot); ; dir = dirname(dir)) {
		if (lists(join(dir, 'package.json'), pkg)) return true;
		if (dirname(dir) === dir) return false;
	}
}

function lists(manifest: string, dependency: string): boolean {
	if (!existsSync(manifest)) return false;

	try {
		const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};

		return Boolean(
			pkg.dependencies?.[dependency] ?? pkg.devDependencies?.[dependency],
		);
	} catch {
		// An unreadable package.json is the build's problem, not this function's.
		return false;
	}
}
