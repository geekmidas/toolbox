import { EnvironmentParser } from '@geekmidas/envkit';
import type { Context, SQSEvent } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AWSLambdaQueue } from '../AWSLambdaQueueAdaptor';
import type { QueueContext } from '../Queue';
import { QueueBuilder } from '../QueueBuilder';

const schema = z.object({ orderId: z.string() });

type OrdersContext = QueueContext<typeof schema>;

const context = {
	functionName: 'orders-worker',
	awsRequestId: 'request-1',
} as Context;

/** An SQS event with one record per body, ids `message-<index>`. */
const createEvent = (bodies: unknown[]): SQSEvent =>
	({
		Records: bodies.map((body, index) => ({
			messageId: `message-${index}`,
			body: typeof body === 'string' ? body : JSON.stringify(body),
		})),
	}) as SQSEvent;

/** A queue whose handler is `handle`, run through the Lambda adaptor. */
const runQueue = (
	handle: (ctx: OrdersContext) => unknown,
	bodies: unknown[],
) => {
	const queue = new QueueBuilder()
		.queue('orders')
		.message(schema)
		.handle(handle);
	const adaptor = new AWSLambdaQueue(new EnvironmentParser({}), queue);

	return adaptor.handler(createEvent(bodies), context, () => {});
};

const ORDERS = [
	{ type: 'orders', payload: { orderId: 'a' } },
	{ type: 'orders', payload: { orderId: 'b' } },
	{ type: 'orders', payload: { orderId: 'c' } },
];

describe('AWSLambdaQueue', () => {
	it('hands the handler each record with its SQS message id', async () => {
		const seen: OrdersContext['records'][] = [];

		await runQueue(({ records }) => {
			seen.push(records);
		}, ORDERS);

		expect(seen).toEqual([
			[
				{ id: 'message-0', message: { orderId: 'a' } },
				{ id: 'message-1', message: { orderId: 'b' } },
				{ id: 'message-2', message: { orderId: 'c' } },
			],
		]);
	});

	it('acknowledges the whole batch when the handler returns nothing', async () => {
		const response = await runQueue(() => {}, ORDERS);

		expect(response).toEqual({ batchItemFailures: [] });
	});

	it('retries only the records the handler reports as failed', async () => {
		const response = await runQueue(
			({ records }) => ({
				failed: records
					.filter((r) => r.message.orderId === 'b')
					.map((r) => r.id),
			}),
			ORDERS,
		);

		expect(response).toEqual({
			batchItemFailures: [{ itemIdentifier: 'message-1' }],
		});
	});

	it('retries every record when the handler throws', async () => {
		const response = await runQueue(() => {
			throw new Error('downstream unavailable');
		}, ORDERS);

		expect(response).toEqual({
			batchItemFailures: [
				{ itemIdentifier: 'message-0' },
				{ itemIdentifier: 'message-1' },
				{ itemIdentifier: 'message-2' },
			],
		});
	});

	it('retries an invalid record alongside the ones the handler reports', async () => {
		const response = await runQueue(
			({ records }) => ({ failed: [records[0]!.id] }),
			[ORDERS[0], { type: 'orders', payload: { orderId: 42 } }],
		);

		expect(response).toEqual({
			batchItemFailures: [
				{ itemIdentifier: 'message-1' },
				{ itemIdentifier: 'message-0' },
			],
		});
	});

	it('ignores reported ids that are not in the batch', async () => {
		const response = await runQueue(() => ({ failed: ['message-9'] }), ORDERS);

		expect(response).toEqual({ batchItemFailures: [] });
	});

	it('takes a payload-only body as the message', async () => {
		const seen: OrdersContext['messages'][] = [];

		await runQueue(
			({ messages }) => {
				seen.push(messages);
			},
			[{ orderId: 'raw' }],
		);

		expect(seen).toEqual([[{ orderId: 'raw' }]]);
	});

	describe('.envelope(false)', () => {
		/** A device message as an IoT rule forwards it: its own `payload`. */
		const DEVICE_MESSAGE = {
			deviceId: 'device-1',
			topic: 'devices/device-1/telemetry',
			payload: 'temperature=21.5',
		};

		const deviceSchema = z.object({
			deviceId: z.string(),
			topic: z.string(),
			payload: z.string(),
		});

		/** A queue fed by something other than its publisher. */
		const runRawQueue = <TSchema extends z.ZodType>(
			messageSchema: TSchema,
			bodies: unknown[],
		) => {
			const seen: unknown[][] = [];
			const queue = new QueueBuilder()
				.queue('devices')
				.envelope(false)
				.message(messageSchema)
				.handle(({ messages }) => {
					seen.push(messages);
				});
			const adaptor = new AWSLambdaQueue(new EnvironmentParser({}), queue);

			return adaptor
				.handler(createEvent(bodies), context, () => {})
				.then((response) => ({ seen, response }));
		};

		it('keeps a body with its own payload field whole', async () => {
			const { seen, response } = await runRawQueue(deviceSchema, [
				DEVICE_MESSAGE,
			]);

			expect(response).toEqual({ batchItemFailures: [] });
			expect(seen).toEqual([[DEVICE_MESSAGE]]);
		});

		it('passes a body that is not JSON through as a string', async () => {
			const { seen } = await runRawQueue(z.string(), ['not,json']);

			expect(seen).toEqual([['not,json']]);
		});

		it('unwraps the same body when the queue keeps its envelope', async () => {
			const seen: unknown[][] = [];
			const queue = new QueueBuilder()
				.queue('devices')
				.message(z.string())
				.handle(({ messages }) => {
					seen.push(messages);
				});
			const adaptor = new AWSLambdaQueue(new EnvironmentParser({}), queue);

			await adaptor.handler(createEvent([DEVICE_MESSAGE]), context, () => {});

			expect(seen).toEqual([[DEVICE_MESSAGE.payload]]);
		});
	});
});
