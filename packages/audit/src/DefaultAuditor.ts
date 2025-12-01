import { nanoid } from 'nanoid';
import type { Auditor } from './Auditor';
import type { AuditStorage } from './storage';
import type {
  AuditableAction,
  AuditActor,
  AuditMetadata,
  AuditOptions,
  AuditRecord,
  ExtractAuditPayload,
  ExtractAuditType,
} from './types';

/**
 * Configuration for DefaultAuditor.
 */
export interface DefaultAuditorConfig {
  /** The actor performing audits (set at construction, immutable) */
  actor: AuditActor;
  /** Storage backend for persisting audits */
  storage: AuditStorage;
  /** Optional metadata to attach to all audits */
  metadata?: AuditMetadata;
  /** Optional custom ID generator (defaults to nanoid) */
  generateId?: () => string;
}

/**
 * Default implementation of the Auditor interface.
 * Collects audit records in memory and flushes to storage.
 *
 * @template TAuditAction - Union of all allowed audit action types
 *
 * @example
 * ```typescript
 * const auditor = new DefaultAuditor<AppAuditAction>({
 *   actor: { id: 'user-123', type: 'user' },
 *   storage: auditStorage,
 *   metadata: { requestId: 'req-456', endpoint: '/users' },
 * });
 *
 * auditor.audit('user.created', { userId: '789', email: 'test@example.com' });
 *
 * // Flush inside transaction
 * await auditor.flush(trx);
 * ```
 */
export class DefaultAuditor<
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
> implements Auditor<TAuditAction>
{
  readonly actor: AuditActor;
  private readonly storage: AuditStorage;
  private readonly metadata?: AuditMetadata;
  private readonly generateId: () => string;
  private records: AuditRecord[] = [];

  constructor(config: DefaultAuditorConfig) {
    this.actor = config.actor;
    this.storage = config.storage;
    this.metadata = config.metadata;
    this.generateId = config.generateId ?? (() => nanoid());
  }

  audit<TType extends ExtractAuditType<TAuditAction>>(
    type: TType,
    payload: ExtractAuditPayload<TAuditAction, TType>,
    options?: AuditOptions,
  ): void {
    const record: AuditRecord = {
      id: this.generateId(),
      type,
      operation: options?.operation ?? 'CUSTOM',
      table: options?.table,
      entityId: options?.entityId,
      oldValues: options?.oldValues,
      newValues: options?.newValues,
      payload,
      timestamp: new Date(),
      actor: this.actor,
      metadata: this.metadata,
    };

    this.records.push(record);
  }

  record(record: Omit<AuditRecord, 'id' | 'timestamp' | 'actor'>): void {
    const fullRecord: AuditRecord = {
      ...record,
      id: this.generateId(),
      timestamp: new Date(),
      actor: this.actor,
      metadata: this.metadata
        ? { ...this.metadata, ...record.metadata }
        : record.metadata,
    };

    this.records.push(fullRecord);
  }

  getRecords(): AuditRecord[] {
    return [...this.records];
  }

  async flush(trx?: unknown): Promise<void> {
    if (this.records.length === 0) {
      return;
    }

    const recordsToFlush = [...this.records];
    this.records = [];

    await this.storage.write(recordsToFlush, trx);
  }

  clear(): void {
    this.records = [];
  }
}
