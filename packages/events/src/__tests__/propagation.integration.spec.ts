import {
	CreateTopicCommand,
	DeleteTopicCommand,
	SNSClient,
} from '@aws-sdk/client-sns';
import {
	CreateQueueCommand,
	DeleteQueueCommand,
	SendMessageCommand,
	SQSClient,
} from '@aws-sdk/client-sqs';
import {
	context,
	ROOT_CONTEXT,
	SpanKind,
	TraceFlags,
	trace,
} from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-node';
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {
	LOCALSTACK_URL,
	POSTGRES_PORT,
	RABBITMQ_AUTHORITY,
} from '../../../testkit/test/ports';
import { basicEventsDriver } from '../basic/driver';
import { Publisher } from '../Publisher';
import { dropSchemas } from '../pgboss/__tests__/setup';
import { pgbossEventsDriver } from '../pgboss/driver';
import type { PgBossConnection } from '../pgboss/PgBossConnection';
import { rabbitmqEventsDriver } from '../rabbitmq/driver';
import { type EventsDriver, registerEventsDriver } from '../registry';
import { Subscriber } from '../Subscriber';
import { snsEventsDriver } from '../sns/driver';
import { sqsEventsDriver } from '../sqs/driver';
import { build as sqsUrl } from '../sqs/sqsUrl';
import { TRACE_CONTEXT_KEY } from '../telemetry';
import type {
	EventConnection,
	EventPublisher,
	PublishableMessage,
} from '../types';
import { clearEventsDrivers } from './__helpers__/drivers';
import { startTracing } from './__helpers__/tracing';

/**
 * Request → broker → consumer as one trace, on each real broker: the
 * consumer's span is the child of the producer's, which is the child of the
 * request's — and the handler never sees how the context travelled.
 */

type Message = PublishableMessage<'order.placed', { id: string }>;

