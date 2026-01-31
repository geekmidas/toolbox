import { EnvironmentParser } from '@geekmidas/envkit';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import type {
	Context,
	SNSEvent,
	SNSEventRecord,
	SQSEvent,
	SQSRecord,
} from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { AWSLambdaSubscriber } from '../AWSLambdaSubscriberAdaptor';
import { Subscriber } from '../Subscriber';

// Mock services
class TestService implements Service<'TestService', TestService> {
	serviceName = 'TestService' as const;
	static serviceName = 'TestService';

	async register() {
		return this;
	}

	getValue() {
		return 'test-value';
	}
}

// Mock Lambda context
const createMockContext = (): Context => ({
	functionName: 'test-subscriber',
	functionVersion: '1',
	invokedFunctionArn: 'arn:aws:lambda:region:account:function:test-subscriber',
	memoryLimitInMB: '512',
	awsRequestId: 'test-request-id',
	logGroupName: '/aws/lambda/test-subscriber',
	logStreamName: '2023/01/01/[$LATEST]test-stream',
	getRemainingTimeInMillis: () => 30000,
	done: vi.fn(),
	fail: vi.fn(),
	succeed: vi.fn(),
	callbackWaitsForEmptyEventLoop: true,
});

// Helper to create SQS event
const createSQSEvent = (messages: any[]): SQSEvent => ({
	Records: messages.map(
		(body, index) =>
			({
				messageId: `message-${index}`,
				receiptHandle: `receipt-${index}`,
				body: JSON.stringify(body),
				attributes: {
					ApproximateReceiveCount: '1',
					SentTimestamp: '1234567890',
					SenderId: 'sender-id',
					ApproximateFirstReceiveTimestamp: '1234567890',
				},
				messageAttributes: {},
				md5OfBody: 'md5',
				eventSource: 'aws:sqs',
				eventSourceARN: 'arn:aws:sqs:region:account:queue-name',
				awsRegion: 'us-east-1',
			}) as SQSRecord,
	),
});

// Helper to create SNS event with full event format (type in message body)
const createSNSEvent = (messages: any[]): SNSEvent => ({
	Records: messages.map(
		(message, index) =>
			({
				EventSource: 'aws:sns',
				EventVersion: '1.0',
				EventSubscriptionArn: 'arn:aws:sns:region:account:topic-name',
				Sns: {
					Type: 'Notification',
					MessageId: `message-${index}`,
					TopicArn: 'arn:aws:sns:region:account:topic-name',
					Subject: 'Test',
					Message: JSON.stringify(message),
					Timestamp: '2023-01-01T00:00:00.000Z',
					SignatureVersion: '1',
					Signature: 'signature',
					SigningCertUrl: 'https://example.com/cert',
					UnsubscribeUrl: 'https://example.com/unsubscribe',
				},
			}) as SNSEventRecord,
	),
});

// Helper to create SNS wrapped in SQS
const createSNSWrappedInSQS = (messages: any[]): SQSEvent => {
	return createSQSEvent(
		messages.map((message) => ({
			Type: 'Notification',
			MessageId: 'message-id',
			TopicArn: 'arn:aws:sns:region:account:topic-name',
			Message: JSON.stringify(message),
			Timestamp: '2023-01-01T00:00:00.000Z',
		})),
	);
};

