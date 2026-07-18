import type { Service } from '@geekmidas/services';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Queue } from '../Queue';
import { QueueBuilder } from '../QueueBuilder';
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

	it('throws when the name is missing', () => {
		expect(() =>
			new QueueBuilder().message(schema).handle(async () => {}),
		).toThrow(/name/);
	});

	it('throws when the message schema is missing', () => {
		const builder = new QueueBuilder().queue('x');
		expect(() =>
			(builder as QueueBuilder<'x', typeof schema>).handle(async () => {}),
		).toThrow(/message/);
	});

	it('resets builder state after handle', () => {
		const builder = new QueueBuilder();
		builder
			.queue('first')
			.services([svc('x')])
			.message(schema)
			.handle(async () => {});
		// State cleared — a second handle with no name throws.
		expect(() =>
			(builder as QueueBuilder<string, typeof schema>).handle(async () => {}),
		).toThrow(/name/);
	});
});

describe('Queue.publisher', () => {
	it('exposes a `<name>Publisher` producer service', () => {
		const queue = new QueueBuilder()
			.queue('orders')
			.message(schema)
			.handle(async () => {});

		expect(queue.publisher.serviceName).toBe('ordersPublisher');
	});

	it('requires the namespaced connection-string env var (sniffed into the manifest)', async () => {
		const producer = new QueueBuilder()
			.queue('orderEvents')
			.message(schema)
			.handle(async () => {});

		// Inject the publisher into a construct's services so getEnvironment sniffs it.
		const consumer = new QueueBuilder()
			.queue('caller')
			.services([producer.publisher])
			.message(schema)
			.handle(async () => {});

		const env = await consumer.getEnvironment();
		expect(env).toContain('ORDER_EVENTS_PUBLISHER_CONNECTION_STRING');
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
