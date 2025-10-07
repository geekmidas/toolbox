import type { EnvironmentParser } from '@geekmidas/envkit';
import middy, { type MiddlewareObj } from '@middy/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Context, Handler, ScheduledEvent } from 'aws-lambda';
import type { Cron } from '../constructs/Cron';
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

export type AWSScheduledHandler = Handler<ScheduledEvent, any>;

type ScheduledFunctionEvent<
  TInput extends ComposableStandardSchema | undefined,
  TServices extends Service[],
  TLogger extends Logger,
> = ScheduledEvent & {
  parsedInput: InferComposableStandardSchema<TInput>;
  services: ServiceRecord<TServices>;
  logger: TLogger;
};

type Middleware<
  TInput extends ComposableStandardSchema | undefined,
  TServices extends Service[],
  TLogger extends Logger,
  TOutSchema extends StandardSchemaV1 | undefined,
> = MiddlewareObj<
  ScheduledFunctionEvent<TInput, TServices, TLogger>,
  InferComposableStandardSchema<TOutSchema>,
  Error,
  Context
>;

export class AWSScheduledFunction<
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
    readonly cron: Cron<
      TInput,
      TServices,
      TLogger,
      TOutSchema,
      TEventPublisher,
      TEventPublisherServiceName
    >,
  ) {
    super(envParser, cron);
  }

  private error(): Middleware<TInput, TServices, TLogger, TOutSchema> {
    return {
      onError: (req) => {
        const logger = req.event?.logger || this.fn.logger;
        logger.error(req.error || {}, 'Error processing scheduled function');

        // Re-throw the wrapped error to let Lambda handle it
        throw wrapError(req.error);
      },
    };
  }

  private input(): Middleware<TInput, TServices, TLogger, TOutSchema> {
    return {
      before: async (req) => {
        try {
          // For scheduled events, we might want to parse the input from event.detail
          // or use a default input if no schema is provided
          if (this.fn.input && req.event.detail) {
            const parsedInput = await this.parseComposableStandardSchema(
              req.event.detail,
              this.fn.input,
            );

            req.event.parsedInput =
              parsedInput as InferComposableStandardSchema<TInput>;
          } else {
            // If no schema or no detail, pass empty object
            req.event.parsedInput = {} as any;
          }
        } catch (error) {
          this.logger.error(
            { error, event: req.event },
            'Failed to parse scheduled event input',
          );
          throw error;
        }
      },
    };
  }

  private loggerMiddleware(): Middleware<
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
          event: {
            id: req.event.id,
            source: req.event.source,
            time: req.event.time,
            account: req.event.account,
            region: req.event.region,
          },
        }) as TLogger;

        req.event.logger = this._logger;
      },
    };
  }

  private services(): Middleware<TInput, TServices, TLogger, TOutSchema> {
    return {
      before: async (req) => {
        req.event.services = await this.getServices();
      },
    };
  }

  private events(): Middleware<TInput, TServices, TLogger, TOutSchema> {
    return {
      after: async (req) => {
        const response = (req.response ||
          undefined) as InferStandardSchema<TOutSchema>;
        await this.publishEvents(response);
      },
    };
  }

  private async _handler(
    event: ScheduledFunctionEvent<TInput, TServices, TLogger>,
  ) {
    // Execute the cron function with the parsed context
    const result = await (this.fn as any)['fn']({
      input: event.parsedInput,
      services: event.services,
      logger: event.logger,
    });

    // Parse output if schema is provided
    const output = await this.fn.parseOutput(result);

    return output;
  }

  get handler(): AWSScheduledHandler {
    const handler = this._handler.bind(this);

    // Apply middleware in order
    return middy(handler)
      .use(this.loggerMiddleware())
      .use(this.error())
      .use(this.services())
      .use(this.input())
      .use(this.events()) as unknown as AWSScheduledHandler;
  }
}
