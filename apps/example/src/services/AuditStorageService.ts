import type { AuditStorage } from '@geekmidas/audit';
import { KyselyAuditStorage } from '@geekmidas/audit/kysely';
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Kysely } from 'kysely';

/**
 * Example audit storage service using KyselyAuditStorage.
 * This demonstrates how to set up audit logging with a database backend.
 */

// Define your audit actions for type safety
export type AppAuditAction =
  | { type: 'user.created'; payload: { userId: string; email: string } }
  | { type: 'user.updated'; payload: { userId: string; changes: string[] } }
  | { type: 'user.deleted'; payload: { userId: string } };

let instance: AuditStorage | null = null;

export const AuditStorageService = {
  serviceName: 'auditStorage' as const,
  register(envParser: EnvironmentParser<{}>): any {
    // Create the config parser - this tracks environment variables
    const configParser = envParser.create((get) => ({
      // Reuse DATABASE_URL since audits are stored in the same database
      databaseUrl: get('DATABASE_URL').string(),
    }));

    // For environment detection (when env is empty), return ConfigParser
    // @ts-ignore - accessing internal property to detect sniffer
    const envData = envParser.env || {};
    if (Object.keys(envData).length === 0) {
      return configParser;
    }

    // Runtime: return a promise that resolves to the service instance
    return (async () => {
      if (!instance) {
        // In a real app, you would create a Kysely instance here
        // For the example, we create a mock that logs audits
        const mockDb = {
          insertInto: () => ({
            values: () => ({
              execute: async () => {
                console.log('[Audit] Writing audit records to database');
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
    })();
  },
} as const;
