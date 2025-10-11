import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Logger } from '../../logger';
import type { Service } from '../../services';
import {
  Subscriber,
  SubscriberBuilder,
  type SubscriberContext,
} from '../Subscriber';
import { ConstructType } from '../Construct';
import type {
  EventPublisher,
  PublishableMessage,
} from '../events';

// Define test event types
type UserEvent =
  | PublishableMessage<
      'user.created',
      { userId: string; email: string; name: string }
    >
  | PublishableMessage<
      'user.updated',
      { userId: string; changes: Record<string, any> }
    >
  | PublishableMessage<'user.deleted', { userId: string; deletedAt: Date }>;

// Mock event publisher
class TestEventPublisher implements EventPublisher<UserEvent> {
  async publish(events: UserEvent[]): Promise<void> {
    void events;
  }
}

// Mock service for testing
const TestEventService: Service<'testEventPublisher', TestEventPublisher> = {
  serviceName: 'testEventPublisher' as const,
  register() {
    return new TestEventPublisher();
  },
};

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
      const subscriber = new Subscriber(
        async () => {},
        30000,
        ['user.created'],
        undefined,
        [],
        mockLogger,
        TestEventService,
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
      const subscriber = new Subscriber(
        handler,
        30000,
        ['user.created'],
        undefined,
        [],
        mockLogger,
        TestEventService,
      );

      expect(subscriber.type).toBe(ConstructType.Subscriber);
      expect(subscriber.__IS_SUBSCRIBER__).toBe(true);
      expect(subscriber.handler).toBe(handler);
      expect(subscriber.timeout).toBe(30000);
      expect(subscriber.subscribedEvents).toEqual(['user.created']);
    });

    it('should accept explicit timeout value', () => {
      const subscriber = new Subscriber(
        async () => {},
        45000,
        ['user.created'],
        undefined,
        [],
        mockLogger,
        TestEventService,
      );

      expect(subscriber.timeout).toBe(45000);
    });
  });
});

describe('SubscriberBuilder', () => {
  describe('timeout', () => {
    it('should set custom timeout', () => {
      const subscriber = new SubscriberBuilder()
        .publisher(TestEventService)
        .timeout(60000)
        .subscribe('user.created')
        .handle(async () => {});

      expect(subscriber.timeout).toBe(60000);
    });

    it('should use default timeout if not set', () => {
      const subscriber = new SubscriberBuilder()
        .publisher(TestEventService)
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
        .publisher(TestEventService)
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
        .publisher(TestEventService)
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
        .publisher(TestEventService)
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
        .publisher(TestEventService)
        .logger(customLogger)
        .subscribe('user.created')
        .handle(async () => {});

      expect(subscriber.logger).toBe(customLogger);
    });
  });

  describe('publisher', () => {
    it('should set publisher service', () => {
      const subscriber = new SubscriberBuilder()
        .publisher(TestEventService)
        .subscribe('user.created')
        .handle(async () => {});

      expect(subscriber.publisherService).toBe(TestEventService);
    });
  });

  describe('subscribe', () => {
    it('should subscribe to single event', () => {
      const subscriber = new SubscriberBuilder()
        .publisher(TestEventService)
        .subscribe('user.created')
        .handle(async () => {});

      expect(subscriber.subscribedEvents).toEqual(['user.created']);
    });

    it('should subscribe to multiple events via chaining', () => {
      const subscriber = new SubscriberBuilder()
        .publisher(TestEventService)
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
        .publisher(TestEventService)
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
        .publisher(TestEventService)
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
        .publisher(TestEventService)
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
        .publisher(TestEventService)
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
        }: SubscriberContext<TestEventPublisher, ['user.created']>) => {
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
        .publisher(TestEventService)
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
        .publisher(TestEventService)
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
        .publisher(TestEventService)
        .services([mockService])
        .output(z.object({ success: z.boolean() }))
        .subscribe('user.created')
        .subscribe('user.updated')
        .handle(async ({ events }) => {
          return { success: events.length > 0 };
        });

      expect(subscriber.timeout).toBe(45000);
      expect(subscriber.logger).toBe(customLogger);
      expect(subscriber.publisherService).toBe(TestEventService);
      expect(subscriber.services).toEqual([mockService]);
      expect(subscriber.subscribedEvents).toEqual([
        'user.created',
        'user.updated',
      ]);
      expect(subscriber.outputSchema).toBeDefined();
    });
  });
});
