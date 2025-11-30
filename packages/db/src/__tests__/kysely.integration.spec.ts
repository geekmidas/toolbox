import {
  CamelCasePlugin,
  type Generated,
  Kysely,
  PostgresDialect,
  sql,
} from 'kysely';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../../testkit/test/globalSetup';
import { withTransaction } from '../kysely';

interface TestDatabase {
  users: {
    id: Generated<number>;
    name: string;
    email: string;
    createdAt: Generated<Date>;
  };
  accounts: {
    id: Generated<number>;
    userId: number;
    balance: number;
    version: number;
  };
}

describe('Kysely Transaction Integration Tests', () => {
  let db: Kysely<TestDatabase>;

  beforeAll(async () => {
    db = new Kysely<TestDatabase>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({
          ...TEST_DATABASE_CONFIG,
          database: 'postgres',
        }),
      }),
      plugins: [new CamelCasePlugin()],
    });

    // Create users table
    await db.schema
      .createTable('users')
      .ifNotExists()
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('name', 'varchar', (col) => col.notNull())
      .addColumn('email', 'varchar', (col) => col.notNull().unique())
      .addColumn('created_at', 'timestamp', (col) =>
        col.defaultTo(sql`now()`).notNull(),
      )
      .execute();

    // Create accounts table
    await db.schema
      .createTable('accounts')
      .ifNotExists()
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('user_id', 'integer', (col) =>
        col.notNull().references('users.id').onDelete('cascade'),
      )
      .addColumn('balance', 'numeric(10, 2)', (col) =>
        col.notNull().defaultTo(0),
      )
      .addColumn('version', 'integer', (col) => col.notNull().defaultTo(0))
      .execute();
  });

  afterEach(async () => {
    // Clean up data after each test
    await db.deleteFrom('accounts').execute();
    await db.deleteFrom('users').execute();
  });

  afterAll(async () => {
    // Drop tables and close connection
    await db.schema.dropTable('accounts').ifExists().execute();
    await db.schema.dropTable('users').ifExists().execute();
    await db.destroy();
  });

  describe('withTransaction - Real Database Operations', () => {
    it('should execute real insert and select within transaction', async () => {
      const result = await withTransaction(db, async (trx) => {
        // Insert a user
        const user = await trx
          .insertInto('users')
          .values({
            name: 'John Doe',
            email: 'john@example.com',
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        // Verify we can select it within the same transaction
        const foundUser = await trx
          .selectFrom('users')
          .selectAll()
          .where('id', '=', user.id)
          .executeTakeFirstOrThrow();

        expect(foundUser.name).toBe('John Doe');
        expect(foundUser.email).toBe('john@example.com');

        return user;
      });

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.name).toBe('John Doe');
    });

    it('should rollback on error', async () => {
      const insertPromise = withTransaction(db, async (trx) => {
        // Insert a user
        await trx
          .insertInto('users')
          .values({
            name: 'Will Be Rolled Back',
            email: 'rollback@example.com',
          })
          .execute();

        // Throw an error
        throw new Error('Transaction should rollback');
      });

      await expect(insertPromise).rejects.toThrow(
        'Transaction should rollback',
      );

      // Verify user was not created
      const users = await db
        .selectFrom('users')
        .selectAll()
        .where('email', '=', 'rollback@example.com')
        .execute();

      expect(users).toHaveLength(0);
    });

    it('should reuse existing transaction', async () => {
      await withTransaction(db, async (trx1) => {
        // Insert user in outer transaction
        const user = await trx1
          .insertInto('users')
          .values({
            name: 'Outer Transaction',
            email: 'outer@example.com',
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        // Nested transaction should reuse the same transaction
        await withTransaction(trx1, async (trx2) => {
          // Should see the user from outer transaction
          const foundUser = await trx2
            .selectFrom('users')
            .selectAll()
            .where('id', '=', user.id)
            .executeTakeFirstOrThrow();

          expect(foundUser.name).toBe('Outer Transaction');

          // Insert an account
          await trx2
            .insertInto('accounts')
            .values({
              userId: user.id,
              balance: 1000,
              version: 0,
            })
            .execute();
        });

        // Verify account was created in the same transaction
        const accounts = await trx1
          .selectFrom('accounts')
          .selectAll()
          .where('userId', '=', user.id)
          .execute();

        expect(accounts).toHaveLength(1);
      });
    });
  });

  describe('SELECT FOR UPDATE', () => {
    it('should lock row with SELECT FOR UPDATE', async () => {
      // Create a user and account
      const user = await db
        .insertInto('users')
        .values({
          name: 'Test User',
          email: 'test@example.com',
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const account = await db
        .insertInto('accounts')
        .values({
          userId: user.id,
          balance: 1000,
          version: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Start two concurrent transactions
      const transaction1Promise = withTransaction(db, async (trx1) => {
        // Lock the account row
        const lockedAccount = await trx1
          .selectFrom('accounts')
          .selectAll()
          .where('id', '=', account.id)
          .forUpdate()
          .executeTakeFirstOrThrow();

        expect(lockedAccount.balance).toBe('1000.00');

        // Simulate some processing time
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Update the balance
        await trx1
          .updateTable('accounts')
          .set({
            balance: sql`balance - 100`,
            version: sql`version + 1`,
          })
          .where('id', '=', account.id)
          .execute();

        return 'transaction1-complete';
      });

      // Wait a bit to ensure transaction1 has acquired the lock
      await new Promise((resolve) => setTimeout(resolve, 10));

      // This transaction should wait for the lock
      const transaction2Promise = withTransaction(db, async (trx2) => {
        // This will wait for transaction1 to release the lock
        const lockedAccount = await trx2
          .selectFrom('accounts')
          .selectAll()
          .where('id', '=', account.id)
          .forUpdate()
          .executeTakeFirstOrThrow();

        // By the time we get here, transaction1 should have completed
        expect(Number(lockedAccount.balance)).toBe(900);

        // Update the balance again
        await trx2
          .updateTable('accounts')
          .set({
            balance: sql`balance - 50`,
            version: sql`version + 1`,
          })
          .where('id', '=', account.id)
          .execute();

        return 'transaction2-complete';
      });

      // Wait for both transactions to complete
      const results = await Promise.all([
        transaction1Promise,
        transaction2Promise,
      ]);

      expect(results).toEqual([
        'transaction1-complete',
        'transaction2-complete',
      ]);

      // Verify final balance
      const finalAccount = await db
        .selectFrom('accounts')
        .selectAll()
        .where('id', '=', account.id)
        .executeTakeFirstOrThrow();

      expect(Number(finalAccount.balance)).toBe(850);
      expect(finalAccount.version).toBe(2);
    });

    it('should prevent concurrent updates with SELECT FOR UPDATE', async () => {
      // Create user and account
      const user = await db
        .insertInto('users')
        .values({
          name: 'Concurrent User',
          email: 'concurrent@example.com',
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const account = await db
        .insertInto('accounts')
        .values({
          userId: user.id,
          balance: 500,
          version: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Perform multiple concurrent withdrawals
      const withdrawals = [100, 150, 200];
      const results = await Promise.all(
        withdrawals.map((amount) =>
          withTransaction(db, async (trx) => {
            // Lock the row
            const currentAccount = await trx
              .selectFrom('accounts')
              .selectAll()
              .where('id', '=', account.id)
              .forUpdate()
              .executeTakeFirstOrThrow();

            // Check if there's enough balance
            if (Number(currentAccount.balance) >= amount) {
              await trx
                .updateTable('accounts')
                .set({
                  balance: sql`balance - ${amount}`,
                  version: sql`version + 1`,
                })
                .where('id', '=', account.id)
                .execute();

              return { success: true, amount };
            }

            return { success: false, amount };
          }),
        ),
      );

      // Verify that withdrawals were serialized correctly
      const finalAccount = await db
        .selectFrom('accounts')
        .selectAll()
        .where('id', '=', account.id)
        .executeTakeFirstOrThrow();

      const totalWithdrawn = results
        .filter((r) => r.success)
        .reduce((sum, r) => sum + r.amount, 0);

      expect(Number(finalAccount.balance)).toBe(500 - totalWithdrawn);
      expect(finalAccount.version).toBe(
        results.filter((r) => r.success).length,
      );
    });
  });

  describe('Isolation Levels', () => {
    it('should set READ COMMITTED isolation level', async () => {
      const result = await withTransaction(
        db,
        async (trx) => {
          // Insert a user
          const user = await trx
            .insertInto('users')
            .values({
              name: 'Read Committed User',
              email: 'readcommitted@example.com',
            })
            .returningAll()
            .executeTakeFirstOrThrow();

          return user;
        },
        { isolationLevel: 'read committed' },
      );

      expect(result).toBeDefined();
      expect(result.name).toBe('Read Committed User');
    });

    it('should set REPEATABLE READ isolation level', async () => {
      const result = await withTransaction(
        db,
        async (trx) => {
          // Insert a user
          const user = await trx
            .insertInto('users')
            .values({
              name: 'Repeatable Read User',
              email: 'repeatableread@example.com',
            })
            .returningAll()
            .executeTakeFirstOrThrow();

          return user;
        },
        { isolationLevel: 'repeatable read' },
      );

      expect(result).toBeDefined();
      expect(result.name).toBe('Repeatable Read User');
    });

    it('should set SERIALIZABLE isolation level', async () => {
      const result = await withTransaction(
        db,
        async (trx) => {
          // Insert a user
          const user = await trx
            .insertInto('users')
            .values({
              name: 'Serializable User',
              email: 'serializable@example.com',
            })
            .returningAll()
            .executeTakeFirstOrThrow();

          return user;
        },
        { isolationLevel: 'serializable' },
      );

      expect(result).toBeDefined();
      expect(result.name).toBe('Serializable User');
    });

    it('should demonstrate READ COMMITTED allows non-repeatable reads', async () => {
      // Create a user first
      const user = await db
        .insertInto('users')
        .values({
          name: 'Original Name',
          email: 'nonrepeatable@example.com',
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Start a READ COMMITTED transaction
      const readTransaction = withTransaction(
        db,
        async (trx) => {
          // First read
          const firstUser = await trx
            .selectFrom('users')
            .selectAll()
            .where('id', '=', user.id)
            .executeTakeFirstOrThrow();

          // Wait for concurrent update
          await new Promise((resolve) => setTimeout(resolve, 50));

          // Second read (should see the update in READ COMMITTED)
          const secondUser = await trx
            .selectFrom('users')
            .selectAll()
            .where('id', '=', user.id)
            .executeTakeFirstOrThrow();

          return { firstRead: firstUser.name, secondRead: secondUser.name };
        },
        { isolationLevel: 'read committed' },
      );

      // After first read, update the user in a separate transaction
      setTimeout(() => {
        db.updateTable('users')
          .set({ name: 'Updated Name' })
          .where('id', '=', user.id)
          .execute();
      }, 25);

      const result = await readTransaction;

      // In READ COMMITTED, the second read sees the committed update
      expect(result.firstRead).toBe('Original Name');
      expect(result.secondRead).toBe('Updated Name');
    });

    it('should demonstrate REPEATABLE READ prevents non-repeatable reads', async () => {
      // Create a user first
      const user = await db
        .insertInto('users')
        .values({
          name: 'Repeatable Original',
          email: 'repeatable@example.com',
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Start a REPEATABLE READ transaction
      const readTransaction = withTransaction(
        db,
        async (trx) => {
          // First read
          const firstUser = await trx
            .selectFrom('users')
            .selectAll()
            .where('id', '=', user.id)
            .executeTakeFirstOrThrow();

          // Wait for concurrent update
          await new Promise((resolve) => setTimeout(resolve, 50));

          // Second read (should still see the same value in REPEATABLE READ)
          const secondUser = await trx
            .selectFrom('users')
            .selectAll()
            .where('id', '=', user.id)
            .executeTakeFirstOrThrow();

          return { firstRead: firstUser.name, secondRead: secondUser.name };
        },
        { isolationLevel: 'repeatable read' },
      );

      // After first read, update the user in a separate transaction
      setTimeout(() => {
        db.updateTable('users')
          .set({ name: 'Repeatable Updated' })
          .where('id', '=', user.id)
          .execute();
      }, 25);

      const result = await readTransaction;

      // In REPEATABLE READ, both reads see the same value
      expect(result.firstRead).toBe('Repeatable Original');
      expect(result.secondRead).toBe('Repeatable Original');
    });

    it('should demonstrate SERIALIZABLE prevents phantom reads', async () => {
      // Create initial users
      await db
        .insertInto('users')
        .values([
          { name: 'User 1', email: 'user1@example.com' },
          { name: 'User 2', email: 'user2@example.com' },
        ])
        .execute();

      // Start a SERIALIZABLE transaction
      const readTransaction = withTransaction(
        db,
        async (trx) => {
          // First count
          const firstCount = await trx
            .selectFrom('users')
            .select(sql<number>`count(*)`.as('count'))
            .executeTakeFirstOrThrow();

          // Wait for concurrent insert
          await new Promise((resolve) => setTimeout(resolve, 50));

          // Second count (should be the same in SERIALIZABLE)
          const secondCount = await trx
            .selectFrom('users')
            .select(sql<number>`count(*)`.as('count'))
            .executeTakeFirstOrThrow();

          return {
            firstCount: Number(firstCount.count),
            secondCount: Number(secondCount.count),
          };
        },
        { isolationLevel: 'serializable' },
      );

      // After first count, insert a new user in a separate transaction
      setTimeout(() => {
        db.insertInto('users')
          .values({ name: 'User 3', email: 'user3@example.com' })
          .execute();
      }, 25);

      const result = await readTransaction;

      // In SERIALIZABLE, both counts see the same number of rows
      expect(result.firstCount).toBe(2);
      expect(result.secondCount).toBe(2);
    });

    it('should not apply isolation level when reusing transaction', async () => {
      await withTransaction(
        db,
        async (trx1) => {
          // Insert user in outer transaction
          const user = await trx1
            .insertInto('users')
            .values({
              name: 'Nested Transaction Test',
              email: 'nested@example.com',
            })
            .returningAll()
            .executeTakeFirstOrThrow();

          // Nested transaction with different isolation level
          // should be ignored since it reuses the outer transaction
          await withTransaction(
            trx1,
            async (trx2) => {
              const foundUser = await trx2
                .selectFrom('users')
                .selectAll()
                .where('id', '=', user.id)
                .executeTakeFirstOrThrow();

              expect(foundUser.name).toBe('Nested Transaction Test');
            },
            { isolationLevel: 'serializable' },
          );
        },
        { isolationLevel: 'read committed' },
      );
    });
  });

  describe('Complex Transaction Scenarios', () => {
    it('should handle cascading deletes within transaction', async () => {
      await withTransaction(db, async (trx) => {
        // Create user and account
        const user = await trx
          .insertInto('users')
          .values({
            name: 'Delete Test User',
            email: 'delete@example.com',
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        await trx
          .insertInto('accounts')
          .values({
            userId: user.id,
            balance: 1000,
            version: 0,
          })
          .execute();

        // Delete user (should cascade to accounts)
        await trx.deleteFrom('users').where('id', '=', user.id).execute();

        // Verify cascading delete worked
        const accounts = await trx
          .selectFrom('accounts')
          .selectAll()
          .where('userId', '=', user.id)
          .execute();

        expect(accounts).toHaveLength(0);
      });
    });

    it('should handle batch inserts within transaction', async () => {
      const userCount = await withTransaction(db, async (trx) => {
        // Batch insert users
        const users = await trx
          .insertInto('users')
          .values([
            { name: 'Batch User 1', email: 'batch1@example.com' },
            { name: 'Batch User 2', email: 'batch2@example.com' },
            { name: 'Batch User 3', email: 'batch3@example.com' },
            { name: 'Batch User 4', email: 'batch4@example.com' },
            { name: 'Batch User 5', email: 'batch5@example.com' },
          ])
          .returningAll()
          .execute();

        expect(users).toHaveLength(5);

        // Count users
        const count = await trx
          .selectFrom('users')
          .select(sql<number>`count(*)`.as('count'))
          .where('email', 'like', 'batch%')
          .executeTakeFirstOrThrow();

        return Number(count.count);
      });

      expect(userCount).toBe(5);
    });

    it('should handle complex queries with joins', async () => {
      await withTransaction(db, async (trx) => {
        // Create test data
        const user1 = await trx
          .insertInto('users')
          .values({ name: 'Author 1', email: 'author1@example.com' })
          .returningAll()
          .executeTakeFirstOrThrow();

        const user2 = await trx
          .insertInto('users')
          .values({ name: 'Author 2', email: 'author2@example.com' })
          .returningAll()
          .executeTakeFirstOrThrow();

        await trx
          .insertInto('accounts')
          .values([
            { userId: user1.id, balance: 1000, version: 0 },
            { userId: user1.id, balance: 2000, version: 0 },
            { userId: user2.id, balance: 3000, version: 0 },
          ])
          .execute();

        // Complex query with joins
        const results = await trx
          .selectFrom('users')
          .leftJoin('accounts', 'users.id', 'accounts.userId')
          .select([
            'users.id as userId',
            'users.name',
            sql<number>`count(accounts.id)`.as('accountCount'),
            sql<number>`coalesce(sum(accounts.balance), 0)`.as('totalBalance'),
          ])
          .groupBy(['users.id', 'users.name'])
          .orderBy('users.id')
          .execute();

        expect(results).toHaveLength(2);
        expect(Number(results[0].accountCount)).toBe(2);
        expect(Number(results[0].totalBalance)).toBe(3000);
        expect(Number(results[1].accountCount)).toBe(1);
        expect(Number(results[1].totalBalance)).toBe(3000);
      });
    });
  });
});
