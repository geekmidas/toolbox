import type { EnvironmentParser } from '@geekmidas/envkit';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
  type Function,
  FunctionBuilder,
  type FunctionHandler,
} from '../constructs/Function';
import type { EventPublisher } from '../constructs/events';
import { publishEvents } from '../constructs/publisher';
import type {
  ComposableStandardSchema,
  InferComposableStandardSchema,
  InferStandardSchema,
} from '../constructs/types';
import type { Logger } from '../logger';
import {
  type Service,
  ServiceDiscovery,
  type ServiceRecord,
} from '../services';

export abstract class FunctionExecutionWrapper<
  TInput extends ComposableStandardSchema | undefined = undefined,
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
> {
  constructor(
    protected envParser: EnvironmentParser<{}>,
    protected readonly fn: Function<
      TInput,
      TServices,
      TLogger,
      TOutSchema,
      FunctionHandler<TInput, TServices, TLogger, TOutSchema>,
      TEventPublisher,
      TEventPublisherServiceName
    >,
  ) {}

  protected _logger?: TLogger;

  get logger(): TLogger {
    return this._logger || this.fn.logger;
  }

  get serviceDiscovery(): ServiceDiscovery<ServiceRecord<TServices>, Logger> {
    const serviceDiscovery = ServiceDiscovery.getInstance<
      ServiceRecord<TServices>,
      TLogger
    >(this.logger, this.envParser);

    return serviceDiscovery;
  }

  getServices(): Promise<ServiceRecord<TServices>> {
    return this.serviceDiscovery.register(this.fn.services);
  }

  async getFunctionInput<TEvent>(
    event: TEvent,
  ): Promise<InferComposableStandardSchema<TInput>> {
    const parsedInput = await FunctionBuilder.parseComposableStandardSchema(
      event,
      this.fn.input,
    );

    return parsedInput as InferComposableStandardSchema<TInput>;
  }

  async publishEvents(response: InferStandardSchema<TOutSchema>) {
    await publishEvents(
      this.logger,
      this.serviceDiscovery,
      this.fn.events,
      response,
      this.fn.publisherService,
    );
  }
}
