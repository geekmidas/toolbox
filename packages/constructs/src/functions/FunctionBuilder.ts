import type { AuditStorage, AuditableAction } from '@geekmidas/audit';
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
  TDatabase = undefined,
  TDatabaseServiceName extends string = string,
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
> extends BaseFunctionBuilder<
  TInput,
  OutSchema,
  TServices,
  TLogger,
  TEventPublisher,
  TEventPublisherServiceName,
  TAuditStorage,
  TAuditStorageServiceName,
  TDatabase,
  TDatabaseServiceName
> {
  protected _memorySize?: number;

  constructor(public override type = ConstructType.Function) {
    super(type);
  }

  override timeout(timeout: number): this {
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
    TAuditStorageServiceName,
    TDatabase,
    TDatabaseServiceName,
    TAuditAction
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
      TAuditStorageServiceName,
      TDatabase,
      TDatabaseServiceName,
      TAuditAction
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
    TAuditStorageServiceName,
    TDatabase,
    TDatabaseServiceName,
    TAuditAction
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
      TAuditStorageServiceName,
      TDatabase,
      TDatabaseServiceName,
      TAuditAction
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
    TAuditStorageServiceName,
    TDatabase,
    TDatabaseServiceName,
    TAuditAction
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
      TAuditStorageServiceName,
      TDatabase,
      TDatabaseServiceName,
      TAuditAction
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
    TAuditStorageServiceName,
    TDatabase,
    TDatabaseServiceName,
    TAuditAction
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
      TAuditStorageServiceName,
      TDatabase,
      TDatabaseServiceName,
      TAuditAction
    >;
  }

  override publisher<T extends EventPublisher<any>, TName extends string>(
    publisher: Service<TName, T>,
  ): FunctionBuilder<
    TInput,
    OutSchema,
    TServices,
    TLogger,
    T,
    TName,
    TAuditStorage,
    TAuditStorageServiceName,
    TDatabase,
    TDatabaseServiceName,
    TAuditAction
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
      TAuditStorageServiceName,
      TDatabase,
      TDatabaseServiceName,
      TAuditAction
    >;
  }

  override auditor<T extends AuditStorage, TName extends string>(
    storage: Service<TName, T>,
  ): FunctionBuilder<
    TInput,
    OutSchema,
    TServices,
    TLogger,
    TEventPublisher,
    TEventPublisherServiceName,
    T,
    TName,
    TDatabase,
    TDatabaseServiceName,
    TAuditAction
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
      TName,
      TDatabase,
      TDatabaseServiceName,
      TAuditAction
    >;
  }

  /**
   * Set the audit action types for this function.
   * This provides type-safety for the auditor in the handler context.
   */
  actions<T extends AuditableAction<string, unknown>>(): FunctionBuilder<
    TInput,
    OutSchema,
    TServices,
    TLogger,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuditStorage,
    TAuditStorageServiceName,
    TDatabase,
    TDatabaseServiceName,
    T
  > {
    return this as unknown as FunctionBuilder<
      TInput,
      OutSchema,
      TServices,
      TLogger,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuditStorage,
      TAuditStorageServiceName,
      TDatabase,
      TDatabaseServiceName,
      T
    >;
  }

  /**
   * Set the database service for this function.
   * The database will be available in the handler context as `db`.
   */
  override database<T, TName extends string>(
    service: Service<TName, T>,
  ): FunctionBuilder<
    TInput,
    OutSchema,
    TServices,
    TLogger,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuditStorage,
    TAuditStorageServiceName,
    T,
    TName,
    TAuditAction
  > {
    this._databaseService = service as unknown as Service<
      TDatabaseServiceName,
      TDatabase
    >;

    return this as unknown as FunctionBuilder<
      TInput,
      OutSchema,
      TServices,
      TLogger,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuditStorage,
      TAuditStorageServiceName,
      T,
      TName,
      TAuditAction
    >;
  }

  handle(
    fn: FunctionHandler<
      TInput,
      TServices,
      TLogger,
      OutSchema,
      TDatabase,
      TAuditStorage,
      TAuditAction
    >,
  ): Function<
    TInput,
    TServices,
    TLogger,
    OutSchema,
    TEventPublisher,
    TEventPublisherServiceName,
    TAuditStorage,
    TAuditStorageServiceName,
    TDatabase,
    TDatabaseServiceName,
    TAuditAction,
    FunctionHandler<
      TInput,
      TServices,
      TLogger,
      OutSchema,
      TDatabase,
      TAuditStorage,
      TAuditAction
    >
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
      this._databaseService,
    );

    // Reset builder state after creating the function to prevent pollution
    this._services = [] as Service[] as TServices;
    this._logger = DEFAULT_LOGGER;
    this._events = [];
    this._publisher = undefined;
    this._auditorStorage = undefined;
    this._databaseService = undefined;
    this.inputSchema = undefined;
    this.outputSchema = undefined;
    this._timeout = undefined;
    this._memorySize = undefined;

    return func;
  }
}
