import type {
	EventPublisher,
	ExtractPublisherMessage,
} from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { cloneWith } from '../clone';
import {
	type Consumable,
	databaseEdges,
	idsOf,
	type ServicesOf,
	serviceOf,
	servicesOf,
} from '../construct-interface';
import type { Topic, TopicEvents, TopicMessage } from '../topic/Topic';
import { Subscriber, type SubscriberHandler } from './Subscriber';

export class SubscriberBuilder<
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TEventPublisher extends EventPublisher<any> | undefined = undefined,
	TSubscribedEvents extends any[] = [],
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> {
	private _subscribedEvents: TSubscribedEvents = [] as any;
	private _timeout?: number;
	private outputSchema?: OutSchema;
	private _services: TServices = [] as Service[] as TServices;
	/** The construct ids `.dependsOn()` named — what the manifest records. */
	public _constructs: string[] = [];
	private _logger: TLogger = DEFAULT_LOGGER;
	/**
	 * The deploy unit that runs this, by construct id. Seeded by the factory a
	 * `Worker` hands out, so a subscriber is not owned by its directory.
	 */
	public _owner?: string;
	private _topicName?: string;
	/** What the handler's `db` comes from — the worker's, unless overridden. */
	private _databaseService?: Service<TDatabaseServiceName, TDatabase>;
	/** The edge `.database()` added, so the next one can replace it. */
	private _databaseEdge?: string;

	constructor() {
		this._timeout = 30000; // Default timeout
	}

	/**
	 * Bind this subscriber to a {@link Topic}: the subscribable event types (and
	 * their payloads) come from the topic's contract, and the binding is recorded
	 * for the manifest, so infra wires the SNS subscription.
	 *
	 * A consumer does not publish, so binding a topic does *not* hand it the
	 * topic's publisher connection string (least privilege). One that publishes
	 * follow-up events depends on the topic it publishes to: `.dependsOn([orders])`.
	 */
	topic<TName extends string, TEvents extends TopicEvents>(
		topic: Topic<TName, TEvents>,
	): SubscriberBuilder<
		TServices,
		TLogger,
		OutSchema,
		EventPublisher<TopicMessage<TEvents>>,
		TSubscribedEvents,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			_topicName: topic.name,
		}) as unknown as SubscriberBuilder<
			TServices,
			TLogger,
			OutSchema,
			EventPublisher<TopicMessage<TEvents>>,
			TSubscribedEvents,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	timeout(timeout: number): this {
		return cloneWith(this, { _timeout: timeout });
	}

	output<T extends StandardSchemaV1>(
		schema: T,
	): SubscriberBuilder<
		TServices,
		TLogger,
		T,
		TEventPublisher,
		TSubscribedEvents,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			outputSchema: schema as unknown as OutSchema,
		}) as any;
	}

	/**
	 * Depend on constructs — a database, a bucket, a mail sender, a queue, a
	 * topic.
	 *
	 * It records the edge and dissolves each construct's client into the
	 * handler's service record under the construct's own id, so
	 * `.dependsOn([uploads])` is what makes `services.uploads` exist and type.
	 *
	 * Constructs only. A `Service` does not match the shape, which is what keeps
	 * env sniffing confined to `.services()` and the explicit lift.
	 */
	dependsOn<const T extends readonly Consumable[]>(
		constructs: T,
	): SubscriberBuilder<
		[...TServices, ...ServicesOf<T>],
		TLogger,
		OutSchema,
		TEventPublisher,
		TSubscribedEvents,
		TDatabase,
		TDatabaseServiceName
	> {
		// Both halves of the edge, from one call and one clone: the services the
		// handler runs with, and the ids the manifest records. Recording them
		// separately is what let them drift apart.
		//
		// `servicesOf` is the half that validates, so it runs first — recording
		// ids ahead of it left a caught `NotAConstruct` with `undefined` already
		// on a `string[]`.
		const services = servicesOf(constructs) as unknown as Service[];

		return cloneWith(this, {
			_services: [...this._services, ...services],
			_constructs: idsOf(constructs, this._constructs),
		}) as unknown as SubscriberBuilder<
			[...TServices, ...ServicesOf<T>],
			TLogger,
			OutSchema,
			TEventPublisher,
			TSubscribedEvents,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	services<T extends Service[]>(
		services: T,
	): SubscriberBuilder<
		[...TServices, ...T],
		TLogger,
		OutSchema,
		TEventPublisher,
		TSubscribedEvents,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			_services: [...this._services, ...services] as any,
		}) as any;
	}

	logger<T extends Logger>(
		logger: T,
	): SubscriberBuilder<
		TServices,
		T,
		OutSchema,
		TEventPublisher,
		TSubscribedEvents,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, { _logger: logger as unknown as TLogger }) as any;
	}

	/**
	 * The database the handler receives as `db`.
	 *
	 * A subscriber built from a worker already has the worker's, when the
	 * worker named one with `.database(db)`; this replaces it — the edge as well
	 * as the client — for a consumer that works against a different database.
	 */
	database<T, TDbName extends string>(
		source: Consumable<TDbName, T> | Service<TDbName, T>,
	): SubscriberBuilder<
		TServices,
		TLogger,
		OutSchema,
		TEventPublisher,
		TSubscribedEvents,
		T,
		TDbName
	> {
		return cloneWith(this, {
			_databaseService: serviceOf(source),
			...databaseEdges(
				{
					constructs: this._constructs,
					edge: this._databaseEdge,
					service: this._databaseService as Service | undefined,
					services: this._services,
				},
				source,
			),
		}) as unknown as SubscriberBuilder<
			TServices,
			TLogger,
			OutSchema,
			TEventPublisher,
			TSubscribedEvents,
			T,
			TDbName
		>;
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
		TEvent extends any[]
			? [...TSubscribedEvents, ...TEvent]
			: [...TSubscribedEvents, TEvent],
		TDatabase,
		TDatabaseServiceName
	> {
		const eventsToAdd = Array.isArray(event) ? event : [event];
		return cloneWith(this, {
			_subscribedEvents: [...this._subscribedEvents, ...eventsToAdd] as any,
		}) as any;
	}

	handle(
		fn: SubscriberHandler<
			TEventPublisher,
			TSubscribedEvents,
			TServices,
			TLogger,
			OutSchema,
			TDatabase
		>,
	): Subscriber<
		TServices,
		TLogger,
		OutSchema,
		TEventPublisher,
		TSubscribedEvents,
		TDatabase,
		TDatabaseServiceName
	> {
		const subscriber = new Subscriber(
			fn,
			this._timeout,
			this._subscribedEvents,
			this.outputSchema,
			this._services,
			this._logger,
			this._topicName,
			this._constructs,
			this._databaseService,
		);

		// Which process runs it. Carried from the factory rather than inferred
		// from the directory the file happens to sit in.
		subscriber.owner = this._owner;

		// No reset: `.handle()` reads this builder and leaves it alone, so a
		// configured base stays usable for the next subscriber.
		return subscriber;
	}
}
