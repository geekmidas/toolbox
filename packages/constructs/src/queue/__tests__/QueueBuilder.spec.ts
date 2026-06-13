import type { Service } from '@geekmidas/services';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Queue } from '../Queue';
import { QueueBuilder } from '../QueueBuilder';

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

	it('throws when the name is missing', () => {
		expect(() =>
			new QueueBuilder().message(schema).handle(async () => {}),
		).toThrow(/name/);
	});

	it('throws when the message schema is missing', () => {
		const builder = new QueueBuilder().queue('x');
		expect(() =>
			(builder as QueueBuilder<typeof schema>).handle(async () => {}),
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
			(builder as QueueBuilder<typeof schema>).handle(async () => {}),
		).toThrow(/name/);
	});
});
