import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { Service } from '@geekmidas/services';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ConstructType } from '../../Construct';
import { Topic, type TopicMessage } from '../../topic/Topic';
import { Subscriber, type SubscriberContext } from '../Subscriber';
import { SubscriberBuilder } from '../SubscriberBuilder';

// The topic these subscribers bind to — its events are the contract.
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
		'user.deleted': z.object({ userId: z.string(), deletedAt: z.date() }),
	},
});

type UserEvent = TopicMessage<typeof users.eventSchemas>;
type UserEventPublisher = EventPublisher<UserEvent>;

/** A subscriber to `users`, typed the way `worker.topic(users)` would type it. */
const UserSubscriber = Subscriber<
	[],
	Logger,
	undefined,
	UserEventPublisher,
	['user.created']
>;

// Mock logger
const mockLogger: Logger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	fatal: vi.fn(),
	trace: vi.fn(),
	child: vi.fn(() => mockLogger),
};

describe('Subscriber', () => {
	describe('isSubscriber', () => {
		it('should identify valid subscriber instances', () => {
			const subscriber = new UserSubscriber(
				async () => {},
				30000,
				['user.created'],
				undefined,
				[],
				mockLogger,
				'users',
			);

			expect(Subscriber.isSubscriber(subscriber)).toBe(true);
		});

		it('should reject non-subscriber objects', () => {
			expect(Subscriber.isSubscriber({})).toBe(false);
			expect(Subscriber.isSubscriber(null)).toBe(false);
			expect(Subscriber.isSubscriber(undefined)).toBe(false);
			expect(Subscriber.isSubscriber({ type: ConstructType.Endpoint })).toBe(
				false,
			);
		});
	});

	describe('constructor', () => {
		it('should create a subscriber with correct type', () => {
			const handler = vi.fn();
			const subscriber = new UserSubscriber(
				handler,
				30000,
				['user.created'],
				undefined,
				[],
				mockLogger,
				'users',
			);

			expect(subscriber.type).toBe(ConstructType.Subscriber);
			expect(subscriber.__IS_SUBSCRIBER__).toBe(true);
			expect(subscriber.handler).toBe(handler);
			expect(subscriber.timeout).toBe(30000);
			expect(subscriber.subscribedEvents).toEqual(['user.created']);
		});

		it('should accept explicit timeout value', () => {
			const subscriber = new UserSubscriber(
				async () => {},
				45000,
				['user.created'],
				undefined,
				[],
				mockLogger,
				'users',
			);

			expect(subscriber.timeout).toBe(45000);
		});
	});
});

