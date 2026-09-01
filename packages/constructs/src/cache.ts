/**
 * `Cache` — a declared key/value cache.
 *
 * The same three-package meeting point as `ObjectStorage` and `Email`: it
 * implements the construct contract, derives its env key through
 * `@geekmidas/manifest`, and hands back a `@geekmidas/cache` client.
 *
 * It names no provider — and unlike `Email`, it cannot name one protocol
 * either. Every mail backend speaks SMTP, so an `smtp://` URL is true of all of
 * them; cache backends genuinely differ, because Upstash speaks HTTP, a Redis
 * speaks its wire protocol, and a table in Postgres speaks SQL. So the scheme in
 * the URL picks the driver, exactly as it does for object storage, and which
 * drivers exist is the generated entry point's decision.
 *
 * The backend is chosen at deploy, not here. An app caching in Postgres and an
 * app caching in Upstash are the same application code.
 */

import { type Cache as CacheClient, createCacheClient } from '@geekmidas/cache';
import {
	type ConstructName,
	canonicalId,
	type Declaration,
	provideKey,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import type { Construct } from './construct-interface';

export interface CacheOptions {
	/**
	 * The database this cache lives in.
	 *
	 * Set by `database.cache()` rather than written by hand — the point of the
	 * method is that the parent's id comes from the parent rather than from a
	 * string somebody has to keep in step.
	 */
	of?: string;
	/** The table entries are kept in. Defaults to `cache`. */
	table?: string;
}

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

	constructor(
		id: ConstructName<TName>,
		private readonly options: CacheOptions = {},
	) {
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
		return [
			{
				kind: 'cache',
				id: this.id,
				...(this.options.of ? { of: this.options.of } : {}),
				...(this.options.table ? { table: this.options.table } : {}),
				provides: [this.key],
			},
		];
	}

	/**
	 * Builds the client from the single URL the target supplied.
	 *
	 * Any credential travels in that URL's userinfo rather than in a second key,
	 * for the same reason a Postgres password does: an address and the thing that
	 * opens it are one fact, and splitting them is one more thing to keep in step.
	 *
	 * The scheme selects the driver, so this construct imports no provider and
	 * an app that caches in Postgres never resolves a Redis client. Whoever
	 * assembles the application registers the drivers its target needs.
	 */
	private async connect({
		envParser,
	}: ServiceRegisterOptions): Promise<CacheClient> {
		const { url } = envParser
			.create((get) => ({ url: get(this.key).string() }))
			.parse();

		return createCacheClient(url);
	}
}
