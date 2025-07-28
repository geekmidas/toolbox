import type { Knex } from 'knex';
import type { TestAPI } from 'vitest';
import { VitestObjectionTransactionIsolator } from './VitestObjectionTransactionIsolator';
import { IsolationLevel } from './VitestTransactionIsolator';

/**
 * Objection.js-specific exports for test utilities.
 * Provides factory implementation for creating test data with Objection.js ORM
 * and transaction isolation for test suites.
 */

export { ObjectionFactory } from './ObjectionFactory';
export { VitestObjectionTransactionIsolator } from './VitestObjectionTransactionIsolator';
export { IsolationLevel } from './VitestTransactionIsolator';
export { PostgresObjectionMigrator } from './PostgresObjectionMigrator';

/**
 * Creates a wrapped Vitest test API with automatic transaction rollback for Objection.js.
 * Each test runs in an isolated database transaction that is rolled back after completion.
 * This ensures tests don't affect each other's data and run faster than truncating tables.
 *
 * @param api - The Vitest test API (usually `test` from vitest)
 * @param knex - The Knex database connection instance
 * @param setup - Optional setup function to run before each test in the transaction
 * @param level - Transaction isolation level (defaults to REPEATABLE_READ)
 * @returns A wrapped test API that provides transaction isolation
 *
 * @example
 * ```typescript
 * import { test } from 'vitest';
 * import { wrapVitestObjectionTransaction } from '@geekmidas/testkit/objection';
 * import { knex } from './database';
 * import { User, Post } from './models';
 *
 * // Create isolated test with automatic rollback
 * const isolatedTest = wrapVitestObjectionTransaction(test, knex);
 *
 * // Use in tests - each test gets its own transaction
 * isolatedTest('should create user', async ({ trx }) => {
 *   const user = await User.query(trx)
 *     .insert({ name: 'Test User', email: 'test@example.com' });
 *
 *   expect(user).toBeDefined();
 *   // User is automatically rolled back after test
 * });
 *
 * // With setup function for common test data
 * const testWithSetup = wrapVitestObjectionTransaction(
 *   test,
 *   knex,
 *   async (trx) => {
 *     // Create common test data
 *     await knex('settings')
 *       .transacting(trx)
 *       .insert({ key: 'test_mode', value: 'true' });
 *   }
 * );
 *
 * testWithSetup('should have test settings', async ({ trx }) => {
 *   const setting = await knex('settings')
 *     .transacting(trx)
 *     .where('key', 'test_mode')
 *     .first();
 *
 *   expect(setting?.value).toBe('true');
 * });
 *
 * // Example with factory and transaction
 * const isolatedTest = wrapVitestObjectionTransaction(test, knex);
 * const factory = new ObjectionFactory(builders, seeds, knex);
 *
 * isolatedTest('creates related data', async ({ trx }) => {
 *   // Factory can use the transaction
 *   const user = await User.query(trx).insert({ name: 'Author' });
 *   const posts = await Post.query(trx).insert([
 *     { title: 'Post 1', userId: user.id },
 *     { title: 'Post 2', userId: user.id }
 *   ]);
 *
 *   const userWithPosts = await User.query(trx)
 *     .findById(user.id)
 *     .withGraphFetched('posts');
 *
 *   expect(userWithPosts.posts).toHaveLength(2);
 * });
 * ```
 */
export function wrapVitestObjectionTransaction(
  api: TestAPI,
  knex: Knex,
  setup?: (trx: Knex.Transaction) => Promise<void>,
  level: IsolationLevel = IsolationLevel.REPEATABLE_READ,
) {
  const wrapper = new VitestObjectionTransactionIsolator(api);

  return wrapper.wrapVitestWithTransaction(knex, setup, level);
}
