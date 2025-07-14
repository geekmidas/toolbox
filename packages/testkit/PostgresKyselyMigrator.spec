import {
  type Kysely,
  type MigrationProvider,
  type Transaction,
  sql,
} from 'kysely';
import {
  type TestAPI,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  vi,
} from 'vitest';
import { createTestDatabase } from '../../test/helpers';
import { PostgresKyselyMigrator } from '../PostgresKyselyMigrator';
import { PostgresMigrator } from '../PostgresMigrator';
import { createKyselyDb, wrapVitestKyselyTransaction } from '../helpers';

describe.skip('PostgresKyselyMigrator', () => {
  let testDbName: string;
  let cleanupDb: () => Promise<void>;

  let consoleSpy: any;
  let consoleErrorSpy: any;
  let it: TestAPI<{
    trx: Transaction<any>;
  }>;

  beforeAll(async () => {
    testDbName = `test_kysely_migrator_${Date.now()}`;
    cleanupDb = await createTestDatabase(testDbName);
    const db = createKyselyDb<any>({
      host: 'localhost',
      port: 5432,
      user: 'geekmidas',
      password: 'geekmidas',
      database: testDbName,
    });
    it = wrapVitestKyselyTransaction(db);
  });

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe.skip('constructor', () => {
    it('should create a PostgresKyselyMigrator instance', ({ trx }) => {
      const provider: MigrationProvider = {
        getMigrations: async () => ({}),
      };

      const options = {
        uri: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
        db: trx,
        provider,
      };

      const migrator = new PostgresKyselyMigrator(options);

      expect(migrator).toBeInstanceOf(PostgresKyselyMigrator);
      expect(migrator).toBeInstanceOf(PostgresMigrator);
    });
  });

  describe.skip('migrate method', () => {
    it('should run migrations successfully', async ({ trx }) => {
      const migrations = {
        '001_initial': {
          up: async (db: Kysely<any>) => {
            await db.schema
              .createTable('test_table')
              .addColumn('id', 'serial', (col) => col.primaryKey())
              .addColumn('name', 'varchar', (col) => col.notNull())
              .execute();
          },
          down: async (db: Kysely<any>) => {
            await db.schema.dropTable('test_table').execute();
          },
        },
        '002_add_column': {
          up: async (db: Kysely<any>) => {
            await db.schema
              .alterTable('test_table')
              .addColumn('email', 'varchar')
              .execute();
          },
          down: async (db: Kysely<any>) => {
            await db.schema
              .alterTable('test_table')
              .dropColumn('email')
              .execute();
          },
        },
      };

      const provider: MigrationProvider = {
        getMigrations: async () => migrations,
      };

      const options = {
        uri: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
        db: trx,
        provider,
      };

      const migrator = new PostgresKyselyMigrator(options);

      await migrator.migrate();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Applied 2 migrations successfully',
      );

      // Verify the table was created
      const tableResult = await trx
        .selectFrom('information_schema.tables')
        .selectAll()
        .where('table_name', '=', 'test_table')
        .where('table_schema', '=', 'public')
        .execute();

      expect(tableResult.length).toBe(1);

      // Verify the column was added
      const columnResult = await trx
        .selectFrom('information_schema.columns')
        .selectAll()
        .where('table_name', '=', 'test_table')
        .where('column_name', '=', 'email')
        .execute();

      expect(columnResult.length).toBe(1);
    });

    it('should handle migration errors', async ({ trx }) => {
      const migrations = {
        '001_bad_migration': {
          up: async (db: Kysely<any>) => {
            // This will fail due to invalid SQL
            await db.executeQuery(sql`INVALID SQL SYNTAX`.compile(trx));
          },
          down: async (db: Kysely<any>) => {
            // No-op
          },
        },
      };

      const provider: MigrationProvider = {
        getMigrations: async () => migrations,
      };

      const options = {
        uri: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
        db: trx,
        provider,
      };

      const migrator = new PostgresKyselyMigrator(options);

      await expect(migrator.migrate()).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.any(Error),
        'Failed to apply migrations',
      );
    });

    it('should handle no migrations to apply', async ({ trx }) => {
      const provider: MigrationProvider = {
        getMigrations: async () => ({}), // No migrations
      };

      const options = {
        uri: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
        db: trx,
        provider,
      };

      const migrator = new PostgresKyselyMigrator(options);

      await migrator.migrate();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Applied 0 migrations successfully',
      );
    });

    it('should handle provider that returns undefined results', async ({
      trx,
    }) => {
      // Create a provider that returns migrations but Kysely reports undefined results
      const provider: MigrationProvider = {
        getMigrations: async () => ({
          '001_test': {
            up: async (db: Kysely<any>) => {
              // Simple migration that should succeed but might return undefined results
              await db.schema
                .createTable('temp_table')
                .addColumn('id', 'serial')
                .ifNotExists()
                .execute();
              await db.schema.dropTable('temp_table').ifExists().execute();
            },
            down: async () => {},
          },
        }),
      };

      const options = {
        uri: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
        db: trx,
        provider,
      };

      const migrator = new PostgresKyselyMigrator(options);

      await migrator.migrate();

      // Should handle the case gracefully
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should cleanup database connection even if migration throws', async ({
      trx,
    }) => {
      const destroySpy = vi.spyOn(trx, 'destroy');

      const provider: MigrationProvider = {
        getMigrations: async () => {
          throw new Error('Provider failed');
        },
      };

      const options = {
        uri: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
        db: trx,
        provider,
      };

      const migrator = new PostgresKyselyMigrator(options);

      await expect(migrator.migrate()).rejects.toThrow('Provider failed');

      expect(destroySpy).toHaveBeenCalled();
    });

    it('should handle database destroy errors gracefully', async () => {
      // Create a mock db that will fail on destroy
      const failingDb = {
        destroy: vi
          .fn()
          .mockRejectedValue(new Error('Failed to close connection')),
      } as any;

      const provider: MigrationProvider = {
        getMigrations: async () => ({}),
      };

      const options = {
        uri: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
        db: failingDb,
        provider,
      };

      const migrator = new PostgresKyselyMigrator(options);

      // The migrate method should propagate the destroy error
      await expect(migrator.migrate()).rejects.toThrow(
        'Failed to close connection',
      );
    });
  });

  describe.skip('integration with Kysely types', () => {
    it('should work with typed database interface', ({ trx }) => {
      interface Database {
        users: {
          id: number;
          name: string;
          email: string;
        };
        posts: {
          id: number;
          title: string;
          userId: number;
        };
      }

      const typedDb = trx as Kysely<Database>;
      const typedProvider: MigrationProvider = {
        getMigrations: async () => ({}),
      };

      const options = {
        uri: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
        db: typedDb,
        provider: typedProvider,
      };

      const migrator = new PostgresKyselyMigrator(options);

      expect(migrator).toBeInstanceOf(PostgresKyselyMigrator);
    });
  });

  describe.skip('logging', () => {
    it('should log correct number of applied migrations', async ({ trx }) => {
      const migrations = {};
      // Create 5 simple migrations
      for (let i = 1; i <= 5; i++) {
        migrations[`00${i}_migration`] = {
          up: async (db: Kysely<any>) => {
            // Simple operation that won't conflict
            await db.executeQuery(
              sql`CREATE TABLE IF NOT EXISTS temp_${sql.raw(`migration_${i}`)} (id SERIAL)`.compile(
                db,
              ),
            );
            await db.executeQuery(
              sql`DROP TABLE IF EXISTS temp_${sql.raw(`migration_${i}`)}`.compile(
                db,
              ),
            );
          },
          down: async () => {},
        };
      }

      const provider: MigrationProvider = {
        getMigrations: async () => migrations,
      };

      const options = {
        uri: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
        db: trx,
        provider,
      };

      const migrator = new PostgresKyselyMigrator(options);

      await migrator.migrate();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Applied 5 migrations successfully',
      );
    });

    it('should log errors with context', async ({ trx }) => {
      const migrations = {
        '001_invalid_column': {
          up: async (db: Kysely<any>) => {
            // This will fail with a specific error
            await db.executeQuery(
              sql`SELECT invalid_column FROM non_existent_table`.compile(db),
            );
          },
          down: async () => {},
        },
      };

      const provider: MigrationProvider = {
        getMigrations: async () => migrations,
      };

      const options = {
        uri: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
        db: trx,
        provider,
      };

      const migrator = new PostgresKyselyMigrator(options);

      await expect(migrator.migrate()).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.any(Error),
        'Failed to apply migrations',
      );
    });
  });

  describe.skip('error scenarios', () => {
    it('should handle invalid migration provider', async ({ trx }) => {
      const invalidProvider: MigrationProvider = {
        getMigrations: async () => {
          throw new Error('Invalid migration configuration');
        },
      };

      const options = {
        uri: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
        db: trx,
        provider: invalidProvider,
      };

      const migrator = new PostgresKyselyMigrator(options);

      await expect(migrator.migrate()).rejects.toThrow(
        'Invalid migration configuration',
      );
    });

    it('should handle migration execution errors', async ({ trx }) => {
      const migrations = {
        '001_failing_migration': {
          up: async (db: Kysely<any>) => {
            throw new Error('Migration execution failed');
          },
          down: async () => {},
        },
      };

      const provider: MigrationProvider = {
        getMigrations: async () => migrations,
      };

      const options = {
        uri: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
        db: trx,
        provider,
      };

      const migrator = new PostgresKyselyMigrator(options);

      await expect(migrator.migrate()).rejects.toThrow();
    });
  });

  describe('inheritance', () => {
    it('should properly extend PostgresMigrator', ({ trx }) => {
      const provider: MigrationProvider = {
        getMigrations: async () => ({}),
      };

      const options = {
        uri: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
        db: trx,
        provider,
      };

      const migrator = new PostgresKyselyMigrator(options);

      expect(migrator).toBeInstanceOf(PostgresMigrator);
      expect(migrator).toBeInstanceOf(PostgresKyselyMigrator);
    });

    it('should implement the abstract migrate method', ({ trx }) => {
      const provider: MigrationProvider = {
        getMigrations: async () => ({}),
      };

      const options = {
        uri: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
        db: trx,
        provider,
      };

      const migrator = new PostgresKyselyMigrator(options);

      expect(typeof migrator.migrate).toBe('function');
    });
  });
});
