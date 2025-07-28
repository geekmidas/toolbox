import { promises as fs } from 'node:fs';
import path from 'node:path';
import knex from 'knex';
import { Client } from 'pg';
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
import { PostgresObjectionMigrator } from '../PostgresObjectionMigrator';

describe('PostgresObjectionMigrator', () => {
  let testDbName: string;
  let cleanupDb: () => Promise<void>;
  let consoleSpy: any;
  let consoleErrorSpy: any;
  let testMigrationsDir: string;

  beforeAll(async () => {
    // Create a unique test database for each test run
    testDbName = `test_postgres_objection_migrator_${Date.now()}`;
    cleanupDb = await createTestDatabase(testDbName);

    // Create test migrations directory
    testMigrationsDir = path.join(
      process.cwd(),
      'test-migrations',
      Date.now().toString(),
    );
    await fs.mkdir(testMigrationsDir, { recursive: true });

    // Create test migration files
    await fs.writeFile(
      path.join(testMigrationsDir, '001_create_users.js'),
      `
exports.up = function(knex) {
  return knex.schema.createTable('users', function(table) {
    table.increments('id').primary();
    table.string('name');
    table.string('email').unique();
    table.timestamps(true, true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('users');
};
`,
    );

    await fs.writeFile(
      path.join(testMigrationsDir, '002_create_posts.js'),
      `
exports.up = function(knex) {
  return knex.schema.createTable('posts', function(table) {
    table.increments('id').primary();
    table.string('title');
    table.text('content');
    table.integer('user_id').unsigned().references('id').inTable('users');
    table.timestamps(true, true);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('posts');
};
`,
    );
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
    // Cleanup test migrations directory
    await fs.rm(testMigrationsDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should create a PostgresObjectionMigrator instance', () => {
      const knexInstance = knex({
        client: 'pg',
        connection: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
      });

      const migrator = new PostgresObjectionMigrator({
        uri: `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
        knex: knexInstance,
      });

      expect(migrator).toBeInstanceOf(PostgresObjectionMigrator);
      knexInstance.destroy();
    });
  });

  describe('migrate method', () => {
    it('should run migrations to latest', async () => {
      const newDbName = `test_migrate_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${newDbName}`;

      const knexInstance = knex({
        client: 'pg',
        connection: uri,
        migrations: {
          directory: testMigrationsDir,
        },
      });

      const migrator = new PostgresObjectionMigrator({
        uri,
        knex: knexInstance,
      });

      const cleanup = await migrator.start();

      // Verify console output
      expect(consoleSpy).toHaveBeenCalledWith(
        `Migrating database: ${newDbName}`,
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Applied batch'),
      );

      // Verify tables were created
      const verifyClient = new Client({
        host: 'localhost',
        port: 5432,
        user: 'geekmidas',
        password: 'geekmidas',
        database: newDbName,
      });
      await verifyClient.connect();

      const tablesResult = await verifyClient.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('users', 'posts')
        ORDER BY table_name
      `);
      expect(tablesResult.rows).toEqual([
        { table_name: 'posts' },
        { table_name: 'users' },
      ]);

      await verifyClient.end();
      await cleanup();
    });

    it('should handle no pending migrations', async () => {
      const newDbName = `test_no_pending_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${newDbName}`;

      // First, create and migrate the database
      const knexInstance1 = knex({
        client: 'pg',
        connection: uri,
        migrations: {
          directory: testMigrationsDir,
        },
      });

      const migrator1 = new PostgresObjectionMigrator({
        uri,
        knex: knexInstance1,
      });

      const cleanup = await migrator1.start();

      // Clear console spy calls
      consoleSpy.mockClear();

      // Now try to migrate again - should have no pending migrations
      const knexInstance2 = knex({
        client: 'pg',
        connection: uri,
        migrations: {
          directory: testMigrationsDir,
        },
      });

      const migrator2 = new PostgresObjectionMigrator({
        uri,
        knex: knexInstance2,
      });

      await migrator2.migrate();

      expect(consoleSpy).toHaveBeenCalledWith('No pending migrations to apply');

      await cleanup();
    });

    it('should handle migration errors', async () => {
      const newDbName = `test_migration_error_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${newDbName}`;

      // Create a bad migration file
      const badMigrationsDir = path.join(
        process.cwd(),
        'bad-migrations',
        Date.now().toString(),
      );
      await fs.mkdir(badMigrationsDir, { recursive: true });
      await fs.writeFile(
        path.join(badMigrationsDir, '001_bad_migration.js'),
        `
exports.up = function(knex) {
  throw new Error('Migration failed on purpose');
};

exports.down = function(knex) {
  return Promise.resolve();
};
`,
      );

      const knexInstance = knex({
        client: 'pg',
        connection: uri,
        migrations: {
          directory: badMigrationsDir,
        },
      });

      const migrator = new PostgresObjectionMigrator({
        uri,
        knex: knexInstance,
      });

      await expect(migrator.start()).rejects.toThrow(
        'Migration failed on purpose',
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to apply migrations:',
        expect.any(Error),
      );

      // Cleanup
      await fs.rm(badMigrationsDir, { recursive: true, force: true });
      const cleanupClient = new Client({
        host: 'localhost',
        port: 5432,
        user: 'geekmidas',
        password: 'geekmidas',
        database: 'postgres',
      });
      await cleanupClient.connect();
      await cleanupClient.query(`DROP DATABASE IF EXISTS "${newDbName}"`);
      await cleanupClient.end();
    });

    it('should destroy knex connection after migration', async () => {
      const newDbName = `test_destroy_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${newDbName}`;

      const knexInstance = knex({
        client: 'pg',
        connection: uri,
        migrations: {
          directory: testMigrationsDir,
        },
      });

      const destroySpy = vi.spyOn(knexInstance, 'destroy');

      const migrator = new PostgresObjectionMigrator({
        uri,
        knex: knexInstance,
      });

      const cleanup = await migrator.start();

      expect(destroySpy).toHaveBeenCalled();

      await cleanup();
    });
  });

  describe('rollback method', () => {
    it('should rollback last migration batch', async () => {
      const newDbName = `test_rollback_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${newDbName}`;

      // First, create and migrate the database
      const knexInstance1 = knex({
        client: 'pg',
        connection: uri,
        migrations: {
          directory: testMigrationsDir,
        },
      });

      const migrator1 = new PostgresObjectionMigrator({
        uri,
        knex: knexInstance1,
      });

      const cleanup = await migrator1.start();

      // Clear console spy
      consoleSpy.mockClear();

      // Now rollback
      const knexInstance2 = knex({
        client: 'pg',
        connection: uri,
        migrations: {
          directory: testMigrationsDir,
        },
      });

      const migrator2 = new PostgresObjectionMigrator({
        uri,
        knex: knexInstance2,
      });

      await migrator2.rollback();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Rolled back batch'),
      );

      // Verify tables were dropped
      const verifyClient = new Client({
        host: 'localhost',
        port: 5432,
        user: 'geekmidas',
        password: 'geekmidas',
        database: newDbName,
      });
      await verifyClient.connect();

      const tablesResult = await verifyClient.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('users', 'posts')
      `);
      expect(tablesResult.rows).toEqual([]);

      await verifyClient.end();
      await cleanup();
    });

    it('should handle no migrations to rollback', async () => {
      const newDbName = `test_no_rollback_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${newDbName}`;

      // Create database without running migrations
      const createClient = new Client({
        host: 'localhost',
        port: 5432,
        user: 'geekmidas',
        password: 'geekmidas',
        database: 'postgres',
      });
      await createClient.connect();
      await createClient.query(`CREATE DATABASE "${newDbName}"`);
      await createClient.end();

      const knexInstance = knex({
        client: 'pg',
        connection: uri,
        migrations: {
          directory: testMigrationsDir,
        },
      });

      const migrator = new PostgresObjectionMigrator({
        uri,
        knex: knexInstance,
      });

      await migrator.rollback();

      expect(consoleSpy).toHaveBeenCalledWith('No migrations to rollback');

      // Cleanup
      const cleanupClient = new Client({
        host: 'localhost',
        port: 5432,
        user: 'geekmidas',
        password: 'geekmidas',
        database: 'postgres',
      });
      await cleanupClient.connect();
      await cleanupClient.query(`DROP DATABASE IF EXISTS "${newDbName}"`);
      await cleanupClient.end();
    });

    it('should handle rollback errors', async () => {
      const newDbName = `test_rollback_error_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${newDbName}`;

      const knexInstance = knex({
        client: 'pg',
        connection: uri,
        migrations: {
          directory: testMigrationsDir,
        },
      });

      const migrator = new PostgresObjectionMigrator({
        uri,
        knex: knexInstance,
      });

      await expect(migrator.rollback()).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to rollback migrations:',
        expect.any(Error),
      );

      await knexInstance.destroy();
    });
  });

  describe('status method', () => {
    it('should return migration status', async () => {
      const newDbName = `test_status_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${newDbName}`;

      // First, create and partially migrate the database
      const knexInstance1 = knex({
        client: 'pg',
        connection: uri,
        migrations: {
          directory: testMigrationsDir,
        },
      });

      const migrator1 = new PostgresObjectionMigrator({
        uri,
        knex: knexInstance1,
      });

      const cleanup = await migrator1.start();

      // Get status
      const knexInstance2 = knex({
        client: 'pg',
        connection: uri,
        migrations: {
          directory: testMigrationsDir,
        },
      });

      const migrator2 = new PostgresObjectionMigrator({
        uri,
        knex: knexInstance2,
      });

      const status = await migrator2.status();

      expect(status).toHaveProperty('completed');
      expect(status).toHaveProperty('pending');
      expect(Array.isArray(status.completed)).toBe(true);
      expect(Array.isArray(status.pending)).toBe(true);

      await cleanup();
    });

    it('should destroy connection after getting status', async () => {
      const newDbName = `test_status_destroy_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${newDbName}`;

      const knexInstance = knex({
        client: 'pg',
        connection: uri,
        migrations: {
          directory: testMigrationsDir,
        },
      });

      const destroySpy = vi.spyOn(knexInstance, 'destroy');

      const migrator = new PostgresObjectionMigrator({
        uri,
        knex: knexInstance,
      });

      // Create database first
      const createClient = new Client({
        host: 'localhost',
        port: 5432,
        user: 'geekmidas',
        password: 'geekmidas',
        database: 'postgres',
      });
      await createClient.connect();
      await createClient.query(`CREATE DATABASE "${newDbName}"`);
      await createClient.end();

      await migrator.status();

      expect(destroySpy).toHaveBeenCalled();

      // Cleanup
      const cleanupClient = new Client({
        host: 'localhost',
        port: 5432,
        user: 'geekmidas',
        password: 'geekmidas',
        database: 'postgres',
      });
      await cleanupClient.connect();
      await cleanupClient.query(`DROP DATABASE IF EXISTS "${newDbName}"`);
      await cleanupClient.end();
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete workflow with complex migrations', async () => {
      const integrationDbName = `test_integration_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${integrationDbName}`;

      const knexInstance = knex({
        client: 'pg',
        connection: uri,
        migrations: {
          directory: testMigrationsDir,
        },
      });

      const migrator = new PostgresObjectionMigrator({
        uri,
        knex: knexInstance,
      });

      // Start migration
      const cleanup = await migrator.start();

      // Verify we can insert data into the migrated tables
      const testClient = new Client({
        host: 'localhost',
        port: 5432,
        user: 'geekmidas',
        password: 'geekmidas',
        database: integrationDbName,
      });
      await testClient.connect();

      // Insert a user
      const userResult = await testClient.query(
        `INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id`,
        ['Test User', 'test@example.com'],
      );
      const userId = userResult.rows[0].id;

      // Insert a post
      await testClient.query(
        `INSERT INTO posts (title, content, user_id) VALUES ($1, $2, $3)`,
        ['Test Post', 'This is a test post', userId],
      );

      // Verify foreign key constraint works
      const postResult = await testClient.query(
        `SELECT * FROM posts WHERE user_id = $1`,
        [userId],
      );
      expect(postResult.rowCount).toBe(1);
      expect(postResult.rows[0].title).toBe('Test Post');

      await testClient.end();

      // Cleanup
      await cleanup();
    });

    it('should work with transaction-based tests', async () => {
      const transactionDbName = `test_transaction_${Date.now()}`;
      const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${transactionDbName}`;

      const knexInstance = knex({
        client: 'pg',
        connection: uri,
        migrations: {
          directory: testMigrationsDir,
        },
      });

      const migrator = new PostgresObjectionMigrator({
        uri,
        knex: knexInstance,
      });

      const cleanup = await migrator.start();

      // Create a new knex instance for transaction testing
      const testKnex = knex({
        client: 'pg',
        connection: uri,
      });

      // Test with transaction
      await testKnex
        .transaction(async (trx) => {
          await trx('users').insert({
            name: 'Transaction User',
            email: 'trx@example.com',
          });
          const users = await trx('users').select('*');
          expect(users.length).toBeGreaterThan(0);
          // Transaction will be rolled back automatically
          throw new Error('Rollback transaction');
        })
        .catch(() => {
          // Expected error
        });

      // Verify data was rolled back
      const users = await testKnex('users').select('*');
      expect(users.length).toBe(0);

      await testKnex.destroy();
      await cleanup();
    });
  });
});
