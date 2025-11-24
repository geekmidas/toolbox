import type { Logger } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import uniqBy from 'lodash.uniqby';
import type { Authorizer } from './Authorizer';
import type { AuthorizeFn, SessionFn } from './Endpoint';
import { EndpointBuilder } from './EndpointBuilder';

import type { EventPublisher, MappedEvent } from '@geekmidas/events';
import type { HttpMethod } from '../types';

const DEFAULT_LOGGER = new ConsoleLogger() as any;

export class EndpointFactory<
  TServices extends Service[] = [],
  TBasePath extends string = '',
  TLogger extends Logger = Logger,
  TSession = unknown,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TAuthorizers extends readonly string[] = readonly string[],
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
  }: EndpointFactoryOptions<
    TServices,
    TBasePath,
    TLogger,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuthorizers
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
    T
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
      T
    >({
      defaultServices: this.defaultServices,
      basePath: this.basePath,
      defaultAuthorizeFn: this.defaultAuthorizeFn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: this.defaultSessionExtractor,
      defaultEventPublisher: this.defaultEventPublisher,
      availableAuthorizers: authorizerConfigs,
      defaultAuthorizerName: this.defaultAuthorizerName,
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
    TAuthorizers
  > {
    const newBasePath = EndpointFactory.joinPaths(path, this.basePath);
    return new EndpointFactory<
      TServices,
      JoinPaths<TBasePath, TPath>,
      TLogger,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers
    >({
      defaultServices: this.defaultServices,
      basePath: newBasePath,
      defaultAuthorizeFn: this.defaultAuthorizeFn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: this.defaultSessionExtractor,
      defaultEventPublisher: this.defaultEventPublisher,
      availableAuthorizers: this.availableAuthorizers,
      defaultAuthorizerName: this.defaultAuthorizerName,
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
    TAuthorizers
  > {
    return new EndpointFactory<
      TServices,
      TBasePath,
      TLogger,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers
    >({
      defaultServices: this.defaultServices,
      basePath: this.basePath,
      defaultAuthorizeFn: fn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: this.defaultSessionExtractor,
      defaultEventPublisher: this.defaultEventPublisher,
      availableAuthorizers: this.availableAuthorizers,
      defaultAuthorizerName: this.defaultAuthorizerName,
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
    TAuthorizers
  > {
    return new EndpointFactory<
      [...S, ...TServices],
      TBasePath,
      TLogger,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers
    >({
      defaultServices: [...services, ...this.defaultServices],
      basePath: this.basePath,
      defaultAuthorizeFn: this.defaultAuthorizeFn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: this.defaultSessionExtractor,
      defaultEventPublisher: this.defaultEventPublisher,
      availableAuthorizers: this.availableAuthorizers,
      defaultAuthorizerName: this.defaultAuthorizerName,
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
    TAuthorizers
  > {
    return new EndpointFactory<
      TServices,
      TBasePath,
      L,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers
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
        .defaultSessionExtractor as unknown as SessionFn<TServices, L, TSession>,
      defaultEventPublisher: this.defaultEventPublisher,
      availableAuthorizers: this.availableAuthorizers,
      defaultAuthorizerName: this.defaultAuthorizerName,
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
    TAuthorizers
  > {
    return new EndpointFactory<
      TServices,
      TBasePath,
      TLogger,
      TSession,
      T,
      TServiceName,
      TAuthorizers
    >({
      defaultServices: this.defaultServices,
      basePath: this.basePath,
      defaultAuthorizeFn: this.defaultAuthorizeFn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: this.defaultSessionExtractor,
      defaultEventPublisher: publisher,
      availableAuthorizers: this.availableAuthorizers,
      defaultAuthorizerName: this.defaultAuthorizerName,
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
    TAuthorizers
  > {
    return new EndpointFactory<
      TServices,
      TBasePath,
      TLogger,
      T,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuthorizers
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
    TAuthorizers
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
      TAuthorizers
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
}

export const e = new EndpointFactory();