const unique = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const REGION = 'us-east-1';
const CREDENTIALS = { accessKeyId: 'test', secretAccessKey: 'test' };
const PG = `geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;

const tracing = startTracing();
const tracer = trace.getTracer('test');

const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterAll(async () => {
	for (const cleanup of cleanups.reverse()) await cleanup();
	await tracing.stop();
});

beforeAll(() => clearEventsDrivers());
beforeEach(() => tracing.exporter.reset());

/** What a handler saw: the message, and the span it ran in. */
interface Received {
	message: Message;
	traceId: string;
	spanId: string;
}

async function connect(
	driver: EventsDriver,
	publisherString: string,
	subscriberString: string,
) {
	registerEventsDriver(driver);

	const subscriber = await Subscriber.fromConnectionString<Message>(
		subscriberString as never,
	);
	const subscriberConnection = (
		subscriber as unknown as { connection?: EventConnection }
	).connection;
	cleanups.push(async () => {
		await (subscriber as { stop?: () => unknown }).stop?.();
		await subscriberConnection?.close();
	});

	const received: Received[] = [];
	await subscriber.subscribe(['order.placed'], async (message) => {
		const span = trace.getSpan(context.active())!.spanContext();
		received.push({ message, traceId: span.traceId, spanId: span.spanId });
	});

	const publisher = await Publisher.fromConnectionString<Message>(
		publisherString as never,
	);
	const publisherConnection = (
		publisher as unknown as { connection?: EventConnection }
	).connection;
	cleanups.push(() => publisherConnection?.close());

	return { publisher, received, subscriberConnection };
}

/** Publish one message from inside a request's span. */
async function publishInRequest(publisher: EventPublisher<Message>) {
	const id = unique();
	const request = await tracer.startActiveSpan(
		'GET /orders',
		{ kind: SpanKind.SERVER },
		async (span) => {
			await publisher.publish([{ type: 'order.placed', payload: { id } }]);
			span.end();
			return span.spanContext();
		},
	);
	return { id, request };
}

const byKind = (kind: SpanKind, traceId: string) =>
	tracing
		.spans()
		.filter((s) => s.kind === kind && s.spanContext().traceId === traceId);

/** The chain request → PRODUCER → CONSUMER, and the handler inside it. */
async function expectOneTrace(
	received: Received[],
	id: string,
	request: { traceId: string; spanId: string },
	system: string,
	/** The consumer's broker, where it differs: SNS is consumed from SQS. */
	consumerSystem = system,
) {
	await vi.waitFor(
		() => {
			expect(received.map((r) => r.message.payload.id)).toContain(id);
			expect(byKind(SpanKind.CONSUMER, request.traceId)).toHaveLength(1);
		},
		{ timeout: 20_000, interval: 200 },
	);

	const [producer] = byKind(SpanKind.PRODUCER, request.traceId);
	const [consumer] = byKind(SpanKind.CONSUMER, request.traceId);
	expect(producer).toBeDefined();
	expect(producer!.parentSpanContext?.spanId).toBe(request.spanId);
	expect(producer!.attributes['messaging.system']).toBe(system);
	expect(producer!.attributes['messaging.operation']).toBe('publish');
	expect(producer!.attributes['gkm.event.type']).toBe('order.placed');
	expect(producer!.name).toMatch(/ publish$/);

	expect(consumer!.parentSpanContext?.spanId).toBe(
		producer!.spanContext().spanId,
	);
	expect(consumer!.attributes['messaging.system']).toBe(consumerSystem);
	expect(consumer!.attributes['messaging.operation']).toBe('process');
	expect(consumer!.name).toMatch(/ process$/);

	// The handler ran inside the consumer span, with the payload as published.
	const handled = received.find((r) => r.message.payload.id === id)!;
	expect(handled.spanId).toBe(consumer!.spanContext().spanId);
	expect(handled.message).toEqual({ type: 'order.placed', payload: { id } });
	expect(JSON.stringify(handled.message)).not.toContain(TRACE_CONTEXT_KEY);
	expect(JSON.stringify(handled.message)).not.toContain('traceparent');
}

/** The consumer span of a message published with no trace context. */
async function expectRoot(received: Received[], id: string) {
	await vi.waitFor(
		() => expect(received.map((r) => r.message.payload.id)).toContain(id),
		{ timeout: 20_000, interval: 200 },
	);
	const handled = received.find((r) => r.message.payload.id === id)!;
	expect(handled.message).toEqual({ type: 'order.placed', payload: { id } });
	await vi.waitFor(() => {
		const consumer = tracing
			.spans()
			.find((s) => s.spanContext().spanId === handled.spanId);
		expect(consumer?.kind).toBe(SpanKind.CONSUMER);
		expect(consumer?.parentSpanContext).toBeUndefined();
	});
}

describe('trace context through each broker', { timeout: 60_000 }, () => {
	it('basic:// continues the trace in-process', async () => {
		registerEventsDriver(basicEventsDriver);
		const connection = await basicEventsDriver.connect('basic://');
		const subscriber = basicEventsDriver.subscriberFor<Message>(connection, {});
		const received: Received[] = [];
		await subscriber.subscribe(['order.placed'], async (message) => {
			const span = trace.getSpan(context.active())!.spanContext();
			received.push({ message, traceId: span.traceId, spanId: span.spanId });
		});
		const publisher = await Publisher.fromConnection<Message>(connection);

		const { id, request } = await publishInRequest(publisher);
		await expectOneTrace(received, id, request, 'basic');
	});

	describe('pgboss://', () => {
		const schema = `pgboss_trace_${unique()}`;
		const url = `pgboss://${PG}?schema=${schema}`;
		let pg: Awaited<ReturnType<typeof connect>>;

		beforeAll(async () => {
			cleanups.push(() => dropSchemas(`postgres://${PG}`, [schema]));
			pg = await connect(
				pgbossEventsDriver,
				url,
				`${url}&batchSize=5&pollingIntervalSeconds=1`,
			);
		});

		it('carries the context in the job data, and strips it', async () => {
			const { id, request } = await publishInRequest(pg.publisher);
			await expectOneTrace(pg.received, id, request, 'pgboss');
		});

		it('starts a root for a job published with no context', async () => {
			const boss = (pg.subscriberConnection as PgBossConnection).instance!;
			const id = unique();
			await boss.insert('order.placed', [{ data: { id } }]);
			await expectRoot(pg.received, id);
		});

		it('follows the parent: an unsampled request yields no consumer span', async () => {
			const unsampled = trace.setSpanContext(ROOT_CONTEXT, {
				traceId: 'a'.repeat(32),
				spanId: 'b'.repeat(16),
				traceFlags: TraceFlags.NONE,
				isRemote: true,
			});
			const id = unique();
			await context.with(unsampled, () =>
				pg.publisher.publish([{ type: 'order.placed', payload: { id } }]),
			);
			await vi.waitFor(
				() =>
					expect(pg.received.map((r) => r.message.payload.id)).toContain(id),
				{ timeout: 20_000, interval: 200 },
			);
			const handled = pg.received.find((r) => r.message.payload.id === id)!;
			// Same trace, not recorded anywhere along it.
			expect(handled.traceId).toBe('a'.repeat(32));
			expect(
				tracing
					.spans()
					.filter(
						(s: ReadableSpan) => s.spanContext().traceId === 'a'.repeat(32),
					),
			).toEqual([]);
		});

		it('follows the parent: a sampled request yields sampled spans', async () => {
			const sampled = trace.setSpanContext(ROOT_CONTEXT, {
				traceId: 'c'.repeat(32),
				spanId: 'd'.repeat(16),
				traceFlags: TraceFlags.SAMPLED,
				isRemote: true,
			});
			const id = unique();
			await context.with(sampled, () =>
				pg.publisher.publish([{ type: 'order.placed', payload: { id } }]),
			);
			await vi.waitFor(
				() => expect(byKind(SpanKind.CONSUMER, 'c'.repeat(32))).toHaveLength(1),
				{ timeout: 20_000, interval: 200 },
			);
		});
	});

	it('pgboss:// topics carry it to each subscriber', async () => {
		registerEventsDriver(pgbossEventsDriver);
		const schema = `pgboss_trace_topic_${unique()}`;
		cleanups.push(() => dropSchemas(`postgres://${PG}`, [schema]));
		const url = `pgboss://${PG}?schema=${schema}`;
		const connection = await pgbossEventsDriver.connect(url);
		cleanups.push(() => connection.close());

		const subscriber = await Subscriber.fromConnection<Message>(connection, {
			topic: 'orders',
			subscription: 'onOrder',
		});
		const received: Received[] = [];
		await subscriber.subscribe(['order.placed'], async (message) => {
			const span = trace.getSpan(context.active())!.spanContext();
			received.push({ message, traceId: span.traceId, spanId: span.spanId });
		});
		const publisher = await Publisher.fromConnection<Message>(connection, {
			topic: 'orders',
		});

		const { id, request } = await publishInRequest(publisher);
		await expectOneTrace(received, id, request, 'pgboss');
	});

	describe('sqs://', () => {
		const client = new SQSClient({
			region: REGION,
			endpoint: LOCALSTACK_URL,
			credentials: CREDENTIALS,
		});
		let queueUrl: string;
		let sqs: Awaited<ReturnType<typeof connect>>;

		beforeAll(async () => {
			const { QueueUrl } = await client.send(
				new CreateQueueCommand({ QueueName: `trace-${unique()}` }),
			);
			queueUrl = QueueUrl!;
			cleanups.push(async () => {
				await client.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
				client.destroy();
			});
			const url = `${sqsUrl({ queueUrl, region: REGION, endpoint: LOCALSTACK_URL })}&accessKeyId=test&secretAccessKey=test`;
			sqs = await connect(sqsEventsDriver, url, `${url}&waitTimeSeconds=1`);
		});

		it('carries the context in message attributes', async () => {
			const { id, request } = await publishInRequest(sqs.publisher);
			await expectOneTrace(sqs.received, id, request, 'aws_sqs');
		});

		it('starts a root for a message with no context', async () => {
			const id = unique();
			await client.send(
				new SendMessageCommand({
					QueueUrl: queueUrl,
					MessageBody: JSON.stringify({
						type: 'order.placed',
						payload: { id },
					}),
				}),
			);
			await expectRoot(sqs.received, id);
		});

		it('starts a root for a context it cannot read', async () => {
			const id = unique();
			await client.send(
				new SendMessageCommand({
					QueueUrl: queueUrl,
					MessageBody: JSON.stringify({
						type: 'order.placed',
						payload: { id },
					}),
					MessageAttributes: {
						traceparent: { DataType: 'String', StringValue: 'not-a-trace' },
					},
				}),
			);
			await expectRoot(sqs.received, id);
		});
	});

	it('sns:// carries it through the topic to the queue', async () => {
		const client = new SNSClient({
			region: REGION,
			endpoint: LOCALSTACK_URL,
			credentials: CREDENTIALS,
		});
		const { TopicArn } = await client.send(
			new CreateTopicCommand({ Name: `trace-${unique()}` }),
		);
		cleanups.push(async () => {
			await client.send(new DeleteTopicCommand({ TopicArn }));
			client.destroy();
		});
		const url = `sns://?topicArn=${encodeURIComponent(TopicArn!)}&region=${REGION}&endpoint=${encodeURIComponent(LOCALSTACK_URL)}&accessKeyId=test&secretAccessKey=test`;
		const sns = await connect(
			snsEventsDriver,
			url,
			`${url}&queueName=trace-${unique()}&deleteQueueOnClose=true&waitTimeSeconds=1`,
		);

		const { id, request } = await publishInRequest(sns.publisher);
		// SNS delivers to an SQS queue of the subscriber's, which it polls.
		await expectOneTrace(sns.received, id, request, 'aws_sns', 'aws_sqs');
	});

	it('rabbitmq:// carries it in message headers', async () => {
		const url = `rabbitmq://${RABBITMQ_AUTHORITY}?exchange=trace-${unique()}&type=topic&timeout=3000`;
		const rabbit = await connect(
			rabbitmqEventsDriver,
			url,
			`${url}&queueName=trace-${unique()}`,
		);

		const { id, request } = await publishInRequest(rabbit.publisher);
		await expectOneTrace(rabbit.received, id, request, 'rabbitmq');
	});
});
