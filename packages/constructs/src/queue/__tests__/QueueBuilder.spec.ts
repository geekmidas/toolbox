import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Worker } from '../../worker';
import { Queue } from '../Queue';
import {
	QueueBuilder,
	QueueNeedsMessage,
	QueueNeedsName,
} from '../QueueBuilder';
import { TestQueueAdaptor } from '../TestQueueAdaptor';

const schema = z.object({ orderId: z.string() });

const svc = (name: string): Service<string, object> => ({
	serviceName: name,
	async register() {
		return {};
	},
});

describe('QueueBuilder', () => {
	it('builds a Queue from .queue().message().handle()', () => {
		const handler = async () => {};
		const queue = new QueueBuilder()
			.queue('orders')
			.message(schema)
			.handle(handler);

		expect(Queue.isQueue(queue)).toBe(true);
		expect(queue.name).toBe('orders');
		expect(queue.messageSchema).toBe(schema);
		expect(queue.handler).toBe(handler);
		expect(queue.services).toEqual([]);
	});

	it('collects services as an array', () => {
		const a = svc('a');
		const queue = new QueueBuilder()
			.queue('jobs')
			.services([a])
			.message(schema)
			.handle(async () => {});

		expect(queue.services).toEqual([a]);
	});

	it('captures batchSize and fifo', () => {
		const queue = new QueueBuilder()
			.queue('orders')
			.batchSize(5)
			.fifo()
			.message(schema)
			.handle(async () => {});

		expect(queue.batchSize).toBe(5);
		expect(queue.fifo).toBe(true);
	});

	it('throws QueueNeedsName when the name is missing', () => {
		expect(() =>
			new QueueBuilder().message(schema).handle(async () => {}),
		).toThrow(QueueNeedsName);
	});

	it('throws QueueNeedsMessage, naming the queue, when the message schema is missing', () => {
		const builder = new QueueBuilder().queue('x');

		let caught: unknown;
		try {
			(builder as QueueBuilder<'x', typeof schema>).handle(async () => {});
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(QueueNeedsMessage);
		expect((caught as QueueNeedsMessage).queue).toBe('x');
		expect((caught as QueueNeedsMessage).name).toBe('QueueNeedsMessage');
	});

	it('leaves the builder it was called on as it was', () => {
		const builder = new QueueBuilder();
		builder
			.queue('first')
			.services([svc('x')])
			.message(schema)
			.handle(async () => {});
		// `.queue()` returned a copy, so the base never had a name.
		expect(() =>
			(builder as QueueBuilder<string, typeof schema>).handle(async () => {}),
		).toThrow(QueueNeedsName);
	});

	it('leaves a free-standing queue unowned', () => {
		const queue = new QueueBuilder()
			.queue('orders')
			.message(schema)
			.handle(async () => {});

		expect(queue.owner).toBeUndefined();
	});
});

describe('worker.queue', () => {
	it('builds a queue whose consumer the worker runs', () => {
		const handler = async () => {};
		const queue = new Worker('Jobs')
			.queue('Emails')
			.message(schema)
			.handle(handler);

		expect(Queue.isQueue(queue)).toBe(true);
		expect(queue.name).toBe('Emails');
		expect(queue.id).toBe('Emails');
		expect(queue.handler).toBe(handler);
		// Stamped with the worker's canonical id: which process runs it.
		expect(queue.owner).toBe('Jobs');
	});

	it("stamps the worker's canonical id, not what was typed", () => {
		const queue = new Worker('background-jobs')
			.queue('Emails')
			.message(schema)
			.handle(async () => {});

		expect(queue.owner).toBe(new Worker('background-jobs').id);
	});

	it("gives the queue the worker's logger", () => {
		const logger = { ...DEFAULT_LOGGER };
		const queue = new Worker('Jobs', { logger })
			.queue('Emails')
			.message(schema)
			.handle(async () => {});

		expect(queue.logger).toBe(logger);
	});

	it('throws QueueNeedsMessage when built without a message', () => {
		const builder = new Worker('Jobs').queue('Emails');

		expect(() =>
			(builder as unknown as QueueBuilder<'Emails', typeof schema>).handle(
				async () => {},
			),
		).toThrow(QueueNeedsMessage);
	});
});

describe('Queue.declare', () => {
	it('declares a queue under a canonical id, keeping the wire name', () => {
		// The name is the `type` a producer sends and the worker subscribes to;
		// changing it would silently orphan in-flight messages.
		const queue = new QueueBuilder()
			.queue('orderEvents')
			.message(schema)
			.handle(async () => {});

		expect(queue.id).toBe('OrderEvents');
		expect(queue.name).toBe('orderEvents');
		expect(queue.declare()).toEqual([
			{
				kind: 'queue',
				id: 'OrderEvents',
				provides: ['ORDER_EVENTS_PUBLISHER_CONNECTION_STRING'],
				// Nested rather than a node beside it: position carries the
				// trigger, so this handler is reached by messages on this queue
				// and by nothing else.
				worker: {
					id: 'OrderEventsWorker',
					handler: 'OrderEvents.handler',
					dependencies: [],
				},
			},
		]);
	});

	it('declares only the producer key', () => {
		// A worker is reached through its queue, so there is no second key and
		// nothing can depend on the handler.
		const queue = new QueueBuilder()
			.queue('orders')
			.message(schema)
			.handle(async () => {});

		expect(queue.declare()[0]?.provides).toHaveLength(1);
	});
});

describe('Queue.service', () => {
	it('is the producer, keyed by the queue — services.orders', () => {
		const queue = new Worker('Jobs')
			.queue('Orders')
			.message(schema)
			.handle(async () => {});

		expect(queue.service.serviceName).toBe('orders');
		// One object for the queue's life: services are cached by identity.
		expect(queue.service).toBe(queue.service);
	});

	it('requires the namespaced connection-string env var where it is depended on', async () => {
		const worker = new Worker('Jobs');
		const orderEvents = worker
			.queue('orderEvents')
			.message(schema)
			.handle(async () => {});

		const producer = worker.dependsOn([orderEvents]).handle(async () => ({}));

		expect(producer.services).toEqual([orderEvents.service]);
		expect(producer.constructs).toEqual(['OrderEvents']);
		expect(await producer.getEnvironment()).toContain(
			'ORDER_EVENTS_PUBLISHER_CONNECTION_STRING',
		);
	});

	it('is not required by the queue itself', async () => {
		// The consumer is handed messages, not a connection to send with.
		const queue = new Worker('Jobs')
			.queue('orderEvents')
			.message(schema)
			.handle(async () => {});

		expect(await queue.getEnvironment()).not.toContain(
			'ORDER_EVENTS_PUBLISHER_CONNECTION_STRING',
		);
	});
});

describe('TestQueueAdaptor', () => {
	it('invokes the handler with the batch of messages and services', async () => {
		const seen: { messages: unknown[]; hadDb: boolean }[] = [];
		const db = svc('db');

		const queue = new QueueBuilder()
			.queue('orders')
			.services([db])
			.message(schema)
			.handle(async ({ messages, services }) => {
				seen.push({
					messages,
					hadDb: 'db' in (services as Record<string, unknown>),
				});
				return { processed: messages.length };
			});

		const adapter = new TestQueueAdaptor(queue);
		const result = await adapter.invoke({
			messages: [{ orderId: '1' }, { orderId: '2' }],
		});

		expect(result).toEqual({ processed: 2 });
		expect(seen).toHaveLength(1);
		expect(seen[0]?.messages).toEqual([{ orderId: '1' }, { orderId: '2' }]);
		expect(seen[0]?.hadDb).toBe(true);
	});
});
