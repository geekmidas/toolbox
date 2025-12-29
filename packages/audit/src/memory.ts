import { InMemoryCache } from '@geekmidas/cache/memory';
import { CacheAuditStorage } from './cache';
import type { AuditableAction } from './types';

/**
 * In-memory audit storage implementation.
 * Convenience wrapper around CacheAuditStorage with InMemoryCache.
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
    super({
      cache: new InMemoryCache(),
      // Use a long TTL since in-memory cache expires items
      ttl: 86400 * 365, // 1 year
    });
  }
}
