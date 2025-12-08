import type {
  AuditStorage,
  AuditableAction,
  ExtractStorageAuditAction,
} from '@geekmidas/audit';
import type { EventPublisher, MappedEvent } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import uniqBy from 'lodash.uniqby';
import type { HttpMethod } from '../types';
import type { Authorizer } from './Authorizer';
import type { AuthorizeFn, SessionFn } from './Endpoint';
import { EndpointBuilder } from './EndpointBuilder';
import type { ActorExtractor } from './audit';

const DEFAULT_LOGGER = new ConsoleLogger() as any;

export class EndpointFactory<
  TServices extends Service[] = [],
  TBasePath extends string = '',
  TLogger extends Logger = Logger,
  TSession = unknown,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TAuthorizers extends readonly string[] = readonly string[],
  TAuditStorage extends AuditStorage<any> | undefined = undefined,
  TAuditStorageServiceName extends string = string,
  TAuditAction extends AuditableAction<
    string,
    unknown
  > = ExtractStorageAuditAction<NonNullable<TAuditStorage>>,
  TDatabase = undefined,
  TDatabaseServiceName extends string = string,
> {
  // @ts-ignore
  private defaultServices: TServices;
  private basePath: TBasePath = '' as TBasePath;
  private defaultAuthorizeFn?: AuthorizeFn<TServices, TLogger, TSession>;
  private defaultEventPublisher:
    | Service<TEventPublisherServiceName, TEventPublisher>
    | undefined;
  private defaultSessionExtractor?: SessionFn<TServices, TLogger, TSession>;
  private defaultLogger: TLogger = DEFAULT_LOGGER;
  private availableAuthorizers: Authorizer[] = [];
  private defaultAuthorizerName?: TAuthorizers[number];
  private defaultAuditorStorage:
    | Service<TAuditStorageServiceName, TAuditStorage>
    | undefined;
  private defaultDatabaseService:
    | Service<TDatabaseServiceName, TDatabase>
    | undefined;
  private defaultActorExtractor?: ActorExtractor<TServices, TSession, TLogger>;

  constructor({
    basePath,
    defaultAuthorizeFn,
    defaultLogger,
    defaultSessionExtractor,
    // @ts-ignore
    defaultServices = [] as TServices,
    defaultEventPublisher,
    availableAuthorizers = [],
    defaultAuthorizerName,
    defaultAuditorStorage,
    defaultDatabaseService,
    defaultActorExtractor,
  }: EndpointFactoryOptions<
    TServices,
    TBasePath,
    TLogger,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuthorizers,
    TAuditStorage,
    TAuditStorageServiceName,
    TDatabase,
    TDatabaseServiceName
  > = {}) {
    // Initialize default services
    this.defaultServices = uniqBy(
      defaultServices,
      (s) => s.serviceName,
    ) as TServices;

    this.basePath = basePath || ('' as TBasePath);
    this.defaultAuthorizeFn = defaultAuthorizeFn;
    this.defaultLogger = defaultLogger || (DEFAULT_LOGGER as TLogger);
    this.defaultSessionExtractor = defaultSessionExtractor;
    this.defaultEventPublisher = defaultEventPublisher;
    this.availableAuthorizers = availableAuthorizers;
    this.defaultAuthorizerName = defaultAuthorizerName;
    this.defaultAuditorStorage = defaultAuditorStorage;
    this.defaultDatabaseService = defaultDatabaseService;
    this.defaultActorExtractor = defaultActorExtractor;
  }

  static joinPaths<TBasePath extends string, P extends string>(
    path: P,
    basePath: TBasePath = '' as TBasePath,
  ): JoinPaths<TBasePath, P> {
    // Handle empty cases
    if (!basePath && !path) return '/' as JoinPaths<TBasePath, P>;
    if (!basePath)
      return (path.startsWith('/') ? path : '/' + path) as JoinPaths<
        TBasePath,
        P
      >;
    if (!path)
      return (
        basePath.startsWith('/') ? basePath : '/' + basePath
      ) as JoinPaths<TBasePath, P>;

    const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
    const segment = path.startsWith('/') ? path : '/' + path;

    let result = base + segment;

    // Ensure leading slash
    if (!result.startsWith('/')) {
      result = '/' + result;
    }

    // Normalize multiple slashes (except in the middle of the path where they might be intentional)
    result = result.replace(/^\/+/g, '/');

    // Remove trailing slash unless it's the root path "/"
    if (result.length > 1 && result.endsWith('/')) {
      result = result.slice(0, -1);
    }

    return result as JoinPaths<TBasePath, P>;
  }

  // Configure available authorizers
  authorizers<const T extends readonly string[]>(
    authorizers: T,
  ): EndpointFactory<
    TServices,
    TBasePath,
    TLogger,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName,
    T,
    TAuditStorage,
    TAuditStorageServiceName,
    TAuditAction,
    TDatabase,
    TDatabaseServiceName
  > {
    const authorizerConfigs = authorizers.map((name) => ({
      name,
    }));
    return new EndpointFactory<
      TServices,
      TBasePath,
      TLogger,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      T,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >({
      defaultServices: this.defaultServices,
      basePath: this.basePath,
      defaultAuthorizeFn: this.defaultAuthorizeFn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: this.defaultSessionExtractor,
      defaultEventPublisher: this.defaultEventPublisher,
      availableAuthorizers: authorizerConfigs,
      defaultAuthorizerName: this.defaultAuthorizerName,
      defaultAuditorStorage: this.defaultAuditorStorage,
      defaultDatabaseService: this.defaultDatabaseService,
      defaultActorExtractor: this.defaultActorExtractor,
    });
  }

  // Create a sub-router with a path prefix
  route<TPath extends string>(
    path: TPath,
  ): EndpointFactory<
    TServices,
    JoinPaths<TBasePath, TPath>,
    TLogger,
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
    const newBasePath = EndpointFactory.joinPaths(path, this.basePath);
    return new EndpointFactory<
      TServices,
      JoinPaths<TBasePath, TPath>,
      TLogger,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >({
      defaultServices: this.defaultServices,
      basePath: newBasePath,
      defaultAuthorizeFn: this.defaultAuthorizeFn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: this.defaultSessionExtractor,
      defaultEventPublisher: this.defaultEventPublisher,
      availableAuthorizers: this.availableAuthorizers,
      defaultAuthorizerName: this.defaultAuthorizerName,
      defaultAuditorStorage: this.defaultAuditorStorage,
      defaultDatabaseService: this.defaultDatabaseService,
      defaultActorExtractor: this.defaultActorExtractor,
    });
  }

  // Create a new factory with authorization
  authorize(
    fn: AuthorizeFn<TServices, TLogger, TSession>,
  ): EndpointFactory<
    TServices,
    TBasePath,
    TLogger,
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
    return new EndpointFactory<
      TServices,
      TBasePath,
      TLogger,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >({
      defaultServices: this.defaultServices,
      basePath: this.basePath,
      defaultAuthorizeFn: fn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: this.defaultSessionExtractor,
      defaultEventPublisher: this.defaultEventPublisher,
      availableAuthorizers: this.availableAuthorizers,
      defaultAuthorizerName: this.defaultAuthorizerName,
      defaultAuditorStorage: this.defaultAuditorStorage,
      defaultDatabaseService: this.defaultDatabaseService,
      defaultActorExtractor: this.defaultActorExtractor,
    });
  }

  // Create a new factory with services
  services<S extends Service[]>(
    services: S,
  ): EndpointFactory<
    [...S, ...TServices],
    TBasePath,
    TLogger,
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
    return new EndpointFactory<
      [...S, ...TServices],
      TBasePath,
      TLogger,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >({
      defaultServices: [...services, ...this.defaultServices],
      basePath: this.basePath,
      defaultAuthorizeFn: this.defaultAuthorizeFn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: this.defaultSessionExtractor,
      defaultEventPublisher: this.defaultEventPublisher,
      availableAuthorizers: this.availableAuthorizers,
      defaultAuthorizerName: this.defaultAuthorizerName,
      defaultAuditorStorage: this.defaultAuditorStorage,
      defaultDatabaseService: this.defaultDatabaseService,
      defaultActorExtractor: this.defaultActorExtractor,
    });
  }

  logger<L extends Logger>(
    logger: L,
  ): EndpointFactory<
    TServices,
    TBasePath,
    L,
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
    return new EndpointFactory<
      TServices,
      TBasePath,
      L,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >({
      defaultServices: this.defaultServices,
      basePath: this.basePath,
      defaultAuthorizeFn: this.defaultAuthorizeFn as unknown as AuthorizeFn<
        TServices,
        L,
        TSession
      >,
      defaultLogger: logger,
      defaultSessionExtractor: this
        .defaultSessionExtractor as unknown as SessionFn<
        TServices,
        L,
        TSession
      >,
      defaultEventPublisher: this.defaultEventPublisher,
      availableAuthorizers: this.availableAuthorizers,
      defaultAuthorizerName: this.defaultAuthorizerName,
      defaultAuditorStorage: this.defaultAuditorStorage,
      defaultDatabaseService: this.defaultDatabaseService,
      defaultActorExtractor: this
        .defaultActorExtractor as unknown as ActorExtractor<
        TServices,
        TSession,
        L
      >,
    });
  }

  publisher<
    T extends EventPublisher<any>,
    TServiceName extends string = string,
  >(
    publisher: Service<TServiceName, T>,
  ): EndpointFactory<
    TServices,
    TBasePath,
    TLogger,
    TSession,
    T,
    TServiceName,
    TAuthorizers,
    TAuditStorage,
    TAuditStorageServiceName,
    TAuditAction,
    TDatabase,
    TDatabaseServiceName
  > {
    return new EndpointFactory<
      TServices,
      TBasePath,
      TLogger,
      TSession,
      T,
      TServiceName,
      TAuthorizers,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >({
      defaultServices: this.defaultServices,
      basePath: this.basePath,
      defaultAuthorizeFn: this.defaultAuthorizeFn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: this.defaultSessionExtractor,
      defaultEventPublisher: publisher,
      availableAuthorizers: this.availableAuthorizers,
      defaultAuthorizerName: this.defaultAuthorizerName,
      defaultAuditorStorage: this.defaultAuditorStorage,
      defaultDatabaseService: this.defaultDatabaseService,
      defaultActorExtractor: this.defaultActorExtractor,
    });
  }

  session<T>(
    session: SessionFn<TServices, TLogger, T>,
  ): EndpointFactory<
    TServices,
    TBasePath,
    TLogger,
    T,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuthorizers,
    TAuditStorage,
    TAuditStorageServiceName,
    TAuditAction,
    TDatabase,
    TDatabaseServiceName
  > {
    return new EndpointFactory<
      TServices,
      TBasePath,
      TLogger,
      T,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >({
      defaultServices: this.defaultServices,
      basePath: this.basePath,
      defaultAuthorizeFn: this.defaultAuthorizeFn as unknown as AuthorizeFn<
        TServices,
        TLogger,
        T
      >,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: session,
      defaultEventPublisher: this.defaultEventPublisher,
      availableAuthorizers: this.availableAuthorizers,
      defaultAuthorizerName: this.defaultAuthorizerName,
      defaultAuditorStorage: this.defaultAuditorStorage,
      defaultDatabaseService: this.defaultDatabaseService,
      defaultActorExtractor: this
        .defaultActorExtractor as unknown as ActorExtractor<
        TServices,
        T,
        TLogger
      >,
    });
  }

  /**
   * Set the database service for endpoints created from this factory.
   * The database will be available in handler context as `db`.
   */
  database<T, TName extends string>(
    service: Service<TName, T>,
  ): EndpointFactory<
    TServices,
    TBasePath,
    TLogger,
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
    return new EndpointFactory<
      TServices,
      TBasePath,
      TLogger,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      T,
      TName
    >({
      defaultServices: this.defaultServices,
      basePath: this.basePath,
      defaultAuthorizeFn: this.defaultAuthorizeFn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: this.defaultSessionExtractor,
      defaultEventPublisher: this.defaultEventPublisher,
      availableAuthorizers: this.availableAuthorizers,
      defaultAuthorizerName: this.defaultAuthorizerName,
      defaultAuditorStorage: this.defaultAuditorStorage,
      defaultDatabaseService: service,
    });
  }

  /**
   * Set the auditor storage service for endpoints created from this factory.
   * This enables audit functionality and makes `auditor` available in handler context.
   * The audit action type is automatically inferred from the storage's generic parameter.
   */
  auditor<T extends AuditStorage<any>, TName extends string>(
    storage: Service<TName, T>,
  ): EndpointFactory<
    TServices,
    TBasePath,
    TLogger,
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
    return new EndpointFactory<
      TServices,
      TBasePath,
      TLogger,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers,
      T,
      TName,
      ExtractStorageAuditAction<T>,
      TDatabase,
      TDatabaseServiceName
    >({
      defaultServices: this.defaultServices,
      basePath: this.basePath,
      defaultAuthorizeFn: this.defaultAuthorizeFn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: this.defaultSessionExtractor,
      defaultEventPublisher: this.defaultEventPublisher,
      availableAuthorizers: this.availableAuthorizers,
      defaultAuthorizerName: this.defaultAuthorizerName,
      defaultAuditorStorage: storage,
      defaultDatabaseService: this.defaultDatabaseService,
      defaultActorExtractor: this
        .defaultActorExtractor as unknown as ActorExtractor<
        TServices,
        TSession,
        TLogger
      >,
    });
  }

  /**
   * Set the actor extractor function for endpoints created from this factory.
   * The actor is extracted from the request context and attached to all audits.
   */
  actor(
    extractor: ActorExtractor<TServices, TSession, TLogger>,
  ): EndpointFactory<
    TServices,
    TBasePath,
    TLogger,
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
    return new EndpointFactory<
      TServices,
      TBasePath,
      TLogger,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >({
      defaultServices: this.defaultServices,
      basePath: this.basePath,
      defaultAuthorizeFn: this.defaultAuthorizeFn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: this.defaultSessionExtractor,
      defaultEventPublisher: this.defaultEventPublisher,
      availableAuthorizers: this.availableAuthorizers,
      defaultAuthorizerName: this.defaultAuthorizerName,
      defaultAuditorStorage: this.defaultAuditorStorage,
      defaultDatabaseService: this.defaultDatabaseService,
      defaultActorExtractor: extractor,
    });
  }

  private createBuilder<TMethod extends HttpMethod, TPath extends string>(
    method: TMethod,
    path: TPath,
  ): EndpointBuilder<
    JoinPaths<TBasePath, TPath>,
    TMethod,
    {},
    TServices,
    TLogger,
    undefined,
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
    const fullPath = EndpointFactory.joinPaths(path, this.basePath);
    const builder = new EndpointBuilder<
      JoinPaths<TBasePath, TPath>,
      TMethod,
      {},
      TServices,
      TLogger,
      undefined,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers,
      TAuditStorage,
      TAuditStorageServiceName,
      TAuditAction,
      TDatabase,
      TDatabaseServiceName
    >(fullPath, method);

    if (this.defaultAuthorizeFn) {
      // @ts-ignore
      builder._authorize = this.defaultAuthorizeFn;
    }
    if (this.defaultServices.length) {
      // Create a copy to avoid sharing references between builders
      builder._services = [...this.defaultServices] as TServices;
    }

    if (this.defaultLogger) {
      builder._logger = this.defaultLogger as TLogger;
    }

    if (this.defaultSessionExtractor) {
      builder._getSession = this.defaultSessionExtractor as SessionFn<
        TServices,
        TLogger,
        TSession
      >;
    }

    if (this.defaultEventPublisher) {
      builder._setPublisher(this.defaultEventPublisher);
    }

    // Set available authorizers and default
    builder._availableAuthorizers = this.availableAuthorizers;
    if (this.defaultAuthorizerName) {
      builder._authorizerName = this.defaultAuthorizerName;
    }

    // Set auditor storage if configured
    if (this.defaultAuditorStorage) {
      builder._setAuditorStorage(this.defaultAuditorStorage as any);
    }

    // Set database service if configured
    if (this.defaultDatabaseService) {
      builder._setDatabaseService(this.defaultDatabaseService as any);
    }

    // Set actor extractor if configured
    if (this.defaultActorExtractor) {
      builder._actorExtractor = this.defaultActorExtractor;
    }

    return builder;
  }

  post<TPath extends string>(path: TPath) {
    return this.createBuilder('POST', path);
  }

  get<TPath extends string>(path: TPath) {
    return this.createBuilder('GET', path);
  }

  put<TPath extends string>(path: TPath) {
    return this.createBuilder('PUT', path);
  }

  delete<TPath extends string>(path: TPath) {
    return this.createBuilder('DELETE', path);
  }

  patch<TPath extends string>(path: TPath) {
    return this.createBuilder('PATCH', path);
  }

  options<TPath extends string>(path: TPath) {
    return this.createBuilder('OPTIONS', path);
  }
}

