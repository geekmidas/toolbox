import {
	CreateTopicCommand,
	DeleteTopicCommand,
	SNSClient,
	SubscribeCommand,
	UnsubscribeCommand,
} from '@aws-sdk/client-sns';
import {
	CreateQueueCommand,
	DeleteQueueCommand,
	GetQueueAttributesCommand,
	ReceiveMessageCommand,
	SetQueueAttributesCommand,
	SQSClient,
} from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PublishableMessage } from '../../types';
import { SNSConnection } from '../SNSConnection';
import { SNSPublisher } from '../SNSPublisher';

type TestMessage = PublishableMessage<
	'user.created' | 'user.updated' | 'order.placed',
	any
>;

const LOCALSTACK_ENDPOINT = 'http://localhost:4566';
const AWS_REGION = 'us-east-1';
const AWS_CREDENTIALS = {
	accessKeyId: 'test',
	secretAccessKey: 'test',
};

// Test infrastructure helpers
async function createTopic(topicName: string): Promise<string> {
	const client = new SNSClient({
		region: AWS_REGION,
		endpoint: LOCALSTACK_ENDPOINT,
		credentials: AWS_CREDENTIALS,
	});

	const command = new CreateTopicCommand({ Name: topicName });
	const response = await client.send(command);
	client.destroy();

	if (!response.TopicArn) {
		throw new Error('Failed to create topic');
	}

	return response.TopicArn;
}

async function deleteTopic(topicArn: string): Promise<void> {
	const client = new SNSClient({
		region: AWS_REGION,
		endpoint: LOCALSTACK_ENDPOINT,
		credentials: AWS_CREDENTIALS,
	});

	await client.send(new DeleteTopicCommand({ TopicArn: topicArn }));
	client.destroy();
}

async function createQueue(queueName: string): Promise<string> {
	const client = new SQSClient({
		region: AWS_REGION,
		endpoint: LOCALSTACK_ENDPOINT,
		credentials: AWS_CREDENTIALS,
	});

	const response = await client.send(
		new CreateQueueCommand({ QueueName: queueName }),
	);
	client.destroy();

	if (!response.QueueUrl) {
		throw new Error('Failed to create queue');
	}

	return response.QueueUrl;
}

async function deleteQueue(queueUrl: string): Promise<void> {
	const client = new SQSClient({
		region: AWS_REGION,
		endpoint: LOCALSTACK_ENDPOINT,
		credentials: AWS_CREDENTIALS,
	});

	await client.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
	client.destroy();
}

async function getQueueArn(queueUrl: string): Promise<string> {
	const client = new SQSClient({
		region: AWS_REGION,
		endpoint: LOCALSTACK_ENDPOINT,
		credentials: AWS_CREDENTIALS,
	});

	const response = await client.send(
		new GetQueueAttributesCommand({
			QueueUrl: queueUrl,
			AttributeNames: ['QueueArn'],
		}),
	);
	client.destroy();

	const queueArn = response.Attributes?.QueueArn;
	if (!queueArn) {
		throw new Error('Failed to get queue ARN');
	}

	return queueArn;
}

async function setQueuePolicy(
	queueUrl: string,
	queueArn: string,
	topicArn: string,
): Promise<void> {
	const client = new SQSClient({
		region: AWS_REGION,
		endpoint: LOCALSTACK_ENDPOINT,
		credentials: AWS_CREDENTIALS,
	});

	const policy = {
		Version: '2012-10-17',
		Statement: [
			{
				Effect: 'Allow',
				Principal: '*',
				Action: 'SQS:SendMessage',
				Resource: queueArn,
				Condition: {
					ArnEquals: { 'aws:SourceArn': topicArn },
				},
			},
		],
	};

	await client.send(
		new SetQueueAttributesCommand({
			QueueUrl: queueUrl,
			Attributes: { Policy: JSON.stringify(policy) },
		}),
	);
	client.destroy();
}

async function subscribeQueueToTopic(
	topicArn: string,
	queueArn: string,
): Promise<string> {
	const client = new SNSClient({
		region: AWS_REGION,
		endpoint: LOCALSTACK_ENDPOINT,
		credentials: AWS_CREDENTIALS,
	});

	const response = await client.send(
		new SubscribeCommand({
			TopicArn: topicArn,
			Protocol: 'sqs',
			Endpoint: queueArn,
		}),
	);
	client.destroy();

	if (!response.SubscriptionArn) {
		throw new Error('Failed to subscribe queue to topic');
	}

	return response.SubscriptionArn;
}

