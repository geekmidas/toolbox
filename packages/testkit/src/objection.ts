import type { Knex } from 'knex';
import type { TestAPI } from 'vitest';
import { VitestObjectionTransactionIsolator } from './VitestObjectionTransactionIsolator';
import {
  type DatabaseConnection,
  type FixtureCreators,
  IsolationLevel,
  extendWithFixtures as baseExtendWithFixtures,
} from './VitestTransactionIsolator';

/**
 * Objection.js-specific exports for test utilities.
 * Provides factory implementation for creating test data with Objection.js ORM
 * and transaction isolation for test suites.
 */

export { ObjectionFactory } from './ObjectionFactory';
export { VitestObjectionTransactionIsolator } from './VitestObjectionTransactionIsolator';
export { IsolationLevel } from './VitestTransactionIsolator';
export { PostgresObjectionMigrator } from './PostgresObjectionMigrator';
export type {
  DatabaseFixtures,
  ExtendedDatabaseFixtures,
  FixtureCreators,
  TestWithExtendedFixtures,
} from './VitestTransactionIsolator';

// Re-export faker and FakerFactory for type portability in declaration files
export { faker, type FakerFactory } from './faker';

/**
 * Creates a wrapped Vitest test API with automatic transaction rollback for Objection.js.
 * Each test runs in an isolated database transaction that is rolled back after completion.
 * This ensures tests don't affect each other's data and run faster than truncating tables.
 *
 * @param api - The Vitest test API (usually `test` from vitest)
 * @param conn - The Knex database connection instance
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
export function wrapVitestObjectionTransaction<
  Extended extends Record<string, unknown> = {},
>(
  api: TestAPI,
  conn: DatabaseConnection<Knex>,
  setup?: (trx: Knex.Transaction) => Promise<void>,
  level: IsolationLevel = IsolationLevel.REPEATABLE_READ,
  fixtures?: FixtureCreators<Knex.Transaction, Extended>,
) {
  const wrapper = new VitestObjectionTransactionIsolator(api);

  return wrapper.wrapVitestWithTransaction(conn, setup, level, fixtures);
}

/**
 * Extends an Objection.js transaction-wrapped test with additional fixtures.
 * Each fixture receives the transaction and can create dependencies like factories or repositories.
 *
 * @template Extended - The type of additional fixtures to provide
 * @param wrappedTest - The base wrapped test from wrapVitestObjectionTransaction
 * @param fixtures - Object mapping fixture names to creator functions
 * @returns An extended test API with both trx and the additional fixtures
 *
 * @example
 * ```typescript
 * import { test } from 'vitest';
 * import { wrapVitestObjectionTransaction, extendWithFixtures, ObjectionFactory } from '@geekmidas/testkit/objection';
 * import { User } from './models';
 *
 * // Define your builders
 * const builders = {
 *   user: ObjectionFactory.createBuilder(User, ({ faker }) => ({
 *     name: faker.person.fullName(),
 *     email: faker.internet.email(),
 *   })),
 * };
 *
 * // Create base wrapped test
 * const baseTest = wrapVitestObjectionTransaction(test, knex, createTestTables);
 *
 * // Extend with fixtures - each fixture receives the transaction
 * const it = extendWithFixtures<{ factory: ObjectionFactory<typeof builders, {}> }>(
 *   baseTest,
 *   {
 *     factory: (trx) => new ObjectionFactory(builders, {}, trx),
 *   }
 * );
 *
 * // Use in tests - both trx and factory are available
 * it('should create user with factory', async ({ trx, factory }) => {
 *   const user = await factory.insert('user', { name: 'Test User' });
 *   expect(user.id).toBeDefined();
 *
 *   // Verify in database
 *   const found = await User.query(trx).findById(user.id);
 *   expect(found?.name).toBe('Test User');
 * });
 * ```
 */
export function extendWithFixtures<
  Extended extends Record<string, unknown>,
  T extends ReturnType<TestAPI['extend']> = ReturnType<TestAPI['extend']>,
>(wrappedTest: T, fixtures: FixtureCreators<Knex.Transaction, Extended>) {
  return baseExtendWithFixtures<Knex.Transaction, Extended, T>(
    wrappedTest,
    fixtures,
  );
}
