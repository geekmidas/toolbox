import type { Kysely, Transaction } from 'kysely';
import type { AuditQueryOptions, AuditStorage } from './storage';
import type { AuditRecord } from './types';

/**
 * Database table interface for audit records.
 * Use this to define your audit_logs table in your Kysely database schema.
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
  oldValues: string | null;
  newValues: string | null;
  payload: string | null;
  timestamp: Date;
  actorId: string | null;
  actorType: string | null;
  actorData: string | null;
  metadata: string | null;
}

/**
 * Configuration for KyselyAuditStorage.
 */
export interface KyselyAuditStorageConfig<DB> {
  /** Kysely database instance */
  db: Kysely<DB>;
  /** Table name for audit logs (must be a key in DB that extends AuditLogTable) */
  tableName: keyof DB & string;
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

  constructor(config: KyselyAuditStorageConfig<DB>) {
    this.db = config.db;
    this.tableName = config.tableName;
  }

  async write(records: AuditRecord[], trx?: unknown): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const db = (trx as Transaction<DB>) ?? this.db;
    const rows = records.map((record) => this.toRow(record));

    await (db as any)
      .insertInto(this.tableName)
      .values(rows)
      .execute();
  }

  async query(options: AuditQueryOptions): Promise<AuditRecord[]> {
    let query = (this.db as any)
      .selectFrom(this.tableName)
      .selectAll();

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
      oldValues:
        record.oldValues !== undefined
          ? JSON.stringify(record.oldValues)
          : null,
      newValues:
        record.newValues !== undefined
          ? JSON.stringify(record.newValues)
          : null,
      payload:
        record.payload !== undefined ? JSON.stringify(record.payload) : null,
      timestamp: record.timestamp,
      actorId: record.actor?.id ?? null,
      actorType: record.actor?.type ?? null,
      actorData:
        record.actor !== undefined
          ? JSON.stringify(this.getActorData(record.actor))
          : null,
      metadata:
        record.metadata !== undefined ? JSON.stringify(record.metadata) : null,
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
      entityId: row.entityId
        ? this.parseEntityId(row.entityId)
        : undefined,
      oldValues: row.oldValues
        ? this.parseJson(row.oldValues)
        : undefined,
      newValues: row.newValues
        ? this.parseJson(row.newValues)
        : undefined,
      payload: row.payload ? this.parseJson(row.payload) : undefined,
      timestamp: row.timestamp,
      actor,
      metadata: row.metadata ? this.parseJson(row.metadata) : undefined,
    };
  }

  /**
   * Parse a JSON value that may already be parsed (e.g., from jsonb columns).
   */
  private parseJson(value: string | object): Record<string, unknown> {
    if (typeof value === 'object') {
      return value as Record<string, unknown>;
    }
    return JSON.parse(value);
  }

  private getActorData(
    actor: NonNullable<AuditRecord['actor']>,
  ): Record<string, unknown> {
    const { id, type, ...rest } = actor;
    return rest;
  }

  private parseEntityId(
    entityId: string,
  ): string | Record<string, unknown> {
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
