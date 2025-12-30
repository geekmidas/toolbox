import type { Transaction } from 'kysely';
import { sql } from 'kysely';
import { type DatabaseConnection, type TransactionSettings, withTransaction } from './kysely';

/**
 * RLS context - key-value pairs to set as PostgreSQL session variables.
 * Keys become `prefix.key` (e.g., `app.user_id`).
 */
export interface RlsContext {
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Options for withRlsContext function.
 */
export interface WithRlsContextOptions {
  /** Prefix for PostgreSQL session variables (default: 'app') */
  prefix?: string;
  /** Transaction settings (isolation level) */
  settings?: TransactionSettings;
}

/**
 * Execute a callback within a transaction with RLS context variables set.
 *
 * Sets PostgreSQL session variables using `SET LOCAL` which scopes them to the
 * current transaction. Variables are automatically cleared when the transaction
 * ends (commit or rollback).
 *
 * @example
 * ```ts
 * await withRlsContext(
 *   db,
 *   { user_id: session.userId, tenant_id: session.tenantId },
 *   async (trx) => {
 *     // RLS policies can now use current_setting('app.user_id')
 *     return trx.selectFrom('orders').selectAll().execute();
 *   }
 * );
 * ```
 *
 * @param db - Database connection (Kysely, Transaction, or ControlledTransaction)
 * @param context - Key-value pairs to set as session variables
 * @param callback - Function to execute within the RLS context
 * @param options - Optional prefix and transaction settings
 */
export async function withRlsContext<DB, T>(
  db: DatabaseConnection<DB>,
  context: RlsContext,
  callback: (trx: Transaction<DB>) => Promise<T>,
  options?: WithRlsContextOptions,
): Promise<T> {
  const prefix = options?.prefix ?? 'app';

  return withTransaction(
    db,
    async (trx) => {
      // Set each context variable using SET LOCAL (scoped to transaction)
      for (const [key, value] of Object.entries(context)) {
        if (value === null || value === undefined) continue;

        const settingName = `${prefix}.${key}`;
        const settingValue = String(value);

        // Use raw SQL for SET LOCAL with proper escaping
        // The setting name is an identifier, value is a string literal
        await sql`SELECT set_config(${settingName}, ${settingValue}, true)`.execute(
          trx,
        );
      }

      return callback(trx);
    },
    options?.settings,
  );
}

/**
 * Bypass marker symbol for explicitly skipping RLS context.
 */
export const RLS_BYPASS = Symbol.for('geekmidas.rls.bypass');

/**
 * Type for RLS bypass marker.
 */
export type RlsBypass = typeof RLS_BYPASS;
