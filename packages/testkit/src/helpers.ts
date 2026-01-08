import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

/**
 * Creates a Kysely database instance with PostgreSQL dialect and camelCase plugin.
 * This is a convenience function for quickly setting up a Kysely connection for testing.
 *
 * @template Database - The database schema type
 * @param config - PostgreSQL connection configuration (pg.Pool config)
 * @returns A configured Kysely instance
 *
 * @example
 * ```typescript
 * interface Database {
 *   users: UsersTable;
 *   posts: PostsTable;
 * }
 *
 * // Create from connection string
 * const db = createKyselyDb<Database>({
 *   connectionString: 'postgresql://user:pass@localhost:5432/testdb'
 * });
 *
 * // Create with detailed config
 * const db = createKyselyDb<Database>({
 *   host: 'localhost',
 *   port: 5432,
 *   database: 'testdb',
 *   user: 'testuser',
 *   password: 'testpass',
 *   max: 10 // connection pool size
 * });
 *
 * // Use in tests
 * const users = await db.selectFrom('users').selectAll().execute();
 * ```
 */
export function createKyselyDb<Database>(config: any): Kysely<Database> {
	return new Kysely({
		dialect: new PostgresDialect({
			pool: new pg.Pool(config),
		}),
		plugins: [new CamelCasePlugin()],
	});
}
