import type {
  AuditActor,
  AuditableAction,
  AuditMetadata,
  AuditOptions,
  AuditRecord,
  ExtractAuditPayload,
  ExtractAuditType,
} from './types';

/**
 * Interface for audit collection and flushing.
 * Generic over audit action types for full type safety.
 *
 * @template TAuditAction - Union of all allowed audit action types
 * @template TTransaction - Transaction type (e.g., Kysely Transaction)
 *
 * @example
 * ```typescript
 * type AppAuditAction =
 *   | AuditableAction<'user.created', { userId: string; email: string }>
 *   | AuditableAction<'user.updated', { userId: string; changes: string[] }>;
 *
 * // In endpoint handler
 * const auditor: Auditor<AppAuditAction> = ...;
 *
 * // Type-safe audit calls
 * auditor.audit('user.created', { userId: '123', email: 'test@example.com' }); // ✅
 * auditor.audit('user.created', { orderId: '123' }); // ❌ Type error
 * auditor.audit('unknown.type', {}); // ❌ Type error
 * ```
 */
export interface Auditor<
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
  TTransaction = unknown,
> {
  /**
   * The actor for all audits in this context.
   * Set at construction time, immutable throughout the request.
   */
  readonly actor: AuditActor;

  /**
   * Record a type-safe audit entry.
   * The payload type is inferred from the audit type.
   *
   * @param type - The audit type (must be a valid type from TAuditAction)
   * @param payload - The audit payload (shape enforced by type)
   * @param options - Optional audit metadata
   *
   * @example
   * ```typescript
   * auditor.audit('user.created', {
   *   userId: '123',
   *   email: 'test@example.com',
   * });
   *
   * auditor.audit('order.placed', {
   *   orderId: 'order-456',
   *   total: 99.99,
   * }, {
   *   entityId: 'order-456',
   *   table: 'orders',
   * });
   * ```
   */
  audit<TType extends ExtractAuditType<TAuditAction>>(
    type: TType,
    payload: ExtractAuditPayload<TAuditAction, TType>,
    options?: AuditOptions,
  ): void;

  /**
   * Record a raw audit record.
   * Use this when you need full control over the audit structure,
   * bypassing type safety.
   *
   * @param record - The audit record (id, timestamp, actor added automatically)
   */
  record(record: Omit<AuditRecord, 'id' | 'timestamp' | 'actor'>): void;

  /**
   * Get all collected audit records.
   * Useful for inspection or custom processing.
   */
  getRecords(): AuditRecord[];

  /**
   * Flush all collected audits to storage.
   * Called automatically by the endpoint adaptor inside the transaction.
   *
   * @param trx - Optional transaction context for atomic writes
   */
  flush(trx?: TTransaction): Promise<void>;

  /**
   * Clear all collected audit records without flushing.
   * Use with caution - collected audits will be lost.
   */
  clear(): void;

  /**
   * Add metadata to all future audit records.
   * Merges with existing metadata (new values override existing).
   * Typically called by adaptors to add request context.
   *
   * @param metadata - Metadata to add (requestId, endpoint, method, ip, etc.)
   *
   * @example
   * ```typescript
   * // In endpoint adaptor
   * auditor.addMetadata({
   *   requestId: 'req-123',
   *   endpoint: '/users',
   *   method: 'POST',
   *   ip: '192.168.1.1',
   * });
   * ```
   */
  addMetadata(metadata: AuditMetadata): void;

  /**
   * Set the transaction context for audit flushing.
   * When set, flush() will use this transaction instead of requiring
   * it to be passed explicitly. This enables declarative audits to
   * participate in the same transaction as the handler's database operations.
   *
   * @param trx - The transaction context (e.g., Kysely Transaction)
   *
   * @example
   * ```typescript
   * // In handler with explicit transaction management
   * const result = await withTransaction(services.database.raw, async (trx) => {
   *   // Register transaction with auditor so declarative audits use it
   *   auditor.setTransaction(trx);
   *
   *   const user = await trx.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow();
   *
   *   // Manual audits will also use this transaction when flush() is called
   *   auditor.audit('user.created', { userId: user.id });
   *
   *   return user;
   * });
   * // After handler, adaptor calls auditor.flush() which uses the stored transaction
   * ```
   */
  setTransaction(trx: TTransaction): void;

  /**
   * Get the currently set transaction context.
   * Returns undefined if no transaction has been set.
   */
  getTransaction(): TTransaction | undefined;
}
