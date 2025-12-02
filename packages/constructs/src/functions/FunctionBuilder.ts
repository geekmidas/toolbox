import type { AuditStorage } from '@geekmidas/audit';
import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type { ComposableStandardSchema } from '@geekmidas/schema';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import uniqBy from 'lodash.uniqby';
import { ConstructType } from '../Construct';
import { BaseFunctionBuilder } from './BaseFunctionBuilder';
import { Function, type FunctionHandler } from './Function';

const DEFAULT_LOGGER = new ConsoleLogger() as any;

export class FunctionBuilder<
  TInput extends ComposableStandardSchema,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TAuditStorage extends AuditStorage | undefined = undefined,
  TAuditStorageServiceName extends string = string,
> extends BaseFunctionBuilder<
  TInput,
  OutSchema,
  TServices,
  TLogger,
  TEventPublisher,
  TEventPublisherServiceName,
  TAuditStorage,
  TAuditStorageServiceName
> {
  protected _memorySize?: number;

  constructor(public type = ConstructType.Function) {
    super(type);
  }

  timeout(timeout: number): this {
    this._timeout = timeout;
    return this;
  }

  memorySize(memorySize: number): this {
    this._memorySize = memorySize;
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
    TEventPublisherServiceName,
    TAuditStorage,
    TAuditStorageServiceName
  > {
    this.outputSchema = schema as unknown as OutSchema;

    return this as unknown as FunctionBuilder<
      TInput,
      T,
      TServices,
      TLogger,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuditStorage,
      TAuditStorageServiceName
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
    TEventPublisherServiceName,
    TAuditStorage,
    TAuditStorageServiceName
  > {
    this.inputSchema = schema as unknown as TInput;

    return this as unknown as FunctionBuilder<
      T,
      OutSchema,
      TServices,
      TLogger,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuditStorage,
      TAuditStorageServiceName
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
    TEventPublisherServiceName,
    TAuditStorage,
    TAuditStorageServiceName
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
      TEventPublisherServiceName,
      TAuditStorage,
      TAuditStorageServiceName
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
    TEventPublisherServiceName,
    TAuditStorage,
    TAuditStorageServiceName
  > {
    this._logger = logger as unknown as TLogger;

    return this as unknown as FunctionBuilder<
      TInput,
      OutSchema,
      TServices,
      T,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuditStorage,
      TAuditStorageServiceName
    >;
  }

  publisher<T extends EventPublisher<any>, TName extends string>(
    publisher: Service<TName, T>,
  ): FunctionBuilder<
    TInput,
    OutSchema,
    TServices,
    TLogger,
    T,
    TName,
    TAuditStorage,
    TAuditStorageServiceName
  > {
    this._publisher = publisher as unknown as Service<
      TEventPublisherServiceName,
      TEventPublisher
    >;

    return this as unknown as FunctionBuilder<
      TInput,
      OutSchema,
      TServices,
      TLogger,
      T,
      TName,
      TAuditStorage,
      TAuditStorageServiceName
    >;
  }

  auditor<T extends AuditStorage, TName extends string>(
    storage: Service<TName, T>,
  ): FunctionBuilder<
    TInput,
    OutSchema,
    TServices,
    TLogger,
    TEventPublisher,
    TEventPublisherServiceName,
    T,
    TName
  > {
    this._auditorStorage = storage as unknown as Service<
      TAuditStorageServiceName,
      TAuditStorage
    >;

    return this as unknown as FunctionBuilder<
      TInput,
      OutSchema,
      TServices,
      TLogger,
      TEventPublisher,
      TEventPublisherServiceName,
      T,
      TName
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
    TEventPublisherServiceName,
    TAuditStorage,
    TAuditStorageServiceName
  > {
    const func = new Function(
      fn,
      this._timeout,
      this.type,
      this.inputSchema,
      this.outputSchema,
      this._services,
      this._logger,
      this._publisher,
      this._events,
      this._memorySize,
      this._auditorStorage,
    );

    // Reset builder state after creating the function to prevent pollution
    this._services = [] as Service[] as TServices;
    this._logger = DEFAULT_LOGGER;
    this._events = [];
    this._publisher = undefined;
    this._auditorStorage = undefined;
    this.inputSchema = undefined;
    this.outputSchema = undefined;
    this._timeout = undefined;
    this._memorySize = undefined;

    return func;
  }
}
