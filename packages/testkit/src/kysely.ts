import type { Kysely, Transaction } from 'kysely';
import type { TestAPI } from 'vitest';
import { VitestKyselyTransactionIsolator } from './VitestKyselyTransactionIsolator';
import { IsolationLevel } from './VitestTransactionIsolator';

/**
 * Kysely-specific exports for test utilities.
 * Provides factories, migrators, and transaction isolators for Kysely ORM.
 */

export { KyselyFactory } from './KyselyFactory';
export { PostgresKyselyMigrator } from './PostgresKyselyMigrator';

/**
 * Creates a wrapped Vitest test API with automatic transaction rollback for Kysely.
 * Each test runs in an isolated database transaction that is rolled back after completion.
 * This ensures tests don't affect each other's data and run faster than truncating tables.
 * 
 * @template Database - The database schema type
 * @param api - The Vitest test API (usually `test` from vitest)
 * @param db - The Kysely database instance
 * @param setup - Optional setup function to run before each test in the transaction
 * @param level - Transaction isolation level (defaults to REPEATABLE_READ)
 * @returns A wrapped test API that provides transaction isolation
 * 
 * @example
 * ```typescript
 * import { test } from 'vitest';
 * import { wrapVitestKyselyTransaction } from '@geekmidas/testkit/kysely';
 * import { db } from './database';
 * 
 * // Create isolated test with automatic rollback
 * const isolatedTest = wrapVitestKyselyTransaction(test, db);
 * 
 * // Use in tests - each test gets its own transaction
 * isolatedTest('should create user', async ({ trx }) => {
 *   const user = await trx
 *     .insertInto('users')
 *     .values({ name: 'Test User', email: 'test@example.com' })
 *     .returningAll()
 *     .executeTakeFirst();
 *   
 *   expect(user).toBeDefined();
 *   // User is automatically rolled back after test
 * });
 * 
 * // With setup function for common test data
 * const testWithSetup = wrapVitestKyselyTransaction(
 *   test,
 *   db,
 *   async (trx) => {
 *     // Create common test data
 *     await trx.insertInto('settings')
 *       .values({ key: 'test_mode', value: 'true' })
 *       .execute();
 *   }
 * );
 * 
 * testWithSetup('should have test settings', async ({ trx }) => {
 *   const setting = await trx
 *     .selectFrom('settings')
 *     .where('key', '=', 'test_mode')
 *     .selectAll()
 *     .executeTakeFirst();
 *   
 *   expect(setting?.value).toBe('true');
 * });
 * ```
 */
export function wrapVitestKyselyTransaction<Database>(
  api: TestAPI,
  db: Kysely<Database>,
  setup?: (trx: Transaction<Database>) => Promise<void>,
  level: IsolationLevel = IsolationLevel.REPEATABLE_READ,
) {
  const wrapper = new VitestKyselyTransactionIsolator<Database>(api);

  return wrapper.wrapVitestWithTransaction(db, setup, level);
}
