import type { Logger } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import { Construct, ConstructType } from '../Construct';

import type {
  EventPublisher,
  ExtractPublisherMessage,
} from '@geekmidas/events';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';

const DEFAULT_LOGGER = new ConsoleLogger() as any;

// Helper type to extract payload types for subscribed events
type ExtractEventPayloads<
  TPublisher extends EventPublisher<any> | undefined,
  TEventTypes extends any[],
> = TPublisher extends EventPublisher<any>
  ? Extract<ExtractPublisherMessage<TPublisher>, { type: TEventTypes[number] }>
  : never;

export class Subscriber<
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TSubscribedEvents extends
    ExtractPublisherMessage<TEventPublisher>['type'][] = ExtractPublisherMessage<TEventPublisher>['type'][],
> extends Construct<
  TLogger,
  TEventPublisherServiceName,
  TEventPublisher,
  OutSchema,
  TServices
> {
  __IS_SUBSCRIBER__ = true;

  static isSubscriber(
    obj: any,
  ): obj is Subscriber<any, any, any, any, any, any> {
    return Boolean(
      obj &&
        obj.__IS_SUBSCRIBER__ === true &&
        obj.type === ConstructType.Subscriber,
    );
  }

  constructor(
    public readonly handler: SubscriberHandler<
      TEventPublisher,
      TSubscribedEvents,
      TServices,
      TLogger,
      OutSchema
    >,
    public override readonly timeout: number = 30000,
    protected _subscribedEvents?: TSubscribedEvents,
    public override readonly outputSchema?: OutSchema,
    public override readonly services: TServices = [] as unknown as TServices,
    public override readonly logger: TLogger = DEFAULT_LOGGER as TLogger,
    public override readonly publisherService?: Service<
      TEventPublisherServiceName,
      TEventPublisher
    >,
  ) {
    super(
      ConstructType.Subscriber,
      logger,
      services,
      [],
      publisherService,
      outputSchema,
    );
  }

  get subscribedEvents(): TSubscribedEvents | undefined {
    return this._subscribedEvents;
  }
}

// Handler type for subscribers that receives an array of events
export type SubscriberHandler<
  TEventPublisher extends EventPublisher<any> | undefined,
  TSubscribedEvents extends ExtractPublisherMessage<TEventPublisher>['type'][],
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
> = (
  ctx: SubscriberContext<
    TEventPublisher,
    TSubscribedEvents,
    TServices,
    TLogger
  >,
) => OutSchema extends StandardSchemaV1
  ? InferStandardSchema<OutSchema> | Promise<InferStandardSchema<OutSchema>>
  : any | Promise<any>;

// Context type for subscriber handlers
export type SubscriberContext<
  TEventPublisher extends EventPublisher<any> | undefined,
  TSubscribedEvents extends ExtractPublisherMessage<TEventPublisher>['type'][],
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
> = {
  events: ExtractEventPayloads<TEventPublisher, TSubscribedEvents>[];
  services: ServiceRecord<TServices>;
  logger: TLogger;
};
