import type {
  AuditStorage,
  AuditableAction,
  ExtractStorageAuditAction,
} from '@geekmidas/audit';
import type { EventPublisher, MappedEvent } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { RateLimitConfig } from '@geekmidas/rate-limit';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import uniqBy from 'lodash.uniqby';
import { ConstructType } from '../Construct';
import { BaseFunctionBuilder } from '../functions';
import type { HttpMethod } from '../types';
import type { Authorizer } from './Authorizer';
import { Endpoint, type EndpointSchemas } from './Endpoint';
import type {
  AuthorizeFn,
  EndpointHandler,
  SessionFn,
  SuccessStatus,
} from './Endpoint';
import type { ActorExtractor, MappedAudit } from './audit';

export class EndpointBuilder<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TSession = unknown,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TAuthorizers extends readonly string[] = readonly string[],
  TAuditStorage extends AuditStorage | undefined = undefined,
  TAuditStorageServiceName extends string = string,
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
  TDatabase = undefined,
  TDatabaseServiceName extends string = string,
> extends BaseFunctionBuilder<
  TInput,
  OutSchema,
  TServices,
  TLogger,
  TEventPublisher,
  TEventPublisherServiceName,
  TAuditStorage,
  TAuditStorageServiceName,
  TDatabase,
  TDatabaseServiceName
