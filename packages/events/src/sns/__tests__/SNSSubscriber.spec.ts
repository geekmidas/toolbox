import {
	CreateTopicCommand,
	DeleteTopicCommand,
	SNSClient,
} from '@aws-sdk/client-sns';
import {
	GetQueueUrlCommand,
	ListQueuesCommand,
	SQSClient,
} from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PublishableMessage } from '../../types';
import { SNSConnection } from '../SNSConnection';
import { SNSPublisher } from '../SNSPublisher';
import { SNSSubscriber } from '../SNSSubscriber';

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

// Helper functions
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

async function queueExists(queueName: string): Promise<boolean> {
	const client = new SQSClient({
		region: AWS_REGION,
		endpoint: LOCALSTACK_ENDPOINT,
		credentials: AWS_CREDENTIALS,
	});

	try {
		await client.send(new GetQueueUrlCommand({ QueueName: queueName }));
		client.destroy();
		return true;
	} catch {
		client.destroy();
		return false;
	}
}

async function listQueuesWithPrefix(prefix: string): Promise<string[]> {
	const client = new SQSClient({
		region: AWS_REGION,
		endpoint: LOCALSTACK_ENDPOINT,
		credentials: AWS_CREDENTIALS,
	});

	const response = await client.send(
		new ListQueuesCommand({ QueueNamePrefix: prefix }),
	);
	client.destroy();

	return response.QueueUrls || [];
}

