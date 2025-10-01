import type { ControlledTransaction, Kysely, Transaction } from 'kysely';

export function withTransaction<DB, T>(
  db: DatabaseConnection<DB>,
  cb: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  if (db.isTransaction) {
    return cb(db as Transaction<DB>);
  }

  return db.transaction().execute(cb);
}

export type DatabaseConnection<T> =
  | ControlledTransaction<T>
  | Kysely<T>
  | Transaction<T>;
