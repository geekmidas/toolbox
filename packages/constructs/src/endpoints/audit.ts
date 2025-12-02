import type {
  AuditableAction,
  AuditActor,
  AuditStorage,
  ExtractAuditPayload,
  ExtractAuditType,
} from '@geekmidas/audit';
import type { Logger } from '@geekmidas/logger';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { CookieFn, HeaderFn } from './Endpoint';

/**
 * Defines how to map an endpoint response to an audit record.
 * Similar to MappedEvent for events.
 *
 * @template TAuditAction - Union of all allowed audit action types
 * @template TOutput - The output schema of the endpoint
 */
export interface MappedAudit<
  TAuditAction extends AuditableAction<string, unknown>,
  TOutput extends StandardSchemaV1 | undefined,
  TType extends ExtractAuditType<TAuditAction> = ExtractAuditType<TAuditAction>,
> {
  /** The audit type (must be a valid type from TAuditAction) */
  type: TType;
  /** Function to extract payload from the endpoint response */
  payload: (
    response: TOutput extends StandardSchemaV1
      ? InferStandardSchema<TOutput>
      : unknown,
  ) => ExtractAuditPayload<TAuditAction, TType>;
  /** Optional condition to determine if audit should be recorded */
  when?: (
    response: TOutput extends StandardSchemaV1
      ? InferStandardSchema<TOutput>
      : unknown,
  ) => boolean;
  /** Optional function to extract entity ID for easier querying */
  entityId?: (
    response: TOutput extends StandardSchemaV1
      ? InferStandardSchema<TOutput>
      : unknown,
  ) => string | Record<string, unknown>;
  /** Optional table name for the audit record */
  table?: string;
}

/**
 * Function type for extracting actor information from request context.
 *
 * @template TServices - Available service dependencies
 * @template TSession - Session data type
 * @template TLogger - Logger type
 */
export type ActorExtractor<
  TServices extends Service[] = [],
  TSession = unknown,
  TLogger extends Logger = Logger,
> = (ctx: {
  services: ServiceRecord<TServices>;
  session: TSession;
  header: HeaderFn;
  cookie: CookieFn;
  logger: TLogger;
}) => AuditActor | Promise<AuditActor>;

/**
 * Configuration for the auditor on an endpoint.
 */
export interface EndpointAuditorConfig<
  TAuditStorage extends AuditStorage,
  TAuditStorageServiceName extends string,
  TServices extends Service[],
  TSession,
  TLogger extends Logger,
  TAuditAction extends AuditableAction<string, unknown>,
  TOutput extends StandardSchemaV1 | undefined,
> {
  /** The audit storage service */
  storageService: Service<TAuditStorageServiceName, TAuditStorage>;
  /** Optional actor extractor function */
  actorExtractor?: ActorExtractor<TServices, TSession, TLogger>;
  /** Declarative audit definitions */
  audits: MappedAudit<TAuditAction, TOutput>[];
}
