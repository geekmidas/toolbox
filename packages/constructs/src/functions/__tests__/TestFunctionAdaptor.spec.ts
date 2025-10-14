import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';

import { Function } from '../Function';
import { TestFunctionAdaptor } from '../TestFunctionAdaptor';

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

describe.skip('TestFunctionAdaptor', () => {
  let logger: ConsoleLogger;

  beforeEach(() => {
    logger = new ConsoleLogger();
    vi.clearAllMocks();
  });

  describe('basic function execution', () => {
    it('should execute a simple function without input/output schemas', async () => {
      const fn = new Function(async ({ input }) => {
        return { message: `Hello ${input.name}` };
      });

      const adaptor = new TestFunctionAdaptor(fn);

      const result = await adaptor.invoke({
        input: { name: 'World' },
        services: {},
      });

      expect(result).toEqual({ message: 'Hello World' });
    });

    it('should execute a function with input schema validation', async () => {
      const inputSchema = { name: z.string() };
      const handler = vi.fn(async ({ input }) => ({
        message: `Hello ${input.name}`,
      }));

      const fn = new Function(
        handler,
        undefined,
        undefined,
        inputSchema,
        undefined,
        [],
        logger,
      );

      const adaptor = new TestFunctionAdaptor(fn);

      const result = await adaptor.invoke({
        input: { name: 'TypeScript' },
        services: {},
      });

      expect(result).toEqual({ message: 'Hello TypeScript' });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { name: 'TypeScript' },
        }),
      );
    });

    it('should fail with invalid input', async () => {
      const inputSchema = z.object({ age: z.number() });
      const fn = new Function(
        async () => ({ success: true }),
        undefined,
        undefined,
        inputSchema,
        undefined,
        [],
        logger,
      );

      const adaptor = new TestFunctionAdaptor(fn);

      await expect(
        adaptor.invoke({ input: { age: 'not a number' } }),
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

      const adaptor = new TestFunctionAdaptor(fn);

      const result = await adaptor.invoke({});

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
        async () => ({
          id: 123, // Wrong type
        }),
        undefined,
        undefined,
        undefined,
        outputSchema,
        [],
        logger,
      );

      const adaptor = new TestFunctionAdaptor(fn);

      await expect(adaptor.invoke({})).rejects.toThrow();
    });
  });

  describe('services', () => {
    it('should inject services into function context', async () => {
      const service = new TestService();
      const handler = vi.fn(async ({ services }) => ({
        value: services.TestService.getValue(),
      }));

      const fn = new Function(
        handler,
        undefined,
        undefined,
        undefined,
        undefined,
        [service],
        logger,
      );

      const adaptor = new TestFunctionAdaptor(fn);

      const result = await adaptor.invoke({});

      expect(result).toEqual({ value: 'test-value' });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          services: expect.objectContaining({
            TestService: expect.any(TestService),
          }),
        }),
      );
    });

    // Service overriding in context is not currently supported
  });

  describe('logging', () => {
    it('should create child logger with test context', async () => {
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

      const adaptor = new TestFunctionAdaptor(fn);

      await adaptor.invoke({
        loggerContext: { testId: '123' },
      });

      expect(mockLogger.child).toHaveBeenCalledWith({
        test: true,
        testId: '123',
      });
      expect(mockLogger.info).toHaveBeenCalledWith('Function executed');
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

      const adaptor = new TestFunctionAdaptor(fn);

      await adaptor.invoke({
        publisher: publisherService,
      });

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

      const adaptor = new TestFunctionAdaptor(fn);

      await adaptor.invoke({
        publisher: publisherService,
      });

      expect(publisherService.publisher.publishedEvents).toHaveLength(0);
    });

    it('should work without publisher service in context', async () => {
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

      const adaptor = new TestFunctionAdaptor(fn);

      // Should not throw when publisher is not provided in context
      const result = await adaptor.invoke({});
      expect(result).toEqual({ id: '123' });
    });
  });

  describe('default service discovery', () => {
    it('should create default service discovery', () => {
      const fn = new Function(async () => ({ success: true }));
      const serviceDiscovery =
        TestFunctionAdaptor.getDefaultServiceDiscovery(fn);

      expect(serviceDiscovery).toBeDefined();
    });

    it('should use custom service discovery when provided', async () => {
      const fn = new Function(async () => ({ success: true }));
      const mockServiceDiscovery = {
        register: vi.fn().mockResolvedValue({}),
        getInstance: vi.fn(),
      } as any;

      const adaptor = new TestFunctionAdaptor(fn, mockServiceDiscovery);

      await adaptor.invoke({});

      expect(mockServiceDiscovery.register).toHaveBeenCalledWith([]);
    });
  });

  describe('error handling', () => {
    it('should propagate errors from function execution', async () => {
      const fn = new Function(async () => {
        throw new Error('Function failed');
      });

      const adaptor = new TestFunctionAdaptor(fn);

      await expect(adaptor.invoke({})).rejects.toThrow('Function failed');
    });
  });
});
