import { describe, expect, it } from 'vitest';
import type { PublishableMessage } from '../../types';
import { RabbitMQConnection } from '../RabbitMQConnection';
import { RabbitMQPublisher } from '../RabbitMQPublisher';
import { RabbitMQSubscriber } from '../RabbitMQSubscriber';

type TestMessage = PublishableMessage<'user.created' | 'user.updated', any>;

const RABBITMQ_URL = 'amqp://geekmidas:geekmidas@localhost:5672';

// Helper to generate unique exchange names
const uniqueExchange = () =>
	`test-exchange-${Date.now()}-${Math.random().toString(36).substring(7)}`;

describe('RabbitMQSubscriber - Integration Tests', () => {
	it('should receive published messages', async () => {
		const testExchange = uniqueExchange();
		const connection = new RabbitMQConnection({
			url: RABBITMQ_URL,
			exchange: testExchange,
		});
		await connection.connect();

		const publisher = new RabbitMQPublisher<TestMessage>(connection);
		const subscriber = new RabbitMQSubscriber<TestMessage>(connection);

		const receivedMessages: TestMessage[] = [];

		await subscriber.subscribe(['user.created'], async (message) => {
			receivedMessages.push(message);
		});

		// Wait a bit for consumer to be ready
		await new Promise((resolve) => setTimeout(resolve, 100));

		await publisher.publish([
			{ type: 'user.created', payload: { userId: '123' } },
		]);

		// Wait for message to be processed
		await new Promise((resolve) => setTimeout(resolve, 200));

		expect(receivedMessages).toHaveLength(1);
		expect(receivedMessages[0].payload.userId).toBe('123');

		await connection.close();
	});

	it('should receive multiple messages', async () => {
		const testExchange = uniqueExchange();
		const connection = new RabbitMQConnection({
			url: RABBITMQ_URL,
			exchange: testExchange,
		});
		await connection.connect();

		const publisher = new RabbitMQPublisher<TestMessage>(connection);
		const subscriber = new RabbitMQSubscriber<TestMessage>(connection);

		const receivedMessages: TestMessage[] = [];

		await subscriber.subscribe(['user.created'], async (message) => {
			receivedMessages.push(message);
		});

		await new Promise((resolve) => setTimeout(resolve, 100));

		await publisher.publish([
			{ type: 'user.created', payload: { userId: '1' } },
			{ type: 'user.created', payload: { userId: '2' } },
			{ type: 'user.created', payload: { userId: '3' } },
		]);

		await new Promise((resolve) => setTimeout(resolve, 300));

		expect(receivedMessages).toHaveLength(3);

		await connection.close();
	});

	it('should only receive subscribed message types', async () => {
		const testExchange = uniqueExchange();
		const connection = new RabbitMQConnection({
			url: RABBITMQ_URL,
			exchange: testExchange,
		});
		await connection.connect();

		const publisher = new RabbitMQPublisher<TestMessage>(connection);
		const subscriber = new RabbitMQSubscriber<TestMessage>(connection);

		const receivedMessages: TestMessage[] = [];

		// Only subscribe to user.created
		await subscriber.subscribe(['user.created'], async (message) => {
			receivedMessages.push(message);
		});

		await new Promise((resolve) => setTimeout(resolve, 100));

		await publisher.publish([
			{ type: 'user.created', payload: { userId: '1' } },
			{ type: 'user.updated', payload: { userId: '2' } },
			{ type: 'user.created', payload: { userId: '3' } },
		]);

		await new Promise((resolve) => setTimeout(resolve, 300));

		expect(receivedMessages).toHaveLength(2);
		expect(receivedMessages.every((m) => m.payload.userId !== '2')).toBe(true);

		await connection.close();
	});

	it('should subscribe to multiple message types', async () => {
		const testExchange = uniqueExchange();
		const connection = new RabbitMQConnection({
			url: RABBITMQ_URL,
			exchange: testExchange,
		});
		await connection.connect();

		const publisher = new RabbitMQPublisher<TestMessage>(connection);
		const subscriber = new RabbitMQSubscriber<TestMessage>(connection);

		const receivedMessages: TestMessage[] = [];

		await subscriber.subscribe(
			['user.created', 'user.updated'],
			async (message) => {
				receivedMessages.push(message);
			},
		);

		await new Promise((resolve) => setTimeout(resolve, 100));

		await publisher.publish([
			{ type: 'user.created', payload: { userId: '1' } },
			{ type: 'user.updated', payload: { userId: '2' } },
			{ type: 'user.created', payload: { userId: '3' } },
		]);

		await new Promise((resolve) => setTimeout(resolve, 300));

		expect(receivedMessages).toHaveLength(3);

		await connection.close();
	});

	it('should handle message processing errors with nack', async () => {
		const testExchange = uniqueExchange();
		const connection = new RabbitMQConnection({
			url: RABBITMQ_URL,
			exchange: testExchange,
		});
		await connection.connect();

		const publisher = new RabbitMQPublisher<TestMessage>(connection);
		const subscriber = new RabbitMQSubscriber<TestMessage>(connection);

		let processCount = 0;

		await subscriber.subscribe(['user.created'], async (_message) => {
			processCount++;
			if (processCount === 1) {
				// Fail first time
				throw new Error('Processing error');
			}
			// Success on retry
		});

		await new Promise((resolve) => setTimeout(resolve, 100));

		await publisher.publish([
			{ type: 'user.created', payload: { userId: '123' } },
		]);

		// Wait for initial processing and retry
		await new Promise((resolve) => setTimeout(resolve, 500));

		// Should have been processed twice (initial + retry after nack)
		expect(processCount).toBeGreaterThanOrEqual(2);

		await connection.close();
	});

	it('should work with custom queue name', async () => {
		const testExchange = uniqueExchange();
		const queueName = `test-queue-${Date.now()}`;

		const connection = new RabbitMQConnection({
			url: RABBITMQ_URL,
			exchange: testExchange,
		});
		await connection.connect();

		const publisher = new RabbitMQPublisher<TestMessage>(connection);
		const subscriber = new RabbitMQSubscriber<TestMessage>(connection, {
			queueName,
		});

		const receivedMessages: TestMessage[] = [];

		await subscriber.subscribe(['user.created'], async (message) => {
			receivedMessages.push(message);
		});

		await new Promise((resolve) => setTimeout(resolve, 100));

		await publisher.publish([
			{ type: 'user.created', payload: { userId: '123' } },
		]);

		await new Promise((resolve) => setTimeout(resolve, 200));

		expect(receivedMessages).toHaveLength(1);

		await connection.close();
	});

	it('should work with prefetch limit', async () => {
		const testExchange = uniqueExchange();
		const connection = new RabbitMQConnection({
			url: RABBITMQ_URL,
			exchange: testExchange,
		});
		await connection.connect();

		const publisher = new RabbitMQPublisher<TestMessage>(connection);
		const subscriber = new RabbitMQSubscriber<TestMessage>(connection, {
			prefetch: 1,
		});

		const receivedMessages: TestMessage[] = [];

		await subscriber.subscribe(['user.created'], async (message) => {
			receivedMessages.push(message);
			// Slow processing
			await new Promise((resolve) => setTimeout(resolve, 100));
		});

		await new Promise((resolve) => setTimeout(resolve, 100));

		// Publish multiple messages
		await publisher.publish([
			{ type: 'user.created', payload: { userId: '1' } },
			{ type: 'user.created', payload: { userId: '2' } },
			{ type: 'user.created', payload: { userId: '3' } },
		]);

		// Wait for all to be processed
		await new Promise((resolve) => setTimeout(resolve, 500));

		expect(receivedMessages).toHaveLength(3);

		await connection.close();
	});

	it('should work with fromConnectionString', async () => {
		const testExchange = uniqueExchange();
		const subscriber =
			await RabbitMQSubscriber.fromConnectionString<TestMessage>(
				`rabbitmq://geekmidas:geekmidas@localhost:5672?exchange=${testExchange}`,
			);

		const connection = new RabbitMQConnection({
			url: RABBITMQ_URL,
			exchange: testExchange,
		});
		await connection.connect();

		const publisher = new RabbitMQPublisher<TestMessage>(connection);

		const receivedMessages: TestMessage[] = [];

		await subscriber.subscribe(['user.created'], async (message) => {
			receivedMessages.push(message);
		});

		await new Promise((resolve) => setTimeout(resolve, 100));

		await publisher.publish([
			{ type: 'user.created', payload: { userId: '123' } },
		]);

		await new Promise((resolve) => setTimeout(resolve, 200));

		expect(receivedMessages).toHaveLength(1);

		await connection.close();
	});
});
