import {
	CreateQueueCommand,
	DeleteQueueCommand,
	ReceiveMessageCommand,
	SendMessageCommand,
	SQSClient,
} from '@aws-sdk/client-sqs';
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { EventConnectionFactory } from '../../EventConnection';
import { Publisher } from '../../Publisher';
import type { PublishableMessage } from '../../types';
import { SQSConnection } from '../SQSConnection';
import { SQSPublisher } from '../SQSPublisher';
import { SQSSubscriber } from '../SQSSubscriber';
import { build } from '../sqsUrl';

/**
 * A queue end to end on the AWS emulator: what the publisher sends is what the
 * subscriber hands its listener, and what the subscriber was not asked for is
 * consumed rather than left to be redelivered forever.
 */

type Message = PublishableMessage<'order.placed' | 'order.shipped', any>;

const REGION = 'us-east-1';
const CREDENTIALS = { accessKeyId: 'test', secretAccessKey: 'test' };
const client = new SQSClient({
	region: REGION,
	endpoint: LOCALSTACK_URL,
	credentials: CREDENTIALS,
});

let queueUrl: string;
const connectionString = () =>
	`${build({ queueUrl, region: REGION, endpoint: LOCALSTACK_URL, maxBatchSize: 4 })}&accessKeyId=test&secretAccessKey=test`;

// A queue per test. A stopped subscriber still finishes the long poll it is
// in, and would consume the next test's messages from a shared queue.
beforeEach(async () => {
	const name = `sqs-spec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
	const created = await client.send(
		new CreateQueueCommand({ QueueName: name }),
	);
	queueUrl = created.QueueUrl!;
});

afterEach(async () => {
	await client.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
});

afterAll(() => client.destroy());

const send = (body: string) =>
	client.send(
		new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }),
	);

const notification = (topicArn: string, message: object, attributes?: object) =>
	JSON.stringify({
		Type: 'Notification',
		TopicArn: topicArn,
		Message: JSON.stringify(message),
		...(attributes ? { MessageAttributes: attributes } : {}),
	});

async function remaining(): Promise<number> {
	const { Messages } = await client.send(
		new ReceiveMessageCommand({
			QueueUrl: queueUrl,
			MaxNumberOfMessages: 10,
			WaitTimeSeconds: 1,
		}),
	);
	return Messages?.length ?? 0;
}

// Each subscriber long-polls for a second at a time.
describe('SQS', { timeout: 30_000 }, () => {
	it('delivers every published message, across batches, to the listener', async () => {
		const publisher = await Publisher.fromConnectionString<Message>(
			connectionString() as never,
		);
		expect(publisher).toBeInstanceOf(SQSPublisher);
		expect((publisher as SQSPublisher<Message>).options.maxBatchSize).toBe(4);

		// Nothing to send is not a call.
		await publisher.publish([]);

		const sent = Array.from({ length: 9 }, (_, i) => ({
			type: 'order.placed' as const,
			payload: { n: i },
		}));
		// Three batches of at most four.
		await publisher.publish(sent);

		const received: Message[] = [];
		const connection = new SQSConnection({
			queueUrl,
			region: REGION,
			endpoint: LOCALSTACK_URL,
			credentials: CREDENTIALS,
		});
		const subscriber = new SQSSubscriber<Message>(connection, {
			waitTimeSeconds: 1,
		});
		await subscriber.subscribe(['order.placed'], async (message) => {
			received.push(message);
		});

		await vi.waitFor(() => expect(received).toHaveLength(9), {
			timeout: 15_000,
			interval: 200,
		});
		subscriber.stop();

		expect(received.map((m) => m.payload.n).sort()).toEqual(
			sent.map((m) => m.payload.n),
		);
		await connection.close();
	});

	it('unwraps SNS notifications, keeps its own topic’s, and consumes the rest', async () => {
		const ours = 'arn:aws:sns:us-east-1:000000000000:orders';
		const theirs = 'arn:aws:sns:us-east-1:000000000000:billing';

		// The type from the notification's attributes.
		await send(
			notification(
				ours,
				{ type: 'order.shipped', payload: { id: 'a' } },
				{ type: { Type: 'String', Value: 'order.shipped' } },
			),
		);
		// No attributes: the type from the message itself.
		await send(
			notification(ours, { type: 'order.shipped', payload: { id: 'b' } }),
		);
		// Another topic's, delivered to this queue by mistake.
		await send(
			notification(theirs, { type: 'order.shipped', payload: { id: 'c' } }),
		);
		// A type nobody subscribed to, and a body that is not JSON at all.
		await send(JSON.stringify({ type: 'order.placed', payload: { id: 'd' } }));
		await send('not json');

		const received: Message[] = [];
		const connection = await EventConnectionFactory.fromConnectionString(
			connectionString(),
		);
		const subscriber = new SQSSubscriber<Message>(connection as SQSConnection, {
			waitTimeSeconds: 1,
			expectedTopicArn: ours,
		});
		await subscriber.subscribe(['order.shipped'], async (message) => {
			received.push(message);
		});

		await vi.waitFor(() => expect(received).toHaveLength(2), {
			timeout: 15_000,
			interval: 200,
		});
		// Let the rest of the poll finish consuming what it was not asked for.
		await new Promise((resolve) => setTimeout(resolve, 1500));
		subscriber.stop();

		expect(received.map((m) => m.payload.id).sort()).toEqual(['a', 'b']);
		expect(await remaining()).toBe(0);
		await connection.close();
	});

	it('refuses to publish to a queue that does not exist', async () => {
		const missing = new SQSPublisher<Message>(
			new SQSConnection({
				queueUrl: `${queueUrl}-missing`,
				region: REGION,
				endpoint: LOCALSTACK_URL,
				credentials: CREDENTIALS,
			}),
		);

		await expect(
			missing.publish([{ type: 'order.placed', payload: {} }]),
		).rejects.toThrow();
	});
});
