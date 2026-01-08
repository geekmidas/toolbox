import type {
	EventPublisher,
	ExtractPublisherMessage,
} from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Subscriber, type SubscriberHandler } from './Subscriber';

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
		const subscriber = new Subscriber(
			fn,
			this._timeout,
			this._subscribedEvents,
			this.outputSchema,
			this._services,
			this._logger,
			this._publisher,
		);

		// Reset builder state after creating the subscriber to prevent pollution
		this._services = [] as Service[] as TServices;
		this._logger = DEFAULT_LOGGER;
		this._publisher = undefined;
		this._subscribedEvents = [] as any;
		this._timeout = 30000; // Reset to default
		this.outputSchema = undefined;

		return subscriber;
	}
}
