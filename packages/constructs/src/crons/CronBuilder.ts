import type { Logger } from '@geekmidas/logger';
import type { ComposableStandardSchema } from '@geekmidas/schema';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { ConstructType } from '../Construct';
import { FunctionBuilder, type FunctionHandler } from '../functions';
import { Cron, type ScheduleExpression } from './Cron';

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
