import type {
	EventPublisher,
	ExtractPublisherMessage,
} from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Construct, ConstructType } from '../Construct';
import type { DatabaseContext } from '../functions/Function';

// Helper type to extract payload types for subscribed events
type ExtractEventPayloads<
	TPublisher extends EventPublisher<any> | undefined,
	TEventTypes extends any[],
> = TPublisher extends EventPublisher<any>
	? Extract<ExtractPublisherMessage<TPublisher>, { type: TEventTypes[number] }>
	: never;

/**
 * A runnable that consumes a topic. Its handler gets `db` when it has a
 * database: the worker's, declared once with `worker.database(db)`, or its own
 * with `.database(other)`.
 */
export class Subscriber<
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	/** The topic's message union — what types the events this subscriber receives. */
	TEventPublisher extends EventPublisher<any> | undefined = undefined,
	TSubscribedEvents extends
		ExtractPublisherMessage<TEventPublisher>['type'][] = ExtractPublisherMessage<TEventPublisher>['type'][],
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> extends Construct<
	TLogger,
	OutSchema,
	TServices,
	string,
	undefined,
	TDatabaseServiceName,
	TDatabase
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
			OutSchema,
			TDatabase
		>,
		public override readonly timeout: number = 30000,
		protected _subscribedEvents?: TSubscribedEvents,
		public override readonly outputSchema?: OutSchema,
		public override readonly services: TServices = [] as unknown as TServices,
		public override readonly logger: TLogger = DEFAULT_LOGGER as TLogger,
		/**
		 * The name of the {@link Topic} this subscriber binds to (via
		 * `worker.topic(topic)`), recorded for the manifest so infra wires the
		 * SNS subscription.
		 */
		public readonly topicName?: string,
		/**
		 * The construct ids `.dependsOn()` named — last, so no existing positional
		 * argument moves.
		 */
		constructs: string[] = [],
		/**
		 * What the handler's `db` is registered from — after `constructs`, for
		 * the same reason.
		 */
		databaseService?: Service<TDatabaseServiceName, TDatabase>,
	) {
		super(
			ConstructType.Subscriber,
			logger,
			services,
			[],
			outputSchema,
			timeout,
			undefined, // memorySize
			undefined, // auditorStorageService
			constructs,
		);

		this.databaseService = databaseService;
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
	TDatabase = undefined,
> = (
	ctx: SubscriberContext<
		TEventPublisher,
		TSubscribedEvents,
		TServices,
		TLogger,
		TDatabase
	>,
) => OutSchema extends StandardSchemaV1
	? InferStandardSchema<OutSchema> | Promise<InferStandardSchema<OutSchema>>
	: any | Promise<any>;

// Context type for subscriber handlers — `db` only when a database is set.
export type SubscriberContext<
	TEventPublisher extends EventPublisher<any> | undefined,
	TSubscribedEvents extends ExtractPublisherMessage<TEventPublisher>['type'][],
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TDatabase = undefined,
> = {
	events: ExtractEventPayloads<TEventPublisher, TSubscribedEvents>[];
	services: ServiceRecord<TServices>;
	logger: TLogger;
} & DatabaseContext<TDatabase>;
