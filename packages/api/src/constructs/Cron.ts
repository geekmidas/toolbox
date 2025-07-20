import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Logger } from '../logger';
import type { Service } from '../service-discovery';
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
  | `*/${number}`;

type CronHour =
  | '*'
  | number
  | `${number}`
  | `${number}-${number}`
  | `${number}/${number}`
  | `*/${number}`;

type CronDay =
  | '*'
  | number
  | `${number}`
  | `${number}-${number}`
  | `${number}/${number}`
  | `*/${number}`;

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
  | 'DEC';

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
  | 'SAT';
export type CronExpression =
  `cron(${CronMinute} ${CronHour} ${CronDay} ${CronMonth} ${CronWeekday})`;

export type ScheduleExpression = RateExpression | CronExpression;
