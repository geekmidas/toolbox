import type { Kysely, Transaction } from 'kysely';
import {
  type IsolationLevel,
  VitestPostgresTransactionIsolator,
} from './VitestTransactionIsolator';

export class VitestKyselyTransactionIsolator<
  Database,
> extends VitestPostgresTransactionIsolator<
  Kysely<Database>,
  Transaction<Database>
> {
  async transact(
    conn: Kysely<Database>,
    level: IsolationLevel,
    fn: (trx: Transaction<Database>) => Promise<void>,
  ): Promise<void> {
    const isolationLevel =
      level.toLocaleLowerCase() as Lowercase<IsolationLevel>;
    await conn.transaction().setIsolationLevel(isolationLevel).execute(fn);
  }
  // Implement any Kysely-specific transaction logic here
}
