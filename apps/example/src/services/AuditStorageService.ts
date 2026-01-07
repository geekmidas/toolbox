import type { AuditableAction, AuditStorage } from '@geekmidas/audit';
import { InMemoryAuditStorage } from '@geekmidas/audit/memory';

/**
 * Example audit storage service using InMemoryAuditStorage.
 * This demonstrates how to set up audit logging for development/testing.
 *
 * For production, replace with KyselyAuditStorage or another persistent backend:
 * ```typescript
 * import { KyselyAuditStorage } from '@geekmidas/audit/kysely';
 *
 * instance = new KyselyAuditStorage({
 *   db: kyselyDb,
 *   tableName: 'audit_logs',
 *   databaseServiceName: 'database',
 * });
 * ```
 *
 * The `AppAuditAction` type is used as the generic parameter for `AuditStorage`,
 * which allows the `.audit([...])` method on endpoints to have full type inference
 * without needing to specify the generic explicitly.
 */

// Define your audit actions for type safety
export type AppAuditAction =
  | AuditableAction<'user.created', { userId: string; email: string }>
  | AuditableAction<'user.updated', { userId: string; changes: string[] }>
  | AuditableAction<'user.deleted', { userId: string }>;

let instance: AuditStorage<AppAuditAction> | null = null;

export const AuditStorageService = {
  serviceName: 'auditStorage' as const,
  async register(): Promise<AuditStorage<AppAuditAction>> {
    if (!instance) {
      instance = new InMemoryAuditStorage<AppAuditAction>();
    }
    return instance;
  },
};