export type RemoveTrailingSlash<T extends string> = T extends `${infer Rest}/`
  ? Rest extends ''
    ? T // Keep "/" as is
    : Rest
  : T;

export type JoinPaths<
  TBasePath extends string,
  TPath extends string,
> = RemoveTrailingSlash<
  TBasePath extends ''
    ? TPath
    : TPath extends ''
      ? TBasePath
      : TBasePath extends '/'
        ? TPath extends `/${string}`
          ? TPath
          : `/${TPath}`
        : TBasePath extends `${infer Base}/`
          ? TPath extends `/${infer Rest}`
            ? `${Base}/${Rest}`
            : `${Base}/${TPath}`
          : TPath extends `/${infer Rest}`
            ? `${TBasePath}/${Rest}`
            : `${TBasePath}/${TPath}`
>;

export interface EndpointFactoryOptions<
  TServices extends Service[] = [],
  TBasePath extends string = '',
  TLogger extends Logger = Logger,
  TSession = unknown,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TAuthorizers extends readonly string[] = readonly string[],
  TAuditStorage extends AuditStorage | undefined = undefined,
  TAuditStorageServiceName extends string = string,
  TDatabase = undefined,
  TDatabaseServiceName extends string = string,
> {
  defaultServices?: TServices;
  basePath?: TBasePath;
  defaultAuthorizeFn?: AuthorizeFn<TServices, TLogger, TSession>;
  defaultLogger?: TLogger;
  defaultSessionExtractor?: SessionFn<TServices, TLogger, TSession>;
  defaultEventPublisher?: Service<TEventPublisherServiceName, TEventPublisher>;
  defaultEvents?: MappedEvent<TEventPublisher, undefined>[];
  availableAuthorizers?: Authorizer[];
  defaultAuthorizerName?: TAuthorizers[number];
  defaultAuditorStorage?: Service<TAuditStorageServiceName, TAuditStorage>;
  defaultDatabaseService?: Service<TDatabaseServiceName, TDatabase>;
  defaultActorExtractor?: ActorExtractor<TServices, TSession, TLogger>;
}

export const e = new EndpointFactory();