describe('AWSLambdaSubscriber', () => {
	let envParser: EnvironmentParser<{}>;
	let logger: ConsoleLogger;

	beforeEach(() => {
		envParser = new EnvironmentParser({});
		logger = new ConsoleLogger();
		vi.clearAllMocks();
	});

	describe('SQS event processing', () => {
		it('should process direct SQS messages', async () => {
			const handler = vi.fn(async ({ events }) => {
				expect(events).toHaveLength(2);
				expect(events[0]).toEqual({
					type: 'user.created',
					payload: { userId: '1', email: 'user1@example.com' },
				});
				expect(events[1]).toEqual({
					type: 'user.created',
					payload: { userId: '2', email: 'user2@example.com' },
				});
			});

			const subscriber = new Subscriber(
				handler,
				30000, // timeout
				undefined, // subscribedEvents
				undefined, // outputSchema
				[], // services
				logger, // logger
			);

			const adapter = new AWSLambdaSubscriber(envParser, subscriber);
			const lambdaHandler = adapter.handler;

			const sqsEvent = createSQSEvent([
				{
					type: 'user.created',
					payload: { userId: '1', email: 'user1@example.com' },
				},
				{
					type: 'user.created',
					payload: { userId: '2', email: 'user2@example.com' },
				},
			]);

			await lambdaHandler(sqsEvent, createMockContext(), vi.fn());

			expect(handler).toHaveBeenCalled();
		});

		it('should process SNS messages wrapped in SQS', async () => {
			const handler = vi.fn(async ({ events }) => {
				expect(events).toHaveLength(2);
				expect(events[0]).toEqual({
					type: 'order.placed',
					payload: { orderId: 'order-1' },
				});
			});

			const subscriber = new Subscriber(
				handler,
				30000, // timeout
				undefined, // subscribedEvents
				undefined, // outputSchema
				[], // services
				logger, // logger
			);

			const adapter = new AWSLambdaSubscriber(envParser, subscriber);
			const lambdaHandler = adapter.handler;

			const sqsEvent = createSNSWrappedInSQS([
				{ type: 'order.placed', payload: { orderId: 'order-1' } },
				{ type: 'order.placed', payload: { orderId: 'order-2' } },
			]);

			await lambdaHandler(sqsEvent, createMockContext(), vi.fn());

			expect(handler).toHaveBeenCalled();
		});
	});

	describe('SNS event processing', () => {
		it('should process SNS events directly', async () => {
			const handler = vi.fn(async ({ events }) => {
				expect(events).toHaveLength(2);
				expect(events[0]).toEqual({
					type: 'user.created',
					payload: { userId: '1', email: 'user1@example.com' },
				});
			});

			const subscriber = new Subscriber(
				handler,
				30000, // timeout
				undefined, // subscribedEvents
				undefined, // outputSchema
				[], // services
				logger, // logger
			);

			const adapter = new AWSLambdaSubscriber(envParser, subscriber);
			const lambdaHandler = adapter.handler;

			const snsEvent = createSNSEvent([
				{
					type: 'user.created',
					payload: { userId: '1', email: 'user1@example.com' },
				},
				{
					type: 'user.created',
					payload: { userId: '2', email: 'user2@example.com' },
				},
			]);

			await lambdaHandler(snsEvent, createMockContext(), vi.fn());

			expect(handler).toHaveBeenCalled();
		});
	});

	describe('event type filtering', () => {
		it('should filter events by subscribed types', async () => {
			const handler = vi.fn(async ({ events }) => {
				expect(events).toHaveLength(2);
				expect(events.every((e: any) => e.type === 'user.created')).toBe(true);
			});

			const subscriber = new Subscriber(
				handler,
				30000, // timeout
				['user.created'] as any, // subscribedEvents - Only subscribe to user.created
				undefined, // outputSchema
				[], // services
				logger, // logger
			);

			const adapter = new AWSLambdaSubscriber(envParser, subscriber);
			const lambdaHandler = adapter.handler;

			const sqsEvent = createSQSEvent([
				{
					type: 'user.created',
					payload: { userId: '1', email: 'user1@example.com' },
				},
				{ type: 'order.placed', payload: { orderId: 'order-1' } }, // Should be filtered out
				{
					type: 'user.created',
					payload: { userId: '2', email: 'user2@example.com' },
				},
			]);

			await lambdaHandler(sqsEvent, createMockContext(), vi.fn());

			expect(handler).toHaveBeenCalled();
		});

		it('should accept all events when no subscribed types specified', async () => {
			const handler = vi.fn(async ({ events }) => {
				expect(events).toHaveLength(3);
			});

			const subscriber = new Subscriber(
				handler,
				30000, // timeout
				undefined, // subscribedEvents - No filter
				undefined, // outputSchema
				[], // services
				logger, // logger
			);

			const adapter = new AWSLambdaSubscriber(envParser, subscriber);
			const lambdaHandler = adapter.handler;

			const sqsEvent = createSQSEvent([
				{
					type: 'user.created',
					payload: { userId: '1', email: 'user1@example.com' },
				},
				{ type: 'order.placed', payload: { orderId: 'order-1' } },
				{ type: 'user.updated', payload: { userId: '1' } },
			]);

			await lambdaHandler(sqsEvent, createMockContext(), vi.fn());

			expect(handler).toHaveBeenCalled();
		});

		it('should return early when no subscribed events after filtering', async () => {
			const handler = vi.fn();

			const subscriber = new Subscriber(
				handler,
				30000, // timeout
				['user.deleted'] as any, // subscribedEvents - Subscribe to events that won't come
				undefined, // outputSchema
				[], // services
				logger, // logger
			);

			const adapter = new AWSLambdaSubscriber(envParser, subscriber);
			const lambdaHandler = adapter.handler;

			const sqsEvent = createSQSEvent([
				{
					type: 'user.created',
					payload: { userId: '1', email: 'user1@example.com' },
				},
				{ type: 'order.placed', payload: { orderId: 'order-1' } },
			]);

			const result = await lambdaHandler(
				sqsEvent,
				createMockContext(),
				vi.fn(),
			);

			expect(handler).not.toHaveBeenCalled();
			expect(result).toEqual({ batchItemFailures: [] });
		});
	});

	describe('services', () => {
		it('should inject services into subscriber context', async () => {
			const service = new TestService();
			const handler = vi.fn(async ({ services }) => {
				expect(services.TestService.getValue()).toBe('test-value');
			});

			const subscriber = new Subscriber(
				handler,
				30000, // timeout
				undefined, // subscribedEvents
				undefined, // outputSchema
				[service], // services
				logger, // logger
			);

			const adapter = new AWSLambdaSubscriber(envParser, subscriber);
			const lambdaHandler = adapter.handler;

			const sqsEvent = createSQSEvent([
				{
					type: 'user.created',
					payload: { userId: '1', email: 'user1@example.com' },
				},
			]);

			await lambdaHandler(sqsEvent, createMockContext(), vi.fn());

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					services: expect.objectContaining({
						TestService: expect.any(TestService),
					}),
				}),
			);
		});
	});

	describe('logging', () => {
		it('should create child logger with Lambda context', async () => {
			const childLogger = {
				info: vi.fn(),
				error: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
				child: vi.fn(),
			};

			const mockLogger = {
				child: vi.fn().mockReturnValue(childLogger),
				info: vi.fn(),
				error: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
			};

			const subscriber = new Subscriber(
				async ({ logger }) => {
					logger.info('Processing events');
				},
				30000, // timeout
				undefined, // subscribedEvents
				undefined, // outputSchema
				[], // services
				mockLogger as any, // logger
			);

			const adapter = new AWSLambdaSubscriber(envParser, subscriber);
			const lambdaHandler = adapter.handler;

			const context = createMockContext();
			const sqsEvent = createSQSEvent([
				{
					type: 'user.created',
					payload: { userId: '1', email: 'user1@example.com' },
				},
			]);

			await lambdaHandler(sqsEvent, context, vi.fn());

			expect(mockLogger.child).toHaveBeenCalledWith({
				subscriber: {
					name: 'test-subscriber',
					version: '1',
					memory: '512',
				},
				req: {
					id: 'test-request-id',
				},
			});
			expect(childLogger.info).toHaveBeenCalledWith('Processing events');
		});
	});

	describe('output validation', () => {
		it('should validate output against schema', async () => {
			const outputSchema = z.object({
				processed: z.number(),
			});

			const subscriber = new Subscriber(
				async ({ events }) => ({
					processed: events.length,
				}),
				30000, // timeout
				undefined, // subscribedEvents
				outputSchema, // outputSchema
				[], // services
				logger, // logger
			);

			const adapter = new AWSLambdaSubscriber(envParser, subscriber);
			const lambdaHandler = adapter.handler;

			const sqsEvent = createSQSEvent([
				{
					type: 'user.created',
					payload: { userId: '1', email: 'user1@example.com' },
				},
				{
					type: 'user.created',
					payload: { userId: '2', email: 'user2@example.com' },
				},
			]);

			const result = await lambdaHandler(
				sqsEvent,
				createMockContext(),
				vi.fn(),
			);

			expect(result).toEqual({ processed: 2 });
		});

		it('should fail with invalid output', async () => {
			const outputSchema = z.object({
				processed: z.number(),
			});

			const subscriber = new Subscriber(
				// @ts-expect-error - intentionally returning wrong type
				async () => ({
					processed: 'not a number',
				}),
				30000, // timeout
				undefined, // subscribedEvents
				outputSchema, // outputSchema
				[], // services
				logger, // logger
			);

			const adapter = new AWSLambdaSubscriber(envParser, subscriber);
			const lambdaHandler = adapter.handler;

			const sqsEvent = createSQSEvent([
				{
					type: 'user.created',
					payload: { userId: '1', email: 'user1@example.com' },
				},
			]);

			await expect(
				lambdaHandler(sqsEvent, createMockContext(), vi.fn()),
			).rejects.toThrow();
		});
	});

	describe('error handling', () => {
		it('should wrap and log errors', async () => {
			const childLogger = {
				info: vi.fn(),
				error: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
				child: vi.fn(),
			};

			const mockLogger = {
				child: vi.fn().mockReturnValue(childLogger),
				error: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
			};

			const subscriber = new Subscriber(
				async () => {
					throw new Error('Processing failed');
				},
				30000, // timeout
				undefined, // subscribedEvents
				undefined, // outputSchema
				[], // services
				mockLogger as any, // logger
			);

			const adapter = new AWSLambdaSubscriber(envParser, subscriber);
			const lambdaHandler = adapter.handler;

			const sqsEvent = createSQSEvent([
				{
					type: 'user.created',
					payload: { userId: '1', email: 'user1@example.com' },
				},
			]);

			await expect(
				lambdaHandler(sqsEvent, createMockContext(), vi.fn()),
			).rejects.toThrow();

			expect(childLogger.error).toHaveBeenCalledWith(
				expect.any(Error),
				'Error processing subscriber',
			);
		});

		it('should log errors for invalid SQS records', async () => {
			const childLogger = {
				info: vi.fn(),
				error: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
				child: vi.fn(),
			};

			const mockLogger = {
				child: vi.fn().mockReturnValue(childLogger),
				info: vi.fn(),
				error: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
			};

			const handler = vi.fn(async ({ events }) => {
				// Should still process valid events
				expect(events).toHaveLength(1);
			});

			const subscriber = new Subscriber(
				handler,
				30000, // timeout
				undefined, // subscribedEvents
				undefined, // outputSchema
				[], // services
				mockLogger as any, // logger
			);

			const adapter = new AWSLambdaSubscriber(envParser, subscriber);
			const lambdaHandler = adapter.handler;

			// Create event with one invalid record
			const sqsEvent: SQSEvent = {
				Records: [
					{
						messageId: 'message-1',
						receiptHandle: 'receipt-1',
						body: 'invalid json{',
						attributes: {} as any,
						messageAttributes: {},
						md5OfBody: 'md5',
						eventSource: 'aws:sqs',
						eventSourceARN: 'arn:aws:sqs:region:account:queue-name',
						awsRegion: 'us-east-1',
					} as SQSRecord,
					{
						messageId: 'message-2',
						receiptHandle: 'receipt-2',
						body: JSON.stringify({
							type: 'user.created',
							payload: { userId: '1', email: 'user1@example.com' },
						}),
						attributes: {} as any,
						messageAttributes: {},
						md5OfBody: 'md5',
						eventSource: 'aws:sqs',
						eventSourceARN: 'arn:aws:sqs:region:account:queue-name',
						awsRegion: 'us-east-1',
					} as SQSRecord,
				],
			};

			await lambdaHandler(sqsEvent, createMockContext(), vi.fn());

			expect(childLogger.error).toHaveBeenCalledWith(
				expect.objectContaining({
					error: expect.any(Error),
					record: expect.any(Object),
				}),
				'Failed to parse SQS record body',
			);
			expect(handler).toHaveBeenCalled();
		});
	});
});
