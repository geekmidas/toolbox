import type { Logger } from '@geekmidas/logger';
import type { Service } from '@geekmidas/services';
import { serviceContext } from '@geekmidas/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { recordingPublisher } from '../../__tests__/__helpers__/recordingPublisher';
import { Topic } from '../../topic/Topic';
import { Subscriber } from '../Subscriber';
import { SubscriberBuilder } from '../SubscriberBuilder';
import { TestSubscriberAdaptor } from '../TestSubscriberAdaptor';

// --- Test fixtures ---

const users = new Topic('users', {
	events: {
		'user.created': z.object({
			userId: z.string(),
			email: z.string(),
			name: z.string(),
		}),
		'user.updated': z.object({
			userId: z.string(),
			changes: z.record(z.string(), z.any()),
		}),
		'user.deleted': z.object({ userId: z.string() }),
	},
});

const audit = new Topic('Audit', {
	events: {
		'audit.recorded': z.object({ subject: z.string(), count: z.number() }),
	},
});

class HandlerFailed extends Error {
	constructor() {
		super('Handler failed');
		this.name = 'HandlerFailed';
	}
}

const TestDbService: Service<'db', { query: () => string }> = {
	serviceName: 'db' as const,
	register() {
		return { query: () => 'result' };
	},
};

describe('TestSubscriberAdaptor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('basic execution', () => {
		it('should invoke a subscriber and return result', async () => {
			const subscriber = new SubscriberBuilder()
				.topic(users)
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
				.topic(users)
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
				.topic(users)
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
				.topic(users)
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
				.topic(users)
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
				.topic(users)
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
				.topic(users)
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
				.topic(users)
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
				.topic(users)
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
				.topic(users)
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
				.topic(users)
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

	describe('follow-up events', () => {
		it('should publish follow-ups through a topic the subscriber depends on', async () => {
			const auditPublisher = recordingPublisher();

			const subscriber = new SubscriberBuilder()
				.topic(users)
				.dependsOn([audit])
				.subscribe('user.created')
				.output(z.object({ count: z.number() }))
				.handle(async ({ events, services }) => {
					await services.audit.publish([
						{
							type: 'audit.recorded',
							payload: { subject: 'users', count: events.length },
						},
					]);
					return { count: events.length };
				});

			const adaptor = new TestSubscriberAdaptor(subscriber);

			const result = await adaptor.invoke({
				events: [
					{
						type: 'user.created',
						payload: { userId: '1', email: 'a@b.com', name: 'A' },
					},
				],
				services: { audit: auditPublisher },
			});

			expect(result).toEqual({ count: 1 });
			expect(auditPublisher.published).toEqual([
				{ type: 'audit.recorded', payload: { subject: 'users', count: 1 } },
			]);
		});

		it('should publish nothing the handler did not', async () => {
			// A subscriber has no declarative events: binding is not publishing.
			const auditPublisher = recordingPublisher();

			const subscriber = new SubscriberBuilder()
				.topic(users)
				.dependsOn([audit])
				.subscribe('user.created')
				.handle(async ({ events }) => ({ count: events.length }));

			await new TestSubscriberAdaptor(subscriber).invoke({
				events: [
					{
						type: 'user.created',
						payload: { userId: '1', email: 'a@b.com', name: 'A' },
					},
				],
				services: { audit: auditPublisher },
			});

			expect(subscriber.events).toEqual([]);
			expect(auditPublisher.calls).toEqual([]);
		});
	});

	describe('error handling', () => {
		it('should propagate errors from handler execution', async () => {
			const subscriber = new SubscriberBuilder()
				.topic(users)
				.subscribe('user.created')
				.handle(async () => {
					throw new HandlerFailed();
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
			).rejects.toThrow(HandlerFailed);
		});
	});

	describe('default service discovery', () => {
		it('should create default service discovery', () => {
			const discovery = TestSubscriberAdaptor.getDefaultServiceDiscovery();
			expect(discovery).toBeDefined();
		});
	});

	describe('request context', () => {
		it('should make serviceContext.getLogger() available inside handler', async () => {
			let contextLogger: any;

			const subscriber = new SubscriberBuilder()
				.topic(users)
				.subscribe('user.created')
				.handle(async ({ events }) => {
					contextLogger = serviceContext.getLogger();
					return { processed: events.length };
				});

			const adaptor = new TestSubscriberAdaptor(subscriber);

			await adaptor.invoke({
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

			expect(contextLogger).toBeDefined();
		});

		it('should make serviceContext.hasContext() return true inside handler', async () => {
			let hasContext = false;

			const subscriber = new SubscriberBuilder()
				.topic(users)
				.subscribe('user.created')
				.handle(async ({ events }) => {
					hasContext = serviceContext.hasContext();
					return { processed: events.length };
				});

			const adaptor = new TestSubscriberAdaptor(subscriber);

			await adaptor.invoke({
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

			expect(hasContext).toBe(true);
		});

		it('should provide a request ID starting with test-', async () => {
			let requestId: string | undefined;

			const subscriber = new SubscriberBuilder()
				.topic(users)
				.subscribe('user.created')
				.handle(async ({ events }) => {
					requestId = serviceContext.getRequestId();
					return { processed: events.length };
				});

			const adaptor = new TestSubscriberAdaptor(subscriber);

			await adaptor.invoke({
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

			expect(requestId).toBeDefined();
			expect(requestId).toMatch(/^test-/);
		});
	});
});
