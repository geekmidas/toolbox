import type { Knex } from 'knex';
import { PostgresMigrator } from './PostgresMigrator';

/**
 * Default logger instance for migration operations.
 */
const logger = console;

/**
 * PostgreSQL migrator implementation for Objection.js ORM with Knex.
 * Extends PostgresMigrator to provide Knex-specific migration functionality.
 * Automatically creates test databases and applies migrations for testing environments.
 *
 * @example
 * ```typescript
 * import knex from 'knex';
 * import { PostgresObjectionMigrator } from '@geekmidas/testkit';
 *
 * // Create Knex instance
 * const db = knex({
 *   client: 'pg',
 *   connection: uri,
 *   migrations: {
 *     directory: path.join(__dirname, 'migrations'),
 *     extension: 'ts'
 *   }
 * });
 *
 * // Create and use migrator
 * const migrator = new PostgresObjectionMigrator({
 *   uri: 'postgresql://localhost:5432/test_db',
 *   knex: db
 * });
 *
 * const cleanup = await migrator.start();
 * // Run tests...
 * await cleanup();
 * ```
 */
export class PostgresObjectionMigrator extends PostgresMigrator {
	/**
	 * Creates a new PostgresObjectionMigrator instance.
	 *
	 * @param options - Configuration options
	 * @param options.uri - PostgreSQL connection URI
	 * @param options.knex - Knex database instance configured with migrations
	 */
	constructor(
		private options: {
			uri: string;
			knex: Knex;
		},
	) {
		super(options.uri);
	}

	/**
	 * Executes Knex migrations to the latest version.
	 * Implements the abstract migrate() method from PostgresMigrator.
	 *
	 * @throws Error if migrations fail to apply
	 * @returns Promise that resolves when all migrations are applied
	 */
	async migrate(): Promise<void> {
		try {
			// Run migrations to latest
			const [batchNo, migrations] = await this.options.knex.migrate.latest();

			if (migrations.length > 0) {
				logger.log(
					`Applied batch ${batchNo} with ${migrations.length} migrations:`,
				);
				migrations.forEach((migration: string) => {
					logger.log(`  - ${migration}`);
				});
			} else {
				logger.log('No pending migrations to apply');
			}
		} catch (error) {
			logger.error('Failed to apply migrations:', error);
			throw error;
		} finally {
			// Always destroy the connection pool
			await this.options.knex.destroy();
		}
	}

	/**
	 * Rolls back the last batch of migrations.
	 * Useful for testing migration rollback scenarios.
	 *
	 * @returns Promise that resolves when rollback is complete
	 */
	async rollback(): Promise<void> {
		try {
			const [batchNo, migrations] = await this.options.knex.migrate.rollback();

			if (migrations.length > 0) {
				logger.log(
					`Rolled back batch ${batchNo} with ${migrations.length} migrations:`,
				);
				migrations.forEach((migration: string) => {
					logger.log(`  - ${migration}`);
				});
			} else {
				logger.log('No migrations to rollback');
			}
		} catch (error) {
			logger.error('Failed to rollback migrations:', error);
			throw error;
		} finally {
			await this.options.knex.destroy();
		}
	}

	/**
	 * Gets the current migration status.
	 * Returns information about completed and pending migrations.
	 *
	 * @returns Promise with migration status information
	 */
	async status(): Promise<{
		completed: string[];
		pending: string[];
	}> {
		try {
			const completed = await this.options.knex.migrate.list();
			const [, pending] = await this.options.knex.migrate.currentVersion();

			return {
				completed: Array.isArray(completed[0]) ? completed[0] : [],
				pending: Array.isArray(pending) ? pending : [],
			};
		} finally {
			await this.options.knex.destroy();
		}
	}
}
