import type { StandardSchemaV1 } from '@standard-schema/spec';
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
