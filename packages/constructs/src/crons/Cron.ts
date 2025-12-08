import type { Logger } from '@geekmidas/logger';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import { ConstructType } from '../Construct';
import { Function, type FunctionHandler } from '../functions';

import type { EventPublisher } from '@geekmidas/events';
import type { ComposableStandardSchema } from '@geekmidas/schema';
import type { Service } from '@geekmidas/services';

export class Cron<
  TInput extends ComposableStandardSchema | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TDatabase = undefined,
  TDatabaseServiceName extends string = string,
> extends Function<
  TInput,
  TServices,
  TLogger,
  OutSchema,
  FunctionHandler<TInput, TServices, TLogger, OutSchema, TDatabase>,
  TEventPublisher,
  TEventPublisherServiceName,
  undefined,
  string,
  TDatabase,
  TDatabaseServiceName
> {
  static isCron(obj: any): obj is Cron<any, any, any, any> {
    return Boolean(
      obj &&
        (obj as Function).__IS_FUNCTION__ === true &&
        obj.type === ConstructType.Cron,
    );
  }

  constructor(
    fn: FunctionHandler<TInput, TServices, TLogger, OutSchema, TDatabase>,
    timeout?: number,
    protected _schedule?: ScheduleExpression,
    input?: TInput,
    outputSchema?: OutSchema,
    services: TServices = [] as unknown as TServices,
    logger?: TLogger,
    publisherService?: Service<TEventPublisherServiceName, TEventPublisher>,
    events: any[] = [],
    memorySize?: number,
    databaseService?: Service<TDatabaseServiceName, TDatabase>,
  ) {
    super(
      fn,
      timeout,
      ConstructType.Cron,
      input,
      outputSchema,
      services,
      logger,
      publisherService,
      events,
      memorySize,
      undefined, // auditorStorageService
      databaseService,
    );
  }

  get schedule(): ScheduleExpression | undefined {
    return this._schedule;
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
