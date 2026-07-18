import type { Cache } from '@geekmidas/cache';
import { InMemoryCache } from '@geekmidas/cache/memory';
import type { Service } from '@geekmidas/services';

/**
 * A cache service. `InMemoryCache` here (a real dependency, not a mock — the
 * toolbox favours integration over mocking); swap for `UpstashCache` in prod.
 * `ServiceDiscovery` caches this, so it's effectively a per-process singleton.
 */
export const CacheService = {
	serviceName: 'cache' as const,
	register(): Cache {
		return new InMemoryCache();
	},
} satisfies Service<'cache', Cache>;
