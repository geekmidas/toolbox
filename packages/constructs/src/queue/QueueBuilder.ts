import type { Logger } from '@geekmidas/logger';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
	type Consumable,
	type ServicesOf,
	servicesOf,
} from '../construct-interface';
import { Queue, type QueueHandler } from './Queue';

/**
 * Builds a {@link Queue} worker — `q.queue('orders').services([db]).message(schema).handle(fn)`.
 * Services are an array (sniffed for required env vars); `message` is the typed
 * job payload; `handle` is the single consumer. The queue name is captured as a
 * literal so `queue.publisher` is typed to `{ type: '<name>', payload }`.
 */
export class QueueBuilder<
	TName extends string = string,
	TMessage extends StandardSchemaV1 | undefined = undefined,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
> {
	private _name?: string;
	private _messageSchema?: TMessage;
	private _timeout = 30000;
	private _batchSize?: number;
	private _fifo?: boolean;
	private _services: TServices = [] as Service[] as TServices;
	private _logger: TLogger = DEFAULT_LOGGER as TLogger;

	/** The queue name — drives the infra queue and its `<NAME>_*` env vars. */
	queue<T extends string>(
		name: T,
	): QueueBuilder<T, TMessage, TServices, TLogger> {
		this._name = name;
		return this as unknown as QueueBuilder<T, TMessage, TServices, TLogger>;
	}

	timeout(timeout: number): this {
		this._timeout = timeout;
		return this;
	}

	/** SQS event-source batch size (deployed). */
	batchSize(batchSize: number): this {
		this._batchSize = batchSize;
		return this;
	}

	/** Mark the queue as FIFO (deployed). */
	fifo(fifo = true): this {
		this._fifo = fifo;
		return this;
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
	): QueueBuilder<TName, TMessage, [...TServices, ...ServicesOf<T>], TLogger> {
		return this.services(
			servicesOf(constructs) as unknown as Service[],
		) as unknown as QueueBuilder<
			TName,
			TMessage,
			[...TServices, ...ServicesOf<T>],
			TLogger
		>;
	}

	services<T extends Service[]>(
		services: T,
	): QueueBuilder<TName, TMessage, [...TServices, ...T], TLogger> {
		this._services = [...this._services, ...services] as unknown as TServices;
		return this as unknown as QueueBuilder<
			TName,
			TMessage,
			[...TServices, ...T],
			TLogger
		>;
	}

	logger<T extends Logger>(
		logger: T,
	): QueueBuilder<TName, TMessage, TServices, T> {
		this._logger = logger as unknown as TLogger;
		return this as unknown as QueueBuilder<TName, TMessage, TServices, T>;
	}

	/** The typed message (job) payload the queue carries. */
	message<T extends StandardSchemaV1>(
		schema: T,
	): QueueBuilder<TName, T, TServices, TLogger> {
		this._messageSchema = schema as unknown as TMessage;
		return this as unknown as QueueBuilder<TName, T, TServices, TLogger>;
	}

	handle(
		fn: QueueHandler<NonNullable<TMessage>, TServices, TLogger>,
	): Queue<TName, NonNullable<TMessage>, TServices, TLogger> {
		if (!this._name) {
			throw new Error(
				'Queue requires a name — call .queue(name) before .handle().',
			);
		}
		if (!this._messageSchema) {
			throw new Error(
				'Queue requires a message schema — call .message(schema) before .handle().',
			);
		}

		const queue = new Queue<TName, NonNullable<TMessage>, TServices, TLogger>(
			this._name as TName,
			fn,
			this._messageSchema as NonNullable<TMessage>,
			this._timeout,
			this._services,
			this._logger,
			this._batchSize,
			this._fifo,
		);

		// Reset builder state to prevent pollution across reuse.
		this._name = undefined;
		this._messageSchema = undefined;
		this._timeout = 30000;
		this._batchSize = undefined;
		this._fifo = undefined;
		this._services = [] as Service[] as TServices;
		this._logger = DEFAULT_LOGGER as TLogger;

		return queue;
	}
}
