import type { ControlledTransaction, Kysely, Transaction } from 'kysely';

export function withTransaction<T>(
  db: DatabaseConnection<any>,
  cb: (trx: DatabaseConnection<any>) => Promise<T>,
): Promise<T> {
  if (db.isTransaction) {
    return cb(db);
  }

  return db.transaction().execute(cb);
}

export type DatabaseConnection<T> =
  | ControlledTransaction<T>
  | Kysely<T>
  | Transaction<T>;