async function unsubscribe(subscriptionArn: string): Promise<void> {
	const client = new SNSClient({
		region: AWS_REGION,
		endpoint: LOCALSTACK_ENDPOINT,
		credentials: AWS_CREDENTIALS,
	});

	await client.send(
		new UnsubscribeCommand({ SubscriptionArn: subscriptionArn }),
	);
	client.destroy();
}

async function receiveMessages(queueUrl: string): Promise<any[]> {
	const client = new SQSClient({
		region: AWS_REGION,
		endpoint: LOCALSTACK_ENDPOINT,
		credentials: AWS_CREDENTIALS,
	});

	const response = await client.send(
		new ReceiveMessageCommand({
			QueueUrl: queueUrl,
			WaitTimeSeconds: 5,
			MaxNumberOfMessages: 10,
			MessageAttributeNames: ['All'],
		}),
	);
	client.destroy();

	return (response.Messages || []).map((msg) => {
		// SNS wraps the message in its own envelope
		const snsEnvelope = JSON.parse(msg.Body || '{}');
		return JSON.parse(snsEnvelope.Message || '{}');
	});
}

describe('SNSPublisher', () => {
	const uniqueId = () =>
		`${Date.now()}-${Math.random().toString(36).substring(7)}`;

	describe('constructor', () => {
		it('should create publisher with connection', async () => {
			const topicArn = await createTopic(`test-constructor-${uniqueId()}`);

			try {
				const connection = new SNSConnection({
					topicArn,
					endpoint: LOCALSTACK_ENDPOINT,
					region: AWS_REGION,
					credentials: AWS_CREDENTIALS,
				});
				await connection.connect();

				const publisher = new SNSPublisher<TestMessage>(connection);
				expect(publisher).toBeDefined();

				await connection.close();
			} finally {
				await deleteTopic(topicArn);
			}
		});
	});

	describe('publish', () => {
		let topicArn: string;
		let queueUrl: string;
		let queueArn: string;
		let subscriptionArn: string;
		let connection: SNSConnection;

		beforeAll(async () => {
			topicArn = await createTopic(`test-publish-${uniqueId()}`);
			queueUrl = await createQueue(`test-publish-queue-${uniqueId()}`);
			queueArn = await getQueueArn(queueUrl);
			await setQueuePolicy(queueUrl, queueArn, topicArn);
			subscriptionArn = await subscribeQueueToTopic(topicArn, queueArn);

			// Wait for subscription to be ready
			await new Promise((resolve) => setTimeout(resolve, 500));

			connection = new SNSConnection({
				topicArn,
				endpoint: LOCALSTACK_ENDPOINT,
				region: AWS_REGION,
				credentials: AWS_CREDENTIALS,
			});
			await connection.connect();
		});

		afterAll(async () => {
			await connection.close();
			await unsubscribe(subscriptionArn);
			await deleteQueue(queueUrl);
			await deleteTopic(topicArn);
		});

		it('should return early if messages array is empty', async () => {
			const publisher = new SNSPublisher<TestMessage>(connection);

			// Should complete immediately without error or sending anything
			const startTime = Date.now();
			await publisher.publish([]);
			const elapsed = Date.now() - startTime;

			// Should complete almost instantly (< 100ms) since no messages are sent
			expect(elapsed).toBeLessThan(100);
		});

		it('should publish a single message with correct format', async () => {
			const publisher = new SNSPublisher<TestMessage>(connection);

			await publisher.publish([
				{
					type: 'user.created',
					payload: { userId: '123', email: 'test@example.com' },
				},
			]);

			// Wait for message to arrive
			await new Promise((resolve) => setTimeout(resolve, 1000));

			const messages = await receiveMessages(queueUrl);
			expect(messages).toHaveLength(1);
			expect(messages[0].type).toBe('user.created');
			expect(messages[0].payload.userId).toBe('123');
			expect(messages[0].payload.email).toBe('test@example.com');
		});

		it('should publish multiple messages', async () => {
			// Create fresh queue to avoid picking up old messages
			const freshQueueUrl = await createQueue(`test-multi-${uniqueId()}`);
			const freshQueueArn = await getQueueArn(freshQueueUrl);
			await setQueuePolicy(freshQueueUrl, freshQueueArn, topicArn);
			const freshSubscriptionArn = await subscribeQueueToTopic(
				topicArn,
				freshQueueArn,
			);

			await new Promise((resolve) => setTimeout(resolve, 500));

			try {
				const publisher = new SNSPublisher<TestMessage>(connection);

				await publisher.publish([
					{ type: 'user.created', payload: { userId: '1' } },
					{ type: 'user.updated', payload: { userId: '2' } },
					{ type: 'order.placed', payload: { orderId: '3' } },
				]);

				await new Promise((resolve) => setTimeout(resolve, 1500));

				const messages = await receiveMessages(freshQueueUrl);
				expect(messages).toHaveLength(3);

				const types = messages.map((m) => m.type).sort();
				expect(types).toEqual(['order.placed', 'user.created', 'user.updated']);
			} finally {
				await unsubscribe(freshSubscriptionArn);
				await deleteQueue(freshQueueUrl);
			}
		});

		it('should handle complex payloads', async () => {
			const freshQueueUrl = await createQueue(`test-complex-${uniqueId()}`);
			const freshQueueArn = await getQueueArn(freshQueueUrl);
			await setQueuePolicy(freshQueueUrl, freshQueueArn, topicArn);
			const freshSubscriptionArn = await subscribeQueueToTopic(
				topicArn,
				freshQueueArn,
			);

			await new Promise((resolve) => setTimeout(resolve, 500));

			try {
				const publisher = new SNSPublisher<TestMessage>(connection);
				const complexPayload = {
					userId: '123',
					nested: {
						data: [1, 2, 3],
						metadata: { key: 'value' },
					},
					timestamp: '2024-01-01T00:00:00Z',
				};

				await publisher.publish([
					{ type: 'user.created', payload: complexPayload },
				]);

				await new Promise((resolve) => setTimeout(resolve, 1000));

				const messages = await receiveMessages(freshQueueUrl);
				expect(messages).toHaveLength(1);
				expect(messages[0].payload).toEqual(complexPayload);
			} finally {
				await unsubscribe(freshSubscriptionArn);
				await deleteQueue(freshQueueUrl);
			}
		});

		it('should auto-connect if not connected', async () => {
			const freshConnection = new SNSConnection({
				topicArn,
				endpoint: LOCALSTACK_ENDPOINT,
				region: AWS_REGION,
				credentials: AWS_CREDENTIALS,
			});

			// Don't call connect() explicitly
			expect(freshConnection.isConnected()).toBe(false);

			const publisher = new SNSPublisher<TestMessage>(freshConnection);

			// Should auto-connect and publish
			await publisher.publish([
				{ type: 'user.created', payload: { test: 'auto-connect' } },
			]);

			expect(freshConnection.isConnected()).toBe(true);

			await freshConnection.close();
		});
	});

	describe('fromConnectionString', () => {
		it('should create publisher from connection string', async () => {
			const topicArn = await createTopic(`test-fromcs-${uniqueId()}`);

			try {
				const connectionString = `sns://?topicArn=${encodeURIComponent(topicArn)}&region=${AWS_REGION}&endpoint=${encodeURIComponent(LOCALSTACK_ENDPOINT)}&accessKeyId=test&secretAccessKey=test`;

				const publisher =
					await SNSPublisher.fromConnectionString<TestMessage>(
						connectionString,
					);

				expect(publisher).toBeInstanceOf(SNSPublisher);

				await publisher.close();
			} finally {
				await deleteTopic(topicArn);
			}
		});
	});

	describe('close', () => {
		it('should complete without error (publisher does not own connection)', async () => {
			const topicArn = await createTopic(`test-close-${uniqueId()}`);

			try {
				const connection = new SNSConnection({
					topicArn,
					endpoint: LOCALSTACK_ENDPOINT,
					region: AWS_REGION,
					credentials: AWS_CREDENTIALS,
				});
				await connection.connect();

				const publisher = new SNSPublisher<TestMessage>(connection);

				// close() should not throw and should not close the connection
				await publisher.close();

				// Connection should still be open
				expect(connection.isConnected()).toBe(true);

				await connection.close();
			} finally {
				await deleteTopic(topicArn);
			}
		});
	});
});
