import { EnvironmentParser } from '@geekmidas/envkit';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Function } from '../constructs/Function';
import { FunctionBuilder } from '../constructs/FunctionBuilder';
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

export class TestFunctionAdaptor<
  TInput extends StandardSchemaV1 | undefined = undefined,
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
> {
  static getDefaultServiceDiscovery<
    TInput extends ComposableStandardSchema | undefined = undefined,
    TOutSchema extends StandardSchemaV1 | undefined = undefined,
    TServices extends Service[] = [],
    TLogger extends Logger = Logger,
    TEventPublisher extends EventPublisher<any> | undefined = undefined,
    TEventPublisherServiceName extends string = string,
  >(
    fn: Function<
      TInput,
      TServices,
      TLogger,
      TOutSchema,
      any,
      TEventPublisher,
      TEventPublisherServiceName
    >,
  ) {
    return ServiceDiscovery.getInstance(fn.logger, new EnvironmentParser({}));
  }

  constructor(
    private readonly fn: Function<
      TInput,
      TServices,
      TLogger,
      TOutSchema,
      any,
      TEventPublisher,
      TEventPublisherServiceName
    >,
    private serviceDiscovery: ServiceDiscovery<
      any,
      any
    > = TestFunctionAdaptor.getDefaultServiceDiscovery(fn),
  ) {}

  async invoke(
    ctx: TestFunctionRequest<
      TInput,
      TServices,
      TEventPublisher,
      TEventPublisherServiceName
    >,
  ): Promise<InferStandardSchema<TOutSchema>> {
    // Parse input if schema is provided

    const parsedInput = await FunctionBuilder.parseComposableStandardSchema(
      ctx.input,
      this.fn.input,
    );

    // Create logger with context
    const logger = this.fn.logger.child({
      test: true,
    }) as TLogger;

    // Register services (use provided services or register from function)
    let services: ServiceRecord<TServices>;
    if (ctx.services) {
      services = ctx.services;
    } else {
      services = await this.serviceDiscovery.register(this.fn.services);
    }

    // Execute the function
    const response = await this.fn['fn']({
      input: parsedInput,
      services,
      logger,
    });

    // Parse output if schema is provided
    const output = await this.fn.parseOutput(response);

    // Register publisher service if provided in context

    await publishEvents(
      logger,
      this.serviceDiscovery,
      this.fn.events,
      output,
      this.fn.publisherService,
    );

    return output;
  }
}

export type TestFunctionRequest<
  TInput extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
> = {
  input: InferComposableStandardSchema<TInput>;
  services: ServiceRecord<TServices>;
  publisher?: Service<TEventPublisherServiceName, TEventPublisher>;
} & InferComposableStandardSchema<{ input: TInput }>;
