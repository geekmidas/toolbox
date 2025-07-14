import { test as base } from 'vitest';

export interface DatabaseFixtures<Transaction> {
  trx: Transaction;
}

export enum IsolationLevel {
  READ_UNCOMMITTED = 'READ UNCOMMITTED',
  READ_COMMITTED = 'READ COMMITTED',
  REPEATABLE_READ = 'REPEATABLE READ',
  SERIALIZABLE = 'SERIALIZABLE',
}

export abstract class VitestPostgresTransactionIsolator<
  Connection,
  Transaction,
> {
  abstract transact(
    conn: Connection,
    isolationLevel: IsolationLevel,
    fn: (trx: Transaction) => Promise<void>,
  ): Promise<void>;

  wrapVitestWithTransaction(
    conn: Connection,
    setup?: (trx: Transaction) => Promise<void>,
    level: IsolationLevel = IsolationLevel.REPEATABLE_READ,
  ) {
    return base.extend<DatabaseFixtures<Transaction>>({
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
