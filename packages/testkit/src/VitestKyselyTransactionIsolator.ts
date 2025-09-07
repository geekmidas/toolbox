import type { Kysely, Transaction } from 'kysely';
import {
  type IsolationLevel,
  VitestPostgresTransactionIsolator,
} from './VitestTransactionIsolator';

/**
 * Kysely-specific implementation of the Vitest transaction isolator.
 * Provides automatic transaction rollback for test isolation using Kysely's transaction API.
 * Each test runs within a database transaction that is rolled back after completion,
 * ensuring a clean state between tests without the overhead of recreating data.
 *
 * @template Database - The database schema type
 *
 * @example
 * ```typescript
 * import { VitestKyselyTransactionIsolator } from '@geekmidas/testkit';
 * import { db } from './database';
 *
 * // Create isolator instance
 * const isolator = new VitestKyselyTransactionIsolator<Database>();
 *
 * // In your test setup
 * beforeEach(async () => {
 *   await isolator.start(db);
 * });
 *
 * afterEach(async () => {
 *   await isolator.rollback();
 * });
 *
 * // Tests run in isolated transactions
 * it('should create user', async () => {
 *   const user = await db.insertInto('users')
 *     .values({ name: 'Test User' })
 *     .returningAll()
 *     .executeTakeFirst();
 *
 *   expect(user).toBeDefined();
 *   // This data will be rolled back after the test
 * });
 * ```
 */
export class VitestKyselyTransactionIsolator<
  Database,
> extends VitestPostgresTransactionIsolator<
  Kysely<Database>,
  Transaction<Database>
> {
  destroy(conn: Kysely<Database>): Promise<void> {
    return conn.destroy();
  }
  /**
   * Creates a Kysely transaction with the specified isolation level.
   * Implements the abstract transact method from VitestPostgresTransactionIsolator.
   *
   * @param conn - The Kysely database connection
   * @param level - The transaction isolation level
   * @param fn - The function to execute within the transaction
   * @returns Promise that resolves when the transaction completes
   */
  async transact(
    conn: Kysely<Database>,
    level: IsolationLevel,
    fn: (trx: Transaction<Database>) => Promise<void>,
  ): Promise<void> {
    const isolationLevel =
      level.toLocaleLowerCase() as Lowercase<IsolationLevel>;
    await conn.transaction().setIsolationLevel(isolationLevel).execute(fn);
  }
  // Implement any Kysely-specific transaction logic here
}
