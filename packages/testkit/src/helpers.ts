import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

export function createKyselyDb<Database>(config: any): Kysely<Database> {
  return new Kysely({
    dialect: new PostgresDialect({
      pool: new pg.Pool(config),
    }),
    plugins: [new CamelCasePlugin()],
  });
}
