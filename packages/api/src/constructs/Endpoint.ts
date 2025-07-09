import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { OpenAPIV3_1 } from 'openapi-types';
import type { ConsoleLogger, Logger } from '../logger';
import type { HermodServiceConstructor } from '../services';
import { Function, FunctionBuilder, type FunctionHandler } from './Function';
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
  static isEndpoint(obj: any): obj is Endpoint<any, any, any, any> {
    return (
      obj &&
      (obj as Function).__IS_FUNCTION__ === true &&
      obj.type === FunctionType.Endpoint
    );
  }

  toOpenApi3Route(): OpenAPIV3_1.PathsObject {
    return {};
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
