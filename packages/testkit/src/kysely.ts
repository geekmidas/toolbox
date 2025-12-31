import type { Kysely, Transaction } from 'kysely';
import type { TestAPI } from 'vitest';
import { VitestKyselyTransactionIsolator } from './VitestKyselyTransactionIsolator';
import {
  type DatabaseConnection,
  type FixtureCreators,
  IsolationLevel,
  extendWithFixtures as baseExtendWithFixtures,
} from './VitestTransactionIsolator';

/**
 * Kysely-specific exports for test utilities.
 * Provides factories, migrators, and transaction isolators for Kysely ORM.
 */

export { KyselyFactory } from './KyselyFactory';
export { PostgresKyselyMigrator } from './PostgresKyselyMigrator';
export { VitestKyselyTransactionIsolator } from './VitestKyselyTransactionIsolator';
export { IsolationLevel } from './VitestTransactionIsolator';
export type { FixtureCreators } from './VitestTransactionIsolator';

// Re-export faker and FakerFactory for type portability in declaration files
export { faker, type FakerFactory } from './faker';

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
  connection: DatabaseConnection<Kysely<Database>>,
  setup?: (trx: Transaction<Database>) => Promise<void>,
  level: IsolationLevel = IsolationLevel.REPEATABLE_READ,
) {
  const wrapper = new VitestKyselyTransactionIsolator<Database>(api);

  return wrapper.wrapVitestWithTransaction(connection, setup, level);
}

/**
 * Extends a Kysely transaction-wrapped test with additional fixtures.
 * Each fixture receives the transaction and can create dependencies like factories or repositories.
 *
 * @template Database - The database schema type
 * @template Extended - The type of additional fixtures to provide
 * @param wrappedTest - The base wrapped test from wrapVitestKyselyTransaction
 * @param fixtures - Object mapping fixture names to creator functions
 * @returns An extended test API with both trx and the additional fixtures
 *
 * @example
 * ```typescript
 * import { test } from 'vitest';
 * import { wrapVitestKyselyTransaction, extendWithFixtures, KyselyFactory } from '@geekmidas/testkit/kysely';
 *
 * // Define your builders
 * const builders = {
 *   user: KyselyFactory.createBuilder<DB, 'users'>('users', ({ faker }) => ({
 *     name: faker.person.fullName(),
 *     email: faker.internet.email(),
 *   })),
 * };
 *
 * // Create base wrapped test
 * const baseTest = wrapVitestKyselyTransaction<DB>(test, db, createTestTables);
 *
 * // Extend with fixtures - each fixture receives the transaction
 * const it = extendWithFixtures<DB, { factory: KyselyFactory<DB, typeof builders, {}> }>(
 *   baseTest,
 *   {
 *     factory: (trx) => new KyselyFactory(builders, {}, trx),
 *   }
 * );
 *
 * // Use in tests - both trx and factory are available
 * it('should create user with factory', async ({ trx, factory }) => {
 *   const user = await factory.insert('user', { name: 'Test User' });
 *   expect(user.id).toBeDefined();
 *
 *   // Verify in database
 *   const found = await trx
 *     .selectFrom('users')
 *     .where('id', '=', user.id)
 *     .selectAll()
 *     .executeTakeFirst();
 *   expect(found?.name).toBe('Test User');
 * });
 * ```
 */
export function extendWithFixtures<
  Database,
  Extended extends Record<string, unknown>,
  T extends ReturnType<TestAPI['extend']> = ReturnType<TestAPI['extend']>,
>(wrappedTest: T, fixtures: FixtureCreators<Transaction<Database>, Extended>) {
  return baseExtendWithFixtures<Transaction<Database>, Extended, T>(
    wrappedTest,
    fixtures,
  );
}
