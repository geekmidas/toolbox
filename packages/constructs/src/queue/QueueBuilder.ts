import type { Logger } from '@geekmidas/logger';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Queue, type QueueHandler } from './Queue';

/**
 * Builds a {@link Queue} worker — `q.queue('orders').services([db]).message(schema).handle(fn)`.
 * Services are an array (sniffed for required env vars); `message` is the typed
 * job payload; `handle` is the single consumer.
 */
export class QueueBuilder<
	TMessage extends StandardSchemaV1 | undefined = undefined,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
> {
	private _name?: string;
	private _messageSchema?: TMessage;
	private _timeout = 30000;
	private _services: TServices = [] as Service[] as TServices;
	private _logger: TLogger = DEFAULT_LOGGER as TLogger;

	/** The queue name — drives the infra queue and its `<NAME>_*` env vars. */
	queue(name: string): this {
		this._name = name;
		return this;
	}

	timeout(timeout: number): this {
		this._timeout = timeout;
		return this;
	}

	services<T extends Service[]>(
		services: T,
	): QueueBuilder<TMessage, [...TServices, ...T], TLogger> {
		this._services = [...this._services, ...services] as unknown as TServices;
		return this as unknown as QueueBuilder<
			TMessage,
			[...TServices, ...T],
			TLogger
		>;
	}

	logger<T extends Logger>(logger: T): QueueBuilder<TMessage, TServices, T> {
		this._logger = logger as unknown as TLogger;
		return this as unknown as QueueBuilder<TMessage, TServices, T>;
	}

	/** The typed message (job) payload the queue carries. */
	message<T extends StandardSchemaV1>(
		schema: T,
	): QueueBuilder<T, TServices, TLogger> {
		this._messageSchema = schema as unknown as TMessage;
		return this as unknown as QueueBuilder<T, TServices, TLogger>;
	}

	handle(
		fn: QueueHandler<NonNullable<TMessage>, TServices, TLogger>,
	): Queue<NonNullable<TMessage>, TServices, TLogger> {
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

		const queue = new Queue<NonNullable<TMessage>, TServices, TLogger>(
			this._name,
			fn,
			this._messageSchema as NonNullable<TMessage>,
			this._timeout,
			this._services,
			this._logger,
		);

		// Reset builder state to prevent pollution across reuse.
		this._name = undefined;
		this._messageSchema = undefined;
		this._timeout = 30000;
		this._services = [] as Service[] as TServices;
		this._logger = DEFAULT_LOGGER as TLogger;

		return queue;
	}
}
