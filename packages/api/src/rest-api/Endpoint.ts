import type { StandardSchemaV1 } from '@standard-schema/spec';
import uniqBy from 'lodash.uniqby';

import { UnprocessableEntityError } from '../errors';
import { ConsoleLogger, type Logger } from '../logger';
import type { HermodServiceConstructor } from '../services';
import type {
  Authorizer,
  ConvertRouteParams,
  EndpointSchemas,
  HandlerContext,
  InferStandardSchema,
  JoinPaths,
  LowerMethod,
  Method,
  Route,
  RouteHandler,
  SessionFn,
} from './types';

// Add a SuccessStatus enum for common HTTP success codes
export enum SuccessStatus {
  OK = 200,
  Created = 201,
  Accepted = 202,
  NoContent = 204,
  ResetContent = 205,
  PartialContent = 206,
}

const DEFAULT_LOGGER = new ConsoleLogger() as any;
export class Handler<
  S extends EndpointSchemas,
  Path extends string,
  TMethod extends Method,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
  TSession = unknown,
> {
  __IS_HANDLER__ = true;

  static isHandler(obj: any): obj is Handler<any, any, any, any, any, any> {
    return obj && obj.__IS_HANDLER__ === true;
  }

  constructor(
    public readonly method: TMethod,
    public readonly path: Path,
    public readonly schemas: S,
    public readonly outputSchema: OutSchema,
    public readonly authorize: Authorizer<S, TServices, TLogger, TSession>,
    public readonly handler: RouteHandler<
      S,
      OutSchema,
      TServices,
      TLogger,
      TSession
    >,
    public readonly status: SuccessStatus = SuccessStatus.OK,
    private description?: string,
    public services: TServices = {} as TServices,
    public logger: TLogger = DEFAULT_LOGGER,
    public getSession: SessionFn<S, TServices, TLogger, TSession> = () =>
      ({}) as TSession,
  ) {}

  get _path() {
    return this.path.replace(/:(\w+)/g, '{$1}') as ConvertRouteParams<Path>;
  }

  route(): Route<TMethod, ConvertRouteParams<Path>> {
    return `${this.method} ${this._path}`;
  }

  static StandardSchemaJsonSchema = {
    zod: async (schema) => {
      const { z } = await import('zod/v4');
      return z.toJSONSchema(schema, { unrepresentable: 'any' });
    },
    valibot: async (schema) => {
      const { toJsonSchema } = await import('@valibot/to-json-schema');
      return toJsonSchema(schema as any);
    },
  };

  async parseSchema<T extends StandardSchemaV1>(
    data?: any,
    schema?: T,
  ): Promise<InferStandardSchema<T> | undefined> {
    if (!schema) {
      return undefined;
    }

    const validated = await schema['~standard'].validate(data);

    if (!validated.issues) {
      return validated.value as InferStandardSchema<T>;
    }

    this.logger.error(validated.issues);

    throw new UnprocessableEntityError(undefined, validated.issues);
  }

  async parseParams(
    data?: any,
  ): Promise<InferStandardSchema<S['params']> | undefined> {
    return this.parseSchema(data, this.schemas.params) as InferStandardSchema<
      S['params']
    >;
  }

  async parseBody(
    data?: any,
  ): Promise<InferStandardSchema<S['body']> | undefined> {
    this.logger.debug({ data }, 'Parsing body schema');
    return this.parseSchema(data, this.schemas.body) as InferStandardSchema<
      S['body']
    >;
  }

  async parseQuery(
    data?: any,
  ): Promise<InferStandardSchema<S['query']> | undefined> {
    return this.parseSchema(data, this.schemas.query) as InferStandardSchema<
      S['query']
    >;
  }

  async parseOutput(
    data?: any,
  ): Promise<InferStandardSchema<OutSchema> | undefined> {
    return this.parseSchema(
      data,
      this.outputSchema,
    ) as InferStandardSchema<OutSchema>;
  }

  async toJSONSchema(schema?: StandardSchemaV1): Promise<any | undefined> {
    if (!schema) {
      return undefined;
    }

    const vendor = schema['~standard']
      .vendor as keyof typeof Handler.StandardSchemaJsonSchema;
    const toJsonSchema = Handler.StandardSchemaJsonSchema[vendor];

    return toJsonSchema?.(schema);
  }

  async toOpenAPI(): Promise<{
    [P in Path]: {
      [M in LowerMethod<TMethod>]: {
        parameters: any[];
        requestBody?: any;
        responses: any;
      };
    };
  }> {
    const method = this.method.toLowerCase() as LowerMethod<typeof this.method>;
    const parameters: any[] = [];
    const responses = {};

    // Convert params schema to OpenAPI parameters
    if (this.schemas.params) {
      const paramsSchema = await this.toJSONSchema(this.schemas.params);
      if (paramsSchema?.properties) {
        for (const [name, schema] of Object.entries(paramsSchema.properties)) {
          // @ts-ignore
          delete schema.$schema;
          parameters.push({
            name,
            in: 'path',
            required: Array.isArray(paramsSchema.required)
              ? paramsSchema.required.includes(name)
              : false,
            // @ts-ignore
            ...schema,
          });
        }
      }
    }

    // Convert query schema to OpenAPI parameters
    if (this.schemas.query) {
      const querySchema = await this.toJSONSchema(this.schemas.query);
      if (querySchema?.properties) {
        for (const [name, schema] of Object.entries(querySchema.properties)) {
          // @ts-ignore
          delete schema.$schema;
          parameters.push({
            name,
            in: 'query',
            required: Array.isArray(querySchema.required)
              ? querySchema.required.includes(name)
              : false,
            // @ts-ignore
            ...schema,
          });
        }
      }
    }

    // Convert body schema to OpenAPI requestBody
    if (this.schemas.body) {
      const schema = await this.toJSONSchema(this.schemas.body);
      // @ts-ignore
      delete schema.$schema;
      parameters.push({
        name: 'body',
        in: 'body',
        required: true,
        schema,
      });
    }

    // Convert output schema to OpenAPI response
    if (this.outputSchema) {
      const outputSchema = await this.toJSONSchema(this.outputSchema);
      delete outputSchema.$schema;
      responses[this.status] = {
        description: this.description || 'Success',
        schema: outputSchema,
      };
    } else {
      responses[this.status] = {
        description: 'Success',
      };
    }

    return {
      [this._path]: {
        [method]: {
          produces: this.outputSchema ? ['application/json'] : undefined,
          parameters,
          responses,
        },
      },
    } as any;
  }
}

