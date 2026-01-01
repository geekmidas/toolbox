import type { Service } from '@geekmidas/services';
import { type Generated, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

/**
 * Database schema definition.
 * Add your tables here.
 */
export interface Database {
  users: {
    id: Generated<string>;
    name: string;
    email: string;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
  };
}

export const DatabaseService = {
  serviceName: 'database' as const,
  async register(envParser) {
    const config = envParser
      .create((get) => ({
        url: get('DATABASE_URL').string(),
      }))
      .parse();

    return new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({ connectionString: config.url }),
      }),
    });
  },
} satisfies Service<'database', Kysely<Database>>;
