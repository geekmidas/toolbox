import type {
  ControlledTransaction,
  IsolationLevel,
  Kysely,
  Transaction,
} from 'kysely';

export interface TransactionSettings {
  isolationLevel?: IsolationLevel;
}

export function withTransaction<DB, T>(
  db: DatabaseConnection<DB>,
  cb: (trx: Transaction<DB>) => Promise<T>,
  settings?: TransactionSettings,
): Promise<T> {
  if (db.isTransaction) {
    return cb(db as Transaction<DB>);
  }

  const builder = db.transaction();

  if (settings?.isolationLevel) {
    return builder.setIsolationLevel(settings.isolationLevel).execute(cb);
  }

  return builder.execute(cb);
}

export type DatabaseConnection<T> =
  | ControlledTransaction<T>
  | Kysely<T>
  | Transaction<T>;
