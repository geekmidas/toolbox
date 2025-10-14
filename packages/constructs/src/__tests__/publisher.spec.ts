import type { Logger } from '@geekmidas/logger';
import { type Service, ServiceDiscovery } from '@geekmidas/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { EnvironmentParser } from '@geekmidas/envkit';
import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import { e } from '../endpoints';
import { publishConstructEvents } from '../publisher';

// Test event types
type TestEvent =
  | PublishableMessage<'user.created', { userId: string; email: string }>
  | PublishableMessage<'user.updated', { userId: string; changes: string[] }>
  | PublishableMessage<'user.deleted', { userId: string }>;

describe('publishEndpointEvents', () => {
  const mockLogger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => mockLogger),
  };
  const debugSpy = mockLogger.debug as any;
  const warnSpy = mockLogger.warn as any;
  const errorSpy = mockLogger.error as any;

  const serviceDiscovery = ServiceDiscovery.getInstance(
    mockLogger,
    new EnvironmentParser({}),
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return early when no events are defined', async () => {
    const endpoint = e
      .logger(mockLogger)
      .post('/test')
      .output(z.object({ success: z.boolean() }))
      .handle(async () => ({ success: true }));

    await publishConstructEvents(
      endpoint,
      { success: true },
      serviceDiscovery as ServiceDiscovery<any, any>,
    );

    expect(debugSpy).toHaveBeenCalledWith('No events to publish');
  });

  it('should return early when events array is empty', async () => {
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn(),
    };

    const mockPublisherService: Service<string, EventPublisher<TestEvent>> = {
      serviceName: Math.random().toString(),
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const endpoint = e
      .logger(mockLogger)
      .publisher(mockPublisherService)
      .post('/test')
      .output(z.object({ success: z.boolean() }))
      .handle(async () => ({ success: true }));

    await publishConstructEvents(
      endpoint,
      { success: true },
      serviceDiscovery as ServiceDiscovery<any, any>,
    );

    expect(debugSpy).toHaveBeenCalledWith('No events to publish');
    expect(mockPublisher.publish).not.toHaveBeenCalled();
  });

  it('should warn when publisher is not available', async () => {
    const outputSchema = z.object({ id: z.string(), email: z.string() });

    const endpoint = e
      .logger(mockLogger)
      .post('/test')
      .output(outputSchema)

      .event({
        // @ts-ignore
        type: 'user.created',
        // @ts-ignore
        payload: (response) => ({
          userId: response.id,
          email: response.email,
        }),
      })
      .handle(async () => ({ id: '123', email: 'test@example.com' }));

    await publishConstructEvents(
      endpoint,
      {
        id: '123',
        email: 'test@example.com',
      },
      serviceDiscovery as ServiceDiscovery<any, any>,
    );

    expect(warnSpy).toHaveBeenCalledWith('No publisher service available');
  });

  it('should publish single event successfully', async () => {
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const mockPublisherService: Service<string, EventPublisher<TestEvent>> = {
      serviceName: Math.random().toString(),
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const outputSchema = z.object({ id: z.string(), email: z.string() });

    const endpoint = e
      .logger(mockLogger)
      .publisher(mockPublisherService)
      .post('/test')
      .output(outputSchema)
      .event({
        type: 'user.created',
        payload: (response) => ({
          userId: response.id,
          email: response.email,
        }),
      })
      .handle(async () => ({ id: '123', email: 'test@example.com' }));

    await publishConstructEvents(
      endpoint,
      {
        id: '123',
        email: 'test@example.com',
      },
      serviceDiscovery as ServiceDiscovery<any, any>,
    );

    expect(debugSpy).toHaveBeenCalledWith(
      { event: 'user.created' },
      'Processing event',
    );
    expect(debugSpy).toHaveBeenCalledWith(
      { eventCount: 1 },
      'Publishing events',
    );
    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'user.created',
        payload: { userId: '123', email: 'test@example.com' },
      },
    ]);
  });

  it('should publish multiple events successfully', async () => {
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const mockPublisherService: Service<string, EventPublisher<TestEvent>> = {
      serviceName: Math.random().toString(),
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const outputSchema = z.object({ id: z.string(), email: z.string() });

    const endpoint = e
      .publisher(mockPublisherService)

      .post('/test')
      .output(outputSchema)
      .event({
        type: 'user.created',
        payload: (response) => ({
          userId: response.id,
          email: response.email,
        }),
      })
      .event({
        type: 'user.updated',
        payload: (response) => ({ userId: response.id, changes: ['email'] }),
      })

      .handle(async () => ({ id: '123', email: 'test@example.com' }));

    await publishConstructEvents(
      endpoint,
      {
        id: '123',
        email: 'test@example.com',
      },
      serviceDiscovery as ServiceDiscovery<any, any>,
    );

    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'user.created',
        payload: { userId: '123', email: 'test@example.com' },
      },
      {
        type: 'user.updated',
        payload: { userId: '123', changes: ['email'] },
      },
    ]);
  });

  it('should respect when condition for events', async () => {
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const mockPublisherService: Service<string, EventPublisher<TestEvent>> = {
      serviceName: Math.random().toString(),
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const outputSchema = z.object({
      id: z.string(),
      email: z.string(),
      isNew: z.boolean(),
    });

    const endpoint = e
      .logger(mockLogger)
      .publisher(mockPublisherService)
      .post('/test')
      .output(outputSchema)
      .event({
        type: 'user.created',
        payload: (response) => ({
          userId: response.id,
          email: response.email,
        }),
        when: (response) => response.isNew === true,
      })
      .event({
        type: 'user.updated',
        payload: (response) => ({ userId: response.id, changes: ['email'] }),
        when: (response) => response.isNew === false,
      })
      .handle(async () => ({
        id: '123',
        email: 'test@example.com',
        isNew: false,
      }));

    await publishConstructEvents(
      endpoint,
      {
        id: '123',
        email: 'test@example.com',
        isNew: false,
      },
      serviceDiscovery as ServiceDiscovery<any, any>,
    );

    // Only the user.updated event should be published
    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'user.updated',
        payload: { userId: '123', changes: ['email'] },
      },
    ]);
  });

  it('should not publish any events when all when conditions are false', async () => {
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const mockPublisherService: Service<string, EventPublisher<TestEvent>> = {
      serviceName: Math.random().toString(),
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const outputSchema = z.object({ id: z.string(), email: z.string() });

    const endpoint = e
      .logger(mockLogger)
      .publisher(mockPublisherService)
      .post('/test')
      .output(outputSchema)
      .event({
        type: 'user.created',
        payload: (response) => ({
          userId: response.id,
          email: response.email,
        }),
        when: () => false,
      })
      .event({
        type: 'user.updated',
        payload: (response) => ({ userId: response.id, changes: ['email'] }),
        when: () => false,
      })
      .handle(async () => ({ id: '123', email: 'test@example.com' }));

    await publishConstructEvents(
      endpoint,
      {
        id: '123',
        email: 'test@example.com',
      },
      serviceDiscovery as ServiceDiscovery<any, any>,
    );

    expect(mockPublisher.publish).not.toHaveBeenCalled();
  });

  it('should handle async payload functions', async () => {
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const mockPublisherService: Service<string, EventPublisher<TestEvent>> = {
      serviceName: Math.random().toString(),
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const outputSchema = z.object({ id: z.string(), email: z.string() });

    const endpoint = e
      .logger(mockLogger)
      .publisher(mockPublisherService)
      .post('/test')
      .output(outputSchema)
      .event({
        type: 'user.created',
        payload: (response) => ({
          // Simulate async operation
          userId: response.id,
          email: response.email,
        }),
      })
      .handle(async () => ({ id: '123', email: 'test@example.com' }));

    await publishConstructEvents(
      endpoint,
      {
        id: '123',
        email: 'test@example.com',
      },
      serviceDiscovery as ServiceDiscovery<any, any>,
    );

    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'user.created',
        payload: { userId: '123', email: 'test@example.com' },
      },
    ]);
  });

  it('should catch and log publish errors', async () => {
    const publishError = new Error('Failed to connect to event bus');
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn().mockRejectedValue(publishError),
    };

    const mockPublisherService: Service<string, EventPublisher<TestEvent>> = {
      serviceName: Math.random().toString(),
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const outputSchema = z.object({ id: z.string(), email: z.string() });

    const endpoint = e
      .logger(mockLogger)
      .publisher(mockPublisherService)
      .post('/test')
      .output(outputSchema)
      .event({
        type: 'user.created',
        payload: (response) => ({
          userId: response.id,
          email: response.email,
        }),
      })
      .handle(async () => ({ id: '123', email: 'test@example.com' }));

    // Should not throw
    await publishConstructEvents(
      endpoint,
      {
        id: '123',
        email: 'test@example.com',
      },
      serviceDiscovery as ServiceDiscovery<any, any>,
    );

    expect(errorSpy).toHaveBeenCalledWith(
      publishError,
      'Failed to publish events',
    );
  });

  it('should preserve additional event properties', async () => {
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const mockPublisherService: Service<string, EventPublisher<TestEvent>> = {
      serviceName: Math.random().toString(),
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const outputSchema = z.object({ id: z.string(), email: z.string() });

    const endpoint = e
      .logger(mockLogger)
      .publisher(mockPublisherService)
      .post('/test')
      .output(outputSchema)
      .event({
        type: 'user.created',
        payload: (response) => ({
          userId: response.id,
          email: response.email,
        }),
        // Additional properties that should be preserved
        metadata: { source: 'api', version: '1.0' },
        priority: 'high',
      })
      .handle(async () => ({ id: '123', email: 'test@example.com' }));

    await publishConstructEvents(
      endpoint,
      {
        id: '123',
        email: 'test@example.com',
      },
      serviceDiscovery as ServiceDiscovery<any, any>,
    );

    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'user.created',
        payload: { userId: '123', email: 'test@example.com' },
        metadata: { source: 'api', version: '1.0' },
        priority: 'high',
      },
    ]);
  });
});
