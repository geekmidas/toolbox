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
import { join } from 'node:path';
import { type CacheBackend, DEFAULT_CACHE } from '../types.js';

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
	elasticache: {
		imports: `import { registerCacheDriver } from '@geekmidas/cache';\nimport { redisCacheDriver, redissCacheDriver } from '@geekmidas/cache/redis';`,
		setup:
			'registerCacheDriver(redisCacheDriver);\nregisterCacheDriver(redissCacheDriver);',
	},
	db: {
		imports: `import { registerCacheDriver } from '@geekmidas/cache';\nimport { postgresCacheDriver } from '@geekmidas/cache/postgres';`,
		setup: 'registerCacheDriver(postgresCacheDriver);',
	},
};

/**
 * Everything a generated entry should register: object storage, and the cache.
 *
 * Merged here rather than threaded separately, because a generated file has one
 * import block and one setup block whatever fills them.
 */
export function driversFor(options: {
	appRoot: string;
	/** Absent means nothing declared a cache, so no cache driver is registered. */
	cache?: CacheBackend | false;
}): RuntimeDrivers {
	const parts = [
		storageDriversFor(options.appRoot),
		options.cache === false || options.cache === undefined
			? NONE
			: (CACHE_DRIVERS[options.cache] ?? CACHE_DRIVERS[DEFAULT_CACHE]),
	].filter((part) => part.imports || part.setup);

	if (parts.length === 0) return NONE;

	return {
		imports: parts.map((part) => part.imports).join('\n'),
		setup: parts.map((part) => part.setup).join('\n'),
	};
}

/**
 * The drivers an app's entry points should register.
 *
 * Keyed off the dependency rather than off a declared bucket, because the entry
 * is generated before discovery has run on the watcher's rebuild path — and an
 * app that installed `@geekmidas/storage` has already paid for the SDK it would
 * otherwise resolve lazily.
 */
export function storageDriversFor(appRoot: string): RuntimeDrivers {
	return dependsOnStorage(appRoot) ? S3 : NONE;
}

function dependsOnStorage(appRoot: string): boolean {
	const manifest = join(appRoot, 'package.json');
	if (!existsSync(manifest)) return false;

	try {
		const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};

		return Boolean(
			pkg.dependencies?.['@geekmidas/storage'] ??
				pkg.devDependencies?.['@geekmidas/storage'],
		);
	} catch {
		// An unreadable package.json is the build's problem, not this function's.
		return false;
	}
}
