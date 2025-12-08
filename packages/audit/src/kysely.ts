import type {
  ControlledTransaction,
  IsolationLevel,
  Kysely,
  Transaction,
} from 'kysely';
import type { AuditQueryOptions, AuditStorage } from './storage';
import type { AuditRecord } from './types';

/**
 * Minimal interface for transaction-aware audit flushing.
 * Use this when you need to flush audits within a database transaction.
 *
 * @template TTransaction - Transaction type (e.g., Kysely Transaction)
 *
 * @example
 * ```typescript
 * import { withAuditableTransaction } from '@geekmidas/audit/kysely';
 * import type { TransactionAwareAuditor } from '@geekmidas/audit/kysely';
 *
 * const result = await withAuditableTransaction(
 *   db,
 *   auditor as TransactionAwareAuditor<Transaction<DB>>,
 *   async (trx) => {
 *     // Your transactional operations
 *     return result;
 *   },
 * );
 * ```
 */
export interface TransactionAwareAuditor<TTransaction = unknown> {
  /** Register the transaction with the auditor for use during flush */
  setTransaction(trx: TTransaction): void;
  /** Flush all pending audits, optionally within a transaction */
  flush(trx?: TTransaction): Promise<void>;
}

export interface TransactionSettings {
  isolationLevel?: IsolationLevel;
}

export type DatabaseConnection<T> =
  | ControlledTransaction<T>
  | Kysely<T>
  | Transaction<T>;

/**
 * Execute a callback within a database transaction with automatic audit handling.
 *
 * This wrapper ensures that:
 * 1. The transaction is automatically registered with the auditor
 * 2. Manual audits (via `auditor.audit()`) are flushed BEFORE the transaction commits
 * 3. If audit flush fails, the entire transaction rolls back
 * 4. If the callback fails, audits are NOT written (atomic consistency)
 *
 * **Note:** Declarative audits (defined via `.audit([...])` on the endpoint builder)
 * are processed AFTER the handler returns, so they run outside this transaction.
 * If you need all audits to be atomic with your database operations, use manual
 * audits via `auditor.audit()` inside this wrapper.
 *
 * @param db - Database connection (Kysely, Transaction, or ControlledTransaction)
 * @param auditor - Auditor instance that will receive the transaction
 * @param cb - Callback to execute within the transaction
 * @param settings - Optional transaction settings (isolation level)
 * @returns The result of the callback
 *
 * @example
 * ```typescript
 * import { withAuditableTransaction } from '@geekmidas/audit/kysely';
 *
 * const result = await withAuditableTransaction(
 *   services.database,
 *   auditor,
 *   async (trx) => {
 *     const user = await trx
 *       .insertInto('users')
 *       .values(data)
 *       .returningAll()
 *       .executeTakeFirstOrThrow();
 *
 *     // Manual audits are atomic with the transaction
 *     auditor.audit('user.created', { userId: user.id, email: user.email });
 *
 *     return user;
 *   },
 * );
 * // Audits are automatically flushed inside the transaction before commit
 * ```
 */
export async function withAuditableTransaction<DB, T>(
  db: DatabaseConnection<DB>,
  auditor: TransactionAwareAuditor<Transaction<DB>>,
  cb: (trx: Transaction<DB>) => Promise<T>,
  settings?: TransactionSettings,
): Promise<T> {
  const execute = async (trx: Transaction<DB>): Promise<T> => {
    // Register transaction with auditor
    auditor.setTransaction(trx);

    // Execute the callback
    const result = await cb(trx);

    // Flush audits BEFORE transaction commits
    // If this fails, the transaction will roll back
    await auditor.flush(trx);

    return result;
  };

  // If already in a transaction, just run with it
  if (db.isTransaction) {
    return execute(db as Transaction<DB>);
  }

  const builder = db.transaction();

  if (settings?.isolationLevel) {
    return builder.setIsolationLevel(settings.isolationLevel).execute(execute);
  }

  return builder.execute(execute);
}

/**
 * Database table interface for audit records.
 * Use this to define your audit_logs table in your Kysely database schema.
 *
 * Column names use snake_case to match standard PostgreSQL conventions.
 *
 * @example
 * ```typescript
 * interface Database {
 *   audit_logs: AuditLogTable;
 *   // ... other tables
 * }
 * ```
 */
export interface AuditLogTable {
  id: string;
  type: string;
  operation: string;
  table: string | null;
  entityId: string | null;
  oldValues: unknown | null;
  newValues: unknown | null;
  payload: unknown | null;
  timestamp: Date;
  actorId: string | null;
  actorType: string | null;
  actorData: unknown | null;
  metadata: unknown | null;
}

/**
 * Configuration for KyselyAuditStorage.
 */
export interface KyselyAuditStorageConfig<DB> {
  /** Kysely database instance */
  db: Kysely<DB>;
  /** Table name for audit logs (must be a key in DB that extends AuditLogTable) */
  tableName: keyof DB & string;
  /**
   * Service name of the database service.
   * When set, endpoint adaptors will automatically use the audit transaction as `db`
   * in the handler context if the endpoint's database service has the same name.
   */
  databaseServiceName?: string;
}

