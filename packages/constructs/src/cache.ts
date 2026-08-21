/**
 * `Cache` — a declared key/value cache.
 *
 * The same three-package meeting point as `ObjectStorage` and `Email`: it
 * implements the construct contract, derives its env key through
 * `@geekmidas/manifest`, and hands back a `@geekmidas/cache` client.
 *
 * It names no provider. A cache is reached over HTTP with a token whether it is
 * Upstash deployed or a proxy in front of Redis locally, so there is one client
 * and one URL shape, and the provider survives only as a host and a credential
 * — exactly the argument that makes `Email` always `smtp://`.
 */

import type { Cache as CacheClient } from '@geekmidas/cache';
import { UpstashCache } from '@geekmidas/cache/upstash';
import {
	type ConstructName,
	canonicalId,
	type Declaration,
	provideKey,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import type { Construct } from './construct-interface';

export class Cache<TName extends string = string>
	implements Construct<TName, CacheClient>
{
	readonly id: TName;
	readonly service: Service<Uncapitalize<TName>, CacheClient>;

	/**
	 * Declared once and read by both `declare()` and `connect()`, so the key the
	 * target publishes and the key the client reads cannot drift.
	 */
	private readonly key: string;

	constructor(id: ConstructName<TName>) {
		const canonical = canonicalId(id as string);

		this.id = canonical as TName;
		this.key = provideKey(canonical, 'url');

		// A field, not a getter: consumers cache services by object identity.
		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			register: (options) => this.connect(options),
		};
	}

	declare(): Declaration[] {
		return [{ kind: 'cache', id: this.id, provides: [this.key] }];
	}

	/**
	 * Builds the client from the single URL the target supplied.
	 *
	 * The token travels in the URL's userinfo rather than in a second key, for
	 * the same reason a Postgres password does: an address and the credential
	 * that opens it are one fact, and splitting them is one more thing to keep
	 * in step.
	 */
	private async connect({
		envParser,
	}: ServiceRegisterOptions): Promise<CacheClient> {
		const { url } = envParser
			.create((get) => ({ url: get(this.key).string() }))
			.parse();

		const { endpoint, token } = parseCacheUrl(url);

		return new UpstashCache(endpoint, token);
	}
}

/** What a cache URL addresses: an HTTP endpoint and the token that opens it. */
export interface CacheAddress {
	endpoint: string;
	token: string;
}

/**
 * Split a cache URL into what the client takes.
 *
 * `http://:token@localhost:20705` → `{ endpoint: 'http://localhost:20705',
 * token }`. Deployed the scheme is `https` and the host is Upstash's; nothing
 * else differs, which is the point.
 */
export function parseCacheUrl(url: string): CacheAddress {
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
