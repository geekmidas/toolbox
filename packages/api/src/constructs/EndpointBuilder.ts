import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ConsoleLogger, Logger } from '../logger';
import type { HermodServiceConstructor } from '../services';
import { Endpoint, type EndpointSchemas } from './Endpoint';
import type { EndpointHandler, SessionFn, SuccessStatus } from './Endpoint';
import { FunctionBuilder } from './Function';
import { FunctionType, type HttpMethod } from './types';

export class EndpointBuilder<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TServices extends HermodServiceConstructor[] = [],
  TLogger extends Logger = ConsoleLogger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TSession = unknown,
> extends FunctionBuilder<TInput, OutSchema, TServices, TLogger> {
  protected schemas: TInput;
  protected _description?: string;
  protected _status?: SuccessStatus;
  _getSession: SessionFn<TServices, TLogger, TSession> = () => ({}) as TSession;

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

  status(status: SuccessStatus): this {
    this._status = status;
    return this;
  }

  body<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    Omit<TInput, 'body'> & { body: T },
    TServices,
    TLogger,
    OutSchema
  > {
    this.schemas.body = schema as unknown as T;
    // @ts-ignore
    return this;
  }

  search<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    Omit<TInput, 'query'> & { query: T },
    TServices,
    TLogger,
    OutSchema
  > {
    this.schemas.query = schema as unknown as T;
    // @ts-ignore
    return this;
  }

  params<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    Omit<TInput, 'params'> & { params: T },
    TServices,
    TLogger,
    OutSchema
  > {
    this.schemas.query = schema as unknown as T;
    // @ts-ignore
    return this;
  }

  handle(
    fn: EndpointHandler<TInput, TServices, TLogger, OutSchema>,
  ): Endpoint<TRoute, TMethod, TInput, OutSchema, TServices, TLogger> {
    return new Endpoint({
      fn,
      method: this.method,
      route: this.route,
      description: this._description,
      input: this.inputSchema,
      output: this.outputSchema,
      services: this._services,
      logger: this._logger,
      timeout: this._timeout,
      status: this._status,
      getSession: this._getSession,
    });
  }
}
