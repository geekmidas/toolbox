import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ConsoleLogger, Logger } from '../logger';
import type {
  HermodServiceConstructor,
  HermodServiceRecord,
} from '../services';

export type EndpointSchemas = Partial<{
  params: StandardSchemaV1;
  query: StandardSchemaV1;
  body: StandardSchemaV1;
}>;

export type InferStandardSchema<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T>
  : never;

// Only include keys that exist in S
export type HandlerContext<
  S extends EndpointSchemas,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
  TSession = unknown,
> = {
  [K in keyof S]: InferStandardSchema<S[K]>;
} & {
  services: HermodServiceRecord<TServices>;
  logger: TLogger;
  headers: Map<string, string>;
  auth: TSession;
};

export type RouteHandler<
  S extends EndpointSchemas,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
  TSession = unknown,
> = (
  ctx: HandlerContext<S, TServices, TLogger, TSession>,
) => OutSchema extends StandardSchemaV1
  ? InferStandardSchema<OutSchema> | Promise<InferStandardSchema<OutSchema>>
  : any | Promise<any>;

export type SessionFn<
  S extends EndpointSchemas,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
  TSession = unknown,
> = (
  ctx: HandlerContext<S, TServices, TLogger, undefined>,
) => Promise<TSession> | TSession;

export type ExtractSessionFromFn<T extends SessionFn<any, any, any, any>> =
  T extends (ctx: any) => Promise<infer U> | infer U ? U : never;

export type Authorizer<
  S extends EndpointSchemas,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
  TSession = unknown,
> = (
  ctx: HandlerContext<S, TServices, TLogger, TSession>,
) => Promise<boolean> | boolean;

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
export type LowerMethod<T extends Method> = Lowercase<T>;

export type Route<
  TMethod extends Method,
  TPath extends string,
> = `${TMethod} ${TPath}`;

type Service<T = unknown> = {
  register: () => T | Promise<T>;
};

export type ServiceRecord = Record<string, Service>;

export type ServiceObject<T extends ServiceRecord> = {
  [K in keyof T]: T[K] extends Service<infer U> ? U : never;
};

export type ConvertRouteParams<T extends string> =
  T extends `${infer Start}:${infer Param}/${infer Rest}`
    ? `${Start}{${Param}}/${ConvertRouteParams<Rest>}`
    : T extends `${infer Start}:${infer Param}`
      ? `${Start}{${Param}}`
      : T;

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
