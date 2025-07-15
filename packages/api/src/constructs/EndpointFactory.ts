import uniqBy from 'lodash.uniqby';
import { ConsoleLogger, type Logger } from '../logger';
import type { HermodServiceConstructor } from '../services';
import type { AuthorizeFn, SessionFn } from './Endpoint';
import { EndpointBuilder } from './EndpointBuilder';
import type { HttpMethod } from './types';

const DEFAULT_LOGGER = new ConsoleLogger() as any;

export class EndpointFactory<
  TServices extends HermodServiceConstructor[] = [],
  TBasePath extends string = '',
  TLogger extends Logger = ConsoleLogger,
  TSession = unknown,
> {
  // @ts-ignore
  private defaultServices: TServices;
  private basePath: TBasePath = '' as TBasePath;
  private defaultAuthorizeFn?: AuthorizeFn<TServices, TLogger, TSession>;

  private defaultSessionExtractor?: SessionFn<TServices, TLogger, TSession>;
  private defaultLogger: TLogger = DEFAULT_LOGGER;
  constructor({
    basePath,
    defaultAuthorizeFn,
    defaultLogger,
    defaultSessionExtractor,
    // @ts-ignore
    defaultServices = [] as TServices,
  }: EndpointFactoryOptions<TServices, TBasePath, TLogger, TSession> = {}) {
    // Initialize default services
    this.defaultServices = uniqBy(
      defaultServices,
      (s) => s.serviceName,
    ) as TServices;

    this.basePath = basePath || ('' as TBasePath);
    this.defaultAuthorizeFn = defaultAuthorizeFn;
    this.defaultLogger = defaultLogger || (DEFAULT_LOGGER as TLogger);
    this.defaultSessionExtractor = defaultSessionExtractor;
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

  // Create a sub-router with a path prefix
  route<TPath extends string>(
    path: TPath,
  ): EndpointFactory<
    TServices,
    JoinPaths<TBasePath, TPath>,
    TLogger,
    TSession
  > {
    const newBasePath = EndpointFactory.joinPaths(path, this.basePath);
    return new EndpointFactory({
      defaultServices: this.defaultServices,
      basePath: newBasePath,
      defaultAuthorizeFn: this.defaultAuthorizeFn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: this.defaultSessionExtractor,
    });
  }

  // Create a new factory with authorization
  authorize(
    fn: AuthorizeFn<TServices, TLogger>,
  ): EndpointFactory<TServices, TBasePath, TLogger, TSession> {
    return new EndpointFactory({
      defaultServices: this.defaultServices,
      basePath: this.basePath,
      defaultAuthorizeFn: fn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: this.defaultSessionExtractor,
    });
  }

  // Create a new factory with services
  services<S extends HermodServiceConstructor[]>(
    services: S,
  ): EndpointFactory<[...S, ...TServices], TBasePath, TLogger, TSession> {
    return new EndpointFactory<
      [...S, ...TServices],
      TBasePath,
      TLogger,
      TSession
    >({
      defaultServices: [...services, ...this.defaultServices],
      basePath: this.basePath,
      defaultAuthorizeFn: this.defaultAuthorizeFn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: this.defaultSessionExtractor,
    });
  }

  logger<L extends Logger>(
    logger: L,
  ): EndpointFactory<TServices, TBasePath, L, TSession> {
    return new EndpointFactory<TServices, TBasePath, L, TSession>({
      defaultServices: this.defaultServices,
      basePath: this.basePath,
      defaultAuthorizeFn: this.defaultAuthorizeFn,
      defaultLogger: logger,
      defaultSessionExtractor: this.defaultSessionExtractor,
    } as EndpointFactoryOptions<TServices, TBasePath, L, TSession>);
  }

  session<T>(session: SessionFn<TServices, TLogger, T>) {
    return new EndpointFactory<TServices, TBasePath, TLogger, T>({
      defaultServices: this.defaultServices,
      basePath: this.basePath,
      // @ts-ignore
      defaultAuthorizeFn: this.defaultAuthorizeFn,
      defaultLogger: this.defaultLogger,
      defaultSessionExtractor: session,
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
    TSession
  > {
    const fullPath = EndpointFactory.joinPaths(path, this.basePath);
    const builder = new EndpointBuilder<
      JoinPaths<TBasePath, TPath>,
      TMethod,
      {},
      TServices,
      TLogger,
      undefined,
      TSession
    >(fullPath, method);

    if (this.defaultAuthorizeFn) {
      // @ts-ignore
      builder._authorize = this.defaultAuthorizeFn;
    }
    if (this.defaultServices.length) {
      builder._services = this.defaultServices as TServices;
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

    return builder as unknown as EndpointBuilder<
      JoinPaths<TBasePath, TPath>,
      TMethod,
      {},
      TServices,
      TLogger,
      undefined,
      TSession
    >;
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
  TServices extends HermodServiceConstructor[] = [],
  TBasePath extends string = '',
  TLogger extends Logger = ConsoleLogger,
  TSession = unknown,
> {
  defaultServices?: TServices;
  basePath?: TBasePath;
  defaultAuthorizeFn?: AuthorizeFn<TServices, TLogger, TSession>;
  defaultLogger?: TLogger;
  defaultSessionExtractor?: SessionFn<TServices, TLogger, TSession>;
}

export const e = new EndpointFactory();
