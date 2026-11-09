import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { QueueContext } from '../Queue';
import { QueueBuilder } from '../QueueBuilder';
import { TestQueueAdaptor } from '../TestQueueAdaptor';

const schema = z.object({ orderId: z.string() });

type OrdersContext = QueueContext<typeof schema>;

describe('TestQueueAdaptor', () => {
	it('numbers messages as records when given messages', async () => {
		const seen: OrdersContext['records'][] = [];
		const queue = new QueueBuilder()
			.queue('orders')
			.message(schema)
			.handle(({ records }) => {
				seen.push(records);
			});

		await new TestQueueAdaptor(queue).invoke({
			messages: [{ orderId: 'a' }, { orderId: 'b' }],
			services: {},
		});

		expect(seen).toEqual([
			[
				{ id: 'message-0', message: { orderId: 'a' } },
				{ id: 'message-1', message: { orderId: 'b' } },
			],
		]);
	});

	it('passes records through, and returns what the handler reports', async () => {
		const queue = new QueueBuilder()
			.queue('orders')
			.message(schema)
			.handle(({ records, messages }) => ({
				failed: records
					.filter((r) => r.message.orderId === 'b')
					.map((r) => r.id),
				messages,
			}));

		const result = await new TestQueueAdaptor(queue).invoke({
			records: [
				{ id: 'first', message: { orderId: 'a' } },
				{ id: 'second', message: { orderId: 'b' } },
			],
			services: {},
		});

		expect(result).toEqual({
			failed: ['second'],
			messages: [{ orderId: 'a' }, { orderId: 'b' }],
		});
	});
});
