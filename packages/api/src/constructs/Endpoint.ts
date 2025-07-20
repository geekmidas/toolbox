import type { StandardSchemaV1 } from '@standard-schema/spec';
import set from 'lodash.set';
import type { OpenAPIV3_1 } from 'openapi-types';
import { UnprocessableEntityError } from '../errors';
import type { Logger } from '../logger';

import type {
  Service,
  ServiceDiscovery,
  ServiceRecord,
} from '../service-discovery';
import {
  Function,
  type FunctionContext,
  type FunctionHandler,
} from './Function';
import { convertStandardSchemaToJsonSchema } from './helpers';
import { type OpenApiSchemaOptions, buildOpenApiSchema } from './openapi';
import {
  FunctionType,
  type HttpMethod,
  type InferComposableStandardSchema,
  type InferStandardSchema,
  type LowerHttpMethod,
  type RemoveUndefined,
} from './types';

export class Endpoint<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
> extends Function<TInput, TServices, TLogger, OutSchema> {
  route: TRoute;
  method: TMethod;
  description?: string;
  public readonly status: SuccessStatus;
  public getSession: SessionFn<TServices, TLogger, TSession> = () =>
    ({}) as TSession;
  public authorize: AuthorizeFn<TServices, TLogger, TSession> = () => true;

  static async buildOpenApiSchema(
    endpoints: Endpoint<any, any, any, any, any, any>[],
    options?: OpenApiSchemaOptions,
  ) {
    return buildOpenApiSchema(endpoints, options);
  }

  static validate<T extends StandardSchemaV1>(schema: T, data: unknown) {
    return schema['~standard'].validate(data);
  }

  get fullPath() {
    return `${this.method} ${this._path}` as const;
  }

  static async parseSchema<T extends StandardSchemaV1>(
    schema: T,
    data: unknown,
  ): Promise<InferStandardSchema<T>> {
    if (!schema) {
      return undefined as InferStandardSchema<T>;
    }

    const parsed = await Endpoint.validate(
      schema as unknown as StandardSchemaV1,
      data,
    );
    if (parsed.issues) {
      throw new UnprocessableEntityError('Validation failed', parsed.issues);
    }

    return parsed.value as InferStandardSchema<T>;
  }

  async parseOutput(output: unknown): Promise<InferStandardSchema<OutSchema>> {
    return Endpoint.parseSchema(
      this.outputSchema as StandardSchemaV1,
      output,
    ) as Promise<InferStandardSchema<OutSchema>>;
  }

  async parseInput<K extends keyof TInput>(
    input: unknown,
    key: K,
  ): Promise<InferComposableStandardSchema<TInput[K]>> {
    const schema = this.input?.[key];
    return Endpoint.parseSchema(schema as StandardSchemaV1, input) as Promise<
      InferComposableStandardSchema<TInput[K]>
    >;
  }

  async parseBody(body: unknown): Promise<InferStandardSchema<TInput['body']>> {
    return this.parseInput(body, 'body') as Promise<
      InferStandardSchema<TInput['body']>
    >;
  }

  static createHeaders(headers: Record<string, string>) {
    const headerMap = new Map<string, string>();
    for (const [k, v] of Object.entries(headers)) {
      const key = k.toLowerCase();
      headerMap.set(key, v);
    }

    return function get(key: string): string | undefined {
      return headerMap.get(key.toLowerCase());
    };
  }

  handler: EndpointHandler<TInput, TServices, TLogger, OutSchema, TSession> = (
    ctx: EndpointContext<TInput, TServices, TLogger, TSession>,
  ): OutSchema extends StandardSchemaV1
    ? InferStandardSchema<OutSchema> | Promise<InferStandardSchema<OutSchema>>
    : void | Promise<void> => {
    return this.fn({
      body: ctx.body,
      query: ctx.query,
      params: ctx.params,
      services: ctx.services,
      logger: ctx.logger,
      header: ctx.header,
      session: ctx.session,
    } as unknown as FunctionContext<TInput, TServices, TLogger>);
  };

  static isEndpoint(obj: any): obj is Endpoint<any, any, any, any> {
    return (
      obj &&
      (obj as Function).__IS_FUNCTION__ === true &&
      obj.type === FunctionType.Endpoint
    );
  }

  get _path() {
    return this.route.replace(/:(\w+)/g, '{$1}') as ConvertRouteParams<TRoute>;
  }

  async toOpenApi3Route(): Promise<EndpointOpenApiSchema<TRoute, TMethod>> {
    const operation: OpenAPIV3_1.OperationObject = {
      ...(this.description && { description: this.description }),
      responses: {
        '200': {
          description: 'Successful response',
        } as OpenAPIV3_1.ResponseObject,
      },
    };

    // Add response schema
    if (this.outputSchema) {
      const responseSchema = await convertStandardSchemaToJsonSchema(
        this.outputSchema,
      );
      if (responseSchema) {
        set(
          operation,
          ['responses', '200', 'content', 'application/json', 'schema'],
          responseSchema,
        );
      }
    }

    // Add parameters array
    const parameters: OpenAPIV3_1.ParameterObject[] = [];

    // Since the EndpointBuilder doesn't have body/search/params methods yet,
    // and the input is a composite type, we need to check if input exists
    // and has the expected shape
    if (this.input && typeof this.input === 'object') {
      // Add request body for methods that support it
      if (
        ['POST', 'PUT', 'PATCH'].includes(this.method) &&
        'body' in this.input &&
        this.input.body
      ) {
        const bodySchema = await convertStandardSchemaToJsonSchema(
          this.input.body as StandardSchemaV1,
        );
        if (bodySchema) {
          set(operation, ['requestBody'], {
            required: true,
            content: {
              'application/json': {
                schema: bodySchema,
              },
            },
          });
        }
      }

      // Add path parameters
      if ('params' in this.input && this.input.params) {
        const paramsSchema = await convertStandardSchemaToJsonSchema(
          this.input.params as StandardSchemaV1,
        );
        if (
          paramsSchema &&
          paramsSchema.type === 'object' &&
          paramsSchema.properties
        ) {
          for (const [name, schema] of Object.entries(
            paramsSchema.properties,
          )) {
            parameters.push({
              name,
              in: 'path',
              required: paramsSchema.required?.includes(name) ?? true,
              schema: schema as any,
            });
          }
        }
      }

      // Add query parameters
      if ('query' in this.input && this.input.query) {
        const querySchema = await convertStandardSchemaToJsonSchema(
          this.input.query,
        );
        if (
          querySchema &&
          querySchema.type === 'object' &&
          querySchema.properties
        ) {
          for (const [name, schema] of Object.entries(querySchema.properties)) {
            parameters.push({
              name,
              in: 'query',
              required: querySchema.required?.includes(name) ?? false,
              schema: schema as any,
            });
          }
        }
      }
    }

    if (parameters.length > 0) {
      operation.parameters = parameters;
    }

    return {
      [this._path]: {
        [this.method.toLowerCase()]: operation,
      },
    } as EndpointOpenApiSchema<TRoute, TMethod>;
  }

  constructor({
    fn,
    method,
    route,
    description,
    input,
    logger,
    output: outputSchema,
    services,
    timeout,
    getSession,
    authorize,
    status = SuccessStatus.OK,
  }: EndpointOptions<
    TRoute,
    TMethod,
    TInput,
    OutSchema,
    TServices,
    TLogger,
    TSession
  >) {
    super(
      fn as FunctionHandler<TInput, TServices, TLogger, OutSchema>,
      timeout,
      FunctionType.Endpoint,
      input,
      outputSchema,
      services,
      logger,
    );

    this.route = route;
    this.method = method;
    this.description = description;
    this.status = status;
    if (getSession) {
      this.getSession = getSession;
    }

    if (authorize) {
      this.authorize = authorize;
    }
  }
}

