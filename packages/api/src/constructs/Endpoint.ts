import type { StandardSchemaV1 } from '@standard-schema/spec';
import set from 'lodash.set';
import type { OpenAPIV3_1 } from 'openapi-types';
import type { ConsoleLogger, Logger } from '../logger';
import type { HermodServiceConstructor } from '../services';
import { Function, type FunctionHandler } from './Function';
import { convertStandardSchemaToJsonSchema } from './helpers';
import { type OpenApiSchemaOptions, buildOpenApiSchema } from './openapi';
import {
  FunctionType,
  type HttpMethod,
  type LowerHttpMethod,
  type RemoveUndefined,
} from './types';

export class Endpoint<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
> extends Function<TInput, TServices, TLogger, OutSchema> {
  route: TRoute;
  method: TMethod;
  description?: string;

  static async buildOpenApiSchema(
    endpoints: Endpoint<any, any, any, any, any, any>[],
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
    outputSchema,
    services,
    timeout,
  }: EndpointOptions<TRoute, TMethod, TInput, OutSchema, TServices, TLogger>) {
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
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
> {
  route: TRoute;
  method: TMethod;
  fn: FunctionHandler<TInput, TServices, TLogger>;
  description: string | undefined;
  timeout: number | undefined;
  input: TInput | undefined;
  outputSchema: TOutSchema | undefined;
  services: TServices;
  logger: TLogger;
}

export type EndpointSchemas = Partial<{
  params: StandardSchemaV1;
  query: StandardSchemaV1;
  body: StandardSchemaV1;
}>;

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
