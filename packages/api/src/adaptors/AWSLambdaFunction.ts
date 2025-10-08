import type { EnvironmentParser } from '@geekmidas/envkit';
import middy, { type MiddlewareObj } from '@middy/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Context, Handler } from 'aws-lambda';
import type { Function, FunctionHandler } from '../constructs/Function';
import { FunctionBuilder } from '../constructs/FunctionBuilder';
import type { EventPublisher } from '../constructs/events';
import type {
  ComposableStandardSchema,
  InferComposableStandardSchema,
  InferStandardSchema,
} from '../constructs/types';
import { wrapError } from '../errors';
import type { Logger } from '../logger';
import type { Service, ServiceRecord } from '../services';
import { FunctionExecutionWrapper } from './FunctionExecutionWrapper';

export type AWSLambdaHandler<TEvent = any, TResult = any> = Handler<
  TEvent,
  TResult
>;

type FunctionEvent<
  TEvent,
  TInput extends ComposableStandardSchema | undefined,
  TServices extends Service[],
  TLogger extends Logger,
> = TEvent & {
  parsedInput: InferComposableStandardSchema<TInput>;
  services: ServiceRecord<TServices>;
  logger: TLogger;
};

type Middleware<
  TEvent,
  TInput extends ComposableStandardSchema | undefined,
  TServices extends Service[],
  TLogger extends Logger,
  TOutSchema extends StandardSchemaV1 | undefined,
> = MiddlewareObj<
  FunctionEvent<TEvent, TInput, TServices, TLogger>,
  InferComposableStandardSchema<TOutSchema>,
  Error,
  Context
>;

export class AWSLambdaFunction<
  TInput extends ComposableStandardSchema | undefined = undefined,
  TOutSchema extends StandardSchemaV1 | undefined = undefined,
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
> extends FunctionExecutionWrapper<
  TInput,
  TOutSchema,
  TServices,
  TLogger,
  TEventPublisher,
  TEventPublisherServiceName
> {
  constructor(
    envParser: EnvironmentParser<{}>,
    readonly fn: Function<
      TInput,
      TServices,
      TLogger,
      TOutSchema,
      FunctionHandler<TInput, TServices, TLogger, TOutSchema>,
      TEventPublisher,
      TEventPublisherServiceName
    >,
  ) {
    super(envParser, fn);
  }

  private error<TEvent>(): Middleware<
    TEvent,
    TInput,
    TServices,
    TLogger,
    TOutSchema
  > {
    return {
      onError: (req) => {
        const logger = req.event?.logger || this.fn.logger;
        logger.error(req.error || {}, 'Error processing function');

        // Re-throw the wrapped error to let Lambda handle it
        throw wrapError(req.error);
      },
    };
  }

  private baseInput<TEvent>(): Middleware<
    TEvent,
    TInput,
    TServices,
    TLogger,
    TOutSchema
  > {
    return {
      before: (req) => {},
    };
  }

  private input<
    TEvent extends { input: InferComposableStandardSchema<TInput> },
  >(): Middleware<TEvent, TInput, TServices, TLogger, TOutSchema> {
    return {
      before: async (req) => {
        try {
          // Parse input if schema is provided
          if (this.fn.input) {
            const parsedInput =
              await FunctionBuilder.parseComposableStandardSchema(
                req.event,
                this.fn.input,
              );

            req.event.parsedInput =
              parsedInput as InferComposableStandardSchema<TInput>;
          } else {
            // If no schema, pass the event as-is
            req.event.parsedInput = req.event as any;
          }
        } catch (error) {
          this.logger.error(
            { error, event: req.event },
            'Failed to parse input',
          );
          throw error;
        }
      },
    };
  }

  private loggerMiddleware<TEvent>(): Middleware<
    TEvent,
    TInput,
    TServices,
    TLogger,
    TOutSchema
  > {
    return {
      before: (req) => {
        this._logger = this.fn.logger.child({
          fn: {
            name: req.context.functionName,
            version: req.context.functionVersion,
            memory: req.context.memoryLimitInMB,
          },
          req: {
            id: req.context.awsRequestId,
          },
        }) as TLogger;

        req.event.logger = this._logger;
      },
    };
  }

  private services<TEvent>(): Middleware<
    TEvent,
    TInput,
    TServices,
    TLogger,
    TOutSchema
  > {
    return {
      before: async (req) => {
        req.event.services = await this.getServices();
      },
    };
  }

  private events<TEvent>(): Middleware<
    TEvent,
    TInput,
    TServices,
    TLogger,
    TOutSchema
  > {
    return {
      after: async (req) => {
        const response = (req.response ||
          undefined) as InferStandardSchema<TOutSchema>;
        await this.publishEvents(response);
      },
    };
  }

  private async _handler<TEvent>(
    event: FunctionEvent<TEvent, TInput, TServices, TLogger>,
  ) {
    // Execute the function with the parsed context
    const result = await this.fn['fn']({
      input: event.parsedInput,
      services: event.services,
      logger: event.logger,
    });

    // Parse output if schema is provided
    const output = await this.fn.parseOutput(result);

    return output;
  }

  get handler(): AWSLambdaHandler {
    const handler = this._handler.bind(this);

    // Apply middleware in order
    return middy(handler)
      .use(this.loggerMiddleware())
      .use(this.baseInput())
      .use(this.error())
      .use(this.services())
      .use(this.input())
      .use(this.events()) as unknown as AWSLambdaHandler;
  }
}
