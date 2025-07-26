import { type Kysely, type MigrationProvider, Migrator } from 'kysely';
import { PostgresMigrator } from './PostgresMigrator';

/**
 * Default logger instance for migration operations.
 */
const logger = console;

/**
 * PostgreSQL migrator implementation for Kysely ORM.
 * Extends PostgresMigrator to provide Kysely-specific migration functionality.
 * Automatically creates test databases and applies migrations for testing environments.
 *
 * @example
 * ```typescript
 * import { FileMigrationProvider } from 'kysely';
 * import { PostgresKyselyMigrator } from '@geekmidas/testkit';
 *
 * // Create migration provider
 * const provider = new FileMigrationProvider({
 *   fs: require('fs'),
 *   path: require('path'),
 *   migrationFolder: path.join(__dirname, 'migrations')
 * });
 *
 * // Create Kysely instance
 * const db = new Kysely<Database>({
 *   dialect: new PostgresDialect({
 *     pool: new Pool({ connectionString: uri })
 *   })
 * });
 *
 * // Create and use migrator
 * const migrator = new PostgresKyselyMigrator({
 *   uri: 'postgresql://localhost:5432/test_db',
 *   db,
 *   provider
 * });
 *
 * const cleanup = await migrator.start();
 * // Run tests...
 * await cleanup();
 * ```
 */
export class PostgresKyselyMigrator extends PostgresMigrator {
  /**
   * Creates a new PostgresKyselyMigrator instance.
   *
   * @param options - Configuration options
   * @param options.uri - PostgreSQL connection URI
   * @param options.db - Kysely database instance
   * @param options.provider - Migration provider for locating migration files
   */
  constructor(
    private options: {
      uri: string;
      db: Kysely<any>;
      provider: MigrationProvider;
    },
  ) {
    super(options.uri);
  }

  /**
   * Executes Kysely migrations to the latest version.
   * Implements the abstract migrate() method from PostgresMigrator.
   *
   * @throws Error if migrations fail to apply
   * @returns Promise that resolves when all migrations are applied
   */
  async migrate(): Promise<void> {
    const migrator = new Migrator({
      db: this.options.db,
      provider: this.options.provider,
    });
    const migrations = await migrator.migrateToLatest();

    if (migrations.error) {
      logger.error(migrations.error, `Failed to apply migrations`);
      throw migrations.error;
    }

    await this.options.db.destroy();

    logger.log(`Applied ${migrations.results?.length} migrations successfully`);
  }
}
