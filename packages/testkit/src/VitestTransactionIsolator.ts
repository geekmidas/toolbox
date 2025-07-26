import type { TestAPI } from 'vitest';

/**
 * Type definition for test fixtures that provide transaction access.
 * Used with Vitest's test.extend() API to inject transactions into tests.
 * 
 * @template Transaction - The transaction type specific to the database driver
 */
export interface DatabaseFixtures<Transaction> {
  /**
   * The database transaction available to the test.
   * All database operations should use this transaction to ensure proper rollback.
   */
  trx: Transaction;
}

/**
 * PostgreSQL transaction isolation levels.
 * Controls the visibility of concurrent transactions.
 * 
 * @see https://www.postgresql.org/docs/current/transaction-iso.html
 */
export enum IsolationLevel {
  /**
   * Lowest isolation level. Allows dirty reads.
   * Not recommended for testing.
   */
  READ_UNCOMMITTED = 'READ UNCOMMITTED',
  /**
   * Default PostgreSQL isolation level.
   * Prevents dirty reads but allows non-repeatable reads.
   */
  READ_COMMITTED = 'READ COMMITTED',
  /**
   * Prevents dirty reads and non-repeatable reads.
   * Recommended for most test scenarios.
   */
  REPEATABLE_READ = 'REPEATABLE READ',
  /**
   * Highest isolation level. Prevents all phenomena.
   * May cause performance overhead in tests.
   */
  SERIALIZABLE = 'SERIALIZABLE',
}

/**
 * Abstract base class for implementing database transaction isolation in Vitest tests.
 * Provides automatic transaction rollback after each test to maintain test isolation.
 * Subclasses must implement the transact() method for their specific database driver.
 * 
 * @template Connection - The database connection type
 * @template Transaction - The transaction type
 * 
 * @example
 * ```typescript
 * // Implement for your database driver
 * class MyDatabaseIsolator extends VitestPostgresTransactionIsolator<MyDB, MyTx> {
 *   async transact(conn: MyDB, level: IsolationLevel, fn: (tx: MyTx) => Promise<void>) {
 *     await conn.transaction(level, fn);
 *   }
 * }
 * 
 * // Use in tests
 * const isolator = new MyDatabaseIsolator(test);
 * const isolatedTest = isolator.wrapVitestWithTransaction(db);
 * 
 * isolatedTest('should create user', async ({ trx }) => {
 *   await trx.insert('users', { name: 'Test' });
 *   // Data is automatically rolled back after test
 * });
 * ```
 */
export abstract class VitestPostgresTransactionIsolator<
  Connection,
  Transaction,
> {
  /**
   * Abstract method to create a transaction with the specified isolation level.
   * Must be implemented by subclasses for specific database drivers.
   * 
   * @param conn - The database connection
   * @param isolationLevel - The transaction isolation level
   * @param fn - The function to execute within the transaction
   * @returns Promise that resolves when the transaction completes
   */
  abstract transact(
    conn: Connection,
    isolationLevel: IsolationLevel,
    fn: (trx: Transaction) => Promise<void>,
  ): Promise<void>;

  /**
   * Creates a new VitestPostgresTransactionIsolator instance.
   * 
   * @param api - The Vitest test API (usually the `test` export from vitest)
   */
  constructor(private readonly api: TestAPI) {}

  /**
   * Creates a wrapped version of Vitest's test API that provides transaction isolation.
   * Each test will run within a database transaction that is automatically rolled back.
   * 
   * @param conn - The database connection to use
   * @param setup - Optional setup function to run within the transaction before each test
   * @param level - The transaction isolation level (defaults to REPEATABLE_READ)
   * @returns A wrapped test API with transaction support
   * 
   * @example
   * ```typescript
   * const isolatedTest = isolator.wrapVitestWithTransaction(db, async (trx) => {
   *   // Optional setup: create common test data
   *   await trx.insert('settings', { key: 'test', value: 'true' });
   * });
   * 
   * isolatedTest('test with transaction', async ({ trx }) => {
   *   const user = await trx.insert('users', { name: 'Test' });
   *   expect(user).toBeDefined();
   * });
   * ```
   */
  wrapVitestWithTransaction(
    conn: Connection,
    setup?: (trx: Transaction) => Promise<void>,
    level: IsolationLevel = IsolationLevel.REPEATABLE_READ,
  ) {
    return this.api.extend<DatabaseFixtures<Transaction>>({
      // This fixture automatically provides a transaction to each test
      trx: async ({}, use) => {
        // Create a custom error class for rollback
        class TestRollback extends Error {
          constructor() {
            super('Test rollback');
            this.name = 'TestRollback';
          }
        }

        let testError: Error | undefined;

        try {
          await this.transact(conn, level, async (transaction) => {
            try {
              // Provide the transaction to the test
              await setup?.(transaction);
              await use(transaction);
            } catch (error) {
              // Capture any test errors
              testError = error as Error;
            }

            // Always throw to trigger rollback
            throw new TestRollback();
          });
        } catch (error) {
          // Only rethrow if it's not our rollback error
          if (!(error instanceof TestRollback)) {
            throw error;
          }

          // If the test had an error, throw it now
          if (testError) {
            throw testError;
          }
        }
      },
    });
  }
}
