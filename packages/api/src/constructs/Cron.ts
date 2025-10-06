import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Logger } from '../logger';
import type { Service } from '../services';
import { Function, FunctionBuilder, type FunctionHandler } from './Function';
import { type ComposableStandardSchema, FunctionType } from './types';

export class Cron<
  TInput extends ComposableStandardSchema,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
> extends Function<TInput, TServices, TLogger, OutSchema> {
  static isCron(obj: any): obj is Cron<any, any, any, any> {
    return (
      obj &&
      (obj as Function).__IS_FUNCTION__ === true &&
      obj.type === FunctionType.Cron
    );
  }

  constructor(
    fn: FunctionHandler<TInput, TServices, TLogger, OutSchema>,
    timeout?: number,
    protected _schedule?: ScheduleExpression,
    input?: TInput,
    outputSchema?: OutSchema,
    services: TServices = [] as Service[] as TServices,
    logger?: TLogger,
  ) {
    super(
      fn,
      timeout,
      FunctionType.Cron,
      input,
      outputSchema,
      services,
      logger,
    );
  }

  get schedule(): ScheduleExpression | undefined {
    return this._schedule;
  }
}

export class CronBuilder<
  TInput extends ComposableStandardSchema,
  TServices extends Service[],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
> extends FunctionBuilder<TInput, OutSchema, TServices, TLogger> {
  private _schedule?: ScheduleExpression;
  constructor() {
    super(FunctionType.Cron);
  }

  schedule(
    _expression: ScheduleExpression,
  ): CronBuilder<TInput, TServices, TLogger, OutSchema> {
    this._schedule = _expression;
    return this;
  }

  // Override parent methods to return CronBuilder instead of FunctionBuilder
  override services<T extends Service[]>(
    services: T,
  ): CronBuilder<TInput, [...TServices, ...T], TLogger, OutSchema> {
    super.services(services);
    return this as unknown as CronBuilder<
      TInput,
      [...TServices, ...T],
      TLogger,
      OutSchema
    >;
  }

  override logger<T extends Logger>(
    logger: T,
  ): CronBuilder<TInput, TServices, T, OutSchema> {
    super.logger(logger);
    return this as unknown as CronBuilder<TInput, TServices, T, OutSchema>;
  }

  override timeout(
    timeout: number,
  ): CronBuilder<TInput, TServices, TLogger, OutSchema> {
    super.timeout(timeout);
    return this as unknown as CronBuilder<
      TInput,
      TServices,
      TLogger,
      OutSchema
    >;
  }

  override output<T extends StandardSchemaV1>(
    schema: T,
  ): CronBuilder<TInput, TServices, TLogger, T> {
    super.output(schema);
    return this as unknown as CronBuilder<TInput, TServices, TLogger, T>;
  }

  override input<T extends ComposableStandardSchema>(
    schema: T,
  ): CronBuilder<T, TServices, TLogger, OutSchema> {
    super.input(schema);
    return this as unknown as CronBuilder<T, TServices, TLogger, OutSchema>;
  }

  handle(
    fn: FunctionHandler<TInput, TServices, TLogger, OutSchema>,
  ): Cron<TInput, TServices, TLogger, OutSchema> {
    return new Cron(
      fn,
      this._timeout,
      this._schedule,
      this.inputSchema,
      this.outputSchema,
      this._services,
      this._logger,
    );
  }
}

export type RateExpression = `rate(${string})`;

type CronMinute =
  | '*'
  | number
  | `${number}`
  | `${number}-${number}`
  | `${number}/${number}`
  | `*/${number}`
  | `${number},${number}`
  | string; // Allow more complex patterns

type CronHour =
  | '*'
  | number
  | `${number}`
  | `${number}-${number}`
  | `${number}/${number}`
  | `*/${number}`
  | `${number},${number}`
  | string; // Allow more complex patterns

type CronDay =
  | '*'
  | number
  | `${number}`
  | `${number}-${number}`
  | `${number}/${number}`
  | `*/${number}`
  | `${number},${number}`
  | string; // Allow more complex patterns

type CronMonth =
  | '*'
  | number
  | `${number}`
  | `${number}-${number}`
  | `${number}/${number}`
  | `*/${number}`
  | 'JAN'
  | 'FEB'
  | 'MAR'
  | 'APR'
  | 'MAY'
  | 'JUN'
  | 'JUL'
  | 'AUG'
  | 'SEP'
  | 'OCT'
  | 'NOV'
  | 'DEC'
  | string; // Allow more complex patterns

type CronWeekday =
  | '*'
  | number
  | `${number}`
  | `${number}-${number}`
  | `${number}/${number}`
  | `*/${number}`
  | 'SUN'
  | 'MON'
  | 'TUE'
  | 'WED'
  | 'THU'
  | 'FRI'
  | 'SAT'
  | `${string}-${string}` // Allow patterns like MON-FRI
  | string; // Allow more complex patterns

export type CronExpression =
  `cron(${CronMinute} ${CronHour} ${CronDay} ${CronMonth} ${CronWeekday})`;

export type ScheduleExpression = RateExpression | CronExpression;
