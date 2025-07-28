import pg from 'pg';

const { Client } = pg;

/**
 * Creates a PostgreSQL client connected to the 'postgres' database.
 * Extracts connection details from the provided URI.
 *
 * @param uri - PostgreSQL connection URI
 * @returns Object containing the target database name and client instance
 *
 * @example
 * ```typescript
 * const { database, db } = await setupClient('postgresql://user:pass@localhost:5432/mydb');
 * // database = 'mydb'
 * // db = Client instance connected to 'postgres' database
 * ```
 */
async function setupClient(uri: string) {
  const url = new URL(uri);

  const db = new Client({
    user: url.username,
    password: url.password,
    host: url.hostname,
    port: parseInt(url.port),
    database: 'postgres',
  });

  let database = url.pathname.slice(1);
  if (database.includes('?')) {
    database = database.substring(0, database.indexOf('?'));
  }
  return { database, db };
}

/**
 * Default logger instance for migration operations.
 */
const logger = console;

/**
 * Abstract base class for PostgreSQL database migration utilities.
 * Provides database creation, migration, and cleanup functionality for testing.
 * Subclasses must implement the migrate() method to define migration logic.
 *
 * @example
 * ```typescript
 * class MyMigrator extends PostgresMigrator {
 *   async migrate(): Promise<void> {
 *     // Run your migrations here
 *     await this.runMigrations();
 *   }
 * }
 *
 * // Use in tests
 * const migrator = new MyMigrator('postgresql://localhost:5432/test_db');
 * const cleanup = await migrator.start();
 *
 * // Run tests...
 *
 * // Clean up
 * await cleanup();
 * ```
 */
export abstract class PostgresMigrator {
  /**
   * Creates a new PostgresMigrator instance.
   *
   * @param uri - PostgreSQL connection URI
   */
  constructor(private uri: string) {}

  /**
   * Abstract method to be implemented by subclasses.
   * Should contain the migration logic for setting up database schema.
   *
   * @returns Promise that resolves when migrations are complete
   */
  abstract migrate(): Promise<void>;

  /**
   * Creates a PostgreSQL database if it doesn't already exist.
   * Connects to the 'postgres' database to check and create the target database.
   *
   * @param uri - PostgreSQL connection URI
   * @returns Object indicating whether the database already existed
   * @private
   */
  private static async create(
    uri: string,
  ): Promise<{ alreadyExisted: boolean }> {
    const { database, db } = await setupClient(uri);
    try {
      await db.connect();
      const result = await db.query(
        `SELECT * FROM pg_catalog.pg_database WHERE datname = '${database}'`,
      );

      if (result.rowCount === 0) {
        await db.query(`CREATE DATABASE "${database}"`);
      }

      return {
        alreadyExisted: result.rowCount ? result.rowCount > 0 : false,
      };
    } finally {
      await db.end();
    }
  }

  /**
   * Drops a PostgreSQL database.
   * Used for cleanup after tests are complete.
   *
   * @param uri - PostgreSQL connection URI
   * @throws Error if database cannot be dropped
   * @private
   */
  private static async drop(uri: string): Promise<void> {
    const { database, db } = await setupClient(uri);
    try {
      await db.connect();
      await db.query(`DROP DATABASE "${database}"`);
    } finally {
      await db.end();
    }
  }

  /**
   * Starts the migration process by creating the database and running migrations.
   * Returns a cleanup function that will drop the database when called.
   *
   * @returns Async cleanup function that drops the created database
   *
   * @example
   * ```typescript
   * const migrator = new MyMigrator('postgresql://localhost:5432/test_db');
   *
   * // Start migrations and get cleanup function
   * const cleanup = await migrator.start();
   *
   * try {
   *   // Run your tests here
   *   await runTests();
   * } finally {
   *   // Always clean up
   *   await cleanup();
   * }
   * ```
   */
  async start() {
    const { database, db } = await setupClient(this.uri);
    try {
      await PostgresMigrator.create(this.uri);
      // Implement migration logic here
      await this.migrate();
      logger.log(`Migrating database: ${database}`);
      // Example: await db.query('CREATE TABLE example (id SERIAL PRIMARY KEY)');
    } finally {
      await db.end();
    }

    return async () => {
      await PostgresMigrator.drop(this.uri);
    };
  }
}