class EndpointBuilder<
  TSchema extends EndpointSchemas = {},
  Path extends string = string,
  TMethod extends Method = Method,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
  TSession = unknown,
> {
  private method: TMethod;
  private path: Path;
  private _description?: string;
  private schemas: EndpointSchemas = {};
  private outputSchema?: OutSchema;
  private statusCode: SuccessStatus = SuccessStatus.OK;

  // Made these accessible to EndpointFactory
  // @ts-ignore
  _services: TServices = [];
  _logger: TLogger = DEFAULT_LOGGER;
  _auth: TSession = {} as TSession;
  authorizeFn: Authorizer<TSchema, TServices, TLogger, TSession> = () => true;
  _getSession: SessionFn<TSchema, TServices, TLogger, TSession> = () =>
    ({}) as TSession;

  constructor(method: TMethod, path: Path) {
    this.method = method;
    this.path = path;
  }

  params<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    Omit<TSchema, 'params'> & { params: T },
    Path,
    TMethod,
    OutSchema,
    TServices,
    TLogger,
    TSession
  > {
    this.schemas.params = schema;
    // @ts-expect-error - for chaining with updated generic
    return this;
  }

  services<T extends HermodServiceConstructor[]>(
    services: T,
  ): EndpointBuilder<
    TSchema,
    Path,
    TMethod,
    OutSchema,
    [...TServices, ...T],
    TLogger,
    TSession
  > {
    this._services = uniqBy(
      [...this._services, ...services],
      (s) => s.serviceName,
    ) as TServices;
    // @ts-expect-error - for chaining with updated generic
    return this;
  }

  query<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    Omit<TSchema, 'query'> & { query: T },
    Path,
    TMethod,
    OutSchema,
    TServices,
    TLogger,
    TSession
  > {
    this.schemas.query = schema;
    // @ts-expect-error - for chaining with updated generic
    return this;
  }

  body<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    Omit<TSchema, 'body'> & { body: T },
    Path,
    TMethod,
    OutSchema,
    TServices,
    TLogger,
    TSession
  > {
    this.schemas.body = schema;
    // @ts-expect-error - for chaining with updated generic
    return this;
  }

  output<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<TSchema, Path, TMethod, T, TServices, TLogger, TSession> {
    this.outputSchema = schema as unknown as OutSchema;
    // @ts-expect-error - for chaining with updated generic
    return this;
  }

  status(status: SuccessStatus): this {
    this.statusCode = status;
    return this;
  }

  authorize(
    fn: (
      ctx: HandlerContext<TSchema, TServices, TLogger, TSession>,
    ) => boolean | Promise<boolean>,
  ): this {
    this.authorizeFn = fn;
    return this;
  }

  description(description: string): this {
    this._description = description;
    return this;
  }

  handle(
    fn: (
      ctx: HandlerContext<TSchema, TServices, TLogger, TSession>,
    ) => OutSchema extends StandardSchemaV1
      ? InferStandardSchema<OutSchema> | Promise<InferStandardSchema<OutSchema>>
      : any | Promise<any>,
  ): Handler<TSchema, Path, TMethod, OutSchema, TServices, TLogger, TSession> {
    return new Handler(
      this.method,
      this.path,
      this.schemas as TSchema,
      this.outputSchema,
      this.authorizeFn,
      fn,
      this.statusCode,
      this._description,
      this._services,
      this._logger,
      this._getSession,
    ) as Handler<
      TSchema,
      Path,
      TMethod,
      OutSchema,
      TServices,
      TLogger,
      TSession
    >;
  }
}

