import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Subscriber } from '../Subscriber';
import { SubscriberBuilder } from '../SubscriberBuilder';
import { TestSubscriberAdaptor } from '../TestSubscriberAdaptor';

// --- Test fixtures ---

type UserEvent =
	| PublishableMessage<
			'user.created',
			{ userId: string; email: string; name: string }
	  >
	| PublishableMessage<
			'user.updated',
			{ userId: string; changes: Record<string, any> }
	  >
	| PublishableMessage<'user.deleted', { userId: string }>;

class TestEventPublisher implements EventPublisher<UserEvent> {
	publishedEvents: UserEvent[] = [];
	async publish(events: UserEvent[]): Promise<void> {
		this.publishedEvents.push(...events);
	}
}

const TestEventService: Service<'testEventPublisher', TestEventPublisher> = {
	serviceName: 'testEventPublisher' as const,
	register() {
		return new TestEventPublisher();
	},
};

const TestDbService: Service<'db', { query: () => string }> = {
	serviceName: 'db' as const,
	register() {
		return { query: () => 'result' };
	},
};

describe('TestSubscriberAdaptor', () => {
	let logger: ConsoleLogger;

	beforeEach(() => {
		logger = new ConsoleLogger();
		vi.clearAllMocks();
	});

	describe('basic execution', () => {
		it('should invoke a subscriber and return result', async () => {
			const subscriber = new SubscriberBuilder()
				.publisher(TestEventService)
				.subscribe('user.created')
				.handle(async ({ events }) => ({
					processed: events.length,
				}));

			const adaptor = new TestSubscriberAdaptor(subscriber);

			const result = await adaptor.invoke({
				events: [
					{
						type: 'user.created',
						payload: {
							userId: '1',
							email: 'test@example.com',
							name: 'Test',
						},
					},
				],
				services: {},
			});

			expect(result).toEqual({ processed: 1 });
		});

		it('should return early with batchItemFailures for empty events', async () => {
			const handler = vi.fn(async () => ({ processed: 0 }));
			const subscriber = new SubscriberBuilder()
				.publisher(TestEventService)
				.subscribe('user.created')
				.handle(handler);

			const adaptor = new TestSubscriberAdaptor(subscriber);

			const result = await adaptor.invoke({
				events: [],
				services: {},
			});

			expect(result).toEqual({ batchItemFailures: [] });
			expect(handler).not.toHaveBeenCalled();
		});

		it('should handle multiple events in a batch', async () => {
			const processedIds: string[] = [];
			const subscriber = new SubscriberBuilder()
				.publisher(TestEventService)
				.subscribe(['user.created', 'user.updated'])
				.handle(async ({ events }) => {
					for (const event of events) {
						processedIds.push(event.payload.userId);
					}
					return { count: events.length };
				});

			const adaptor = new TestSubscriberAdaptor(subscriber);

			const result = await adaptor.invoke({
				events: [
					{
						type: 'user.created',
						payload: {
							userId: '1',
							email: 'a@b.com',
							name: 'A',
						},
					},
					{
						type: 'user.updated',
						payload: {
							userId: '2',
							changes: { name: 'B' },
						},
					},
				] as any,
				services: {},
			});

			expect(result).toEqual({ count: 2 });
			expect(processedIds).toEqual(['1', '2']);
		});
	});

	describe('output validation', () => {
		it('should validate output against schema', async () => {
			const outputSchema = z.object({ processed: z.number() });

			const subscriber = new SubscriberBuilder()
				.publisher(TestEventService)
				.output(outputSchema)
				.subscribe('user.created')
				.handle(async ({ events }) => ({
					processed: events.length,
				}));

			const adaptor = new TestSubscriberAdaptor(subscriber);

			const result = await adaptor.invoke({
				events: [
					{
						type: 'user.created',
						payload: {
							userId: '1',
							email: 'test@example.com',
							name: 'Test',
						},
					},
				],
				services: {},
			});

			expect(result).toEqual({ processed: 1 });
		});

		it('should throw on invalid output', async () => {
			const outputSchema = z.object({ processed: z.number() });

			const subscriber = new SubscriberBuilder()
				.publisher(TestEventService)
				.output(outputSchema)
				.subscribe('user.created')
				.handle(async () => ({
					processed: 'not-a-number' as any,
				}));

			const adaptor = new TestSubscriberAdaptor(subscriber);

			await expect(
				adaptor.invoke({
					events: [
						{
							type: 'user.created',
							payload: {
								userId: '1',
								email: 'test@example.com',
								name: 'Test',
							},
						},
					],
					services: {},
				}),
			).rejects.toThrow('Subscriber output validation failed');
		});
	});

	describe('event filtering', () => {
		it('should filter out events not in subscribedEvents', async () => {
			const receivedEvents: any[] = [];
			const subscriber = new SubscriberBuilder()
				.publisher(TestEventService)
				.subscribe('user.created')
				.handle(async ({ events }) => {
					receivedEvents.push(...events);
					return { count: events.length };
				});

			const adaptor = new TestSubscriberAdaptor(subscriber);

			const result = await adaptor.invoke({
				events: [
					{
						type: 'user.created',
						payload: {
							userId: '1',
							email: 'a@b.com',
							name: 'A',
						},
					},
					// This event type is not subscribed — should be filtered
					{
						type: 'user.deleted',
						payload: { userId: '2' },
					},
				] as any,
				services: {},
			});

			expect(result).toEqual({ count: 1 });
			expect(receivedEvents).toHaveLength(1);
			expect(receivedEvents[0].type).toBe('user.created');
		});

		it('should return early if all events are filtered out', async () => {
			const handler = vi.fn(async () => ({}));
			const subscriber = new SubscriberBuilder()
				.publisher(TestEventService)
				.subscribe('user.created')
				.handle(handler);

			const adaptor = new TestSubscriberAdaptor(subscriber);

			const result = await adaptor.invoke({
				events: [
					{
						type: 'user.deleted',
						payload: { userId: '1' },
					},
				] as any,
				services: {},
			});

			expect(result).toEqual({ batchItemFailures: [] });
			expect(handler).not.toHaveBeenCalled();
		});

		it('should accept all events when subscribedEvents is undefined', async () => {
			// Build a subscriber without .subscribe() — accepts all
			const subscriber = new Subscriber(
				async ({ events }) => ({ count: events.length }),
				30000,
				undefined, // no subscribedEvents filter
			);

			const adaptor = new TestSubscriberAdaptor(subscriber as any);

			const result = await adaptor.invoke({
				events: [
					{ type: 'user.created', payload: { userId: '1' } },
					{ type: 'user.deleted', payload: { userId: '2' } },
				] as any,
				services: {},
			});

			expect(result).toEqual({ count: 2 });
		});
	});

	describe('services', () => {
		it('should use provided services from request', async () => {
			const subscriber = new SubscriberBuilder()
				.publisher(TestEventService)
				.services([TestDbService])
				.subscribe('user.created')
				.handle(async ({ services }) => ({
					value: services.db.query(),
				}));

			const adaptor = new TestSubscriberAdaptor(subscriber);

			const result = await adaptor.invoke({
				events: [
					{
						type: 'user.created',
						payload: {
							userId: '1',
							email: 'a@b.com',
							name: 'A',
						},
					},
				],
				services: { db: { query: () => 'injected-result' } },
			});

			expect(result).toEqual({ value: 'injected-result' });
		});

		it('should auto-resolve services when not provided', async () => {
			const subscriber = new SubscriberBuilder()
				.publisher(TestEventService)
				.services([TestDbService])
				.subscribe('user.created')
				.handle(async ({ services }) => ({
					value: services.db.query(),
				}));

			const adaptor = new TestSubscriberAdaptor(subscriber);

			const result = await adaptor.invoke({
				events: [
					{
						type: 'user.created',
						payload: {
							userId: '1',
							email: 'a@b.com',
							name: 'A',
						},
					},
				],
			});

			expect(result).toEqual({ value: 'result' });
		});

		it('should use custom ServiceDiscovery when provided', async () => {
			const subscriber = new SubscriberBuilder()
				.publisher(TestEventService)
				.services([TestDbService])
				.subscribe('user.created')
				.handle(async ({ services }) => ({
					value: services.db.query(),
				}));

			const mockDiscovery = {
				register: vi.fn().mockResolvedValue({
					db: { query: () => 'custom-discovery' },
				}),
			} as any;

			const adaptor = new TestSubscriberAdaptor(subscriber, mockDiscovery);

			const result = await adaptor.invoke({
				events: [
					{
						type: 'user.created',
						payload: {
							userId: '1',
							email: 'a@b.com',
							name: 'A',
						},
					},
				],
			});

			expect(result).toEqual({ value: 'custom-discovery' });
			expect(mockDiscovery.register).toHaveBeenCalledWith(subscriber.services);
		});
	});

	describe('logging', () => {
		it('should create child logger with test context', async () => {
			const mockLogger: Logger = {
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				fatal: vi.fn(),
				trace: vi.fn(),
				child: vi.fn().mockReturnThis(),
			};

			const subscriber = new SubscriberBuilder()
				.publisher(TestEventService)
				.logger(mockLogger)
				.subscribe('user.created')
				.handle(async ({ logger }) => {
					logger.info('Processing events');
					return {};
				});

			const adaptor = new TestSubscriberAdaptor(subscriber);

			await adaptor.invoke({
				events: [
					{
						type: 'user.created',
						payload: {
							userId: '1',
							email: 'a@b.com',
							name: 'A',
						},
					},
				],
				services: {},
			});

			expect(mockLogger.child).toHaveBeenCalledWith({ test: true });
			expect(mockLogger.info).toHaveBeenCalledWith('Processing events');
		});
	});

	describe('event publishing', () => {
		it('should publish events after successful execution', async () => {
			const testPublisher = new TestEventPublisher();
			const publisherService: Service<'publisher', TestEventPublisher> = {
				serviceName: 'publisher' as const,
				register() {
					return testPublisher;
				},
			};

			const subscriber = new Subscriber(
				async ({ events }) => ({
					count: events.length,
				}),
				30000,
				['user.created'] as any,
				z.object({ count: z.number() }),
				[],
				logger,
				publisherService as any,
			);

			// Add events to publish after handler completes
			(subscriber as any).events = [
				{
					type: 'user.updated',
					payload: (response: any) => ({
						userId: 'derived',
						changes: { count: response.count },
					}),
				},
			];

			const adaptor = new TestSubscriberAdaptor(subscriber as any);

			await adaptor.invoke({
				events: [
					{
						type: 'user.created',
						payload: {
							userId: '1',
							email: 'a@b.com',
							name: 'A',
						},
					},
				] as any,
				services: {},
			});

			expect(testPublisher.publishedEvents).toHaveLength(1);
			expect(testPublisher.publishedEvents[0]).toEqual({
				type: 'user.updated',
				payload: { userId: 'derived', changes: { count: 1 } },
			});
		});

		it('should conditionally publish events with when clause', async () => {
			const testPublisher = new TestEventPublisher();
			const publisherService: Service<'publisher', TestEventPublisher> = {
				serviceName: 'publisher' as const,
				register() {
					return testPublisher;
				},
			};

			const subscriber = new Subscriber(
				async () => ({ success: false }),
				30000,
				['user.created'] as any,
				z.object({ success: z.boolean() }),
				[],
				logger,
				publisherService as any,
			);

			(subscriber as any).events = [
				{
					type: 'user.updated',
					payload: () => ({
						userId: 'test',
						changes: {},
					}),
					when: (response: any) => response.success === true,
				},
			];

			const adaptor = new TestSubscriberAdaptor(subscriber as any);

			await adaptor.invoke({
				events: [
					{
						type: 'user.created',
						payload: {
							userId: '1',
							email: 'a@b.com',
							name: 'A',
						},
					},
				] as any,
				services: {},
			});

			// when clause returned false — no events published
			expect(testPublisher.publishedEvents).toHaveLength(0);
		});
	});

	describe('error handling', () => {
		it('should propagate errors from handler execution', async () => {
			const subscriber = new SubscriberBuilder()
				.publisher(TestEventService)
				.subscribe('user.created')
				.handle(async () => {
					throw new Error('Handler failed');
				});

			const adaptor = new TestSubscriberAdaptor(subscriber);

			await expect(
				adaptor.invoke({
					events: [
						{
							type: 'user.created',
							payload: {
								userId: '1',
								email: 'a@b.com',
								name: 'A',
							},
						},
					],
					services: {},
				}),
			).rejects.toThrow('Handler failed');
		});
	});

	describe('default service discovery', () => {
		it('should create default service discovery', () => {
			const discovery = TestSubscriberAdaptor.getDefaultServiceDiscovery();
			expect(discovery).toBeDefined();
		});
	});
});
