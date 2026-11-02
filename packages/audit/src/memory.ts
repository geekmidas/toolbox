import type { Cache } from '@geekmidas/cache';
import { CacheAuditStorage } from './cache';
import type { AuditableAction } from './types';

/**
 * A `Map` behind the `Cache` interface, so the in-memory store needs no
 * `@geekmidas/cache` — an optional peer — at run time. Records never expire:
 * they live as long as the process.
 */
class MapCache implements Cache {
	private readonly store = new Map<string, unknown>();

	async get<T>(key: string): Promise<T | undefined> {
		return this.store.get(key) as T | undefined;
	}

	async set<T>(key: string, value: T): Promise<void> {
		this.store.set(key, value);
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key);
	}

	async ttl(key: string): Promise<number> {
		return this.store.has(key) ? Number.POSITIVE_INFINITY : 0;
	}
}

/**
 * In-memory audit storage implementation.
 * Convenience wrapper around CacheAuditStorage with an in-process map.
 *
 * Useful for testing, development, and applications that don't need persistent audit logs.
 *
 * @template TAuditAction - Optional type parameter for type-safe audit actions.
 *
 * @example
 * ```typescript
 * import { InMemoryAuditStorage } from '@geekmidas/audit/memory';
 * import { DefaultAuditor } from '@geekmidas/audit';
 *
 * const storage = new InMemoryAuditStorage();
 * const auditor = new DefaultAuditor({
 *   actor: { id: 'user-123', type: 'user' },
 *   storage,
 * });
 *
 * auditor.audit('user.created', { userId: '789', email: 'test@example.com' });
 * await auditor.flush();
 *
 * // Query stored records
 * const records = await storage.query({ type: 'user.created' });
 *
 * // Get all records (for testing)
 * const all = await storage.getRecords();
 *
 * // Clear for next test
 * await storage.clear();
 * ```
 */
export class InMemoryAuditStorage<
	TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
		string,
		unknown
	>,
> extends CacheAuditStorage<TAuditAction> {
	constructor() {
		super({ cache: new MapCache() });
	}
}