// New: EndpointFactory for creating routers and configured endpoints
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
      ctx: HandlerContext<any, TServices, TLogger, TSession>,
    ) => boolean | Promise<boolean>,
    private defaultLogger: TLogger = DEFAULT_LOGGER,
    private defaultSessionExtractor?: SessionFn<
      {},
      TServices,
      TLogger,
      TSession
    >,
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
      ctx: HandlerContext<any, TServices, TLogger, TSession>,
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

  session<TSession>(session: SessionFn<{}, TServices, TLogger, TSession>) {
    return new EndpointFactory<TServices, TBasePath, TLogger, TSession>(
      this.defaultServices,
      this.basePath,
      this.defaultAuthorizeFn as any,
      this.defaultLogger,
      session,
    );
  }

  private createBuilder<TMethod extends Method, TPath extends string>(
    method: TMethod,
    path: TPath,
  ): EndpointBuilder<
    {},
    JoinPaths<TBasePath, TPath>,
    TMethod,
    undefined,
    TServices,
    TLogger,
    TSession
  > {
    const fullPath = EndpointFactory.joinPaths(path, this.basePath);
    const builder = new EndpointBuilder(method, fullPath);

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
      {},
      JoinPaths<TBasePath, TPath>,
      TMethod,
      undefined,
      TServices,
      TLogger,
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

// Original Endpoint class for backward compatibility
export class Endpoint {
  static post<TPath extends string>(path: TPath) {
    return new EndpointBuilder('POST', path);
  }
  static get<TPath extends string>(path: TPath) {
    return new EndpointBuilder('GET', path);
  }
  static put<TPath extends string>(path: TPath) {
    return new EndpointBuilder('PUT', path);
  }
  static delete<TPath extends string>(path: TPath) {
    return new EndpointBuilder('DELETE', path);
  }
  static patch<TPath extends string>(path: TPath) {
    return new EndpointBuilder('PATCH', path);
  }
  static options<TPath extends string>(path: TPath) {
    return new EndpointBuilder('OPTIONS', path);
  }

  // New static methods for factory pattern
  static route<P extends string>(
    path: P,
  ): EndpointFactory<HermodServiceConstructor[], P> {
    return new EndpointFactory([], path);
  }

  static authorize(
    fn: (
      ctx: HandlerContext<any, HermodServiceConstructor[]>,
    ) => boolean | Promise<boolean>,
  ): EndpointFactory<HermodServiceConstructor[]> {
    return new EndpointFactory([], '', fn);
  }

  static services<S extends HermodServiceConstructor[]>(
    services: S,
  ): EndpointFactory<S> {
    return new EndpointFactory(services);
  }
}

// Export a default instance for convenience
export const e = new EndpointFactory([]);

// Utility function to create a new factory
export function createEndpoint() {
  return new EndpointFactory([]);
}
