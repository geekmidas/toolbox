import { environmentCase } from '@geekmidas/envkit';
import {
	type EventPublisher,
	type EventPublisherConnectionString,
	type PublishableMessage,
	Publisher,
} from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Construct, ConstructType } from '../Construct';

const DEFAULT_LOGGER = new ConsoleLogger() as unknown as Logger;

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
	) {
		super(
			ConstructType.Queue,
			logger,
			services,
			[],
			undefined,
			undefined,
			timeout,
		);
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
	get publisher(): Service<
		`${TName}Publisher`,
		EventPublisher<QueueMessage<TName, TMessage>>
	> {
		const envVar = `${environmentCase(this.name)}_PUBLISHER_CONNECTION_STRING`;
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
