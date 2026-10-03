import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
import { runWithRequestContext, ServiceDiscovery } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Queue, QueueContext } from './Queue';

/**
 * In-memory test driver for a {@link Queue} worker. Hand it a batch of messages
 * and it registers the queue's services, runs the handler in a request context,
 * and returns the handler result — no SQS/pg-boss required. A queue with a
 * database gets `db` registered from it, or the one the request passes.
 *
 * @example
 * const adapter = new TestQueueAdaptor(ordersQueue);
 * await adapter.invoke({ messages: [{ orderId: '123' }] });
 */
export class TestQueueAdaptor<
	TName extends string = string,
	TMessage extends StandardSchemaV1 = StandardSchemaV1,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> {
	static getDefaultServiceDiscovery() {
		return ServiceDiscovery.getInstance(new EnvironmentParser({}));
	}

	constructor(
		private readonly queue: Queue<
			TName,
			TMessage,
			TServices,
			TLogger,
			TDatabase,
			TDatabaseServiceName
		>,
		private serviceDiscovery: ServiceDiscovery<any> = TestQueueAdaptor.getDefaultServiceDiscovery(),
	) {}

	async invoke(
		request: TestQueueRequest<TMessage, TServices, TDatabase>,
	): Promise<unknown> {
		const logger = this.queue.logger.child({ test: true }) as TLogger;

		const services =
			request.services ??
			((await this.serviceDiscovery.register(
				this.queue.services,
			)) as ServiceRecord<TServices>);

		const db = request.db !== undefined ? request.db : await this.getDatabase();

		const requestId = `test-${Date.now()}`;
		const startTime = Date.now();

		return runWithRequestContext({ logger, requestId, startTime }, () =>
			this.queue.handler({
				messages: request.messages,
				services,
				logger,
				db,
			} as unknown as QueueContext<TMessage, TServices, TLogger, TDatabase>),
		);
	}

	private async getDatabase(): Promise<TDatabase | undefined> {
		const service = this.queue.databaseService;
		if (!service) return undefined;

		const registered = await this.serviceDiscovery.register([service]);

		return registered[service.serviceName] as TDatabase | undefined;
	}
}

export type TestQueueRequest<
	TMessage extends StandardSchemaV1 = StandardSchemaV1,
	TServices extends Service[] = [],
	TDatabase = undefined,
> = {
	messages: InferStandardSchema<TMessage>[];
	services?: ServiceRecord<TServices>;
	/** Stands in for the queue's database — a transaction, say. */
	db?: TDatabase;
};
