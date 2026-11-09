import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
import { runWithRequestContext, ServiceDiscovery } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Queue, QueueRecord } from './Queue';

/**
 * In-memory test driver for a {@link Queue} worker. Hand it a batch of messages
 * and it registers the queue's services, runs the handler in a request context,
 * and returns the handler result — no SQS/pg-boss required.
 *
 * Pass `messages` and each gets the id `message-<index>`, or pass `records` to
 * choose the ids, for a handler that reports failures by id.
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

		const records: QueueRecord<TMessage>[] =
			'records' in request
				? request.records
				: request.messages.map((message, index) => ({
						id: `message-${index}`,
						message,
					}));

		return runWithRequestContext({ logger, requestId, startTime }, () =>
			this.queue.handler({
				messages: records.map((r) => r.message),
				records,
				services,
				logger,
			}),
		);
	}
}

export type TestQueueRequest<
	TMessage extends StandardSchemaV1 = StandardSchemaV1,
	TServices extends Service[] = [],
> = (
	| { messages: InferStandardSchema<TMessage>[] }
	| { records: QueueRecord<TMessage>[] }
) & {
	services?: ServiceRecord<TServices>;
};