describe('SubscriberBuilder', () => {
	describe('timeout', () => {
		it('should set custom timeout', () => {
			const subscriber = new SubscriberBuilder()
				.topic(users)
				.timeout(60000)
				.subscribe('user.created')
				.handle(async () => {});

			expect(subscriber.timeout).toBe(60000);
		});

		it('should use default timeout if not set', () => {
			const subscriber = new SubscriberBuilder()
				.topic(users)
				.subscribe('user.created')
				.handle(async () => {});

			expect(subscriber.timeout).toBe(30000);
		});
	});

	describe('output', () => {
		it('should set output schema', () => {
			const outputSchema = z.object({
				processed: z.number(),
			});

			const subscriber = new SubscriberBuilder()
				.topic(users)
				.output(outputSchema)
				.subscribe('user.created')
				.handle(async () => ({ processed: 1 }));

			expect(subscriber.outputSchema).toBe(outputSchema);
		});
	});

	describe('services', () => {
		it('should register services', () => {
			const mockService: Service<'test', { foo: string }> = {
				serviceName: 'test' as const,
				register() {
					return { foo: 'bar' };
				},
			};

			const subscriber = new SubscriberBuilder()
				.topic(users)
				.services([mockService])
				.subscribe('user.created')
				.handle(async () => {});

			expect(subscriber.services).toEqual([mockService]);
		});

		it('should accumulate multiple service calls', () => {
			const service1: Service<'service1', { a: string }> = {
				serviceName: 'service1' as const,
				register() {
					return { a: 'a' };
				},
			};
			const service2: Service<'service2', { b: string }> = {
				serviceName: 'service2' as const,
				register() {
					return { b: 'b' };
				},
			};

			const subscriber = new SubscriberBuilder()
				.topic(users)
				.services([service1])
				.services([service2])
				.subscribe('user.created')
				.handle(async () => {});

			expect(subscriber.services).toEqual([service1, service2]);
		});
	});

	describe('logger', () => {
		it('should set custom logger', () => {
			const customLogger: Logger = {
				...mockLogger,
				info: vi.fn(),
			};

			const subscriber = new SubscriberBuilder()
				.topic(users)
				.logger(customLogger)
				.subscribe('user.created')
				.handle(async () => {});

			expect(subscriber.logger).toBe(customLogger);
		});
	});

	describe('topic', () => {
		it('should bind the topic by name', () => {
			const subscriber = new SubscriberBuilder()
				.topic(users)
				.subscribe('user.created')
				.handle(async () => {});

			expect(subscriber.topicName).toBe('users');
		});

		it('should not make the bound topic a dependency', () => {
			// Binding is not publishing: no producer service, no edge.
			const subscriber = new SubscriberBuilder()
				.topic(users)
				.subscribe('user.created')
				.handle(async () => {});

			expect(subscriber.services).toEqual([]);
			expect(subscriber.constructs).toEqual([]);
			expect(subscriber.events).toEqual([]);
		});

		it('should take a topic it publishes follow-ups to through dependsOn', () => {
			const audit = new Topic('Audit', {
				events: { 'audit.recorded': z.object({ subject: z.string() }) },
			});

			const subscriber = new SubscriberBuilder()
				.topic(users)
				.dependsOn([audit])
				.subscribe('user.created')
				.handle(async ({ services }) => {
					await services.audit.publish([
						{ type: 'audit.recorded', payload: { subject: 'x' } },
					]);
				});

			expect(subscriber.services).toEqual([audit.service]);
			expect(subscriber.constructs).toEqual(['Audit']);
		});
	});

	describe('subscribe', () => {
		it('should subscribe to single event', () => {
			const subscriber = new SubscriberBuilder()
				.topic(users)
				.subscribe('user.created')
				.handle(async () => {});

			expect(subscriber.subscribedEvents).toEqual(['user.created']);
		});

		it('should subscribe to multiple events via chaining', () => {
			const subscriber = new SubscriberBuilder()
				.topic(users)
				.subscribe('user.created')
				.subscribe('user.updated')
				.subscribe('user.deleted')
				.handle(async () => {});

			expect(subscriber.subscribedEvents).toEqual([
				'user.created',
				'user.updated',
				'user.deleted',
			]);
		});

		it('should subscribe to multiple events via array', () => {
			const subscriber = new SubscriberBuilder()
				.topic(users)
				.subscribe(['user.created', 'user.updated', 'user.deleted'])
				.handle(async () => {});

			expect(subscriber.subscribedEvents).toEqual([
				'user.created',
				'user.updated',
				'user.deleted',
			]);
		});

		it('should mix array and single subscriptions', () => {
			const subscriber = new SubscriberBuilder()
				.topic(users)
				.subscribe(['user.created', 'user.updated'])
				.subscribe('user.deleted')
				.handle(async () => {});

			expect(subscriber.subscribedEvents).toEqual([
				'user.created',
				'user.updated',
				'user.deleted',
			]);
		});
	});

	describe('handle', () => {
		it('should create a subscriber instance', () => {
			const handler = vi.fn(async () => {});
			const subscriber = new SubscriberBuilder()
				.topic(users)
				.subscribe('user.created')
				.handle(handler);

			expect(subscriber).toBeInstanceOf(Subscriber);
			expect(subscriber.handler).toBe(handler);
		});

		it('should pass context to handler', async () => {
			const handler = vi.fn(
				async ({ events, services, logger }: SubscriberContext<any, any>) => {
					expect(events).toBeDefined();
					expect(services).toBeDefined();
					expect(logger).toBeDefined();
				},
			);

			const subscriber = new SubscriberBuilder()
				.topic(users)
				.subscribe('user.created')
				.handle(handler);

			// Simulate calling the handler
			await subscriber.handler({
				events: [
					{
						type: 'user.created',
						payload: { userId: '1', email: 'test@example.com', name: 'Test' },
					},
				] as any,
				services: {} as any,
				logger: mockLogger,
			});

			expect(handler).toHaveBeenCalled();
		});

		it('should handle events with correct typing', async () => {
			const handler = vi.fn(
				async ({
					events,
				}: SubscriberContext<UserEventPublisher, ['user.created']>) => {
					// Type assertions to verify correct typing
					events.forEach((event) => {
						if (event.type === 'user.created') {
							expect(event.payload.userId).toBeDefined();
							expect(event.payload.email).toBeDefined();
							expect(event.payload.name).toBeDefined();
						}
					});

					return { processed: events.length };
				},
			);

			const outputSchema = z.object({ processed: z.number() });

			const subscriber = new SubscriberBuilder()
				.topic(users)
				.output(outputSchema)
				.subscribe('user.created')
				.handle(handler);

			const result = await subscriber.handler({
				events: [
					{
						type: 'user.created',
						payload: {
							userId: '123',
							email: 'test@example.com',
							name: 'Test User',
						},
					},
				] as any,
				services: {} as any,
				logger: mockLogger,
			});

			expect(result).toEqual({ processed: 1 });
			expect(handler).toHaveBeenCalled();
		});

		it('should handle batch of events', async () => {
			const processedEvents: UserEvent[] = [];
			const handler = vi.fn(async ({ events }) => {
				processedEvents.push(...events);
				return { count: events.length };
			});

			const subscriber = new SubscriberBuilder()
				.topic(users)
				.subscribe(['user.created', 'user.updated'])
				.handle(handler);

			const testEvents = [
				{
					type: 'user.created' as const,
					payload: { userId: '1', email: 'user1@test.com', name: 'User 1' },
				},
				{
					type: 'user.created' as const,
					payload: { userId: '2', email: 'user2@test.com', name: 'User 2' },
				},
				{
					type: 'user.updated' as const,
					payload: { userId: '1', changes: { name: 'Updated Name' } },
				},
			];

			await subscriber.handler({
				events: testEvents as any,
				services: {} as any,
				logger: mockLogger,
			});

			expect(handler).toHaveBeenCalled();
			expect(processedEvents).toHaveLength(3);
		});
	});

	describe('builder chaining', () => {
		it('should support fluent builder pattern', () => {
			const mockService: Service<'db', any> = {
				serviceName: 'db' as const,
				register() {
					return {};
				},
			};

			const customLogger = { ...mockLogger };

			const subscriber = new SubscriberBuilder()
				.timeout(45000)
				.logger(customLogger)
				.topic(users)
				.services([mockService])
				.output(z.object({ success: z.boolean() }))
				.subscribe('user.created')
				.subscribe('user.updated')
				.handle(async ({ events }) => {
					return { success: events.length > 0 };
				});

			expect(subscriber.timeout).toBe(45000);
			expect(subscriber.logger).toBe(customLogger);
			expect(subscriber.topicName).toBe('users');
			expect(subscriber.services).toEqual([mockService]);
			expect(subscriber.subscribedEvents).toEqual([
				'user.created',
				'user.updated',
			]);
			expect(subscriber.outputSchema).toBeDefined();
		});
	});
});
