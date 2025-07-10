import uniqBy from 'lodash.uniqby';
import { ConsoleLogger, type Logger } from '../logger';
import type { HermodServiceConstructor } from '../services';
import { EndpointBuilder } from './EndpointBuilder';
import type { FunctionContext } from './Function';
import type { HttpMethod } from './types';

const DEFAULT_LOGGER = new ConsoleLogger() as any;

export type SessionFn<
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
  TSession = unknown,
> = (
  ctx: FunctionContext<{}, TServices, TLogger>,
) => Promise<TSession> | TSession;

export class EndpointFactory<
  TServices extends HermodServiceConstructor[] = [],
  TBasePath extends string = '',
  TLogger extends Logger = ConsoleLogger,
  TSession = unknown,
> {
  private defaultServices: TServices;
  constructor(
    defaultServices: TServices,
    private basePath: TBasePath = '' as TBasePath,
    private defaultAuthorizeFn?: (
      ctx: FunctionContext<any, TServices, TLogger>,
    ) => boolean | Promise<boolean>,
    private defaultLogger: TLogger = DEFAULT_LOGGER,
    private defaultSessionExtractor?: SessionFn<TServices, TLogger, TSession>,
  ) {
    // Initialize default services
    this.defaultServices = uniqBy(
      defaultServices,
      (s) => s.serviceName,
    ) as TServices;
  }

  static joinPaths<TBasePath extends string, P extends string>(
    path: P,
    basePath: TBasePath = '' as TBasePath,
  ): JoinPaths<TBasePath, P> {
    const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
    const segment = path.startsWith('/') ? path : '/' + path;

    return (base + segment) as JoinPaths<TBasePath, P>;
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
    return new EndpointFactory(
      this.defaultServices,
      newBasePath,
      this.defaultAuthorizeFn,
      this.defaultLogger,
      this.defaultSessionExtractor,
    );
  }

  // Create a new factory with authorization
  authorize(
    fn: (
      ctx: FunctionContext<any, TServices, TLogger>,
    ) => boolean | Promise<boolean>,
  ): EndpointFactory<TServices, TBasePath, TLogger, TSession> {
    return new EndpointFactory(
      this.defaultServices,
      this.basePath,
      fn,
      this.defaultLogger,
      this.defaultSessionExtractor,
    );
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
    >(
      [...services, ...this.defaultServices],
      this.basePath,
      this.defaultAuthorizeFn,
      this.defaultLogger,
      this.defaultSessionExtractor,
    );
  }

  logger<L extends Logger>(
    logger: L,
  ): EndpointFactory<TServices, TBasePath, L, TSession> {
    return new EndpointFactory<TServices, TBasePath, L, TSession>(
      this.defaultServices,
      this.basePath,
      this.defaultAuthorizeFn as any,
      logger,
      this.defaultSessionExtractor as any,
    );
  }

  session<TSession>(session: SessionFn<TServices, TLogger, TSession>) {
    return new EndpointFactory<TServices, TBasePath, TLogger, TSession>(
      this.defaultServices,
      this.basePath,
      this.defaultAuthorizeFn as any,
      this.defaultLogger,
      session,
    );
  }

  private createBuilder<TMethod extends HttpMethod, TPath extends string>(
    method: TMethod,
    path: TPath,
  ): EndpointBuilder<
    JoinPaths<TBasePath, TPath>,
    TMethod,
    undefined,
    undefined,
    undefined,
    TServices,
    TLogger,
    undefined,
    TSession
  > {
    const fullPath = EndpointFactory.joinPaths(path, this.basePath);
    const builder = new EndpointBuilder(fullPath, method);

    if (this.defaultAuthorizeFn) {
      // @ts-ignore
      builder.authorizeFn = this.defaultAuthorizeFn;
    }
    if (this.defaultServices.length) {
      // @ts-ignore
      builder._services = this.defaultServices as TServices;
    }

    if (this.defaultLogger) {
      // @ts-ignore
      builder._logger = this.defaultLogger as TLogger;
    }

    if (this.defaultSessionExtractor) {
      // @ts-ignore
      builder._getSession = this.defaultSessionExtractor as SessionFn<
        {},
        TServices,
        TLogger,
        TSession
      >;
    }

    return builder as unknown as EndpointBuilder<
      JoinPaths<TBasePath, TPath>,
      TMethod,
      undefined,
      undefined,
      undefined,
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
