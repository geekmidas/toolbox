import type { Knex } from 'knex';
import {
  type IsolationLevel,
  VitestPostgresTransactionIsolator,
} from './VitestTransactionIsolator';

/**
 * Objection.js-specific implementation of the Vitest transaction isolator.
 * Provides automatic transaction rollback for test isolation using Objection.js and Knex transaction API.
 * Each test runs within a database transaction that is rolled back after completion,
 * ensuring a clean state between tests without the overhead of recreating data.
 *
 * @example
 * ```typescript
 * import { VitestObjectionTransactionIsolator } from '@geekmidas/testkit';
 * import { knex } from './database';
 * import { User } from './models';
 * import { test } from 'vitest';
 *
 * // Create isolator instance
 * const isolator = new VitestObjectionTransactionIsolator(test);
 *
 * // Use with wrapped test API
 * const isolatedTest = isolator.wrapVitestWithTransaction(knex);
 *
 * isolatedTest('should create user', async ({ trx }) => {
 *   const user = await User.query(trx)
 *     .insert({ name: 'Test User' });
 *
 *   expect(user).toBeDefined();
 *   // This data will be rolled back after the test
 * });
 * ```
 */
export class VitestObjectionTransactionIsolator extends VitestPostgresTransactionIsolator<
  Knex,
  Knex.Transaction
> {
  destroy(conn: Knex<any, any[]>): Promise<void> {
    return conn.destroy();
  }
  /**
   * Creates a Knex transaction with the specified isolation level.
   * Implements the abstract transact method from VitestPostgresTransactionIsolator.
   * This transaction can be used with Objection.js models via Model.query(trx).
   *
   * @param conn - The Knex database connection
   * @param level - The transaction isolation level
   * @param fn - The function to execute within the transaction
   * @returns Promise that resolves when the transaction completes
   *
   * @example
   * ```typescript
   * await isolator.transact(knex, IsolationLevel.REPEATABLE_READ, async (trx) => {
   *   // Use transaction with Objection models
   *   await User.query(trx).insert({ name: 'Test' });
   *   await Post.query(trx).where('userId', user.id).delete();
   * });
   * ```
   */
  async transact(
    connection: Knex,
    level: IsolationLevel,
    fn: (trx: Knex.Transaction) => Promise<void>,
  ): Promise<void> {
    const isolationLevel = level.toLowerCase() as Lowercase<IsolationLevel>;

    await connection.transaction(
      async (trx) => {
        await fn(trx);
      },
      {
        isolationLevel,
      },
    );
  }
}
