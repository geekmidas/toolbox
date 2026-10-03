import {
	type EventPublisher,
	type EventPublisherConnectionString,
	type PublishableMessage,
	Publisher,
} from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import {
	canonicalId,
	type Declaration,
	provideKey,
	serviceKey,
} from '@geekmidas/manifest';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Construct, ConstructType } from '../Construct';
import type { DatabaseContext } from '../functions/Function';

/**
 * The wire message a queue carries: `{ type: <queue name>, payload: <message> }`.
 * The producer publishes this shape and the worker receives the `payload`s as
 * its `messages`. Typing `type` to the queue name keeps the publisher fully
 * typed and lets pg-boss (local) / SQS (deployed) route by name.
 */
export type QueueMessage<
	TName extends string,
	TMessage extends StandardSchemaV1,
> = PublishableMessage<TName, InferStandardSchema<TMessage>>;

/**
 * A queue worker — a point-to-point SQS-style queue and its single consumer.
 * Unlike a `Subscriber` (topic fan-out, filtered by `subscribedEvents`), a queue
 * drains every message of its one `message` type. Build one from the worker
 * that runs it — `worker.queue('Emails').message(schema).handle(…)` — and
 * `gkm build` discovers it into the manifest's `queues` field.
 *
 * Producers send to it by depending on it: `.dependsOn([emails])` makes
 * `services.emails` the publisher.
 *
 * Its handler gets `db` when it has a database: the worker's, declared once
 * with `worker.database(db)`, or its own with `.database(other)`.
 */
export class Queue<
	TName extends string = string,
	TMessage extends StandardSchemaV1 = StandardSchemaV1,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> extends Construct<
	TLogger,
	undefined,
	TServices,
	string,
	undefined,
	TDatabaseServiceName,
	TDatabase
> {
	__IS_QUEUE__ = true;

	static isQueue(
		obj: unknown,
	): obj is Queue<string, StandardSchemaV1, Service[], Logger, any> {
		return Boolean(
			obj &&
				(obj as { __IS_QUEUE__?: boolean }).__IS_QUEUE__ === true &&
				(obj as Construct).type === ConstructType.Queue,
		);
	}

	/**
	 * The canonical id this queue is declared under.
	 *
	 * Derived from the name rather than given separately, so `emails` and
	 * `Emails` are one queue. The name stays what it was: it is the wire `type`
	 * a producer sends and the worker subscribes to, and changing that would
	 * silently orphan in-flight messages.
	 */
	readonly id: string;

	/**
	 * The queue as a dependency — what `.dependsOn([emails])` dissolves into,
	 * reachable as `services.emails`.
	 *
	 * The producer: the queue's one consumer is the handler it was built with,
	 * so the only thing another construct can want from a queue is to send to
	 * it. It reads `<NAME>_PUBLISHER_CONNECTION_STRING` and picks the transport
	 * from its protocol — `pgboss://` locally, `sqs://` deployed. A field
	 * assigned once, not a getter: services are cached by object identity.
	 */
	readonly service: Service<
		Uncapitalize<TName>,
		EventPublisher<QueueMessage<TName, TMessage>>
	>;

	/**
	 * The producer's env key. Read by both {@link declare} and the service, so
	 * what the target publishes and what the producer looks up cannot drift.
	 */
	private readonly connectionKey: string;

	constructor(
		public readonly name: TName,
		public readonly handler: QueueHandler<
			TMessage,
			TServices,
			TLogger,
			TDatabase
		>,
		public readonly messageSchema: TMessage,
		public override readonly timeout: number = 30000,
		public override readonly services: TServices = [] as unknown as TServices,
		public override readonly logger: TLogger = DEFAULT_LOGGER as TLogger,
		/** SQS event-source batch size (deployed). */
		public readonly batchSize?: number,
		/** Whether the queue is FIFO (deployed). */
		public readonly fifo?: boolean,
		/**
		 * The construct ids the *worker* `.dependsOn()` named — last, so no
		 * existing positional argument moves.
		 */
		constructs: string[] = [],
		/**
		 * What the handler's `db` is registered from — after `constructs`, for
		 * the same reason.
		 */
		databaseService?: Service<TDatabaseServiceName, TDatabase>,
	) {
		super(
			ConstructType.Queue,
			logger,
			services,
			[],
			undefined,
			timeout,
			undefined, // memorySize
			undefined, // auditorStorageService
			constructs,
		);

		this.databaseService = databaseService;
		this.id = canonicalId(name);
		this.connectionKey = provideKey(this.id, 'publisherConnectionString');

		const envVar = this.connectionKey;
		this.service = {
			serviceName: serviceKey(this.id) as Uncapitalize<TName>,
			async register({ envParser }) {
				const { connectionString } = envParser
					.create((get) => ({ connectionString: get(envVar).string() }))
					.parse();

				return Publisher.fromConnectionString<QueueMessage<TName, TMessage>>(
					connectionString as EventPublisherConnectionString,
				);
			},
		};
	}

	/**
	 * What this queue is in the manifest.
	 *
	 * A queue is a resource, not a handler: the worker is reached *through* it,
	 * so the declaration carries the producer's key and nothing about the code
	 * that drains it. The local target reads this to know which broker has to be
	 * running and what connection string to inject.
	 */
	declare(): Declaration[] {
		return [
			{
				kind: 'queue',
				id: this.id,
				provides: [this.connectionKey],
				...(this.fifo ? { fifo: true } : {}),
				// Nested rather than a sibling node, because position carries the
				// trigger: this handler is reached by messages on this queue and
				// by nothing else, so there is no `trigger` field to keep in step.
				//
				// `handler` is the export name; which directory the build wrote it
				// to is the target's business, and a path with a cloud in it does
				// not belong in a neutral declaration.
				worker: {
					id: `${this.id}Worker`,
					handler: `${this.id}.handler`,
					// Filled by the build from what the worker declared. Empty is a
					// stated gap, not a claim that it reaches nothing.
					dependencies: [],
				},
			},
		];
	}
}

/**
 * The context a queue handler receives — a batch of typed messages, and `db`
 * when the queue has a database.
 */
export type QueueContext<
	TMessage extends StandardSchemaV1,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TDatabase = undefined,
> = {
	messages: InferStandardSchema<TMessage>[];
	services: ServiceRecord<TServices>;
	logger: TLogger;
} & DatabaseContext<TDatabase>;

export type QueueHandler<
	TMessage extends StandardSchemaV1,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TDatabase = undefined,
> = (
	ctx: QueueContext<TMessage, TServices, TLogger, TDatabase>,
) => unknown | Promise<unknown>;
