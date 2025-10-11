import type { StandardSchemaV1 } from '@standard-schema/spec';
import { ConsoleLogger, type Logger } from '../logger';
import type { Service, ServiceRecord } from '../services';
import { Construct, ConstructType } from './Construct';
import type { EventPublisher, ExtractPublisherMessage } from './events';
import type { InferStandardSchema } from './types';

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
> extends Construct {
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
    public readonly timeout: number = 30000,
    protected _subscribedEvents?: TSubscribedEvents,
    public readonly outputSchema?: OutSchema,
    public readonly services: TServices = [] as Service[] as TServices,
    public readonly logger: TLogger = DEFAULT_LOGGER as TLogger,
    public readonly publisherService?: Service<
      TEventPublisherServiceName,
      TEventPublisher
    >,
  ) {
    super(ConstructType.Subscriber);
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

export class SubscriberBuilder<
  TServices extends Service[] = [],
  TLogger extends Logger = Logger,
  OutSchema extends StandardSchemaV1 | undefined = undefined,
  TEventPublisher extends EventPublisher<any> | undefined = undefined,
  TEventPublisherServiceName extends string = string,
  TSubscribedEvents extends any[] = [],
> {
  private _subscribedEvents: TSubscribedEvents = [] as any;
  private _timeout?: number;
  private outputSchema?: OutSchema;
  private _services: TServices = [] as Service[] as TServices;
  private _logger: TLogger = DEFAULT_LOGGER;
  private _publisher?: Service<TEventPublisherServiceName, TEventPublisher>;

  constructor() {
    this._timeout = 30000; // Default timeout
  }

  timeout(timeout: number): this {
    this._timeout = timeout;
    return this;
  }

  output<T extends StandardSchemaV1>(
    schema: T,
  ): SubscriberBuilder<
    TServices,
    TLogger,
    T,
    TEventPublisher,
    TEventPublisherServiceName,
    TSubscribedEvents
  > {
    this.outputSchema = schema as unknown as OutSchema;
    return this as any;
  }

  services<T extends Service[]>(
    services: T,
  ): SubscriberBuilder<
    [...TServices, ...T],
    TLogger,
    OutSchema,
    TEventPublisher,
    TEventPublisherServiceName,
    TSubscribedEvents
  > {
    this._services = [...this._services, ...services] as any;
    return this as any;
  }

  logger<T extends Logger>(
    logger: T,
  ): SubscriberBuilder<
    TServices,
    T,
    OutSchema,
    TEventPublisher,
    TEventPublisherServiceName,
    TSubscribedEvents
  > {
    this._logger = logger as unknown as TLogger;
    return this as any;
  }

  publisher<T extends EventPublisher<any>, TName extends string>(
    publisher: Service<TName, T>,
  ): SubscriberBuilder<
    TServices,
    TLogger,
    OutSchema,
    T,
    TName,
    TSubscribedEvents
  > {
    this._publisher = publisher as any;
    return this as any;
  }

  subscribe<
    TEvent extends TEventPublisher extends EventPublisher<any>
      ?
          | ExtractPublisherMessage<TEventPublisher>['type']
          | ExtractPublisherMessage<TEventPublisher>['type'][]
      : never,
  >(
    event: TEvent,
  ): SubscriberBuilder<
    TServices,
    TLogger,
    OutSchema,
    TEventPublisher,
    TEventPublisherServiceName,
    TEvent extends any[]
      ? [...TSubscribedEvents, ...TEvent]
      : [...TSubscribedEvents, TEvent]
  > {
    const eventsToAdd = Array.isArray(event) ? event : [event];
    this._subscribedEvents = [...this._subscribedEvents, ...eventsToAdd] as any;
    return this as any;
  }

  handle(
    fn: SubscriberHandler<
      TEventPublisher,
      TSubscribedEvents,
      TServices,
      TLogger,
      OutSchema
    >,
  ): Subscriber<
    TServices,
    TLogger,
    OutSchema,
    TEventPublisher,
    TEventPublisherServiceName,
    TSubscribedEvents
  > {
    return new Subscriber(
      fn,
      this._timeout,
      this._subscribedEvents,
      this.outputSchema,
      this._services,
      this._logger,
      this._publisher,
    );
  }
}
