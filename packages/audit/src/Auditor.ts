import type {
  AuditableAction,
  AuditActor,
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
  flush(trx?: unknown): Promise<void>;

  /**
   * Clear all collected audit records without flushing.
   * Use with caution - collected audits will be lost.
   */
  clear(): void;
}