export type EndpointInput<
  TBody extends StandardSchemaV1 | undefined = undefined,
  TSearch extends StandardSchemaV1 | undefined = undefined,
  TParams extends StandardSchemaV1 | undefined = undefined,
> = RemoveUndefined<{
  body: TBody;
  search: TSearch;
  params: TParams;
}>;

export interface EndpointOptions<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TOutput extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
> {
  route: TRoute;
  method: TMethod;
  fn: EndpointHandler<TInput, TServices, TLogger, TOutput, TSession>;
  authorize: AuthorizeFn<TServices, TLogger, TSession> | undefined;
  description: string | undefined;
  timeout: number | undefined;
  input: TInput | undefined;
  output: TOutput | undefined;
  services: TServices;
  logger: TLogger;
  getSession: SessionFn<TServices, TLogger, TSession> | undefined;
  status: SuccessStatus | undefined;
}

export type EndpointSchemas = Partial<{
  params: StandardSchemaV1;
  query: StandardSchemaV1;
  body: StandardSchemaV1;
}>;

export type AuthorizeFn<
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
> = (
  ctx: FunctionContext<{}, TServices, TLogger> & {
    header: HeaderFn;
    session: TSession;
  },
) => Promise<boolean> | boolean;

export type SessionFn<
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
> = (
  ctx: FunctionContext<{}, TServices, TLogger> & { header: HeaderFn },
) => Promise<TSession> | TSession;

export type ConvertRouteParams<T extends string> =
  T extends `${infer Start}:${infer Param}/${infer Rest}`
    ? `${Start}{${Param}}/${ConvertRouteParams<Rest>}`
    : T extends `${infer Start}:${infer Param}`
      ? `${Start}{${Param}}`
      : T;

export type EndpointOpenApiSchema<
  TRoute extends string,
  TMethod extends HttpMethod,
> = {
  [key in ConvertRouteParams<TRoute>]: {
    [key in LowerHttpMethod<TMethod>]: OpenAPIV3_1.OperationObject<{}>;
  };
};

export type EndpointHeaders = Map<string, string>;
export type HeaderFn = (key: string) => string | undefined;

export type EndpointContext<
  Input extends EndpointSchemas | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TSession = unknown,
> = {
  services: ServiceDiscovery<ServiceRecord<TServices>>;
  logger: TLogger;
  header: HeaderFn;
  session: TSession;
} & InferComposableStandardSchema<Input>;

export type EndpointHandler<
  TInput extends EndpointSchemas | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TSession = unknown,
> = (
  ctx: EndpointContext<TInput, TServices, TLogger, TSession>,
) => OutSchema extends StandardSchemaV1
  ? InferStandardSchema<OutSchema> | Promise<InferStandardSchema<OutSchema>>
  : any | Promise<any>;

export enum SuccessStatus {
  OK = 200,
  Created = 201,
  Accepted = 202,
  NoContent = 204,
  ResetContent = 205,
  PartialContent = 206,
}
