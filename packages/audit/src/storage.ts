import type { AuditRecord } from './types';

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
 */
export interface AuditStorage {
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
}
