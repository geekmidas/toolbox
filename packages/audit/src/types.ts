import type { InferStandardSchema } from '@geekmidas/schema';
import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * Represents an auditable action with a type and payload.
 * Similar to PublishableMessage in @geekmidas/events.
 *
 * @template TType - The audit type/name (e.g., 'user.created')
 * @template TPayload - The audit payload data
 *
 * @example
 * ```typescript
 * type AppAuditAction =
 *   | AuditableAction<'user.created', { userId: string; email: string }>
 *   | AuditableAction<'user.updated', { userId: string; changes: string[] }>
 *   | AuditableAction<'order.placed', { orderId: string; total: number }>;
 * ```
 */
export type AuditableAction<TType extends string, TPayload = unknown> = {
	type: TType;
	payload: TPayload;
};

/**
 * Extract the type string from an AuditableAction union.
 */
export type ExtractAuditType<T extends AuditableAction<string, unknown>> =
	T extends AuditableAction<infer TType, unknown> ? TType : never;

/**
 * Extract the payload for a specific audit type from an AuditableAction union.
 */
export type ExtractAuditPayload<
	T extends AuditableAction<string, unknown>,
	TType extends ExtractAuditType<T>,
> = T extends AuditableAction<TType, infer TPayload> ? TPayload : never;

/**
 * Audit operation types for database auditing.
 */
export type AuditOperation = 'INSERT' | 'UPDATE' | 'DELETE' | 'CUSTOM';

/**
 * Represents the actor who performed an audited action.
 */
export interface AuditActor {
	/** Unique identifier for the actor (user ID, service ID, etc.) */
	id?: string;
	/** Type of actor ('user', 'system', 'service', etc.) */
	type?: string;
	/** Additional actor properties */
	[key: string]: unknown;
}

/**
 * Metadata associated with an audit record.
 */
export interface AuditMetadata {
	/** Request correlation ID */
	requestId?: string;
	/** Which endpoint was called */
	endpoint?: string;
	/** HTTP method */
	method?: string;
	/** Client IP address */
	ip?: string;
	/** Client user agent */
	userAgent?: string;
	/** Additional metadata */
	[key: string]: unknown;
}

/**
 * A complete audit record representing a tracked action.
 */
export interface AuditRecord<TPayload = unknown> {
	/** Unique identifier for this audit record */
	id: string;
	/** Audit type (e.g., 'user.created', 'order.placed') */
	type: string;
	/** Operation type for database audits */
	operation: AuditOperation;
	/** Database table name (for database operations) */
	table?: string;
	/** Entity primary key(s) */
	entityId?: string | Record<string, unknown>;
	/** Previous state (for UPDATE/DELETE) */
	oldValues?: Record<string, unknown>;
	/** New state (for INSERT/UPDATE) */
	newValues?: Record<string, unknown>;
	/** Custom payload (for CUSTOM operations) */
	payload?: TPayload;
	/** When the audit was recorded */
	timestamp: Date;
	/** Who performed the action */
	actor?: AuditActor;
	/** Request context */
	metadata?: AuditMetadata;
}

/**
 * Options for manual audit calls.
 */
export interface AuditOptions {
	/** Entity primary key(s) for easier querying */
	entityId?: string | Record<string, unknown>;
	/** Database table name */
	table?: string;
	/** Operation type (defaults to 'CUSTOM') */
	operation?: AuditOperation;
	/** Previous state */
	oldValues?: Record<string, unknown>;
	/** New state */
	newValues?: Record<string, unknown>;
}

/**
 * Mapped audit definition for declarative auditing.
 * Similar to MappedEvent in @geekmidas/events.
 */
export interface MappedAudit<
	TAuditAction extends AuditableAction<string, unknown>,
	TOutput extends StandardSchemaV1 | undefined = undefined,
> {
	/** The audit type - must be a valid type from the AuditableAction union */
	type: ExtractAuditType<TAuditAction>;
	/** Function to extract payload from the response */
	payload: (
		response: InferStandardSchema<TOutput>,
	) => ExtractAuditPayload<TAuditAction, ExtractAuditType<TAuditAction>>;
	/** Optional condition - only audit if this returns true */
	when?: (response: InferStandardSchema<TOutput>) => boolean;
	/** Optional entity ID extractor for easier querying */
	entityId?: (
		response: InferStandardSchema<TOutput>,
	) => string | Record<string, unknown>;
	/** Optional table name for database association */
	table?: string;
}

/**
 * Extract the AuditableAction type from an Auditor.
 */
export type ExtractAuditorAction<T> = T extends Auditor<infer A> ? A : never;

/**
 * Extract the AuditableAction type from an AuditStorage.
 */
export type ExtractStorageAuditAction<T> =
	T extends AuditStorage<infer A> ? A : AuditableAction<string, unknown>;

// Forward declaration for Auditor type extraction
import type { Auditor } from './Auditor';
import type { AuditStorage } from './storage';
