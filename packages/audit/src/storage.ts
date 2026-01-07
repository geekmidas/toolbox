import type { AuditableAction, AuditRecord } from './types';

/**
 * Options for querying audit records.
 */
export interface AuditQueryOptions {
  /** Filter by audit type */
  type?: string | string[];
  /** Filter by entity ID */
  entityId?: string | Record<string, unknown>;
  /** Filter by table name */
  table?: string;
  /** Filter by actor ID */
  actorId?: string;
  /** Filter by date range (start) */
  from?: Date;
  /** Filter by date range (end) */
  to?: Date;
  /** Limit number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Sort order */
  orderBy?: 'timestamp' | 'type';
  /** Sort direction */
  orderDirection?: 'asc' | 'desc';
}

/**
 * Interface for audit storage backends.
 * Implement this to store audits in your preferred location.
 *
 * @example
 * ```typescript
 * // Same database storage (recommended for transactions)
 * const auditStorage: AuditStorage = {
 *   async write(records, trx) {
 *     const db = trx ?? getDatabase();
 *     await db.insertInto('audit_logs').values(records).execute();
 *   },
 * };
 *
 * // External audit service
 * const externalAuditStorage: AuditStorage = {
 *   async write(records) {
 *     await fetch('https://audit.example.com/api/audits', {
 *       method: 'POST',
 *       body: JSON.stringify({ records }),
 *     });
 *   },
 * };
 * ```
 *
 * @template TAuditAction - Optional type parameter for type-safe audit actions.
 *   When provided, this type is preserved in the Service definition and can be
 *   extracted by EndpointBuilder to provide type inference for `.audit([...])`.
 */
export interface AuditStorage<
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
> {
  /** @internal Type marker for extracting audit action type */
  readonly __auditActionType?: TAuditAction;
  /**
   * Write audit records to storage.
   * Called by Auditor.flush() to persist collected audits.
   *
   * @param records - The audit records to write
   * @param trx - Optional transaction context (for same-DB storage)
   */
  write(records: AuditRecord[], trx?: unknown): Promise<void>;

  /**
   * Optional: Query audit records for retrieval.
   * Implement this for audit log viewing/searching.
   *
   * @param options - Query filters and pagination
   * @returns Matching audit records
   */
  query?(options: AuditQueryOptions): Promise<AuditRecord[]>;

  /**
   * Optional: Count audit records matching filters.
   * Useful for pagination.
   *
   * @param options - Query filters (limit/offset ignored)
   * @returns Count of matching records
   */
  count?(options: Omit<AuditQueryOptions, 'limit' | 'offset'>): Promise<number>;

  /**
   * Optional: Get the database connection for transactional audit writes.
   * When implemented, the endpoint adaptor can automatically wrap handlers
   * in a transaction, ensuring audits are atomic with other database operations.
   *
   * @returns Database connection (e.g., Kysely instance)
   *
   * @example
   * ```typescript
   * class KyselyAuditStorage implements AuditStorage {
   *   constructor(private db: Kysely<DB>) {}
   *
   *   getDatabase() {
   *     return this.db;
   *   }
   * }
   * ```
   */
  getDatabase?(): unknown;

  /**
   * Optional: The service name of the database service used by this storage.
   * When set, endpoint adaptors will automatically use the audit transaction as `db`
   * in the handler context if the endpoint's database service has the same name.
   *
   * @example
   * ```typescript
   * const storage = new KyselyAuditStorage({
   *   db,
   *   tableName: 'audit_logs',
   *   databaseServiceName: 'database', // Matches databaseService.serviceName
   * });
   * ```
   */
  databaseServiceName?: string;

  /**
   * Optional: Execute a callback within a database transaction.
   * The auditor is registered with the transaction and audits are flushed
   * before the transaction commits.
   *
   * This is database-agnostic - each storage implementation provides its own
   * transaction handling based on the underlying database.
   *
   * If a database connection is provided, it should be used instead of the
   * storage's internal connection. If the connection is already a transaction,
   * it should be reused instead of creating a nested transaction.
   *
   * @param auditor - The auditor to register with the transaction
   * @param callback - The callback to execute within the transaction
   * @param db - Optional database connection (may already be a transaction)
   * @returns The result of the callback
   *
   * @example
   * ```typescript
   * // KyselyAuditStorage implementation
   * async withTransaction<T>(auditor, callback, db) {
   *   const connection = db ?? this.db;
   *   if (connection.isTransaction) {
   *     // Reuse existing transaction
   *     auditor.setTransaction(connection);
   *     const result = await callback();
   *     await auditor.flush(connection);
   *     return result;
   *   }
   *   return connection.transaction().execute(async (trx) => {
   *     auditor.setTransaction(trx);
   *     const result = await callback();
   *     await auditor.flush(trx);
   *     return result;
   *   });
   * }
   * ```
   */
  withTransaction?<T>(
    auditor: {
      setTransaction(trx: unknown): void;
      flush(trx?: unknown): Promise<void>;
    },
    callback: () => Promise<T>,
    db?: unknown,
  ): Promise<T>;
}
