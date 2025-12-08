import type { AuditStorage, AuditableAction } from '@geekmidas/audit';
import { KyselyAuditStorage } from '@geekmidas/audit/kysely';
import type { Kysely } from 'kysely';

/**
 * Example audit storage service using KyselyAuditStorage.
 * This demonstrates how to set up audit logging with a database backend.
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
      // In a real app, you would create a Kysely instance here
      // For the example, we create a mock that logs audits
      const mockDb = {
        insertInto: () => ({
          values: () => ({
            execute: async () => {
              return [];
            },
          }),
        }),
        selectFrom: () => ({
          selectAll: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => ({
                  offset: () => ({
                    execute: async () => [],
                  }),
                }),
              }),
            }),
          }),
          select: () => ({
            where: () => ({
              executeTakeFirst: async () => ({ count: 0 }),
            }),
          }),
        }),
      } as unknown as Kysely<{ audit_logs: any }>;

      instance = new KyselyAuditStorage({
        db: mockDb,
        tableName: 'audit_logs',
        databaseServiceName: 'database', // Links to DatabaseService for transactions
        autoId: true, // Let database generate IDs
      });
    }
    return instance;
  },
};
