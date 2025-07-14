import type { Kysely, Transaction } from 'kysely';
import type { TestAPI } from 'vitest';
import { VitestKyselyTransactionIsolator } from './VitestKyselyTransactionIsolator';
import { IsolationLevel } from './VitestTransactionIsolator';

export { KyselyFactory } from './KyselyFactory';
export { PostgresKyselyMigrator } from './PostgresKyselyMigrator';

export function wrapVitestKyselyTransaction<Database>(
  api: TestAPI,
  db: Kysely<Database>,
  setup?: (trx: Transaction<Database>) => Promise<void>,
  level: IsolationLevel = IsolationLevel.REPEATABLE_READ,
) {
  const wrapper = new VitestKyselyTransactionIsolator<Database>(api);

  return wrapper.wrapVitestWithTransaction(db, setup, level);
}
