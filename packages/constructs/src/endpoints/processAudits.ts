import type {
  AuditableAction,
  AuditActor,
  AuditStorage,
} from '@geekmidas/audit';
import { DefaultAuditor } from '@geekmidas/audit';
import type { Logger } from '@geekmidas/logger';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceDiscovery } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Endpoint, CookieFn, HeaderFn } from './Endpoint';
import type { ActorExtractor, MappedAudit } from './audit';

/**
 * Process declarative audit definitions after successful endpoint execution.
 * Similar to publishConstructEvents for events.
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
  serviceDiscovery: ServiceDiscovery<any, any>,
  logger: TLogger,
  ctx: {
    session: TSession;
    header: HeaderFn;
    cookie: CookieFn;
    services: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const audits = endpoint.audits as MappedAudit<TAuditAction, OutSchema>[];

    // Skip if no audits or no storage configured
    if (!audits?.length) {
      logger.debug('No declarative audits to process');
      return;
    }

    if (!endpoint.auditorStorageService) {
      logger.warn('No auditor storage service available');
      return;
    }

    // Get the audit storage service
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
        // Continue with system actor
      }
    }

    // Create auditor with extracted actor
    const auditor = new DefaultAuditor<TAuditAction>({
      actor,
      storage,
      metadata: {
        endpoint: endpoint.route,
        method: endpoint.method,
      },
    });

    // Process each declarative audit
    for (const audit of audits) {
      logger.debug({ audit: audit.type }, 'Processing audit');

      // Check when condition
      if (audit.when && !audit.when(response)) {
        logger.debug({ audit: audit.type }, 'Audit skipped due to when condition');
        continue;
      }

      // Extract payload
      const payload = audit.payload(response);

      // Extract entityId if configured
      const entityId = audit.entityId?.(response);

      // Record the audit
      auditor.audit(audit.type as any, payload as any, {
        table: audit.table,
        entityId,
      });
    }

    // Flush audits to storage
    const recordCount = auditor.getRecords().length;
    if (recordCount > 0) {
      logger.debug({ auditCount: recordCount }, 'Flushing audits');
      await auditor.flush();
    }
  } catch (error) {
    logger.error(error as Error, 'Failed to process audits');
    // Don't rethrow - audit failures shouldn't fail the request
  }
}
