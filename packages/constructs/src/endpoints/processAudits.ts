import type {
	AuditActor,
	AuditableAction,
	Auditor,
	AuditStorage,
} from '@geekmidas/audit';
import { DefaultAuditor } from '@geekmidas/audit';
import type { Logger } from '@geekmidas/logger';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceDiscovery } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ActorExtractor, MappedAudit } from './audit';
import type { CookieFn, Endpoint, HeaderFn } from './Endpoint';

/**
 * Process declarative audit definitions after successful endpoint execution.
 * Similar to publishConstructEvents for events.
 *
 * @param endpoint - The endpoint with audit configuration
 * @param response - The handler response to generate audit payloads from
 * @param serviceDiscovery - Service discovery for registering audit storage
 * @param logger - Logger for debug/error messages
 * @param ctx - Request context (session, headers, cookies, services)
 * @param existingAuditor - Optional existing auditor instance (e.g., from handler context).
 *                          If provided, uses this auditor (with its stored transaction).
 *                          If not provided, creates a new auditor.
 */
export async function processEndpointAudits<
	TServices extends Service[] = [],
	TSession = unknown,
	TLogger extends Logger = Logger,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TAuditStorage extends AuditStorage | undefined = undefined,
	TAuditStorageServiceName extends string = string,
	TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
		string,
		unknown
	>,
>(
	endpoint: Endpoint<
		any,
		any,
		any,
		OutSchema,
		TServices,
		TLogger,
		TSession,
		any,
		any,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction
	>,
	response: InferStandardSchema<OutSchema>,
	serviceDiscovery: ServiceDiscovery<any>,
	logger: TLogger,
	ctx: {
		session: TSession;
		header: HeaderFn;
		cookie: CookieFn;
		services: Record<string, unknown>;
	},
	existingAuditor?: Auditor<TAuditAction>,
): Promise<void> {
	try {
		const audits = endpoint.audits as MappedAudit<TAuditAction, OutSchema>[];

		// If we have an existing auditor (from handler context), we need to flush
		// any manual audits it collected, even if there are no declarative audits
		const hasExistingRecords =
			existingAuditor && existingAuditor.getRecords().length > 0;

		// Skip if no declarative audits and no existing records to flush
		if (!audits?.length && !hasExistingRecords) {
			logger.debug('No audits to process');
			return;
		}

		// If no auditor storage service and we have things to process, warn
		if (!endpoint.auditorStorageService) {
			if (hasExistingRecords || audits?.length) {
				logger.warn('No auditor storage service available');
			}
			return;
		}

		// Get or create auditor
		let auditor: Auditor<TAuditAction>;

		if (existingAuditor) {
			// Use existing auditor (preserves stored transaction and manual audits)
			auditor = existingAuditor;
			logger.debug('Using existing auditor from handler context');
		} else {
			// Create new auditor (backward compatibility)
			const services = await serviceDiscovery.register([
				endpoint.auditorStorageService,
			]);
			const storage = services[
				endpoint.auditorStorageService.serviceName
			] as AuditStorage;

			// Extract actor if configured
			let actor: AuditActor = { id: 'system', type: 'system' };
			if (endpoint.actorExtractor) {
				try {
					actor = await (
						endpoint.actorExtractor as ActorExtractor<
							TServices,
							TSession,
							TLogger
						>
					)({
						services: ctx.services as any,
						session: ctx.session,
						header: ctx.header,
						cookie: ctx.cookie,
						logger,
					});
				} catch (error) {
					logger.error(error as Error, 'Failed to extract actor for audits');
					// Continue with system actor
				}
			}

			auditor = new DefaultAuditor<TAuditAction>({
				actor,
				storage,
				metadata: {
					endpoint: endpoint.route,
					method: endpoint.method,
				},
			});
		}

		// Process each declarative audit
		if (audits?.length) {
			for (const audit of audits) {
				logger.debug({ audit: audit.type }, 'Processing declarative audit');

				// Check when condition
				if (audit.when && !audit.when(response as any)) {
					logger.debug(
						{ audit: audit.type },
						'Audit skipped due to when condition',
					);
					continue;
				}

				// Extract payload
				const payload = audit.payload(response as any);

				// Extract entityId if configured
				const entityId = audit.entityId?.(response as any);

				// Record the audit
				auditor.audit(audit.type as any, payload as any, {
					table: audit.table,
					entityId,
				});
			}
		}

		// Flush audits to storage
		// Note: If existingAuditor has a stored transaction (via setTransaction),
		// flush() will use it automatically
		const recordCount = auditor.getRecords().length;
		if (recordCount > 0) {
			// Check if auditor has a stored transaction (for logging purposes)
			const trx =
				'getTransaction' in auditor
					? (auditor as { getTransaction(): unknown }).getTransaction()
					: undefined;
			logger.debug(
				{ auditCount: recordCount, hasTransaction: !!trx },
				'Flushing audits',
			);
			await auditor.flush();
		}
	} catch (error) {
		logger.error(error as Error, 'Failed to process audits');
		// Don't rethrow - audit failures shouldn't fail the request
	}
}

