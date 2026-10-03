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
import { Queue, type QueueHandler } from './Queue';

/**
 * Builds a {@link Queue} and its one consumer. Reached through
 * `worker.queue('orders')`, never constructed by hand: the worker stamps itself
 * as the owner. `message` is the typed job payload and `handle` the consumer.
 * The queue name is captured as a literal so `queue.service` publishes
 * `{ type: '<name>', payload }`. The handler's `db` is the worker's database
 * unless `.database(other)` names another.
 */
export class QueueBuilder<
	TName extends string = string,
	TMessage extends StandardSchemaV1 | undefined = undefined,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> {
	private _name?: string;
	private _messageSchema?: TMessage;
	private _timeout = 30000;
	private _batchSize?: number;
	private _fifo?: boolean;
	private _services: TServices = [] as Service[] as TServices;
	/** The construct ids `.dependsOn()` named — what the manifest records. */
	public _constructs: string[] = [];
	private _logger: TLogger = DEFAULT_LOGGER as TLogger;
	/** The worker that runs this queue's consumer — stamped by `worker.queue()`. */
	public _owner?: string;
	/** What the handler's `db` comes from — the worker's, unless overridden. */
	private _databaseService?: Service<TDatabaseServiceName, TDatabase>;
	/** The edge `.database()` added, so the next one can replace it. */
	private _databaseEdge?: string;

	/** The queue name — drives the infra queue and its `<NAME>_*` env vars. */
	queue<T extends string>(
		name: T,
	): QueueBuilder<
		T,
		TMessage,
		TServices,
		TLogger,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, { _name: name }) as unknown as QueueBuilder<
			T,
			TMessage,
			TServices,
			TLogger,
			TDatabase,
			TDatabaseServiceName
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
	): QueueBuilder<
		TName,
		TMessage,
		[...TServices, ...ServicesOf<T>],
		TLogger,
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
		}) as unknown as QueueBuilder<
			TName,
			TMessage,
			[...TServices, ...ServicesOf<T>],
			TLogger,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	services<T extends Service[]>(
		services: T,
	): QueueBuilder<
		TName,
		TMessage,
		[...TServices, ...T],
		TLogger,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			_services: [...this._services, ...services] as unknown as TServices,
		}) as unknown as QueueBuilder<
			TName,
			TMessage,
			[...TServices, ...T],
			TLogger,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	logger<T extends Logger>(
		logger: T,
	): QueueBuilder<
		TName,
		TMessage,
		TServices,
		T,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			_logger: logger as unknown as TLogger,
		}) as unknown as QueueBuilder<
			TName,
			TMessage,
			TServices,
			T,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	/**
	 * The database the handler receives as `db`.
	 *
	 * A queue built from a worker already has the worker's, when the worker
	 * named one with `.database(db)`; this replaces it — the edge as well as
	 * the client — for a consumer that works against a different database.
	 */
	database<T, TDbName extends string>(
		source: Consumable<TDbName, T> | Service<TDbName, T>,
	): QueueBuilder<TName, TMessage, TServices, TLogger, T, TDbName> {
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
		}) as unknown as QueueBuilder<
			TName,
			TMessage,
			TServices,
			TLogger,
			T,
			TDbName
		>;
	}

	/** The typed message (job) payload the queue carries. */
	message<T extends StandardSchemaV1>(
		schema: T,
	): QueueBuilder<
		TName,
		T,
		TServices,
		TLogger,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			_messageSchema: schema as unknown as TMessage,
		}) as unknown as QueueBuilder<
			TName,
			T,
			TServices,
			TLogger,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	handle(
		fn: QueueHandler<NonNullable<TMessage>, TServices, TLogger, TDatabase>,
	): Queue<
		TName,
		NonNullable<TMessage>,
		TServices,
		TLogger,
		TDatabase,
		TDatabaseServiceName
	> {
		if (!this._name) throw new QueueNeedsName();
		if (!this._messageSchema) throw new QueueNeedsMessage(this._name);

		const queue = new Queue<
			TName,
			NonNullable<TMessage>,
			TServices,
			TLogger,
			TDatabase,
			TDatabaseServiceName
		>(
			this._name as TName,
			fn,
			this._messageSchema as NonNullable<TMessage>,
			this._timeout,
			this._services,
			this._logger,
			this._batchSize,
			this._fifo,
			this._constructs,
			this._databaseService,
		);
		// Which process runs the consumer: the worker it was built from.
		queue.owner = this._owner;

		// No reset. `.handle()` reads this builder and leaves it alone, so a
		// configured base — `const fn = f.logger(log).timeout(60_000)` — keeps
		// its configuration for every construct built from it. The reset that
		// used to be here wiped the base on first use, which made a base usable
		// exactly once, and quietly reverted the logger to the default.

		return queue;
	}
}

/** A queue built without a name — only reachable by building one by hand. */
export class QueueNeedsName extends Error {
	constructor() {
		super(
			"A queue needs a name: build it from a worker, worker.queue('Emails').",
		);
		this.name = 'QueueNeedsName';
	}
}

/** A queue whose message was never described. */
export class QueueNeedsMessage extends Error {
	constructor(readonly queue: string) {
		super(
			`Queue '${queue}' has no message: call .message(schema) before .handle(), ` +
				'so its producers and its consumer agree on what it carries.',
		);
		this.name = 'QueueNeedsMessage';
	}
}
