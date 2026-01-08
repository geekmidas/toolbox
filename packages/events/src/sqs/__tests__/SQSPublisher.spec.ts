import { describe, expect, it } from 'vitest';
import type { PublishableMessage } from '../../types';
import { SQSConnection } from '../SQSConnection';
import { SQSPublisher } from '../SQSPublisher';

type TestMessage = PublishableMessage<'user.created' | 'user.updated', any>;

const TEST_QUEUE_URL =
	'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue';

describe('SQSPublisher', () => {
	describe('constructor', () => {
		it('should create instance with queue URL', () => {
			const connection = new SQSConnection({
				queueUrl: TEST_QUEUE_URL,
			});
			const publisher = new SQSPublisher<TestMessage>(connection);

			expect(publisher).toBeDefined();
		});

		it('should create instance with region', () => {
			const connection = new SQSConnection({
				queueUrl: TEST_QUEUE_URL,
				region: 'us-east-1',
			});
			const publisher = new SQSPublisher<TestMessage>(connection);

			expect(publisher).toBeDefined();
		});

		it('should create instance with credentials', () => {
			const connection = new SQSConnection({
				queueUrl: TEST_QUEUE_URL,
				region: 'us-east-1',
				credentials: {
					accessKeyId: 'test-key',
					secretAccessKey: 'test-secret',
				},
			});
			const publisher = new SQSPublisher<TestMessage>(connection);

			expect(publisher).toBeDefined();
		});

		it('should create instance with custom batch size', () => {
			const connection = new SQSConnection({
				queueUrl: TEST_QUEUE_URL,
			});
			const publisher = new SQSPublisher<TestMessage>(connection, {
				maxBatchSize: 5,
			});

			expect(publisher).toBeDefined();
		});

		it('should create instance with custom endpoint', () => {
			const connection = new SQSConnection({
				queueUrl: TEST_QUEUE_URL,
				endpoint: 'http://localhost:4566',
			});
			const publisher = new SQSPublisher<TestMessage>(connection);

			expect(publisher).toBeDefined();
		});

		it('should default maxBatchSize to 10', () => {
			const connection = new SQSConnection({
				queueUrl: TEST_QUEUE_URL,
			});
			const publisher = new SQSPublisher<TestMessage>(connection);

			// Access private options through any to test default
			expect(publisher.options.maxBatchSize).toBe(10);
		});
	});

	describe('fromConnectionString', () => {
		it('should parse basic connection string', async () => {
			const publisher = await SQSPublisher.fromConnectionString<TestMessage>(
				`sqs://?queueUrl=${encodeURIComponent(TEST_QUEUE_URL)}`,
			);

			expect(publisher).toBeDefined();
		});

		it('should parse connection string with region', async () => {
			const publisher = await SQSPublisher.fromConnectionString<TestMessage>(
				`sqs://?queueUrl=${encodeURIComponent(TEST_QUEUE_URL)}&region=us-west-2`,
			);

			expect(publisher).toBeDefined();
			expect(publisher.connection.config.region).toBe('us-west-2');
		});

		it('should parse connection string with credentials', async () => {
			const publisher = await SQSPublisher.fromConnectionString<TestMessage>(
				`sqs://?queueUrl=${encodeURIComponent(TEST_QUEUE_URL)}&accessKeyId=test-key&secretAccessKey=test-secret`,
			);

			expect(publisher).toBeDefined();
			expect(publisher.connection.config.credentials).toEqual({
				accessKeyId: 'test-key',
				secretAccessKey: 'test-secret',
				sessionToken: undefined,
			});
		});

		it('should parse connection string with session token', async () => {
			const publisher = await SQSPublisher.fromConnectionString<TestMessage>(
				`sqs://?queueUrl=${encodeURIComponent(TEST_QUEUE_URL)}&accessKeyId=test-key&secretAccessKey=test-secret&sessionToken=test-token`,
			);

			expect(publisher).toBeDefined();
			expect(publisher.connection.config.credentials).toEqual({
				accessKeyId: 'test-key',
				secretAccessKey: 'test-secret',
				sessionToken: 'test-token',
			});
		});

		it('should parse connection string with maxBatchSize', async () => {
			const publisher = await SQSPublisher.fromConnectionString<TestMessage>(
				`sqs://?queueUrl=${encodeURIComponent(TEST_QUEUE_URL)}&maxBatchSize=5`,
			);

			expect(publisher).toBeDefined();
			expect(publisher.options.maxBatchSize).toBe(5);
		});

		it('should parse connection string with endpoint', async () => {
			const publisher = await SQSPublisher.fromConnectionString<TestMessage>(
				`sqs://?queueUrl=${encodeURIComponent(TEST_QUEUE_URL)}&endpoint=${encodeURIComponent('http://localhost:4566')}`,
			);

			expect(publisher).toBeDefined();
			expect(publisher.connection.config.endpoint).toBe(
				'http://localhost:4566',
			);
		});

		it('should parse connection string with all parameters', async () => {
			const publisher = await SQSPublisher.fromConnectionString<TestMessage>(
				`sqs://?queueUrl=${encodeURIComponent(TEST_QUEUE_URL)}&region=us-west-2&endpoint=${encodeURIComponent('http://localhost:4566')}&maxBatchSize=5&accessKeyId=test&secretAccessKey=secret`,
			);

			expect(publisher).toBeDefined();
			expect(publisher.connection.config.region).toBe('us-west-2');
			expect(publisher.connection.config.endpoint).toBe(
				'http://localhost:4566',
			);
			expect(publisher.options.maxBatchSize).toBe(5);
			expect(publisher.connection.config.credentials).toEqual({
				accessKeyId: 'test',
				secretAccessKey: 'secret',
				sessionToken: undefined,
			});
		});

		it('should throw error if queueUrl is missing', async () => {
			await expect(
				SQSPublisher.fromConnectionString<TestMessage>(
					'sqs://?region=us-east-1',
				),
			).rejects.toThrow('queueUrl parameter is required');
		});
	});

	describe('close', () => {
		it('should close without error', async () => {
			const connection = new SQSConnection({
				queueUrl: TEST_QUEUE_URL,
			});
			const publisher = new SQSPublisher<TestMessage>(connection);

			await expect(publisher.close()).resolves.toBeUndefined();
		});

		it('should allow multiple close calls', async () => {
			const connection = new SQSConnection({
				queueUrl: TEST_QUEUE_URL,
			});
			const publisher = new SQSPublisher<TestMessage>(connection);

			await publisher.close();
			await expect(publisher.close()).resolves.toBeUndefined();
		});
	});
});
