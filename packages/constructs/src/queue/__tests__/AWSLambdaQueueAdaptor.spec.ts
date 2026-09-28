import { EnvironmentParser } from '@geekmidas/envkit';
import type { Service } from '@geekmidas/services';
import { serviceContext } from '@geekmidas/services';
import type { Context, SQSEvent, SQSRecord } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AWSLambdaQueue } from '../AWSLambdaQueueAdaptor';
import { QueueBuilder } from '../QueueBuilder';

const schema = z.object({ orderId: z.string() });

const context = {
	functionName: 'orders-worker',
	awsRequestId: 'req-1',
} as Context;

/** An SQS record carrying `body`, as the event-source mapping delivers it. */
const record = (messageId: string, body: unknown): SQSRecord =>
	({
		messageId,
		body: typeof body === 'string' ? body : JSON.stringify(body),
	}) as SQSRecord;

const event = (...records: SQSRecord[]): SQSEvent => ({ Records: records });

function worker(
	handle: (messages: { orderId: string }[]) => Promise<void> | void,
	services: Service[] = [],
) {
	const queue = new QueueBuilder()
		.queue('orders')
		.services(services)
		.message(schema)
		.handle(async ({ messages }) => handle(messages));

	return new AWSLambdaQueue(new EnvironmentParser({}), queue);
}

describe('AWSLambdaQueue', () => {
	it('hands the whole batch to the handler, unwrapping each publisher envelope', async () => {
		const seen: { orderId: string }[][] = [];
		const lambda = worker((messages) => {
			seen.push(messages);
		});

		const result = await lambda.handler(
			event(
				// What the SQS publisher writes.
				record('m1', { type: 'order.placed', payload: { orderId: 'a' } }),
				// A bare payload is accepted too.
				record('m2', { orderId: 'b' }),
			),
			context,
			() => {},
		);

		expect(seen).toEqual([[{ orderId: 'a' }, { orderId: 'b' }]]);
		expect(result).toEqual({ batchItemFailures: [] });
	});

	it('fails only the records that do not parse or validate', async () => {
		const seen: { orderId: string }[][] = [];
		const lambda = worker((messages) => {
			seen.push(messages);
		});

		const result = await lambda.handler(
			event(
				record('good', { payload: { orderId: 'a' } }),
				record('invalid', { payload: { orderId: 42 } }),
				// Not JSON: the raw string is the payload, which fails the schema.
				record('garbled', '{not json'),
			),
			context,
			() => {},
		);

		expect(seen).toEqual([[{ orderId: 'a' }]]);
		expect(result).toEqual({
			batchItemFailures: [
				{ itemIdentifier: 'invalid' },
				{ itemIdentifier: 'garbled' },
			],
		});
	});

	it('does not call the handler when no record survives', async () => {
		let called = false;
		const lambda = worker(() => {
			called = true;
		});

		const result = await lambda.handler(
			event(record('bad', { payload: {} })),
			context,
			() => {},
		);

		expect(called).toBe(false);
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'bad' }] });
	});

	it('retries the whole batch when the handler throws, without listing a record twice', async () => {
		const lambda = worker(() => {
			throw new Error('downstream is down');
		});

		const result = await lambda.handler(
			event(
				record('a', { payload: { orderId: 'a' } }),
				record('invalid', { payload: {} }),
				record('b', { payload: { orderId: 'b' } }),
			),
			context,
			() => {},
		);

		expect(result).toEqual({
			batchItemFailures: [
				{ itemIdentifier: 'invalid' },
				{ itemIdentifier: 'a' },
				{ itemIdentifier: 'b' },
			],
		});
	});

	it('registers its services once, across invocations', async () => {
		let registrations = 0;
		const counter: Service<'counter', { id: number }> = {
			serviceName: 'counter',
			async register() {
				registrations += 1;
				return { id: registrations };
			},
		};
		const queue = new QueueBuilder()
			.queue(`orders-${Math.random()}`)
			.services([counter])
			.message(schema)
			.handle(async ({ services }) => {
				expect(services.counter).toEqual({ id: 1 });
			});
		const lambda = new AWSLambdaQueue(new EnvironmentParser({}), queue);

		await lambda.handler(
			event(record('1', { orderId: 'a' })),
			context,
			() => {},
		);
		await lambda.handler(
			event(record('2', { orderId: 'b' })),
			context,
			() => {},
		);

		expect(registrations).toBe(1);
	});

	it('runs the handler inside the invocation’s request context', async () => {
		let requestId: string | undefined;
		const lambda = worker(() => {
			requestId = serviceContext.getRequestId();
		});

		await lambda.handler(
			event(record('1', { orderId: 'a' })),
			context,
			() => {},
		);

		expect(requestId).toBe('req-1');
		expect(lambda.logger).toBe(lambda.queue.logger);
	});
});
