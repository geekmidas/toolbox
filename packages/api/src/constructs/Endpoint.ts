import type { StandardSchemaV1 } from '@standard-schema/spec';
import set from 'lodash.set';
import type { OpenAPIV3_1 } from 'openapi-types';
import type { ConsoleLogger, Logger } from '../logger';
import type { HermodServiceConstructor } from '../services';
import { Function, FunctionBuilder, type FunctionHandler } from './Function';
import { convertStandardSchemaToJsonSchema } from './helpers';
import { buildOpenApiSchema, type OpenApiSchemaOptions } from './openapi';
import { FunctionType, type RemoveUndefined } from './types';

export class Endpoint<
  TRoute extends string,
  TMethod extends HttpMethod,
  TBody extends StandardSchemaV1 | undefined = undefined,
  TSearch extends StandardSchemaV1 | undefined = undefined,
  TParams extends StandardSchemaV1 | undefined = undefined,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
> extends Function<
  EndpointInput<TBody, TSearch, TParams>,
  TServices,
  TLogger,
  OutSchema
> {
  route: TRoute;
  method: TMethod;
  description?: string;

  static async buildOpenApiSchema(
    endpoints: Endpoint<any, any, any, any, any, any, any, any>[],
    options?: OpenApiSchemaOptions,
  ) {
    return buildOpenApiSchema(endpoints, options);
  }

  static isEndpoint(obj: any): obj is Endpoint<any, any, any, any> {
    return (
      obj &&
      (obj as Function).__IS_FUNCTION__ === true &&
      obj.type === FunctionType.Endpoint
    );
  }

  async toOpenApi3Route(): Promise<OpenAPIV3_1.PathsObject> {
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
      if ('search' in this.input && this.input.search) {
        const searchSchema = await convertStandardSchemaToJsonSchema(
          this.input.search as StandardSchemaV1,
        );
        if (
          searchSchema &&
          searchSchema.type === 'object' &&
          searchSchema.properties
        ) {
          for (const [name, schema] of Object.entries(
            searchSchema.properties,
          )) {
            parameters.push({
              name,
              in: 'query',
              required: searchSchema.required?.includes(name) ?? false,
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
      [this.route]: {
        [this.method.toLowerCase()]: operation,
      },
    };
  }

  constructor({
    fn,
    method,
    route,
    description,
    input,
    logger,
    outputSchema,
    services,
    timeout,
  }: EndpointOptions<
    TRoute,
    TMethod,
    TBody,
    TSearch,
    TParams,
    OutSchema,
    TServices,
    TLogger
  >) {
    super(
      fn,
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
  }
}

export class EndpointBuilder<
  TRoute extends string,
  TMethod extends HttpMethod,
  TBody extends StandardSchemaV1 | undefined = undefined,
  TSearch extends StandardSchemaV1 | undefined = undefined,
  TParams extends StandardSchemaV1 | undefined = undefined,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
> extends FunctionBuilder<
  EndpointInput<TBody, TSearch, TParams>,
  OutSchema,
  TServices,
  TLogger
> {
  protected bodySchema?: TBody;
  protected searchSchema?: TSearch;
  protected paramsSchema?: TParams;
  protected _description?: string;

  constructor(
    readonly route: TRoute,
    readonly method: TMethod,
  ) {
    super(FunctionType.Endpoint);
  }

  description(description: string): this {
    this._description = description;
    return this;
  }

  handle(
    fn: FunctionHandler<
      EndpointInput<TBody, TSearch, TParams>,
      TServices,
      TLogger,
      OutSchema
    >,
  ): Endpoint<
    TRoute,
    TMethod,
    TBody,
    TSearch,
    TParams,
    OutSchema,
    TServices,
    TLogger
  > {
    return new Endpoint({
      fn,
      method: this.method,
      route: this.route,
      description: this._description,
      input: this.inputSchema as EndpointInput<TBody, TSearch, TParams>,
      outputSchema: this.outputSchema,
      services: this._services,
      logger: this._logger,
      timeout: this._timeout,
    });
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

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | 'TRACE'
  | 'CONNECT';

export interface EndpointOptions<
  TRoute extends string,
  TMethod extends HttpMethod,
  TBody extends StandardSchemaV1 | undefined = undefined,
  TSearch extends StandardSchemaV1 | undefined = undefined,
  TParams extends StandardSchemaV1 | undefined = undefined,
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
> {
  route: TRoute;
  method: TMethod;
  fn: FunctionHandler<
    EndpointInput<TBody, TSearch, TParams>,
    TServices,
    TLogger
  >;
  description: string | undefined;
  timeout: number | undefined;
  input: EndpointInput<TBody, TSearch, TParams> | undefined;
  outputSchema: TOutSchema | undefined;
  services: TServices;
  logger: TLogger;
}
