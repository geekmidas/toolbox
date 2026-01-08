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
import { PostgresMigrator } from '../PostgresMigrator';

// Create a concrete implementation for testing
class TestPostgresMigrator extends PostgresMigrator {
	public migrateCalled = false;
	public migrateError?: Error;
	public customMigrations: Array<() => Promise<void>> = [];

	async migrate(): Promise<void> {
		this.migrateCalled = true;
		if (this.migrateError) {
			throw this.migrateError;
		}

		// Run any custom migrations
		for (const migration of this.customMigrations) {
			await migration();
		}
	}

	addMigration(migration: () => Promise<void>) {
		this.customMigrations.push(migration);
	}
}

describe('PostgresMigrator', () => {
	let testDbName: string;
	let cleanupDb: () => Promise<void>;
	let consoleSpy: any;

	beforeAll(async () => {
		// Create a unique test database for each test run
		testDbName = `test_postgres_migrator_${Date.now()}`;
		cleanupDb = await createTestDatabase(testDbName);
	});

	beforeEach(() => {
		consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		consoleSpy.mockRestore();
	});

	afterAll(async () => {
		await cleanupDb();
	});

	describe('constructor', () => {
		it('should create a PostgresMigrator instance', () => {
			const migrator = new TestPostgresMigrator(
				`postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
			);
			expect(migrator).toBeInstanceOf(PostgresMigrator);
		});
	});

	describe('start method', () => {
		it('should create database, migrate, and return cleanup function', async () => {
			const newDbName = `test_start_${Date.now()}`;
			const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${newDbName}`;
			const migrator = new TestPostgresMigrator(uri);

			// Add a simple migration to verify it runs
			let migrationRan = false;
			migrator.addMigration(async () => {
				migrationRan = true;
			});

			const cleanup = await migrator.start();

			expect(migrator.migrateCalled).toBe(true);
			expect(migrationRan).toBe(true);
			expect(consoleSpy).toHaveBeenCalledWith(
				`Migrating database: ${newDbName}`,
			);
			expect(typeof cleanup).toBe('function');

			// Test cleanup
			await cleanup();
		});

		it('should handle existing database', async () => {
			// Use the already created test database
			const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`;
			const migrator = new TestPostgresMigrator(uri);

			let migrationRan = false;
			migrator.addMigration(async () => {
				migrationRan = true;
			});

			const cleanup = await migrator.start();

			expect(migrator.migrateCalled).toBe(true);
			expect(migrationRan).toBe(true);
			expect(typeof cleanup).toBe('function');

			// Test cleanup (but don't actually run it since we need the db for other tests)
		});

		it('should handle URI with query parameters', async () => {
			const queryDbName = `test_query_params_${Date.now()}`;
			const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${queryDbName}?ssl=false&timeout=30`;
			const migrator = new TestPostgresMigrator(uri);

			const cleanup = await migrator.start();

			expect(migrator.migrateCalled).toBe(true);
			expect(typeof cleanup).toBe('function');

			await cleanup();
		});

		it('should clean up connections even if migration fails', async () => {
			const failDbName = `test_fail_${Date.now()}`;
			const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${failDbName}`;
			const migrator = new TestPostgresMigrator(uri);
			migrator.migrateError = new Error('Migration failed');

			await expect(migrator.start()).rejects.toThrow('Migration failed');

			// Verify the database was still created but migration failed
			expect(migrator.migrateCalled).toBe(true);

			// Cleanup the failed database
			const cleanupClient = new Client({
				host: 'localhost',
				port: 5432,
				user: 'geekmidas',
				password: 'geekmidas',
				database: 'postgres',
			});
			try {
				await cleanupClient.connect();
				await cleanupClient.query(`DROP DATABASE IF EXISTS "${failDbName}"`);
			} finally {
				await cleanupClient.end();
			}
		});

		it('should return cleanup function that drops database', async () => {
			const cleanupDbName = `test_cleanup_${Date.now()}`;
			const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${cleanupDbName}`;
			const migrator = new TestPostgresMigrator(uri);

			const cleanup = await migrator.start();

			expect(migrator.migrateCalled).toBe(true);
			expect(typeof cleanup).toBe('function');

			// Verify database exists before cleanup
			const checkClient = new Client({
				host: 'localhost',
				port: 5432,
				user: 'geekmidas',
				password: 'geekmidas',
				database: 'postgres',
			});
			await checkClient.connect();
			const beforeResult = await checkClient.query(
				`SELECT * FROM pg_catalog.pg_database WHERE datname = $1`,
				[cleanupDbName],
			);
			expect(beforeResult.rowCount).toBe(1);
			await checkClient.end();

			// Call cleanup
			await cleanup();

			// Verify database was dropped
			const checkClient2 = new Client({
				host: 'localhost',
				port: 5432,
				user: 'geekmidas',
				password: 'geekmidas',
				database: 'postgres',
			});
			await checkClient2.connect();
			const afterResult = await checkClient2.query(
				`SELECT * FROM pg_catalog.pg_database WHERE datname = $1`,
				[cleanupDbName],
			);
			expect(afterResult.rowCount).toBe(0);
			await checkClient2.end();
		});
	});

	describe('database creation', () => {
		it('should handle connection errors gracefully', async () => {
			// Use invalid credentials to test connection error
			const badDbName = `test_bad_connection_${Date.now()}`;
			const uri = `postgresql://invalid_user:invalid_pass@localhost:5432/${badDbName}`;
			const migrator = new TestPostgresMigrator(uri);

			await expect(migrator.start()).rejects.toThrow();
		});

		it('should handle invalid database names', async () => {
			// Use a database name with invalid characters
			const invalidDbName = 'test-invalid-db-name!';
			const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${invalidDbName}`;
			const migrator = new TestPostgresMigrator(uri);

			await expect(migrator.start).rejects.toThrow();
		});
	});

	describe('URI parsing', () => {
		it('should parse different URI formats correctly', async () => {
			const testDbName = `test_uri_parsing_${Date.now()}`;
			const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`;
			const migrator = new TestPostgresMigrator(uri);

			const cleanup = await migrator.start();

			expect(migrator.migrateCalled).toBe(true);
			expect(typeof cleanup).toBe('function');

			await cleanup();
		});
	});

	describe('error handling', () => {
		it('should propagate migration errors', async () => {
			const errorDbName = `test_migration_error_${Date.now()}`;
			const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${errorDbName}`;
			const migrator = new TestPostgresMigrator(uri);
			const migrationError = new Error('Custom migration error');
			migrator.migrateError = migrationError;

			await expect(migrator.start()).rejects.toThrow('Custom migration error');

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
				await cleanupClient.query(`DROP DATABASE IF EXISTS "${errorDbName}"`);
			} finally {
				await cleanupClient.end();
			}
		});

		it('should handle cleanup errors gracefully', async () => {
			const cleanupErrorDbName = `test_cleanup_error_${Date.now()}`;
			const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${cleanupErrorDbName}`;
			const migrator = new TestPostgresMigrator(uri);

			const cleanup = await migrator.start();

			// Manually drop the database to cause a cleanup error
			const adminClient = new Client({
				host: 'localhost',
				port: 5432,
				user: 'geekmidas',
				password: 'geekmidas',
				database: 'postgres',
			});
			await adminClient.connect();
			await adminClient.query(
				`DROP DATABASE IF EXISTS "${cleanupErrorDbName}"`,
			);
			await adminClient.end();

			// Now cleanup should fail because database doesn't exist
			await expect(cleanup()).rejects.toThrow();
		});
	});

	describe('abstract method', () => {
		it('should require concrete implementation of migrate method', () => {
			// TypeScript ensures abstract methods are implemented
			// This test verifies the TestPostgresMigrator implements migrate
			const migrator = new TestPostgresMigrator(
				`postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`,
			);
			expect(typeof migrator.migrate).toBe('function');
		});
	});

	describe('integration scenarios', () => {
		it('should handle complete workflow', async () => {
			const integrationDbName = `test_integration_${Date.now()}`;
			const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${integrationDbName}`;
			const migrator = new TestPostgresMigrator(uri);

			// Add a migration that creates a table
			migrator.addMigration(async () => {
				const client = new Client({
					host: 'localhost',
					port: 5432,
					user: 'geekmidas',
					password: 'geekmidas',
					database: integrationDbName,
				});
				await client.connect();
				await client.query(`
          CREATE TABLE IF NOT EXISTS test_table (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL
          )
        `);
				await client.end();
			});

			// Start migration
			const cleanup = await migrator.start();

			expect(migrator.migrateCalled).toBe(true);
			expect(consoleSpy).toHaveBeenCalledWith(
				`Migrating database: ${integrationDbName}`,
			);

			// Verify the table was created
			const verifyClient = new Client({
				host: 'localhost',
				port: 5432,
				user: 'geekmidas',
				password: 'geekmidas',
				database: integrationDbName,
			});
			await verifyClient.connect();
			const tableResult = await verifyClient.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'test_table'
      `);
			expect(tableResult.rowCount).toBe(1);
			await verifyClient.end();

			// Cleanup
			await cleanup();
		});

		it('should handle database that already exists and cleanup', async () => {
			// Use the existing test database
			const uri = `postgresql://geekmidas:geekmidas@localhost:5432/${testDbName}`;
			const migrator = new TestPostgresMigrator(uri);

			// Start migration (database already exists)
			const cleanup = await migrator.start();

			expect(migrator.migrateCalled).toBe(true);

			// Don't call cleanup as we need the database for other tests
			expect(typeof cleanup).toBe('function');
		});
	});
});
