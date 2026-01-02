import type { Logger } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type { ComposableStandardSchema } from '@geekmidas/schema';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import uniqBy from 'lodash.uniqby';
import { ConstructType } from '../Construct';
import { FunctionBuilder, type FunctionHandler } from '../functions';
import { Cron, type ScheduleExpression } from './Cron';

import type { EventPublisher } from '@geekmidas/events';

const DEFAULT_LOGGER = new ConsoleLogger() as any;

export class CronBuilder<
  TInput extends ComposableStandardSchema,
  TServices extends Service[],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TDatabase = undefined,
  TDatabaseServiceName extends string = string,
> extends FunctionBuilder<
  TInput,
  OutSchema,
  TServices,
  TLogger,
  TEventPublisher,
  TEventPublisherServiceName,
  undefined,
  string,
  TDatabase,
  TDatabaseServiceName
> {
  private _schedule?: ScheduleExpression;

  constructor() {
    super(ConstructType.Cron);
  }

  override memorySize(memorySize: number): this {
    this._memorySize = memorySize;
    return this;
  }

  schedule(
    _expression: ScheduleExpression,
  ): CronBuilder<
    TInput,
    TServices,
    TLogger,
    OutSchema,
    TEventPublisher,
    TEventPublisherServiceName,
    TDatabase,
    TDatabaseServiceName
  > {
    this._schedule = _expression;
    return this;
  }

  override input<T extends ComposableStandardSchema>(
    schema: T,
  ): CronBuilder<
    T,
    TServices,
    TLogger,
    OutSchema,
    TEventPublisher,
    TEventPublisherServiceName,
    TDatabase,
    TDatabaseServiceName
  > {
    this.inputSchema = schema as unknown as TInput;

    return this as unknown as CronBuilder<
      T,
      TServices,
      TLogger,
      OutSchema,
      TEventPublisher,
      TEventPublisherServiceName,
      TDatabase,
      TDatabaseServiceName
    >;
  }

  override output<T extends StandardSchemaV1>(
    schema: T,
  ): CronBuilder<
    TInput,
    TServices,
    TLogger,
    T,
    TEventPublisher,
    TEventPublisherServiceName,
    TDatabase,
    TDatabaseServiceName
  > {
    this.outputSchema = schema as unknown as OutSchema;

    return this as unknown as CronBuilder<
      TInput,
      TServices,
      TLogger,
      T,
      TEventPublisher,
      TEventPublisherServiceName,
      TDatabase,
      TDatabaseServiceName
    >;
  }

  override services<T extends Service[]>(
    services: T,
  ): CronBuilder<
    TInput,
    [...TServices, ...T],
    TLogger,
    OutSchema,
    TEventPublisher,
    TEventPublisherServiceName,
    TDatabase,
    TDatabaseServiceName
  > {
    this._services = uniqBy(
      [...this._services, ...services],
      (s) => s.serviceName,
    ) as TServices;

    return this as unknown as CronBuilder<
      TInput,
      [...TServices, ...T],
      TLogger,
      OutSchema,
      TEventPublisher,
      TEventPublisherServiceName,
      TDatabase,
      TDatabaseServiceName
    >;
  }

  override logger<T extends Logger>(
    logger: T,
  ): CronBuilder<
    TInput,
    TServices,
    T,
    OutSchema,
    TEventPublisher,
    TEventPublisherServiceName,
    TDatabase,
    TDatabaseServiceName
  > {
    this._logger = logger as unknown as TLogger;

    return this as unknown as CronBuilder<
      TInput,
      TServices,
      T,
      OutSchema,
      TEventPublisher,
      TEventPublisherServiceName,
      TDatabase,
      TDatabaseServiceName
    >;
  }

  override publisher<T extends EventPublisher<any>, TName extends string>(
    publisher: Service<TName, T>,
  ): CronBuilder<
    TInput,
    TServices,
    TLogger,
    OutSchema,
    T,
    TName,
    TDatabase,
    TDatabaseServiceName
  > {
    this._publisher = publisher as unknown as Service<
      TEventPublisherServiceName,
      TEventPublisher
    >;

    return this as unknown as CronBuilder<
      TInput,
      TServices,
      TLogger,
      OutSchema,
      T,
      TName,
      TDatabase,
      TDatabaseServiceName
    >;
  }

  /**
   * Set the database service for this cron job.
   * The database will be available in the handler context as `db`.
   */
  override database<T, TName extends string>(
    service: Service<TName, T>,
  ): CronBuilder<
    TInput,
    TServices,
    TLogger,
    OutSchema,
    TEventPublisher,
    TEventPublisherServiceName,
    T,
    TName
  > {
    this._databaseService = service as unknown as Service<
      TDatabaseServiceName,
      TDatabase
    >;

    return this as unknown as CronBuilder<
      TInput,
      TServices,
      TLogger,
      OutSchema,
      TEventPublisher,
      TEventPublisherServiceName,
      T,
      TName
    >;
  }

  override handle(
    fn: FunctionHandler<TInput, TServices, TLogger, OutSchema, TDatabase>,
  ): Cron<
    TInput,
    TServices,
    TLogger,
    OutSchema,
    TEventPublisher,
    TEventPublisherServiceName,
    TDatabase,
    TDatabaseServiceName
  > {
    const cron = new Cron(
      fn,
      this._timeout,
      this._schedule,
      this.inputSchema,
      this.outputSchema,
      this._services,
      this._logger,
      this._publisher,
      this._events,
      this._memorySize,
      this._databaseService,
    );

    // Reset builder state after creating the cron to prevent pollution
    this._services = [] as Service[] as TServices;
    this._logger = DEFAULT_LOGGER;
    this._events = [];
    this._publisher = undefined;
    this._databaseService = undefined;
    this._schedule = undefined;
    this.inputSchema = undefined;
    this.outputSchema = undefined;
    this._timeout = undefined;
    this._memorySize = undefined;

    return cron;
  }
}
