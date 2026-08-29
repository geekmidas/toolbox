/**
 * A cache over the Redis wire protocol — ElastiCache, Valkey, or a Redis you run.
 *
 * The sibling of the Upstash client rather than a replacement for it. Upstash
 * speaks HTTP, which is what makes it reachable from a Lambda with no VPC and
 * no connection pool; this speaks the wire protocol, which is what ElastiCache
 * offers and what a container next to your app is cheapest on.
 *
 * Choosing one is a deployment decision, and the local target follows it: pick
 * `elasticache` and dev runs plain Redis, pick `upstash` and dev runs the HTTP
 * proxy in front of it. Either way dev and prod speak the same protocol, which
 * is the property that matters — a cache that behaves differently in the two
 * places is worse than a slower one.
 */

import { Redis } from 'ioredis';
import type { Cache } from './index';
import type { CacheDriver } from './registry';

export class RedisCache implements Cache {
	constructor(private readonly client: Redis) {}

	async get<T>(key: string): Promise<T | undefined> {
		const value = await this.client.get(key);
		if (value === null) return undefined;

		try {
			return JSON.parse(value) as T;
		} catch {
			// Written by something that did not go through `set`. Returning the
			// raw string is more useful than throwing on a value somebody put
			// there on purpose.
			return value as unknown as T;
		}
	}

	async set<T>(key: string, value: T, ttl?: number): Promise<void> {
		const encoded = JSON.stringify(value);

		if (ttl === undefined) {
			await this.client.set(key, encoded);
			return;
		}

		await this.client.set(key, encoded, 'EX', ttl);
	}

	async delete(key: string): Promise<void> {
		await this.client.del(key);
	}

	async ttl(key: string): Promise<number> {
		const seconds = await this.client.ttl(key);

		// Redis reports -2 for a key that does not exist and -1 for one with no
		// expiry. The interface says zero for a missing key, and "never expires"
		// has no time left to report either — so both become zero rather than
		// leaking sentinel values a caller would have to know about.
		return seconds < 0 ? 0 : seconds;
	}
}

/**
 * The `redis://` and `rediss://` driver.
 *
 * One client per URL for the life of the process — a Redis connection is a
 * socket, and opening one per cache call is the thing that makes people
 * conclude a cache is not worth having.
 *
 * `ioredis` is imported at the top of this module because the *module* is the
 * lazy boundary: an app caching in Postgres never imports
 * `@geekmidas/cache/redis`, and so never resolves it.
 */
export const redisCacheDriver: CacheDriver = {
	scheme: 'redis:',
	create: (url) => new RedisCache(clientFor(url)),
};

/** The TLS form. ElastiCache Serverless requires it; the same client handles both. */
export const redissCacheDriver: CacheDriver = {
	scheme: 'rediss:',
	create: (url) => new RedisCache(clientFor(url)),
};

const clients = new Map<string, Redis>();

function clientFor(url: string): Redis {
	const existing = clients.get(url);
	if (existing) return existing;

	const client = new Redis(url, {
		// A cache miss is recoverable and a hung request is not. Failing fast and
		// letting the caller treat it as a miss is the behaviour a cache should
		// have; retrying forever turns a degraded cache into a degraded app.
		maxRetriesPerRequest: 2,
		enableOfflineQueue: false,
	});

	clients.set(url, client);

	return client;
}
