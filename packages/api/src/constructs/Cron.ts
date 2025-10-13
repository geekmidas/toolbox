import type { Logger } from '@geekmidas/logger';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Service } from '../services';
import { ConstructType } from './Construct';
import { Function, type FunctionHandler } from './Function';
import { FunctionBuilder } from './FunctionBuilder';

import type { EventPublisher } from '@geekmidas/events';
import type { ComposableStandardSchema } from './types';

export class Cron<
  TInput extends ComposableStandardSchema | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
> extends Function<
  TInput,
  TServices,
  TLogger,
  OutSchema,
  FunctionHandler<TInput, TServices, TLogger, OutSchema>,
  TEventPublisher,
  TEventPublisherServiceName
> {
  static isCron(obj: any): obj is Cron<any, any, any, any> {
    return Boolean(
      obj &&
        (obj as Function).__IS_FUNCTION__ === true &&
        obj.type === ConstructType.Cron,
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
      ConstructType.Cron,
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
    super(ConstructType.Cron);
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
