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
 * drains every message of its one `message` type. Build one with `q` (see
 * `QueueBuilder`); `gkm build` discovers it into the manifest's `queues` field.
 *
 * The producer side is {@link Queue.publisher} — a ready-to-inject `Service`
 * that any endpoint/function drops into `.services([...])` to send messages.
 */
export class Queue<
	TName extends string = string,
	TMessage extends StandardSchemaV1 = StandardSchemaV1,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
> extends Construct<TLogger, string, undefined, undefined, TServices> {
	__IS_QUEUE__ = true;

	static isQueue(
		obj: unknown,
	): obj is Queue<string, StandardSchemaV1, Service[], Logger> {
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
	 * The producer's env key. Read by both {@link declare} and
	 * {@link publisher}, so what the target publishes and what the producer
	 * looks up cannot drift.
	 */
	private readonly connectionKey: string;

	constructor(
		public readonly name: TName,
		public readonly handler: QueueHandler<TMessage, TServices, TLogger>,
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
	) {
		super(
			ConstructType.Queue,
			logger,
			services,
			[],
			undefined,
			undefined,
			timeout,
			undefined, // memorySize
			undefined, // auditorStorageService
			constructs,
		);

		this.id = canonicalId(name);
		this.connectionKey = provideKey(this.id, 'publisherConnectionString');
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

	/**
	 * The producer side — a `Service` exposing an `EventPublisher` typed to this
	 * queue's message. Inject it via `.services([queue.publisher])`; the handler
	 * then calls `services.<name>Publisher.publish([{ type, payload }])`.
	 *
	 * It reads `<NAME>_PUBLISHER_CONNECTION_STRING` and builds the transport from
	 * the URL protocol — `pgboss://` locally, `sqs://` deployed — so the same
	 * code publishes to Postgres in dev and SQS in prod. Because it's a `Service`,
	 * `Construct.getEnvironment()` sniffs it, so the env requirement flows into
	 * the manifest and infra links exactly this queue with least privilege.
	 */
	/**
	 * The queue as a dependency — what `.dependsOn([emailsQueue])` dissolves
	 * into, reachable as `services.emails`.
	 *
	 * It is the producer: a consumer is the worker written right here, so the
	 * only thing another construct can want from a queue is the ability to send
	 * to it. {@link publisher} is the same service under its older
	 * `<name>Publisher` key, kept for `.services([queue.publisher])`.
	 */
	get service(): Service<
		Uncapitalize<TName>,
		EventPublisher<QueueMessage<TName, TMessage>>
	> {
		const { register } = this.publisher;

		return {
			serviceName: serviceKey(this.id) as Uncapitalize<TName>,
			register,
		};
	}

	get publisher(): Service<
		`${TName}Publisher`,
		EventPublisher<QueueMessage<TName, TMessage>>
	> {
		const envVar = this.connectionKey;
		return {
			serviceName: `${this.name}Publisher`,
			async register({ envParser }) {
				const { connectionString } = envParser
					.create((get) => ({
						connectionString: get(envVar).string(),
					}))
					.parse();

				return Publisher.fromConnectionString<QueueMessage<TName, TMessage>>(
					connectionString as EventPublisherConnectionString,
				);
			},
		};
	}
}

/** The context a queue handler receives — a batch of typed messages. */
export type QueueContext<
	TMessage extends StandardSchemaV1,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
> = {
	messages: InferStandardSchema<TMessage>[];
	services: ServiceRecord<TServices>;
	logger: TLogger;
};

export type QueueHandler<
	TMessage extends StandardSchemaV1,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
> = (
	ctx: QueueContext<TMessage, TServices, TLogger>,
) => unknown | Promise<unknown>;
