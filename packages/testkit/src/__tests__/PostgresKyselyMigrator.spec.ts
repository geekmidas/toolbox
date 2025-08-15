import { Kysely, type MigrationProvider, PostgresDialect, sql } from 'kysely';
import { Client, Pool } from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createTestDatabase } from '../../test/helpers';
import { PostgresKyselyMigrator } from '../PostgresKyselyMigrator';
import { PostgresMigrator } from '../PostgresMigrator';

// Test database schema
interface TestSchema {
  users: {
    id: number;
    name: string;
    email: string;
    created_at: Date;
  };
  posts: {
    id: number;
    title: string;
    content: string;
    user_id: number;
    created_at: Date;
  };
}

// Test migration provider
class TestMigrationProvider implements MigrationProvider {
  private migrations: Record<string, any> = {};
  private shouldError = false;

  addMigration(
    name: string,
    migration: {
      up: (db: Kysely<any>) => Promise<void>;
      down?: (db: Kysely<any>) => Promise<void>;
    },
  ) {
    this.migrations[name] = migration;
  }

  setError(shouldError: boolean) {
    this.shouldError = shouldError;
  }

  async getMigrations() {
    if (this.shouldError) {
      throw new Error('Failed to load migrations');
    }
    return this.migrations;
  }
}

describe('PostgresKyselyMigrator', () => {
  let testDbName: string;
  let cleanupDb: () => Promise<void>;
  let consoleSpy: any;
  let consoleErrorSpy: any;

  beforeAll(async () => {
    // Create a unique test database for each test run
    testDbName = `test_kysely_migrator_${Date.now()}`;
    cleanupDb = await createTestDatabase(testDbName);
  });

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  afterAll(async () => {
    await cleanupDb();
  });

  describe('constructor', () => {
    it('should create a PostgresKyselyMigrator instance', () => {
      const db = new Kysely<TestSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            host: 'localhost',
            port: 5432,
            user: 'geekmidas',
            password: 'geekmidas',
            database: testDbName,
          }),
        }),
      });

      const provider = new TestMigrationProvider();
      const migrator = new PostgresKyselyMigrator({
        uri: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
        db,
        provider,
      });

      expect(migrator).toBeInstanceOf(PostgresKyselyMigrator);
      expect(migrator).toBeInstanceOf(PostgresMigrator);
    });
  });

  describe('migrate method', () => {
    it('should apply migrations successfully', async () => {
      const newDbName = `test_migrate_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${newDbName}`;

      const db = new Kysely<TestSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            host: 'localhost',
            port: 5432,
            user: 'geekmidas',
            password: 'geekmidas',
            database: newDbName,
          }),
        }),
      });

      const provider = new TestMigrationProvider();

      // Add test migrations
      provider.addMigration('001_create_users', {
        up: async (db) => {
          await db.schema
            .createTable('users')
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .addColumn('name', 'varchar', (col) => col.notNull())
            .addColumn('email', 'varchar', (col) => col.notNull().unique())
            .addColumn('created_at', 'timestamp', (col) =>
              col.defaultTo(sql`now()`).notNull(),
            )
            .execute();
        },
        down: async (db) => {
          await db.schema.dropTable('users').execute();
        },
      });

      provider.addMigration('002_create_posts', {
        up: async (db) => {
          await db.schema
            .createTable('posts')
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .addColumn('title', 'varchar', (col) => col.notNull())
            .addColumn('content', 'text', (col) => col.notNull())
            .addColumn('user_id', 'integer', (col) =>
              col.notNull().references('users.id').onDelete('cascade'),
            )
            .addColumn('created_at', 'timestamp', (col) =>
              col.defaultTo(sql`now()`).notNull(),
            )
            .execute();
        },
        down: async (db) => {
          await db.schema.dropTable('posts').execute();
        },
      });

      const migrator = new PostgresKyselyMigrator({
        uri,
        db,
        provider,
      });

      // Start the migrator (creates database and runs migrations)
      const cleanup = await migrator.start();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Applied 2 migrations successfully'),
      );

      // Verify tables were created
      const client = new Client({
        host: 'localhost',
        port: 5432,
        user: 'geekmidas',
        password: 'geekmidas',
        database: newDbName,
      });

      try {
        await client.connect();
        const tablesResult = await client.query(`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' 
          AND table_name IN ('users', 'posts')
          ORDER BY table_name
        `);

        expect(tablesResult.rowCount).toBe(2);
        expect(tablesResult.rows).toEqual([
          { table_name: 'posts' },
          { table_name: 'users' },
        ]);
      } finally {
        await client.end();
      }

      // Cleanup
      await cleanup();
    });

    it('should handle migration errors', async () => {
      const errorDbName = `test_migrate_error_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${errorDbName}`;

      const db = new Kysely<TestSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            host: 'localhost',
            port: 5432,
            user: 'geekmidas',
            password: 'geekmidas',
            database: errorDbName,
          }),
        }),
      });

      const provider = new TestMigrationProvider();

      // Add a migration that will fail
      provider.addMigration('001_failing_migration', {
        up: async () => {
          throw new Error('Migration failed intentionally');
        },
      });

      const migrator = new PostgresKyselyMigrator({
        uri,
        db,
        provider,
      });

      // Expect the start method to throw
      await expect(migrator.start()).rejects.toThrow(
        'Migration failed intentionally',
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.any(Error),
        'Failed to apply migrations',
      );

      // Ensure db is closed before cleanup
      await db.destroy();

      // Cleanup the created database
      const cleanupClient = new Client({
        host: 'localhost',
        port: 5432,
        user: 'geekmidas',
        password: 'geekmidas',
        database: 'postgres',
      });
      try {
        await cleanupClient.connect();
        // Force disconnect any existing connections
        await cleanupClient.query(`
          SELECT pg_terminate_backend(pg_stat_activity.pid)
          FROM pg_stat_activity
          WHERE pg_stat_activity.datname = '${errorDbName}'
            AND pid <> pg_backend_pid()
        `);
        await cleanupClient.query(`DROP DATABASE IF EXISTS "${errorDbName}"`);
      } finally {
        await cleanupClient.end();
      }
    });

    it('should destroy database connection after migrations', async () => {
      const destroyDbName = `test_destroy_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${destroyDbName}`;

      const db = new Kysely<TestSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            host: 'localhost',
            port: 5432,
            user: 'geekmidas',
            password: 'geekmidas',
            database: destroyDbName,
          }),
        }),
      });

      const destroySpy = vi.spyOn(db, 'destroy');
      const provider = new TestMigrationProvider();

      provider.addMigration('001_simple', {
        up: async (db) => {
          await db.schema
            .createTable('test')
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .execute();
        },
      });

      const migrator = new PostgresKyselyMigrator({
        uri,
        db,
        provider,
      });

      const cleanup = await migrator.start();

      // Verify destroy was called after migrations
      expect(destroySpy).toHaveBeenCalled();

      // Cleanup
      await cleanup();
    });
  });

  describe('integration with PostgresMigrator', () => {
    it('should work with complete workflow', async () => {
      const integrationDbName = `test_integration_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${integrationDbName}`;

      const db = new Kysely<TestSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            host: 'localhost',
            port: 5432,
            user: 'geekmidas',
            password: 'geekmidas',
            database: integrationDbName,
          }),
        }),
      });

      const provider = new TestMigrationProvider();

      // Add comprehensive migrations
      provider.addMigration('001_initial_schema', {
        up: async (db) => {
          // Users table
          await db.schema
            .createTable('users')
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .addColumn('name', 'varchar', (col) => col.notNull())
            .addColumn('email', 'varchar', (col) => col.notNull().unique())
            .addColumn('created_at', 'timestamp', (col) =>
              col.defaultTo(sql`now()`).notNull(),
            )
            .execute();

          // Posts table
          await db.schema
            .createTable('posts')
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .addColumn('title', 'varchar', (col) => col.notNull())
            .addColumn('content', 'text', (col) => col.notNull())
            .addColumn('user_id', 'integer', (col) =>
              col.notNull().references('users.id').onDelete('cascade'),
            )
            .addColumn('created_at', 'timestamp', (col) =>
              col.defaultTo(sql`now()`).notNull(),
            )
            .execute();

          // Add index
          await db.schema
            .createIndex('idx_posts_user_id')
            .on('posts')
            .column('user_id')
            .execute();
        },
      });

      provider.addMigration('002_add_updated_at', {
        up: async (db) => {
          await db.schema
            .alterTable('users')
            .addColumn('updated_at', 'timestamp', (col) =>
              col.defaultTo(sql`now()`).notNull(),
            )
            .execute();

          await db.schema
            .alterTable('posts')
            .addColumn('updated_at', 'timestamp', (col) =>
              col.defaultTo(sql`now()`).notNull(),
            )
            .execute();
        },
      });

      const migrator = new PostgresKyselyMigrator({
        uri,
        db,
        provider,
      });

      const cleanup = await migrator.start();

      expect(consoleSpy).toHaveBeenCalledWith(
        `Migrating database: ${integrationDbName}`,
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'Applied 2 migrations successfully',
      );

      // Verify final schema
      const verifyClient = new Client({
        host: 'localhost',
        port: 5432,
        user: 'geekmidas',
        password: 'geekmidas',
        database: integrationDbName,
      });

      try {
        await verifyClient.connect();

        // Check columns exist
        const columnsResult = await verifyClient.query(`
          SELECT table_name, column_name 
          FROM information_schema.columns
          WHERE table_schema = 'public' 
          AND table_name IN ('users', 'posts')
          AND column_name = 'updated_at'
          ORDER BY table_name
        `);

        expect(columnsResult.rowCount).toBe(2);

        // Check index exists
        const indexResult = await verifyClient.query(`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public'
          AND indexname = 'idx_posts_user_id'
        `);

        expect(indexResult.rowCount).toBe(1);
      } finally {
        await verifyClient.end();
      }

      // Cleanup
      await cleanup();
    });

    it('should handle empty migrations', async () => {
      const emptyDbName = `test_empty_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${emptyDbName}`;

      const db = new Kysely<TestSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            host: 'localhost',
            port: 5432,
            user: 'geekmidas',
            password: 'geekmidas',
            database: emptyDbName,
          }),
        }),
      });

      const provider = new TestMigrationProvider();
      // No migrations added

      const migrator = new PostgresKyselyMigrator({
        uri,
        db,
        provider,
      });

      const cleanup = await migrator.start();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Applied 0 migrations successfully',
      );

      await cleanup();
    });

    it('should work with FileMigrationProvider pattern', async () => {
      const fileProviderDbName = `test_file_provider_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${fileProviderDbName}`;

      const db = new Kysely<TestSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            host: 'localhost',
            port: 5432,
            user: 'geekmidas',
            password: 'geekmidas',
            database: fileProviderDbName,
          }),
        }),
      });

      // Simulate a file-based migration provider
      const migrations = {
        '2024_01_01_000001_create_users': {
          up: async (db: Kysely<any>) => {
            await db.schema
              .createTable('users')
              .addColumn('id', 'serial', (col) => col.primaryKey())
              .addColumn('username', 'varchar', (col) => col.notNull().unique())
              .execute();
          },
          down: async (db: Kysely<any>) => {
            await db.schema.dropTable('users').execute();
          },
        },
        '2024_01_02_000001_create_sessions': {
          up: async (db: Kysely<any>) => {
            await db.schema
              .createTable('sessions')
              .addColumn('id', 'serial', (col) => col.primaryKey())
              .addColumn('user_id', 'integer', (col) =>
                col.notNull().references('users.id'),
              )
              .addColumn('token', 'varchar', (col) => col.notNull())
              .execute();
          },
          down: async (db: Kysely<any>) => {
            await db.schema.dropTable('sessions').execute();
          },
        },
      };

      const provider: MigrationProvider = {
        async getMigrations() {
          return migrations;
        },
      };

      const migrator = new PostgresKyselyMigrator({
        uri,
        db,
        provider,
      });

      const cleanup = await migrator.start();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Applied 2 migrations successfully',
      );

      // Verify both tables exist
      const verifyClient = new Client({
        host: 'localhost',
        port: 5432,
        user: 'geekmidas',
        password: 'geekmidas',
        database: fileProviderDbName,
      });

      try {
        await verifyClient.connect();
        const tablesResult = await verifyClient.query(`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' 
          AND table_name IN ('users', 'sessions')
          ORDER BY table_name
        `);

        expect(tablesResult.rowCount).toBe(2);
      } finally {
        await verifyClient.end();
      }

      await cleanup();
    });
  });

  describe('error scenarios', () => {
    it('should handle provider errors', async () => {
      const providerErrorDbName = `test_provider_error_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${providerErrorDbName}`;

      const db = new Kysely<TestSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            host: 'localhost',
            port: 5432,
            user: 'geekmidas',
            password: 'geekmidas',
            database: providerErrorDbName,
          }),
        }),
      });

      const provider = new TestMigrationProvider();
      provider.setError(true);

      const migrator = new PostgresKyselyMigrator({
        uri,
        db,
        provider,
      });

      await expect(migrator.start()).rejects.toThrow(
        'Failed to load migrations',
      );

      // Ensure db is closed
      await db.destroy();

      // Cleanup
      const cleanupClient = new Client({
        host: 'localhost',
        port: 5432,
        user: 'geekmidas',
        password: 'geekmidas',
        database: 'postgres',
      });
      try {
        await cleanupClient.connect();
        await cleanupClient.query(
          `DROP DATABASE IF EXISTS "${providerErrorDbName}"`,
        );
      } finally {
        await cleanupClient.end();
      }
    }, 10000);

    it('should handle invalid SQL in migrations', async () => {
      const invalidSqlDbName = `test_invalid_sql_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${invalidSqlDbName}`;

      const db = new Kysely<TestSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            host: 'localhost',
            port: 5432,
            user: 'geekmidas',
            password: 'geekmidas',
            database: invalidSqlDbName,
          }),
        }),
      });

      const provider = new TestMigrationProvider();
      provider.addMigration('001_invalid_sql', {
        up: async (db) => {
          // Try to reference non-existent table
          await db.schema
            .createTable('posts')
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .addColumn('user_id', 'integer', (col) =>
              col.notNull().references('non_existent_table.id'),
            )
            .execute();
        },
      });

      const migrator = new PostgresKyselyMigrator({
        uri,
        db,
        provider,
      });

      await expect(migrator.start()).rejects.toThrow();

      // Ensure db is closed
      await db.destroy();

      // Cleanup
      const cleanupClient = new Client({
        host: 'localhost',
        port: 5432,
        user: 'geekmidas',
        password: 'geekmidas',
        database: 'postgres',
      });
      try {
        await cleanupClient.connect();
        await cleanupClient.query(
          `DROP DATABASE IF EXISTS "${invalidSqlDbName}"`,
        );
      } finally {
        await cleanupClient.end();
      }
    }, 10000);
  });
});