/**
 * Context for audit-aware handler execution.
 */
export interface AuditExecutionContext<
	TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
		string,
		unknown
	>,
> {
	/** The auditor instance for recording audits */
	auditor: Auditor<TAuditAction>;
	/** The audit storage instance */
	storage: AuditStorage;
}

/**
 * Create audit context for handler execution.
 * Returns the auditor and storage for use in the handler.
 *
 * @param endpoint - The endpoint with audit configuration
 * @param serviceDiscovery - Service discovery for getting audit storage
 * @param logger - Logger for debug/error messages
 * @param ctx - Request context for actor extraction
 * @returns Audit context with auditor and storage, or undefined if not configured
 */
export async function createAuditContext<
	TServices extends Service[] = [],
	TSession = unknown,
	TLogger extends Logger = Logger,
	TAuditStorage extends AuditStorage | undefined = undefined,
	TAuditStorageServiceName extends string = string,
	TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
		string,
		unknown
	>,
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
>(
	endpoint: Endpoint<
		any,
		any,
		any,
		any,
		TServices,
		TLogger,
		TSession,
		any,
		any,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	>,
	serviceDiscovery: ServiceDiscovery<any>,
	logger: TLogger,
	ctx: {
		session: TSession;
		header: HeaderFn;
		cookie: CookieFn;
		services: Record<string, unknown>;
	},
): Promise<AuditExecutionContext<TAuditAction> | undefined> {
	if (!endpoint.auditorStorageService) {
		return undefined;
	}

	const services = await serviceDiscovery.register([
		endpoint.auditorStorageService,
	]);
	const storage = services[
		endpoint.auditorStorageService.serviceName
	] as AuditStorage;

	// Extract actor if configured
	let actor: AuditActor = { id: 'system', type: 'system' };
	if (endpoint.actorExtractor) {
		try {
			actor = await (
				endpoint.actorExtractor as ActorExtractor<TServices, TSession, TLogger>
			)({
				services: ctx.services as any,
				session: ctx.session,
				header: ctx.header,
				cookie: ctx.cookie,
				logger,
			});
		} catch (error) {
			logger.error(error as Error, 'Failed to extract actor for audits');
		}
	}

	const auditor = new DefaultAuditor<TAuditAction>({
		actor,
		storage,
		metadata: {
			endpoint: endpoint.route,
			method: endpoint.method,
		},
	});

	return { auditor, storage };
}

/**
 * Options for executeWithAuditTransaction.
 */
export interface ExecuteWithAuditTransactionOptions {
	/**
	 * Database connection to use for the transaction.
	 * If this is already a transaction, it will be reused instead of creating a nested one.
	 * If not provided, the storage's internal database is used.
	 */
	db?: unknown;
}

/**
 * Execute a handler with automatic audit transaction support.
 * If the audit storage provides a withTransaction method, wraps execution
 * in a transaction so audits are atomic with handler's database operations.
 *
 * This is database-agnostic - each storage implementation provides its own
 * transaction handling based on the underlying database (Kysely, Drizzle, etc.).
 *
 * If the db parameter is provided and is already a transaction, the storage
 * will reuse it instead of creating a nested transaction (similar to
 * packages/db/src/kysely.ts#withTransaction).
 *
 * @param auditContext - The audit context from createAuditContext
 * @param handler - The handler function to execute (receives auditor)
 * @param onComplete - Called after handler with response, to process declarative audits
 * @param options - Optional configuration including database connection
 * @returns The handler result
 */
export async function executeWithAuditTransaction<
	T,
	TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
		string,
		unknown
	>,
>(
	auditContext: AuditExecutionContext<TAuditAction> | undefined,
	handler: (auditor?: Auditor<TAuditAction>) => Promise<T>,
	onComplete?: (response: T, auditor: Auditor<TAuditAction>) => Promise<void>,
	options?: ExecuteWithAuditTransactionOptions,
): Promise<T> {
	// No audit context - just run handler
	if (!auditContext) {
		return handler(undefined);
	}

	const { auditor, storage } = auditContext;

	// Check if storage provides a transaction wrapper
	if (storage.withTransaction) {
		// Wrap in transaction - audits are atomic with handler operations
		// The storage's withTransaction handles setTransaction and flush
		// Pass db so existing transactions are reused
		return storage.withTransaction(
			auditor,
			async () => {
				const response = await handler(auditor);

				// Process declarative audits within the transaction
				if (onComplete) {
					await onComplete(response, auditor);
				}

				return response;
			},
			options?.db,
		);
	}

	// No transaction support - run handler and flush audits after
	const response = await handler(auditor);

	if (onComplete) {
		await onComplete(response, auditor);
	}

	// Flush audits (no transaction)
	await auditor.flush();

	return response;
}