/**
 * Kysely-based audit storage implementation.
 * Stores audit records in a database table using Kysely.
 *
 * @template DB - Your Kysely database schema
 *
 * @example
 * ```typescript
 * interface Database {
 *   audit_logs: AuditLogTable;
 * }
 *
 * const storage = new KyselyAuditStorage({
 *   db: kyselyDb,
 *   tableName: 'audit_logs',
 * });
 *
 * const auditor = new DefaultAuditor({
 *   actor: { id: 'user-123', type: 'user' },
 *   storage,
 * });
 * ```
 */
export class KyselyAuditStorage<DB> implements AuditStorage {
  private readonly db: Kysely<DB>;
  private readonly tableName: keyof DB & string;
  readonly databaseServiceName?: string;

  constructor(config: KyselyAuditStorageConfig<DB>) {
    this.db = config.db;
    this.tableName = config.tableName;
    this.databaseServiceName = config.databaseServiceName;
  }

  async write(records: AuditRecord[], trx?: unknown): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const db = (trx as Transaction<DB>) ?? this.db;
    const rows = records.map((record) => this.toRow(record));

    await (db as any).insertInto(this.tableName).values(rows).execute();
  }

  async query(options: AuditQueryOptions): Promise<AuditRecord[]> {
    let query = (this.db as any).selectFrom(this.tableName).selectAll();

    query = this.applyFilters(query, options);

    // Ordering
    const orderBy = options.orderBy ?? 'timestamp';
    const orderDirection = options.orderDirection ?? 'desc';
    query = query.orderBy(
      orderBy === 'timestamp' ? 'timestamp' : 'type',
      orderDirection,
    );

    // Pagination
    if (options.limit !== undefined) {
      query = query.limit(options.limit);
    }
    if (options.offset !== undefined) {
      query = query.offset(options.offset);
    }

    const rows = await query.execute();
    return rows.map((row: AuditLogTable) => this.fromRow(row));
  }

  async count(
    options: Omit<AuditQueryOptions, 'limit' | 'offset'>,
  ): Promise<number> {
    let query = (this.db as any)
      .selectFrom(this.tableName)
      .select((eb: any) => eb.fn.count('id').as('count'));

    query = this.applyFilters(query, options);

    const result = await query.executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  /**
   * Get the Kysely database instance for transactional operations.
   * Used by endpoint adaptors to automatically wrap handlers in transactions.
   */
  getDatabase(): Kysely<DB> {
    return this.db;
  }

  private applyFilters(query: any, options: AuditQueryOptions): any {
    // Type filter
    if (options.type !== undefined) {
      if (Array.isArray(options.type)) {
        query = query.where('type', 'in', options.type);
      } else {
        query = query.where('type', '=', options.type);
      }
    }

    // Entity ID filter
    if (options.entityId !== undefined) {
      const entityId =
        typeof options.entityId === 'string'
          ? options.entityId
          : JSON.stringify(options.entityId);
      query = query.where('entityId', '=', entityId);
    }

    // Table filter
    if (options.table !== undefined) {
      query = query.where('table', '=', options.table);
    }

    // Actor ID filter
    if (options.actorId !== undefined) {
      query = query.where('actorId', '=', options.actorId);
    }

    // Date range filters
    if (options.from !== undefined) {
      query = query.where('timestamp', '>=', options.from);
    }
    if (options.to !== undefined) {
      query = query.where('timestamp', '<=', options.to);
    }

    return query;
  }

  private toRow(record: AuditRecord): AuditLogTable {
    return {
      id: record.id,
      type: record.type,
      operation: record.operation,
      table: record.table ?? null,
      entityId:
        record.entityId === undefined
          ? null
          : typeof record.entityId === 'string'
            ? record.entityId
            : JSON.stringify(record.entityId),
      oldValues: record.oldValues ?? null,
      newValues: record.newValues ?? null,
      payload: record.payload ?? null,
      timestamp: record.timestamp,
      actorId: record.actor?.id ?? null,
      actorType: record.actor?.type ?? null,
      actorData:
        record.actor !== undefined ? this.getActorData(record.actor) : null,
      metadata: record.metadata ?? null,
    };
  }

  private fromRow(row: AuditLogTable): AuditRecord {
    const actor =
      row.actorId !== null || row.actorType !== null
        ? {
            id: row.actorId ?? undefined,
            type: row.actorType ?? undefined,
            ...(row.actorData ? this.parseJson(row.actorData) : {}),
          }
        : undefined;

    return {
      id: row.id,
      type: row.type,
      operation: row.operation as AuditRecord['operation'],
      table: row.table ?? undefined,
      entityId: row.entityId ? this.parseEntityId(row.entityId) : undefined,
      oldValues: row.oldValues ? this.parseJson(row.oldValues) : undefined,
      newValues: row.newValues ? this.parseJson(row.newValues) : undefined,
      payload: row.payload ? this.parseJson(row.payload) : undefined,
      timestamp: row.timestamp,
      actor,
      metadata: row.metadata ? this.parseJson(row.metadata) : undefined,
    };
  }

  /**
   * Parse a JSON value that may already be parsed (e.g., from jsonb columns).
   */
  private parseJson(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null) {
      return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
      return JSON.parse(value);
    }
    return {};
  }

  private getActorData(
    actor: NonNullable<AuditRecord['actor']>,
  ): Record<string, unknown> {
    const { id, type, ...rest } = actor;
    return rest;
  }

  private parseEntityId(entityId: string): string | Record<string, unknown> {
    try {
      const parsed = JSON.parse(entityId);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
      return entityId;
    } catch {
      return entityId;
    }
  }
}
