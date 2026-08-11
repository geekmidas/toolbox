import type { Knex } from 'knex';
import { nanoid } from 'nanoid';
import type {
	AuditQueryOptions,
	AuditStorage,
	TransactionAwareAuditor,
} from './storage';
import type { AuditRecord } from './types';

export type { TransactionAwareAuditor };

export interface TransactionSettings {
	isolationLevel?: Knex.IsolationLevels;
}

export type DatabaseConnection = Knex | Knex.Transaction;

/**
 * Type guard for an active Knex transaction.
 *
 * Knex marks transaction instances with `isTransaction`, and a completed
 * transaction can no longer be used, so a settled transaction is treated as a
 * plain connection.
 */
function isActiveTransaction(
	connection: DatabaseConnection,
): connection is Knex.Transaction {
	return (
		connection.isTransaction === true &&
		!(connection as Knex.Transaction).isCompleted()
	);
}

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
 * @param db - Database connection (Knex instance or Transaction)
 * @param auditor - Auditor instance that will receive the transaction
 * @param cb - Callback to execute within the transaction
 * @param settings - Optional transaction settings (isolation level)
 * @returns The result of the callback
 *
 * @example
 * ```typescript
 * import { withAuditableTransaction } from '@geekmidas/audit/knex';
 *
 * const result = await withAuditableTransaction(
 *   services.database,
 *   auditor,
 *   async (trx) => {
 *     const [user] = await trx('users').insert(data).returning('*');
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
export async function withAuditableTransaction<T>(
	db: DatabaseConnection,
	auditor: TransactionAwareAuditor<Knex.Transaction>,
	cb: (trx: Knex.Transaction) => Promise<T>,
	settings?: TransactionSettings,
): Promise<T> {
	const execute = async (trx: Knex.Transaction): Promise<T> => {
		// Register transaction with auditor
		auditor.setTransaction(trx);

		// Execute the callback
		const result = await cb(trx);

		// Flush audits BEFORE transaction commits
		// If this fails, the transaction will roll back
		await auditor.flush(trx);

		return result;
	};

	// If already in a transaction, just run with it.
	// Knex would otherwise open a savepoint, which commits independently.
	if (isActiveTransaction(db)) {
		return execute(db);
	}

	return db.transaction(execute, settings);
}

/**
 * Shape of a row in the audit log table.
 * Use this to describe your audit table when declaring Knex table types.
 *
 * Property names are camelCase to match the Kysely storage. Pair this with
 * `knexSnakeCaseMappers()` if your database columns are snake_case.
 *
 * @example
 * ```typescript
 * import { knexSnakeCaseMappers } from 'objection';
 *
 * const db = knex({
 *   client: 'pg',
 *   connection: process.env.DATABASE_URL,
 *   ...knexSnakeCaseMappers(),
 * });
 *
 * declare module 'knex/types/tables' {
 *   interface Tables {
 *     audit_logs: AuditLogTable;
 *   }
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
 * Insertable version of AuditLogTable where id is optional.
 * Use this when your database auto-generates IDs or when using the autoId option.
 */
export type InsertableAuditLogTable = Omit<AuditLogTable, 'id'> & {
	id?: string;
};

/**
 * Configuration for KnexAuditStorage.
 */
export interface KnexAuditStorageConfig {
	/** Knex database instance */
	db: Knex;
	/** Table name for audit logs */
	tableName: string;
	/**
	 * Service name of the database service.
	 * When set, endpoint adaptors will automatically use the audit transaction as `db`
	 * in the handler context if the endpoint's database service has the same name.
	 */
	databaseServiceName?: string;
	/**
	 * Let the database auto-generate IDs (e.g., via DEFAULT gen_random_uuid()).
	 * When true, the ID field is omitted from inserts if not provided.
	 * When false (default), IDs are generated using nanoid if not provided.
	 * @default false
	 */
	autoId?: boolean;
}

/**
 * Knex-based audit storage implementation.
 * Stores audit records in a database table using Knex.
 *
 * @example
 * ```typescript
 * const storage = new KnexAuditStorage({
 *   db: knexDb,
 *   tableName: 'audit_logs',
 * });
 *
 * const auditor = new DefaultAuditor({
 *   actor: { id: 'user-123', type: 'user' },
 *   storage,
 * });
 * ```
 */
export class KnexAuditStorage implements AuditStorage {
	private readonly db: Knex;
	private readonly tableName: string;
	private readonly autoId: boolean;
	readonly databaseServiceName?: string;

	constructor(config: KnexAuditStorageConfig) {
		this.db = config.db;
		this.tableName = config.tableName;
		this.databaseServiceName = config.databaseServiceName;
		this.autoId = config.autoId ?? false;
	}

	async write(records: AuditRecord[], trx?: unknown): Promise<void> {
		if (records.length === 0) {
			return;
		}

		const db = (trx as Knex.Transaction) ?? this.db;
		const rows = records.map((record) => this.toRow(record));

		await db(this.tableName).insert(rows);
	}

	async query(options: AuditQueryOptions): Promise<AuditRecord[]> {
		let query = this.db(this.tableName).select('*');

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

		const rows = await query;
		return rows.map((row: AuditLogTable) => this.fromRow(row));
	}

	async count(
		options: Omit<AuditQueryOptions, 'limit' | 'offset'>,
	): Promise<number> {
		let query = this.db(this.tableName).count({ count: 'id' });

		query = this.applyFilters(query, options);

		const result = await query.first();
		return Number(result?.count ?? 0);
	}

	/**
	 * Get the Knex database instance for transactional operations.
	 * Used by endpoint adaptors to automatically wrap handlers in transactions.
	 */
	getDatabase(): Knex {
		return this.db;
	}

	/**
	 * Execute a callback within a Knex transaction with automatic audit handling.
	 * The auditor is registered with the transaction and audits are flushed
	 * before the transaction commits.
	 *
	 * If the provided db connection is already a transaction, it will be reused
	 * instead of opening a savepoint.
	 */
	async withTransaction<T>(
		auditor: TransactionAwareAuditor<Knex.Transaction>,
		callback: () => Promise<T>,
		db?: DatabaseConnection,
	): Promise<T> {
		const connection = db ?? this.db;

		// If already in a transaction, reuse it
		if (isActiveTransaction(connection)) {
			auditor.setTransaction(connection);
			const result = await callback();
			await auditor.flush(connection);
			return result;
		}

		// Create new transaction
		return connection.transaction(async (trx) => {
			auditor.setTransaction(trx);
			const result = await callback();
			await auditor.flush(trx);
			return result;
		});
	}

	private applyFilters(query: any, options: AuditQueryOptions): any {
		// Type filter
		if (options.type !== undefined) {
			if (Array.isArray(options.type)) {
				query = query.whereIn('type', options.type);
			} else {
				query = query.where('type', options.type);
			}
		}

		// Entity ID filter
		if (options.entityId !== undefined) {
			const entityId =
				typeof options.entityId === 'string'
					? options.entityId
					: JSON.stringify(options.entityId);
			query = query.where('entityId', entityId);
		}

		// Table filter
		if (options.table !== undefined) {
			query = query.where('table', options.table);
		}

		// Actor ID filter
		if (options.actorId !== undefined) {
			query = query.where('actorId', options.actorId);
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
		// If autoId is true, let database generate ID (ignore record.id)
		// If autoId is false (default), use record.id or generate with nanoid
		const id = this.autoId ? undefined : record.id || nanoid();

		return {
			...(id && { id }),
			type: record.type,
			operation: record.operation,
			table: record.table ?? null,
			entityId:
				record.entityId === undefined
					? null
					: typeof record.entityId === 'string'
						? record.entityId
						: JSON.stringify(record.entityId),
			oldValues: this.toJsonColumn(record.oldValues),
			newValues: this.toJsonColumn(record.newValues),
			payload: this.toJsonColumn(record.payload),
			timestamp: record.timestamp,
			actorId: record.actor?.id ?? null,
			actorType: record.actor?.type ?? null,
			actorData:
				record.actor !== undefined
					? this.toJsonColumn(this.getActorData(record.actor))
					: null,
			metadata: this.toJsonColumn(record.metadata),
		} as AuditLogTable;
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
	 * Serialize a JSON value for insertion.
	 *
	 * Unlike Kysely, Knex has no per-column type information to tell a json/jsonb
	 * column from an object it should bind as a composite value, so plain objects
	 * are stringified before they reach the driver.
	 */
	private toJsonColumn(value: unknown): string | null {
		if (value === undefined || value === null) {
			return null;
		}
		return JSON.stringify(value);
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
