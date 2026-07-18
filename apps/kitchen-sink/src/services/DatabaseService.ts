import type { Service } from '@geekmidas/services';
import { type Generated, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

/** Database schema. */
export interface Database {
	users: {
		id: Generated<string>;
		name: string;
		email: string;
		created_at: Generated<Date>;
		updated_at: Generated<Date>;
	};
}

/**
 * The canonical service pattern — `register({ envParser })` reads its own config
 * (so `DATABASE_URL` is sniffed into the manifest) and returns the instance.
 */
export const DatabaseService = {
	serviceName: 'database' as const,
	async register({ envParser }) {
		const config = envParser
			.create((get) => ({ url: get('DATABASE_URL').string() }))
			.parse();

		return new Kysely<Database>({
			dialect: new PostgresDialect({
				pool: new pg.Pool({ connectionString: config.url }),
			}),
		});
	},
} satisfies Service<'database', Kysely<Database>>;
