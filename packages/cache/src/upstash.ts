import { Redis } from '@upstash/redis';
import type { Cache } from './';
import type { CacheDriver } from './registry';

export class UpstashCache implements Cache {
	private client: Redis;

	constructor(url: string, token: string) {
		this.client = new Redis({
			url,
			token,
		});
	}

	async ttl(key: string): Promise<number> {
		const ttl = await this.client.ttl(key);

		if (ttl === -2) {
			return 0; // Key does not exist
		}

		return ttl; // Returns TTL in seconds
	}

	async get<T>(key: string): Promise<T | undefined> {
		const v = await this.client.get(key);

		if (v === null) {
			return undefined;
		}

		return v as T;
	}

	async set<T>(key: string, value: T, ttl = 3600): Promise<void> {
		await this.client.set(key, value, { ex: ttl });
	}

	async delete(key: string): Promise<void> {
		await this.client.del(key);
	}
}

/**
 * The `https://` and `http://` driver.
 *
 * The token travels in the URL's userinfo, because an address and the
 * credential that opens it are one fact — see {@link parseUpstashUrl}. Deployed
 * that is Upstash's host over TLS; locally it is the `serverless-redis-http`
 * proxy in front of a Redis container, and the client cannot tell the
 * difference. That is the whole point of choosing this backend.
 */
export const upstashCacheDriver: CacheDriver = {
	scheme: 'https:',
	create: (url) => {
		const { endpoint, token } = parseUpstashUrl(url);
		return new UpstashCache(endpoint, token);
	},
};

/** The same driver for plain HTTP, which is what the local proxy speaks. */
export const upstashInsecureCacheDriver: CacheDriver = {
	...upstashCacheDriver,
	scheme: 'http:',
};

/** What an Upstash cache URL addresses: an HTTP endpoint and the token for it. */
export interface UpstashAddress {
	endpoint: string;
	token: string;
}

/**
 * Split a cache URL into what the client takes.
 *
 * `http://:token@localhost:20705` becomes `{ endpoint: 'http://localhost:20705',
 * token }`. Deployed the scheme is `https` and the host is Upstash's; nothing
 * else differs.
 */
export function parseUpstashUrl(url: string): UpstashAddress {
	const parsed = new URL(url);
	const token = decodeURIComponent(parsed.password || parsed.username);

	parsed.username = '';
	parsed.password = '';

	return {
		// `origin` drops the trailing slash `toString()` would add, which the
		// client would otherwise send as part of every path.
		endpoint: parsed.origin,
		token,
	};
}
