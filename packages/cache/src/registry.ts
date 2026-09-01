/**
 * Cache drivers, keyed by URL scheme.
 *
 * The same shape `@geekmidas/storage` uses, for the same reason: a construct is
 * handed one URL and the scheme in it picks the client. That is what lets the
 * *backend* be a deployment choice rather than an application one — an app
 * caching in Postgres and an app caching in Upstash are the same code.
 *
 * Registration is explicit rather than an import side effect, because a
 * side-effecting module is exactly what a bundler is entitled to drop — and
 * because an app that caches in Postgres should never resolve a Redis client.
 */

import type { Cache } from './index';

/** What a driver has to supply: a scheme it answers to, and a client for a URL. */
export interface CacheDriver {
	/** Including the colon, as `URL.protocol` reports it — `redis:`, `https:`. */
	scheme: string;
	create(url: string): Cache;
}

const drivers = new Map<string, CacheDriver>();

/** Make a driver available to {@link createCacheClient}. Idempotent. */
export function registerCacheDriver(driver: CacheDriver): void {
	drivers.set(driver.scheme, driver);
}

/** Which schemes are currently registered — the useful half of a failure. */
export function registeredCacheSchemes(): string[] {
	return [...drivers.keys()].sort();
}

/**
 * Build a client for a URL.
 *
 * @throws {UnregisteredCacheScheme} when no driver handles the scheme, which in
 * practice means the entry point registered a different one — the backend and
 * the build disagreeing, caught at the first cache call rather than never.
 */
export function createCacheClient(url: string): Cache {
	const scheme = schemeOf(url);
	const driver = drivers.get(scheme);

	if (!driver) {
		throw new UnregisteredCacheScheme(url, scheme, registeredCacheSchemes());
	}

	return driver.create(url);
}

/** No driver handles the scheme in a cache URL. */
export class UnregisteredCacheScheme extends Error {
	constructor(
		readonly url: string,
		readonly scheme: string,
		readonly registered: readonly string[],
	) {
		super(
			`No cache driver handles '${scheme}'. ` +
				(registered.length
					? `Registered: ${registered.join(', ')}.`
					: 'Nothing is registered.') +
				' The scheme comes from the backend the target provisioned, so this ' +
				'is usually a build that registered a different one.',
		);
		this.name = 'UnregisteredCacheScheme';
	}
}

function schemeOf(url: string): string {
	const separator = url.indexOf(':');
	return separator === -1 ? '' : url.slice(0, separator + 1);
}
