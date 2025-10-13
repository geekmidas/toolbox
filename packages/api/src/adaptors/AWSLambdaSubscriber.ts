import type { EnvironmentParser } from '@geekmidas/envkit';
import middy, { type MiddlewareObj } from '@middy/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type {
  Context,
  Handler,
  SNSEvent,
  SQSEvent,
  SQSRecord,
} from 'aws-lambda';
import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { InferStandardSchema } from '../constructs/types';
import { wrapError } from '../errors';
import type { Service, ServiceRecord } from '../services';
import type { Subscriber } from '../constructs/Subscriber';
import { ServiceDiscovery } from '../services';

export type AWSLambdaHandler<TEvent = any, TResult = any> = Handler<
  TEvent,
  TResult
>;

type SubscriberEvent<TServices extends Service[], TLogger extends Logger> = {
  events: any[];
  services: ServiceRecord<TServices>;
  logger: TLogger;
};

type Middleware<
  TServices extends Service[],
  TLogger extends Logger,
  TOutSchema extends StandardSchemaV1 | undefined,
> = MiddlewareObj<
  SubscriberEvent<TServices, TLogger>,
  InferStandardSchema<TOutSchema>,
  Error,
  Context
>;

export class AWSLambdaSubscriber<
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TSubscribedEvents extends any[] = [],
> {
  private _logger!: TLogger;
  private _services!: ServiceRecord<TServices>;

  constructor(
    private envParser: EnvironmentParser<{}>,
    readonly subscriber: Subscriber<
      TServices,
      TLogger,
      OutSchema,
      TEventPublisher,
      TEventPublisherServiceName,
      TSubscribedEvents
    >,
  ) {
    this._logger = subscriber.logger;
  }

  get logger(): TLogger {
    return this._logger;
  }

  private async getServices(): Promise<ServiceRecord<TServices>> {
    if (this._services) {
      return this._services;
    }

    const serviceDiscovery = ServiceDiscovery.getInstance(
      this.logger,
      this.envParser,
    );

    if (this.subscriber.services.length > 0) {
      const registered = await serviceDiscovery.register(
        this.subscriber.services,
      );
      this._services = registered as ServiceRecord<TServices>;
    } else {
      this._services = {} as ServiceRecord<TServices>;
    }

    return this._services;
  }

  private error(): Middleware<TServices, TLogger, OutSchema> {
    return {
      onError: (req) => {
        const logger = req.event?.logger || this.subscriber.logger;
        logger.error(req.error || {}, 'Error processing subscriber');

        // Re-throw the wrapped error to let Lambda handle it
        throw wrapError(req.error);
      },
    };
  }

  private loggerMiddleware(): Middleware<TServices, TLogger, OutSchema> {
    return {
      before: (req) => {
        this._logger = this.subscriber.logger.child({
          subscriber: {
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

  private services(): Middleware<TServices, TLogger, OutSchema> {
    return {
      before: async (req) => {
        req.event.services = await this.getServices();
      },
    };
  }

  private parseEvents(): Middleware<TServices, TLogger, OutSchema> {
    return {
      before: async (req) => {
        const rawEvent = (req as any).event as SQSEvent | SNSEvent;

        // Parse events based on the event type
        const events: any[] = [];

        if ('Records' in rawEvent) {
          if (this.isSQSEvent(rawEvent)) {
            // SQS Event
            for (const record of rawEvent.Records) {
              try {
                const event = this.parseSQSRecord(record);
                if (event && this.isSubscribedEvent(event.type)) {
                  events.push(event);
                }
              } catch (error) {
                this.logger.error(
                  { error, record },
                  'Failed to parse SQS record',
                );
              }
            }
          } else if (this.isSNSEvent(rawEvent)) {
            // SNS Event
            for (const record of rawEvent.Records) {
              try {
                const event = JSON.parse(record.Sns.Message);
                if (event && this.isSubscribedEvent(event.type)) {
                  events.push(event);
                }
              } catch (error) {
                this.logger.error(
                  { error, record },
                  'Failed to parse SNS record',
                );
              }
            }
          }
        }

        (req.event as any).events = events;
      },
    };
  }

  private isSQSEvent(event: SQSEvent | SNSEvent): event is SQSEvent {
    return (
      'Records' in event &&
      event.Records.length > 0 &&
      'eventSource' in event.Records[0] &&
      event.Records[0].eventSource === 'aws:sqs'
    );
  }

  private isSNSEvent(event: SQSEvent | SNSEvent): event is SNSEvent {
    return (
      'Records' in event &&
      event.Records.length > 0 &&
      'EventSource' in event.Records[0] &&
      event.Records[0].EventSource === 'aws:sns'
    );
  }

  private parseSQSRecord(record: SQSRecord): any | null {
    try {
      const body = JSON.parse(record.body);

      // Check if this is an SNS message wrapped in SQS
      if (body.Type === 'Notification' && body.Message) {
        // Parse the SNS message
        const snsMessage = JSON.parse(body.Message);
        return snsMessage;
      }

      // Direct SQS message
      return body;
    } catch (error) {
      this.logger.error({ error, record }, 'Failed to parse SQS record body');
      return null;
    }
  }

  private isSubscribedEvent(eventType: string): boolean {
    if (!this.subscriber.subscribedEvents) {
      return true; // If no events specified, accept all
    }

    return this.subscriber.subscribedEvents.includes(eventType as any);
  }

  private async _handler(event: SubscriberEvent<TServices, TLogger>) {
    // If no events after filtering, return early
    if (event.events.length === 0) {
      this.logger.info('No subscribed events to process');
      return {
        batchItemFailures: [],
      };
    }

    // Execute the subscriber with the parsed context
    const result = await this.subscriber.handler({
      events: event.events,
      services: event.services,
      logger: event.logger,
    });

    // Parse output if schema is provided
    if (this.subscriber.outputSchema && result) {
      const validationResult =
        await this.subscriber.outputSchema['~standard'].validate(result);

      if (validationResult.issues) {
        this.logger.error(
          { issues: validationResult.issues },
          'Subscriber output validation failed',
        );
        throw new Error('Subscriber output validation failed');
      }

      return validationResult.value;
    }

    return result;
  }

  get handler(): AWSLambdaHandler {
    const handler = this._handler.bind(this);

    // Apply middleware in order
    return middy(handler)
      .use(this.loggerMiddleware())
      .use(this.error())
      .use(this.services())
      .use(this.parseEvents()) as unknown as AWSLambdaHandler;
  }
}
