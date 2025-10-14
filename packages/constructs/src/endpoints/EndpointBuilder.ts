import type { Logger } from '@geekmidas/logger';
import type { RateLimitConfig } from '@geekmidas/rate-limit';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import uniqBy from 'lodash.uniqby';
import { ConstructType } from '../Construct';
import { BaseFunctionBuilder } from '../functions';
import { Endpoint, type EndpointSchemas } from './Endpoint';
import type {
  AuthorizeFn,
  EndpointHandler,
  SessionFn,
  SuccessStatus,
} from './Endpoint';

import type { EventPublisher, MappedEvent } from '@geekmidas/events';
import type { HttpMethod } from '../types';

export class EndpointBuilder<
  TRoute extends string,
  TMethod extends HttpMethod,
  TInput extends EndpointSchemas = {},
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TSession = unknown,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
> extends BaseFunctionBuilder<
  TInput,
  OutSchema,
  TServices,
  TLogger,
  TEventPublisher,
  TEventPublisherServiceName
> {
  protected schemas: TInput = {} as TInput;
  protected _description?: string;
  protected _status?: SuccessStatus;
  protected _tags?: string[];
  _getSession: SessionFn<TServices, TLogger, TSession> = () => ({}) as TSession;
  _authorize: AuthorizeFn<TServices, TLogger, TSession> = () => true;
  _rateLimit?: RateLimitConfig;

  constructor(
    readonly route: TRoute,
    readonly method: TMethod,
  ) {
    super(ConstructType.Endpoint);
  }

  // Internal setter for EndpointFactory to set default publisher
  _setPublisher(
    publisher: Service<TEventPublisherServiceName, TEventPublisher>,
  ) {
    this._publisher = publisher;
  }

  description(description: string): this {
    this._description = description;
    return this;
  }

  status(status: SuccessStatus): this {
    this._status = status;
    return this;
  }

  event<TEvent extends MappedEvent<TEventPublisher, OutSchema>>(
    event: TEvent,
  ): this {
    this._events.push(event);
    return this;
  }

  tags(tags: string[]): this {
    this._tags = tags;
    return this;
  }

  publisher<T extends EventPublisher<any>, TName extends string>(
    publisher: Service<TName, T>,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    TInput,
    TServices,
    TLogger,
    OutSchema,
    TSession,
    T,
    TName
  > {
    this._publisher = publisher as unknown as Service<
      TEventPublisherServiceName,
      TEventPublisher
    >;

    return this as unknown as EndpointBuilder<
      TRoute,
      TMethod,
      TInput,
      TServices,
      TLogger,
      OutSchema,
      TSession,
      T,
      TName
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
    TSession,
    TEventPublisher
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
    TSession,
    TEventPublisher
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
    TSession,
    TEventPublisher
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
    TSession,
    TEventPublisher
  > {
    this.schemas.params = schema as unknown as T;
    // @ts-ignore
    return this;
  }

  rateLimit(config: RateLimitConfig): this {
    this._rateLimit = config;
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
    TSession,
    TEventPublisher,
    TEventPublisherServiceName
  > {
    this._services = uniqBy(
      [...this._services, ...services],
      (s) => s.serviceName,
    ) as TServices;

    return this as unknown as EndpointBuilder<
      TRoute,
      TMethod,
      TInput,
      [...TServices, ...T],
      TLogger,
      OutSchema,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName
    >;
  }

  logger<T extends Logger>(
    logger: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    TInput,
    TServices,
    T,
    OutSchema,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName
  > {
    this._logger = logger as unknown as TLogger;

    return this as unknown as EndpointBuilder<
      TRoute,
      TMethod,
      TInput,
      TServices,
      T,
      OutSchema,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName
    >;
  }

  output<T extends StandardSchemaV1>(
    schema: T,
  ): EndpointBuilder<
    TRoute,
    TMethod,
    TInput,
    TServices,
    TLogger,
    T,
    TSession,
    TEventPublisher,
    TEventPublisherServiceName
  > {
    this.outputSchema = schema as unknown as OutSchema;

    return this as unknown as EndpointBuilder<
      TRoute,
      TMethod,
      TInput,
      TServices,
      TLogger,
      T,
      TSession,
      TEventPublisher,
      TEventPublisherServiceName
    >;
  }

  // EndpointBuilder doesn't have a generic input method - it uses body, query, params instead
  input(_schema: any): any {
    throw new Error(
      'EndpointBuilder does not support generic input. Use body(), query(), or params() instead.',
    );
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
    TSession,
    TEventPublisher
  > {
    return new Endpoint({
      fn,
      method: this.method,
      route: this.route,
      description: this._description,
      tags: this._tags,
      input: this.schemas,
      output: this.outputSchema,
      services: this._services,
      logger: this._logger,
      timeout: this._timeout,
      authorize: this._authorize,
      status: this._status,
      getSession: this._getSession,
      rateLimit: this._rateLimit,
      publisherService: this._publisher,
      events: this._events,
    });
  }
}
