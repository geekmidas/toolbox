import type { Logger } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Construct, ConstructType } from '../Construct';

const DEFAULT_LOGGER = new ConsoleLogger() as unknown as Logger;

/**
 * A queue worker — a point-to-point SQS-style queue and its single consumer.
 * Unlike a `Subscriber` (topic fan-out, filtered by `subscribedEvents`), a queue
 * drains every message of its one `message` type. Build one with `q` (see
 * `QueueBuilder`); `gkm build` discovers it into the manifest's `queues` field.
 */
export class Queue<
	TMessage extends StandardSchemaV1,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
> extends Construct<TLogger, string, undefined, undefined, TServices> {
	__IS_QUEUE__ = true;

	static isQueue(
		obj: unknown,
	): obj is Queue<StandardSchemaV1, Service[], Logger> {
		return Boolean(
			obj &&
				(obj as { __IS_QUEUE__?: boolean }).__IS_QUEUE__ === true &&
				(obj as Construct).type === ConstructType.Queue,
		);
	}

	constructor(
		public readonly name: string,
		public readonly handler: QueueHandler<TMessage, TServices, TLogger>,
		public readonly messageSchema: TMessage,
		public override readonly timeout: number = 30000,
		public override readonly services: TServices = [] as unknown as TServices,
		public override readonly logger: TLogger = DEFAULT_LOGGER as TLogger,
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
