import type { Logger } from '@geekmidas/logger';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { cloneWith } from '../clone';
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
		return cloneWith(this, { _name: name }) as unknown as QueueBuilder<
			T,
			TMessage,
			TServices,
			TLogger
		>;
	}

	timeout(timeout: number): this {
		return cloneWith(this, { _timeout: timeout });
	}

	/** SQS event-source batch size (deployed). */
	batchSize(batchSize: number): this {
		return cloneWith(this, { _batchSize: batchSize });
	}

	/** Mark the queue as FIFO (deployed). */
	fifo(fifo = true): this {
		return cloneWith(this, { _fifo: fifo });
	}

	services<T extends Service[]>(
		services: T,
	): QueueBuilder<TName, TMessage, [...TServices, ...T], TLogger> {
		return cloneWith(this, {
			_services: [...this._services, ...services] as unknown as TServices,
		}) as unknown as QueueBuilder<
			TName,
			TMessage,
			[...TServices, ...T],
			TLogger
		>;
	}

	logger<T extends Logger>(
		logger: T,
	): QueueBuilder<TName, TMessage, TServices, T> {
		return cloneWith(this, {
			_logger: logger as unknown as TLogger,
		}) as unknown as QueueBuilder<TName, TMessage, TServices, T>;
	}

	/** The typed message (job) payload the queue carries. */
	message<T extends StandardSchemaV1>(
		schema: T,
	): QueueBuilder<TName, T, TServices, TLogger> {
		return cloneWith(this, {
			_messageSchema: schema as unknown as TMessage,
		}) as unknown as QueueBuilder<TName, T, TServices, TLogger>;
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

		// No reset. `.handle()` reads this builder and leaves it alone, so a
		// configured base keeps its configuration for every construct built
		// from it. The reset that used to be here wiped the base on first use.

		return queue;
	}
}
