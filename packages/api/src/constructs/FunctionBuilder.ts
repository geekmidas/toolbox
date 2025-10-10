import type { StandardSchemaV1 } from '@standard-schema/spec';
import uniqBy from 'lodash.uniqby';
import type { Logger } from '../logger';
import type { Service } from '../services';
import { BaseFunctionBuilder } from './BaseFunctionBuilder';
import { ConstructType } from './Construct';
import { Function, type FunctionHandler } from './Function';
import type { EventPublisher } from './events';
import type { ComposableStandardSchema } from './types';

export class FunctionBuilder<
  TInput extends ComposableStandardSchema,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
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
  constructor(public type = ConstructType.Function) {
    super(type);
  }

  timeout(timeout: number): this {
    this._timeout = timeout;
    return this;
  }

  output<T extends StandardSchemaV1>(
    schema: T,
  ): FunctionBuilder<
    TInput,
    T,
    TServices,
    TLogger,
    TEventPublisher,
    TEventPublisherServiceName
  > {
    this.outputSchema = schema as unknown as OutSchema;

    return this as unknown as FunctionBuilder<
      TInput,
      T,
      TServices,
      TLogger,
      TEventPublisher,
      TEventPublisherServiceName
    >;
  }

  input<T extends ComposableStandardSchema>(
    schema: T,
  ): FunctionBuilder<
    T,
    OutSchema,
    TServices,
    TLogger,
    TEventPublisher,
    TEventPublisherServiceName
  > {
    this.inputSchema = schema as unknown as TInput;

    return this as unknown as FunctionBuilder<
      T,
      OutSchema,
      TServices,
      TLogger,
      TEventPublisher,
      TEventPublisherServiceName
    >;
  }

  services<T extends Service[]>(
    services: T,
  ): FunctionBuilder<
    TInput,
    OutSchema,
    [...TServices, ...T],
    TLogger,
    TEventPublisher,
    TEventPublisherServiceName
  > {
    this._services = uniqBy(
      [...this._services, ...services],
      (s) => s.serviceName,
    ) as TServices;

    return this as unknown as FunctionBuilder<
      TInput,
      OutSchema,
      [...TServices, ...T],
      TLogger,
      TEventPublisher,
      TEventPublisherServiceName
    >;
  }

  logger<T extends Logger>(
    logger: T,
  ): FunctionBuilder<
    TInput,
    OutSchema,
    TServices,
    T,
    TEventPublisher,
    TEventPublisherServiceName
  > {
    this._logger = logger as unknown as TLogger;

    return this as unknown as FunctionBuilder<
      TInput,
      OutSchema,
      TServices,
      T,
      TEventPublisher,
      TEventPublisherServiceName
    >;
  }

  handle(
    fn: FunctionHandler<TInput, TServices, TLogger, OutSchema>,
  ): Function<
    TInput,
    TServices,
    TLogger,
    OutSchema,
    FunctionHandler<TInput, TServices, TLogger, OutSchema>,
    TEventPublisher,
    TEventPublisherServiceName
  > {
    return new Function(
      fn,
      this._timeout,
      this.type,
      this.inputSchema,
      this.outputSchema,
      this._services,
      this._logger,
      this._publisher,
      this._events,
    );
  }
}
