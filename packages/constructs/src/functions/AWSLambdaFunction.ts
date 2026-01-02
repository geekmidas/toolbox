import type { AuditStorage, AuditableAction, Auditor } from '@geekmidas/audit';
import type { EnvironmentParser } from '@geekmidas/envkit';
import middy, { type MiddlewareObj } from '@middy/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Context, Handler } from 'aws-lambda';
import type { Function, FunctionHandler } from './Function';
import { FunctionBuilder } from './FunctionBuilder';

import { wrapError } from '@geekmidas/errors';
import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type {
  ComposableStandardSchema,
  InferComposableStandardSchema,
  InferStandardSchema,
} from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
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
  TDatabase = undefined,
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
> = TEvent & {
  parsedInput: InferComposableStandardSchema<TInput>;
  services: ServiceRecord<TServices>;
  logger: TLogger;
  db: TDatabase | undefined;
  auditor: Auditor<TAuditAction> | undefined;
};

type Middleware<
  TEvent,
  TInput extends ComposableStandardSchema | undefined,
  TServices extends Service[],
  TLogger extends Logger,
  TOutSchema extends StandardSchemaV1 | undefined,
  TDatabase = undefined,
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
> = MiddlewareObj<
  FunctionEvent<TEvent, TInput, TServices, TLogger, TDatabase, TAuditAction>,
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
  TAuditStorage extends AuditStorage | undefined = undefined,
  TAuditStorageServiceName extends string = string,
  TDatabase = undefined,
  TDatabaseServiceName extends string = string,
  TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
    string,
    unknown
  >,
> extends FunctionExecutionWrapper<
  TInput,
  TOutSchema,
  TServices,
  TLogger,
  TEventPublisher,
  TEventPublisherServiceName,
  TAuditStorage,
  TAuditStorageServiceName,
  TDatabase,
  TDatabaseServiceName,
  TAuditAction
> {
  constructor(
    envParser: EnvironmentParser<{}>,
    override readonly fn: Function<
      TInput,
      TServices,
      TLogger,
      TOutSchema,
      TEventPublisher,
      TEventPublisherServiceName,
      TAuditStorage,
      TAuditStorageServiceName,
      TDatabase,
      TDatabaseServiceName,
      TAuditAction,
      FunctionHandler<
        TInput,
        TServices,
        TLogger,
        TOutSchema,
        TDatabase,
        TAuditStorage,
        TAuditAction
      >
    >,
  ) {
    super(envParser, fn);
  }

  private error<TEvent>(): Middleware<
    TEvent,
    TInput,
    TServices,
    TLogger,
    TOutSchema,
    TDatabase,
    TAuditAction
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
    TOutSchema,
    TDatabase,
    TAuditAction
  > {
    return {
      before: (req) => {},
    };
  }

  private input<
    TEvent extends { input: InferComposableStandardSchema<TInput> },
  >(): Middleware<
    TEvent,
    TInput,
    TServices,
    TLogger,
    TOutSchema,
    TDatabase,
    TAuditAction
  > {
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
    TOutSchema,
    TDatabase,
    TAuditAction
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
    TOutSchema,
    TDatabase,
    TAuditAction
  > {
    return {
      before: async (req) => {
        req.event.services = await this.getServices();
      },
    };
  }

  private database<TEvent>(): Middleware<
    TEvent,
    TInput,
    TServices,
    TLogger,
    TOutSchema,
    TDatabase,
    TAuditAction
  > {
    return {
      before: async (req) => {
        req.event.db = await this.getDatabase();
      },
    };
  }

  private auditor<TEvent>(): Middleware<
    TEvent,
    TInput,
    TServices,
    TLogger,
    TOutSchema,
    TDatabase,
    TAuditAction
  > {
    return {
      before: async (req) => {
        req.event.auditor = await this.createAuditor();
      },
      after: async (req) => {
        // Flush any pending audits after successful execution
        if (req.event.auditor) {
          const records = req.event.auditor.getRecords();
          if (records.length > 0) {
            this.logger.debug(
              { auditCount: records.length },
              'Flushing function audits',
            );
            await req.event.auditor.flush();
          }
        }
      },
    };
  }

  private events<TEvent>(): Middleware<
    TEvent,
    TInput,
    TServices,
    TLogger,
    TOutSchema,
    TDatabase,
    TAuditAction
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
    event: FunctionEvent<
      TEvent,
      TInput,
      TServices,
      TLogger,
      TDatabase,
      TAuditAction
    >,
  ) {
    // Execute the function with the parsed context
    const result = await this.fn['fn']({
      input: event.parsedInput,
      services: event.services,
      logger: event.logger,
      db: event.db,
      auditor: event.auditor,
    } as any);

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
      .use(this.database())
      .use(this.auditor())
      .use(this.input())
      .use(this.events()) as unknown as AWSLambdaHandler;
  }
}
