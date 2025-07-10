import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ConsoleLogger, Logger } from '../logger';
import type { HermodServiceConstructor } from '../services';
import { Endpoint, type EndpointInput } from './Endpoint';
import { FunctionBuilder, type FunctionHandler } from './Function';
import { FunctionType, type HttpMethod } from './types';

export class EndpointBuilder<
  TRoute extends string,
  TMethod extends HttpMethod,
  TBody extends StandardSchemaV1 | undefined = undefined,
  TSearch extends StandardSchemaV1 | undefined = undefined,
  TParams extends StandardSchemaV1 | undefined = undefined,
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TSession = unknown,
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

  body<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    T,
    TSearch,
    TParams,
    TServices,
    TLogger,
    OutSchema
  > {
    this.bodySchema = schema as unknown as TBody;
    // @ts-ignore
    return this;
  }

  search<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    TBody,
    T,
    TParams,
    TServices,
    TLogger,
    OutSchema
  > {
    this.searchSchema = schema as unknown as TSearch;
    // @ts-ignore
    return this;
  }

  params<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    TBody,
    TSearch,
    T,
    TServices,
    TLogger,
    OutSchema
  > {
    this.paramsSchema = schema as unknown as TParams;
    // @ts-ignore
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
      input: this.inputSchema,
      outputSchema: this.outputSchema,
      services: this._services,
      logger: this._logger,
      timeout: this._timeout,
    });
  }
}