> {
  protected schemas: TInput = {} as TInput;
  protected _description?: string;
  protected _status?: SuccessStatus;
  protected _tags?: string[];
  protected _memorySize?: number;
  _getSession: SessionFn<TServices, TLogger, TSession, TDatabase> = () =>
    ({}) as TSession;
  _authorize: AuthorizeFn<TServices, TLogger, TSession> = () => true;
  _rateLimit?: RateLimitConfig;
  _availableAuthorizers: Authorizer[] = [];
  _authorizerName?: TAuthorizers[number];
  _actorExtractor?: ActorExtractor<TServices, TSession, TLogger>;
  _audits: MappedAudit<TAuditAction, OutSchema>[] = [];

  constructor(
    readonly route: TRoute,
    readonly method: TMethod,
  ) {
    super(ConstructType.Endpoint);
  }

  // Internal setter for EndpointFactory to set default publisher
  _setPublisher(
    publisher: Service<TEventPublisherServiceName, TEventPublisher>,
  ) {
    this._publisher = publisher;
  }

  // Internal setter for EndpointFactory to set default auditor storage
  _setAuditorStorage(
    storage: Service<TAuditStorageServiceName, TAuditStorage>,
  ) {
    this._auditorStorage = storage;
  }

  // Internal setter for EndpointFactory to set default database service
  _setDatabaseService(service: Service<TDatabaseServiceName, TDatabase>) {
    this._databaseService = service;
  }

  description(description: string): this {
    this._description = description;
    return this;
  }

  status(status: SuccessStatus): this {
    this._status = status;
    return this;
  }

  event<TEvent extends MappedEvent<TEventPublisher, OutSchema>>(
    event: TEvent,
  ): this {
    this._events.push(event);
    return this;
  }

  tags(tags: string[]): this {
    this._tags = tags;
    return this;
  }

  memorySize(memorySize: number): this {
    this._memorySize = memorySize;
    return this;
  }

  publisher<T extends EventPublisher<any>, TName extends string>(
    publisher: Service<TName, T>,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    TInput,
    TServices,
    TLogger,
    OutSchema,
    TSession,
    T,
    TName,
    TAuthorizers,
    TAuditStorage,
    TAuditStorageServiceName,
    TAuditAction,
    TDatabase,
    TDatabaseServiceName
  > {
    this._publisher = publisher as unknown as Service<
      TEventPublisherServiceName,
      TEventPublisher
    >;

    return this as unknown as EndpointBuilder<
      TRoute,
      TMethod,
      TInput,
      TServices,
      TLogger,
      OutSchema,
      TSession,
      T,
      TName,
      TAuthorizers,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >;
  }

  body<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    Omit<TInput, 'body'> & { body: T },
    TServices,
    TLogger,
    OutSchema,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuthorizers,
    TAuditStorage,
    TAuditStorageServiceName,
    TAuditAction,
    TDatabase,
    TDatabaseServiceName
  > {
    this.schemas.body = schema as unknown as T;
    // @ts-ignore
    return this;
  }

  search<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    Omit<TInput, 'query'> & { query: T },
    TServices,
    TLogger,
    OutSchema,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuthorizers,
    TAuditStorage,
    TAuditStorageServiceName,
    TAuditAction,
    TDatabase,
    TDatabaseServiceName
  > {
    this.schemas.query = schema as unknown as T;
    // @ts-ignore
    return this;
  }

  query<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    Omit<TInput, 'query'> & { query: T },
    TServices,
    TLogger,
    OutSchema,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuthorizers,
    TAuditStorage,
    TAuditStorageServiceName,
    TAuditAction,
    TDatabase,
    TDatabaseServiceName
  > {
    return this.search(schema);
  }

  params<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    Omit<TInput, 'params'> & { params: T },
    TServices,
    TLogger,
    OutSchema,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuthorizers,
    TAuditStorage,
    TAuditStorageServiceName,
    TAuditAction,
    TDatabase,
    TDatabaseServiceName
  > {
    this.schemas.params = schema as unknown as T;
    // @ts-ignore
    return this;
  }

  rateLimit(config: RateLimitConfig): this {
    this._rateLimit = config;
    return this;
  }

  authorizer(
    name: TAuthorizers[number] | 'none',
  ): EndpointBuilder<
    TRoute,
    TMethod,
    TInput,
    TServices,
    TLogger,
    OutSchema,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuthorizers,
    TAuditStorage,
    TAuditStorageServiceName,
    TAuditAction,
    TDatabase,
    TDatabaseServiceName
  > {
    // Special case: 'none' explicitly marks endpoint as having no authorizer
    if (name === 'none') {
      this._authorizerName = undefined;
      return this;
    }

    // Validate that the authorizer exists in available authorizers
    const authorizerExists = this._availableAuthorizers.some(
      (a) => a.name === name,
    );
    if (!authorizerExists && this._availableAuthorizers.length > 0) {
      const available = this._availableAuthorizers
        .map((a) => a.name)
        .join(', ');
      throw new Error(
        `Authorizer "${name as string}" not found in available authorizers: ${available}`,
      );
    }
    this._authorizerName = name;
    return this;
  }

  services<T extends Service[]>(
    services: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    TInput,
    [...TServices, ...T],
    TLogger,
    OutSchema,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuthorizers,
    TAuditStorage,
    TAuditStorageServiceName,
    TAuditAction,
    TDatabase,
    TDatabaseServiceName
  > {
    this._services = uniqBy(
      [...this._services, ...services],
      (s) => s.serviceName,
    ) as TServices;

    return this as unknown as EndpointBuilder<
      TRoute,
      TMethod,
      TInput,
      [...TServices, ...T],
      TLogger,
      OutSchema,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >;
  }

  logger<T extends Logger>(
    logger: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    TInput,
    TServices,
    T,
    OutSchema,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuthorizers,
    TAuditStorage,
    TAuditStorageServiceName,
    TAuditAction,
    TDatabase,
    TDatabaseServiceName
  > {
    this._logger = logger as unknown as TLogger;

    return this as unknown as EndpointBuilder<
      TRoute,
      TMethod,
      TInput,
      TServices,
      T,
      OutSchema,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >;
  }

  output<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    TInput,
    TServices,
    TLogger,
    T,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuthorizers,
    TAuditStorage,
    TAuditStorageServiceName,
    TAuditAction,
    TDatabase,
    TDatabaseServiceName
  > {
    this.outputSchema = schema as unknown as OutSchema;

    return this as unknown as EndpointBuilder<
      TRoute,
      TMethod,
      TInput,
      TServices,
      TLogger,
      T,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >;
  }

  /**
   * Set the auditor storage service for this endpoint.
   * This enables audit functionality and makes `auditor` available in the handler context.
   * The audit action type is automatically inferred from the storage's generic parameter.
   */
  auditor<T extends AuditStorage<any>, TName extends string>(
    storage: Service<TName, T>,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    TInput,
    TServices,
    TLogger,
    OutSchema,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuthorizers,
    T,
    TName,
    ExtractStorageAuditAction<T>,
    TDatabase,
    TDatabaseServiceName
  > {
    this._auditorStorage = storage as unknown as Service<
      TAuditStorageServiceName,
      TAuditStorage
    >;

    return this as unknown as EndpointBuilder<
      TRoute,
      TMethod,
      TInput,
      TServices,
      TLogger,
      OutSchema,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers,
      T,
      TName,
      ExtractStorageAuditAction<T>,
      TDatabase,
      TDatabaseServiceName
    >;
  }

  /**
   * Set the actor extractor function for audit records.
   * The actor is extracted from the request context and attached to all audits.
   */
  actor(
    extractor: ActorExtractor<TServices, TSession, TLogger>,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    TInput,
    TServices,
    TLogger,
    OutSchema,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuthorizers,
    TAuditStorage,
    TAuditStorageServiceName,
    TAuditAction,
    TDatabase,
    TDatabaseServiceName
  > {
    this._actorExtractor = extractor;
    return this;
  }

  /**
   * Add declarative audit definitions that are processed after the handler executes.
   * Similar to `.event()` for events, but for audits.
   *
   * @example
   * ```typescript
   * .audit<AppAuditAction>([
   *   {
   *     type: 'user.created',
   *     payload: (response) => ({ userId: response.id, email: response.email }),
   *     when: (response) => response.active,
   *     entityId: (response) => response.id,
   *     table: 'users',
   *   },
   * ])
   * ```
   */
  audit(audits: MappedAudit<TAuditAction, OutSchema>[]): this {
    this._audits = audits;
    return this;
  }

  /**
   * Set the database service for this endpoint.
   * The database will be available in the handler context as `db`.
   * When audit storage is configured and uses the same database,
   * `db` will automatically be the transaction for ACID compliance.
   *
   * @example
   * ```typescript
   * .database(databaseService)
   * .handle(async ({ db }) => {
   *   // db is the raw database or transaction (when auditor uses same db)
   *   return await db.selectFrom('users').selectAll().execute();
   * })
   * ```
   */
  database<T, TName extends string>(
    service: Service<TName, T>,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    TInput,
    TServices,
    TLogger,
    OutSchema,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuthorizers,
    TAuditStorage,
    TAuditStorageServiceName,
    TAuditAction,
    T,
    TName
  > {
    this._databaseService = service as unknown as Service<
      TDatabaseServiceName,
      TDatabase
    >;

    return this as unknown as EndpointBuilder<
      TRoute,
      TMethod,
      TInput,
      TServices,
      TLogger,
      OutSchema,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      T,
      TName
    >;
  }

  // EndpointBuilder doesn't have a generic input method - it uses body, query, params instead
  input(_schema: any): any {
    throw new Error(
      'EndpointBuilder does not support generic input. Use body(), query(), or params() instead.',
    );
  }

  handle(
    fn: EndpointHandler<
      TInput,
      TServices,
      TLogger,
      OutSchema,
      TSession,
      TDatabase,
      TAuditStorage,
      TAuditAction
    >,
  ): Endpoint<
    TRoute,
    TMethod,
    TInput,
    OutSchema,
    TServices,
    TLogger,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuditStorage,
    TAuditStorageServiceName,
    TAuditAction,
    TDatabase,
    TDatabaseServiceName
  > {
    // Find authorizer metadata if name is set
    // If the authorizer name is set but not in availableAuthorizers, create a simple authorizer object
    const authorizer = this._authorizerName
      ? this._availableAuthorizers.find((a) => a.name === this._authorizerName) ??
        { name: this._authorizerName }
      : undefined;

    return new Endpoint({
      fn,
      method: this.method,
      route: this.route,
      description: this._description,
      tags: this._tags,
      input: this.schemas,
      output: this.outputSchema,
      services: this._services,
      logger: this._logger,
      timeout: this._timeout,
      memorySize: this._memorySize,
      authorize: this._authorize,
      status: this._status,
      getSession: this._getSession,
      rateLimit: this._rateLimit,
      publisherService: this._publisher,
      events: this._events,
      authorizer,
      auditorStorageService: this._auditorStorage,
      actorExtractor: this._actorExtractor,
      audits: this._audits,
      databaseService: this._databaseService,
    });
  }
}
