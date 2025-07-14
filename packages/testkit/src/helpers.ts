import {
  CamelCasePlugin,
  Kysely,
  PostgresDialect,
  type Transaction,
} from 'kysely';
import pg from 'pg';
import { VitestKyselyTransactionIsolator } from './VitestKyselyTransactionIsolator';
import { IsolationLevel } from './VitestTransactionIsolator';

export function wrapVitestKyselyTransaction<Database>(
  db: Kysely<Database>,
  setup?: (trx: Transaction<Database>) => Promise<void>,
  level: IsolationLevel = IsolationLevel.REPEATABLE_READ,
) {
  const wrapper = new VitestKyselyTransactionIsolator<Database>();

  return wrapper.wrapVitestWithTransaction(db, setup, level);
}

export function createKyselyDb<Database>(config: any): Kysely<Database> {
  return new Kysely({
    dialect: new PostgresDialect({
      pool: new pg.Pool(config),
    }),
    plugins: [new CamelCasePlugin()],
  });
}
