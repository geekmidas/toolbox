import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Logger } from '../logger';
import type { RateLimitConfig } from '../rate-limit';
import type { Service } from '../services';
import { Endpoint, type EndpointSchemas } from './Endpoint';
import type {
  AuthorizeFn,
  EndpointHandler,
  SessionFn,
  SuccessStatus,
} from './Endpoint';
import { FunctionBuilder } from './Function';
import { FunctionType, type HttpMethod } from './types';

export class EndpointBuilder<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TSession = unknown,
> extends FunctionBuilder<TInput, OutSchema, TServices, TLogger> {
  protected schemas: TInput = {} as TInput;
  protected _description?: string;
  protected _status?: SuccessStatus;
  _getSession: SessionFn<TServices, TLogger, TSession> = () => ({}) as TSession;
  _authorize: AuthorizeFn<TServices, TLogger, TSession> = () => true;
  _rateLimit?: RateLimitConfig;

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

  services<T extends Service[]>(
    services: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    TInput,
    [...TServices, ...T],
    TLogger,
    OutSchema,
    TSession
  > {
    return super.services(services) as EndpointBuilder<
      TRoute,
      TMethod,
      TInput,
      [...TServices, ...T],
      TLogger,
      OutSchema,
      TSession
    >;
  }

  output<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<TRoute, TMethod, TInput, TServices, TLogger, T, TSession> {
    return super.output(schema) as EndpointBuilder<
      TRoute,
      TMethod,
      TInput,
      TServices,
      TLogger,
      T,
      TSession
    >;
  }

  body<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    Omit<TInput, 'body'> & { body: T },
    TServices,
    TLogger,
    OutSchema,
    TSession
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
    OutSchema,
    TSession
  > {
    this.schemas.query = schema as unknown as T;
    // @ts-ignore
    return this;
  }

  query<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    Omit<TInput, 'query'> & { query: T },
    TServices,
    TLogger,
    OutSchema,
    TSession
  > {
    return this.search(schema);
  }

  params<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    Omit<TInput, 'params'> & { params: T },
    TServices,
    TLogger,
    OutSchema,
    TSession
  > {
    this.schemas.params = schema as unknown as T;
    // @ts-ignore
    return this;
  }

  rateLimit(
    config: RateLimitConfig,
  ): this {
    this._rateLimit = config;
    return this;
  }

  handle(
    fn: EndpointHandler<TInput, TServices, TLogger, OutSchema, TSession>,
  ): Endpoint<
    TRoute,
    TMethod,
    TInput,
    OutSchema,
    TServices,
    TLogger,
    TSession
  > {
    return new Endpoint({
      fn,
      method: this.method,
      route: this.route,
      description: this._description,
      input: this.schemas,
      output: this.outputSchema,
      services: this._services,
      logger: this._logger,
      timeout: this._timeout,
      authorize: this._authorize,
      status: this._status,
      getSession: this._getSession,
      rateLimit: this._rateLimit,
    });
  }
}