describe('SNSSubscriber', () => {
	const uniqueId = () =>
		`${Date.now()}-${Math.random().toString(36).substring(7)}`;

	describe('constructor', () => {
		it('should create subscriber with default options', async () => {
			const topicArn = await createTopic(`test-sub-constructor-${uniqueId()}`);

			try {
				const connection = new SNSConnection({
					topicArn,
					endpoint: LOCALSTACK_ENDPOINT,
					region: AWS_REGION,
					credentials: AWS_CREDENTIALS,
				});
				await connection.connect();

				const subscriber = new SNSSubscriber<TestMessage>(connection);
				expect(subscriber).toBeDefined();

				await connection.close();
			} finally {
				await deleteTopic(topicArn);
			}
		});

		it('should create subscriber with custom options', async () => {
			const topicArn = await createTopic(`test-sub-options-${uniqueId()}`);

			try {
				const connection = new SNSConnection({
					topicArn,
					endpoint: LOCALSTACK_ENDPOINT,
					region: AWS_REGION,
					credentials: AWS_CREDENTIALS,
				});
				await connection.connect();

				const subscriber = new SNSSubscriber<TestMessage>(connection, {
					queueName: 'my-custom-queue',
					createQueue: true,
					deleteQueueOnClose: false,
					waitTimeSeconds: 5,
					maxMessages: 5,
				});

				expect(subscriber).toBeDefined();

				await connection.close();
			} finally {
				await deleteTopic(topicArn);
			}
		});
	});

	describe('subscribe and receive messages', () => {
		let topicArn: string;
		let connection: SNSConnection;
		let publisher: SNSPublisher<TestMessage>;

		beforeAll(async () => {
			topicArn = await createTopic(`test-sub-receive-${uniqueId()}`);
			connection = new SNSConnection({
				topicArn,
				endpoint: LOCALSTACK_ENDPOINT,
				region: AWS_REGION,
				credentials: AWS_CREDENTIALS,
			});
			await connection.connect();
			publisher = new SNSPublisher<TestMessage>(connection);
		});

		afterAll(async () => {
			await connection.close();
			await deleteTopic(topicArn);
		});

		it('should receive messages published to SNS topic', async () => {
			const subscriber = new SNSSubscriber<TestMessage>(connection, {
				waitTimeSeconds: 1,
				deleteQueueOnClose: true,
			});

			const receivedMessages: TestMessage[] = [];

			await subscriber.subscribe(['user.created'], async (message) => {
				receivedMessages.push(message);
			});

			// Wait for subscription to be ready
			await new Promise((resolve) => setTimeout(resolve, 1000));

			// Publish message
			await publisher.publish([
				{ type: 'user.created', payload: { userId: '123', name: 'Test User' } },
			]);

			// Wait for message to be received
			await new Promise((resolve) => setTimeout(resolve, 3000));

			await subscriber.stop();

			expect(receivedMessages).toHaveLength(1);
			expect(receivedMessages[0].type).toBe('user.created');
			expect(receivedMessages[0].payload.userId).toBe('123');
		}, 15000);

		it('should filter messages by type', async () => {
			const subscriber = new SNSSubscriber<TestMessage>(connection, {
				waitTimeSeconds: 1,
				deleteQueueOnClose: true,
			});

			const receivedMessages: TestMessage[] = [];

			// Only subscribe to user.created
			await subscriber.subscribe(['user.created'], async (message) => {
				receivedMessages.push(message);
			});

			await new Promise((resolve) => setTimeout(resolve, 1000));

			// Publish multiple message types
			await publisher.publish([
				{ type: 'user.created', payload: { id: '1' } },
				{ type: 'user.updated', payload: { id: '2' } },
				{ type: 'order.placed', payload: { id: '3' } },
			]);

			await new Promise((resolve) => setTimeout(resolve, 3000));

			await subscriber.stop();

			// Should only receive user.created
			expect(receivedMessages).toHaveLength(1);
			expect(receivedMessages[0].type).toBe('user.created');
		}, 15000);

		it('should receive multiple message types when subscribed', async () => {
			const subscriber = new SNSSubscriber<TestMessage>(connection, {
				waitTimeSeconds: 1,
				deleteQueueOnClose: true,
			});

			const receivedMessages: TestMessage[] = [];

			// Subscribe to multiple types
			await subscriber.subscribe(
				['user.created', 'order.placed'],
				async (message) => {
					receivedMessages.push(message);
				},
			);

			await new Promise((resolve) => setTimeout(resolve, 1000));

			await publisher.publish([
				{ type: 'user.created', payload: { id: '1' } },
				{ type: 'user.updated', payload: { id: '2' } }, // Not subscribed
				{ type: 'order.placed', payload: { id: '3' } },
			]);

			await new Promise((resolve) => setTimeout(resolve, 3000));

			await subscriber.stop();

			expect(receivedMessages).toHaveLength(2);
			const types = receivedMessages.map((m) => m.type).sort();
			expect(types).toEqual(['order.placed', 'user.created']);
		}, 15000);
	});

	describe('queue management', () => {
		it('should auto-generate queue name when not provided', async () => {
			const topicArn = await createTopic(`test-auto-queue-${uniqueId()}`);

			try {
				const connection = new SNSConnection({
					topicArn,
					endpoint: LOCALSTACK_ENDPOINT,
					region: AWS_REGION,
					credentials: AWS_CREDENTIALS,
				});
				await connection.connect();

				const subscriber = new SNSSubscriber<TestMessage>(connection, {
					waitTimeSeconds: 1,
					deleteQueueOnClose: true,
				});

				await subscriber.subscribe(['user.created'], async () => {});

				// Check that an auto-generated queue was created
				const queues = await listQueuesWithPrefix('sns-sub-');
				expect(queues.length).toBeGreaterThan(0);

				await subscriber.stop();
				await connection.close();
			} finally {
				await deleteTopic(topicArn);
			}
		}, 10000);

		it('should use custom queue name when provided', async () => {
			const topicArn = await createTopic(`test-custom-queue-${uniqueId()}`);
			const customQueueName = `custom-queue-${uniqueId()}`;

			try {
				const connection = new SNSConnection({
					topicArn,
					endpoint: LOCALSTACK_ENDPOINT,
					region: AWS_REGION,
					credentials: AWS_CREDENTIALS,
				});
				await connection.connect();

				const subscriber = new SNSSubscriber<TestMessage>(connection, {
					queueName: customQueueName,
					waitTimeSeconds: 1,
					deleteQueueOnClose: true,
				});

				await subscriber.subscribe(['user.created'], async () => {});

				// Check that the custom queue was created
				const exists = await queueExists(customQueueName);
				expect(exists).toBe(true);

				await subscriber.stop();
				await connection.close();
			} finally {
				await deleteTopic(topicArn);
			}
		}, 10000);

		it('should delete auto-generated queue on close', async () => {
			const topicArn = await createTopic(`test-delete-queue-${uniqueId()}`);
			const queuePrefix = `sns-sub-delete-test-${Date.now()}`;

			try {
				const connection = new SNSConnection({
					topicArn,
					endpoint: LOCALSTACK_ENDPOINT,
					region: AWS_REGION,
					credentials: AWS_CREDENTIALS,
				});
				await connection.connect();

				const subscriber = new SNSSubscriber<TestMessage>(connection, {
					queueName: queuePrefix,
					waitTimeSeconds: 1,
					deleteQueueOnClose: true, // Explicit delete
				});

				await subscriber.subscribe(['user.created'], async () => {});

				// Verify queue exists
				expect(await queueExists(queuePrefix)).toBe(true);

				await subscriber.stop();

				// Wait for cleanup
				await new Promise((resolve) => setTimeout(resolve, 500));

				// Verify queue is deleted
				expect(await queueExists(queuePrefix)).toBe(false);

				await connection.close();
			} finally {
				await deleteTopic(topicArn);
			}
		}, 10000);

		it('should keep queue when deleteQueueOnClose is false', async () => {
			const topicArn = await createTopic(`test-keep-queue-${uniqueId()}`);
			const customQueueName = `keep-queue-${uniqueId()}`;

			try {
				const connection = new SNSConnection({
					topicArn,
					endpoint: LOCALSTACK_ENDPOINT,
					region: AWS_REGION,
					credentials: AWS_CREDENTIALS,
				});
				await connection.connect();

				const subscriber = new SNSSubscriber<TestMessage>(connection, {
					queueName: customQueueName,
					waitTimeSeconds: 1,
					deleteQueueOnClose: false, // Don't delete
				});

				await subscriber.subscribe(['user.created'], async () => {});

				// Verify queue exists
				expect(await queueExists(customQueueName)).toBe(true);

				await subscriber.stop();

				// Wait for cleanup
				await new Promise((resolve) => setTimeout(resolve, 500));

				// Verify queue still exists
				expect(await queueExists(customQueueName)).toBe(true);

				await connection.close();
			} finally {
				await deleteTopic(topicArn);
			}
		}, 10000);
	});

	describe('fromConnectionString', () => {
		it('should create subscriber from connection string', async () => {
			const topicArn = await createTopic(`test-fromcs-sub-${uniqueId()}`);

			try {
				const connectionString = `sns://?topicArn=${encodeURIComponent(topicArn)}&region=${AWS_REGION}&endpoint=${encodeURIComponent(LOCALSTACK_ENDPOINT)}&accessKeyId=test&secretAccessKey=test&queueName=test-queue-${uniqueId()}`;

				const subscriber =
					await SNSSubscriber.fromConnectionString<TestMessage>(
						connectionString,
					);

				expect(subscriber).toBeInstanceOf(SNSSubscriber);

				await subscriber.stop();
			} finally {
				await deleteTopic(topicArn);
			}
		});

		it('should parse connection string options', async () => {
			const topicArn = await createTopic(`test-fromcs-opts-${uniqueId()}`);
			const queueName = `parsed-queue-${uniqueId()}`;

			try {
				const connectionString = `sns://?topicArn=${encodeURIComponent(topicArn)}&region=${AWS_REGION}&endpoint=${encodeURIComponent(LOCALSTACK_ENDPOINT)}&accessKeyId=test&secretAccessKey=test&queueName=${queueName}&waitTimeSeconds=5&deleteQueueOnClose=true`;

				const subscriber =
					await SNSSubscriber.fromConnectionString<TestMessage>(
						connectionString,
					);

				// Subscribe to trigger queue creation
				await subscriber.subscribe(['user.created'], async () => {});

				// Verify queue was created with the specified name
				expect(await queueExists(queueName)).toBe(true);

				await subscriber.stop();

				// Queue should be deleted since deleteQueueOnClose=true
				await new Promise((resolve) => setTimeout(resolve, 500));
				expect(await queueExists(queueName)).toBe(false);
			} finally {
				await deleteTopic(topicArn);
			}
		}, 10000);
	});

	describe('stop', () => {
		it('should stop receiving messages after stop is called', async () => {
			const topicArn = await createTopic(`test-stop-${uniqueId()}`);

			try {
				const connection = new SNSConnection({
					topicArn,
					endpoint: LOCALSTACK_ENDPOINT,
					region: AWS_REGION,
					credentials: AWS_CREDENTIALS,
				});
				await connection.connect();

				const publisher = new SNSPublisher<TestMessage>(connection);
				const subscriber = new SNSSubscriber<TestMessage>(connection, {
					waitTimeSeconds: 1,
					deleteQueueOnClose: true,
				});

				const receivedMessages: TestMessage[] = [];

				await subscriber.subscribe(['user.created'], async (message) => {
					receivedMessages.push(message);
				});

				await new Promise((resolve) => setTimeout(resolve, 1000));

				// Publish first message
				await publisher.publish([
					{ type: 'user.created', payload: { id: 'before-stop' } },
				]);

				await new Promise((resolve) => setTimeout(resolve, 2000));

				// Stop the subscriber
				await subscriber.stop();

				// Should have received the first message
				expect(receivedMessages.length).toBeGreaterThanOrEqual(1);

				await connection.close();
			} finally {
				await deleteTopic(topicArn);
			}
		}, 15000);

		it('should unsubscribe from SNS topic on stop', async () => {
			const topicArn = await createTopic(`test-unsub-${uniqueId()}`);

			try {
				const connection = new SNSConnection({
					topicArn,
					endpoint: LOCALSTACK_ENDPOINT,
					region: AWS_REGION,
					credentials: AWS_CREDENTIALS,
				});
				await connection.connect();

				const subscriber = new SNSSubscriber<TestMessage>(connection, {
					waitTimeSeconds: 1,
					deleteQueueOnClose: true,
				});

				await subscriber.subscribe(['user.created'], async () => {});
				await new Promise((resolve) => setTimeout(resolve, 500));

				// Stop should not throw
				await expect(subscriber.stop()).resolves.toBeUndefined();

				await connection.close();
			} finally {
				await deleteTopic(topicArn);
			}
		}, 10000);
	});
});
