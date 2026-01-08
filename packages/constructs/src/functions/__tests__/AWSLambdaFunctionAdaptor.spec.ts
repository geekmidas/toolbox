import { EnvironmentParser } from '@geekmidas/envkit';
import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import type { Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { AWSLambdaFunction } from '../AWSLambdaFunction';
import { Function } from '../Function';

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

// Mock event publisher
type TestEvent = PublishableMessage<'test.event', { data: string }>;

class TestPublisher implements EventPublisher<TestEvent> {
	publishedEvents: TestEvent[] = [];

	async publish(events: TestEvent[]): Promise<void> {
		this.publishedEvents.push(...events);
	}
}

class TestPublisherService
	implements Service<'TestPublisherService', TestPublisher>
{
	serviceName = 'TestPublisherService' as const;
	static serviceName = 'TestPublisherService';
	publisher = new TestPublisher();

	async register() {
		return this.publisher;
	}
}

// Mock Lambda context
const createMockContext = (): Context => ({
	functionName: 'test-function',
	functionVersion: '1',
	invokedFunctionArn: 'arn:aws:lambda:region:account:function:test-function',
	memoryLimitInMB: '128',
	awsRequestId: 'test-request-id',
	logGroupName: '/aws/lambda/test-function',
	logStreamName: '2023/01/01/[$LATEST]test-stream',
	getRemainingTimeInMillis: () => 30000,
	done: vi.fn(),
	fail: vi.fn(),
	succeed: vi.fn(),
	callbackWaitsForEmptyEventLoop: true,
});

describe('AWSLambdaFunction', () => {
	let envParser: EnvironmentParser<{}>;
	let logger: ConsoleLogger;

	beforeEach(() => {
		envParser = new EnvironmentParser({});
		logger = new ConsoleLogger();
		vi.clearAllMocks();
	});

	describe('basic function execution', () => {
		it('should execute a simple function without input/output schemas', async () => {
			const fn = new Function(async ({ input }) => {
				return { message: `Hello ` };
			});

			const adaptor = new AWSLambdaFunction(envParser, fn);
			const handler = adaptor.handler;

			const result = await handler(
				{ name: 'World' },
				createMockContext(),
				vi.fn(),
			);

			expect(result).toBeUndefined();
		});

		it('should execute a function with input schema validation', async () => {
			const inputSchema = { name: z.string() };
			const outputSchema = z.object({ message: z.string() });
			const handler = vi.fn(async ({ input }) => ({
				message: `Hello ${input.name}`,
			}));

			const fn = new Function(
				handler,
				undefined,
				undefined,
				inputSchema,
				outputSchema,
				[],
				logger,
			);

			const adaptor = new AWSLambdaFunction(envParser, fn);
			const lambdaHandler = adaptor.handler;

			const result = await lambdaHandler(
				{ name: 'TypeScript' },
				createMockContext(),
				vi.fn(),
			);

			expect(result).toEqual({ message: 'Hello TypeScript' });
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					input: { name: 'TypeScript' },
				}),
			);
		});

		it('should fail with invalid input', async () => {
			const inputSchema = { age: z.number() };
			const fn = new Function(
				async () => ({ success: true }),
				undefined,
				undefined,
				inputSchema,
				undefined,
				[],
				logger,
			);

			const adaptor = new AWSLambdaFunction(envParser, fn);
			const handler = adaptor.handler;

			await expect(
				handler({ age: 'not a number' }, createMockContext(), vi.fn()),
			).rejects.toThrow();
		});

		it('should validate output schema', async () => {
			const outputSchema = z.object({
				id: z.string(),
				timestamp: z.number(),
			});

			const fn = new Function(
				async () => ({
					id: '123',
					timestamp: Date.now(),
				}),
				undefined,
				undefined,
				undefined,
				outputSchema,
				[],
				logger,
			);

			const adaptor = new AWSLambdaFunction(envParser, fn);
			const handler = adaptor.handler;

			const result = await handler({}, createMockContext(), vi.fn());

			expect(result).toMatchObject({
				id: '123',
				timestamp: expect.any(Number),
			});
		});

		it('should fail with invalid output', async () => {
			const outputSchema = z.object({
				id: z.string(),
			});

			const fn = new Function(
				// @ts-expect-error
				async () => ({
					id: 123, // Invalid type, should be string
				}),
				undefined,
				undefined,
				undefined,
				outputSchema,
				[],
				logger,
			);

			const adaptor = new AWSLambdaFunction(envParser, fn);
			const handler = adaptor.handler;

			await expect(handler({}, createMockContext(), vi.fn())).rejects.toThrow();
		});
	});

	describe('services', () => {
		it('should inject services into function context', async () => {
			const service = new TestService();
			const handler = vi.fn(async ({ services }) => ({
				value: services.TestService.getValue(),
			}));

			const schema = z.object({ value: z.string() });
			const fn = new Function(
				handler,
				undefined,
				undefined,
				undefined,
				schema,
				[service],
				logger,
			);

			const adaptor = new AWSLambdaFunction(envParser, fn);
			const lambdaHandler = adaptor.handler;

			const result = await lambdaHandler({}, createMockContext(), vi.fn());

			expect(result).toEqual({ value: 'test-value' });
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
			const mockLogger = {
				child: vi.fn().mockReturnThis(),
				info: vi.fn(),
				error: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
			};

			const fn = new Function(
				async ({ logger }) => {
					logger.info('Function executed');
					return { success: true };
				},
				undefined,
				undefined,
				undefined,
				undefined,
				[],
				mockLogger as any,
			);

			const adaptor = new AWSLambdaFunction(envParser, fn);
			const handler = adaptor.handler;

			const context = createMockContext();
			await handler({}, context, vi.fn());

			expect(mockLogger.child).toHaveBeenCalledWith({
				fn: {
					name: 'test-function',
					version: '1',
					memory: '128',
				},
				req: {
					id: 'test-request-id',
				},
			});
			expect(mockLogger.info).toHaveBeenCalledWith('Function executed');
		});
	});

	describe('error handling', () => {
		it('should wrap and log errors', async () => {
			const mockLogger = {
				child: vi.fn().mockReturnThis(),
				error: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
			};

			const fn = new Function(
				async () => {
					throw new Error('Function failed');
				},
				undefined,
				undefined,
				undefined,
				undefined,
				[],
				mockLogger as any,
			);

			const adaptor = new AWSLambdaFunction(envParser, fn);
			const handler = adaptor.handler;

			await expect(handler({}, createMockContext(), vi.fn())).rejects.toThrow();

			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.any(Error),
				'Error processing function',
			);
		});
	});

	describe('events', () => {
		it('should publish events after successful execution', async () => {
			const publisherService = new TestPublisherService();

			const fn = new Function(
				async () => ({ id: '123' }),
				undefined,
				undefined,
				undefined,
				z.object({ id: z.string() }),
				[],
				logger,
				publisherService,
				[
					{
						type: 'test.event',
						payload: (response) => ({ data: response.id }),
					},
				],
			);

			const adaptor = new AWSLambdaFunction(envParser, fn);
			const handler = adaptor.handler;

			await handler({}, createMockContext(), vi.fn());

			expect(publisherService.publisher.publishedEvents).toHaveLength(1);
			expect(publisherService.publisher.publishedEvents[0]).toEqual({
				type: 'test.event',
				payload: { data: '123' },
			});
		});

		it('should conditionally publish events based on when clause', async () => {
			const publisherService = new TestPublisherService();

			const fn = new Function(
				async () => ({ success: false }),
				undefined,
				undefined,
				undefined,
				z.object({ success: z.boolean() }),
				[],
				logger,
				publisherService,
				[
					{
						type: 'test.event',
						payload: () => ({ data: 'test' }),
						when: (response) => response.success === true,
					},
				],
			);

			const adaptor = new AWSLambdaFunction(envParser, fn);
			const handler = adaptor.handler;

			await handler({}, createMockContext(), vi.fn());

			expect(publisherService.publisher.publishedEvents).toHaveLength(0);
		});
	});

	// Skipping timeout tests for now as middleware order needs to be adjusted

	describe('database', () => {
		// Mock database service
		class MockDatabase {
			async query(_sql: string) {
				return [{ id: '1', name: 'Test User' }];
			}
		}

		class DatabaseService implements Service<'database', MockDatabase> {
			serviceName = 'database' as const;
			db = new MockDatabase();

			async register() {
				return this.db;
			}
		}

		it('should inject database into function context', async () => {
			const databaseService = new DatabaseService();
			const handler = vi.fn(async ({ db }) => {
				const result = await db.query('SELECT * FROM users');
				return { users: result };
			});

			const outputSchema = z.object({
				users: z.array(z.object({ id: z.string(), name: z.string() })),
			});

			const fn = new Function(
				handler,
				undefined,
				undefined,
				undefined,
				outputSchema,
				[],
				logger,
				undefined,
				[],
				undefined,
				undefined,
				databaseService,
			);

			const adaptor = new AWSLambdaFunction(envParser, fn);
			const lambdaHandler = adaptor.handler;

			const result = await lambdaHandler({}, createMockContext(), vi.fn());

			expect(result).toEqual({ users: [{ id: '1', name: 'Test User' }] });
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					db: expect.any(MockDatabase),
				}),
			);
		});

		it('should have db as undefined when no database service is configured', async () => {
			const handler = vi.fn(async ({ db }) => {
				return { hasDb: db !== undefined };
			});

			const outputSchema = z.object({ hasDb: z.boolean() });

			const fn = new Function(
				handler,
				undefined,
				undefined,
				undefined,
				outputSchema,
				[],
				logger,
			);

			const adaptor = new AWSLambdaFunction(envParser, fn);
			const lambdaHandler = adaptor.handler;

			const result = await lambdaHandler({}, createMockContext(), vi.fn());

			expect(result).toEqual({ hasDb: false });
		});
	});
});
