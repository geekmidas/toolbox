import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
import { runWithRequestContext, ServiceDiscovery } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Queue } from './Queue';

/**
 * In-memory test driver for a {@link Queue} worker. Hand it a batch of messages
 * and it registers the queue's services, runs the handler in a request context,
 * and returns the handler result — no SQS/pg-boss required.
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
> {
	static getDefaultServiceDiscovery() {
		return ServiceDiscovery.getInstance(new EnvironmentParser({}));
	}

	constructor(
		private readonly queue: Queue<TName, TMessage, TServices, TLogger>,
		private serviceDiscovery: ServiceDiscovery<any> = TestQueueAdaptor.getDefaultServiceDiscovery(),
	) {}

	async invoke(
		request: TestQueueRequest<TMessage, TServices>,
	): Promise<unknown> {
		const logger = this.queue.logger.child({ test: true }) as TLogger;

		const services =
			request.services ??
			((await this.serviceDiscovery.register(
				this.queue.services,
			)) as ServiceRecord<TServices>);

		const requestId = `test-${Date.now()}`;
		const startTime = Date.now();

		return runWithRequestContext({ logger, requestId, startTime }, () =>
			this.queue.handler({
				messages: request.messages,
				services,
				logger,
			}),
		);
	}
}

export type TestQueueRequest<
	TMessage extends StandardSchemaV1 = StandardSchemaV1,
	TServices extends Service[] = [],
> = {
	messages: InferStandardSchema<TMessage>[];
	services?: ServiceRecord<TServices>;
};
