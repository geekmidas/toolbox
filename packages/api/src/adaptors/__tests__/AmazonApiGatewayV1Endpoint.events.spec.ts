import { EnvironmentParser } from '@geekmidas/envkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Endpoint } from '../../constructs/Endpoint';
import type {
  EventPublisher,
  MappedEvent,
  PublishableMessage,
} from '../../constructs/events';
import type { Logger } from '../../logger';
import type { Service } from '../../services';
import { AmazonApiGatewayV1Endpoint } from '../AmazonApiGatewayV1Endpoint';
import {
  createMockContext,
  createMockV1Event as createMockEvent,
  createMockLogger,
} from './aws-test-helpers';

// Test event types
type TestEvent =
  | PublishableMessage<'user.created', { userId: string; email: string }>
  | PublishableMessage<'user.updated', { userId: string; changes: string[] }>
  | PublishableMessage<'notification.sent', { userId: string; type: string }>;

// Mock functions are now imported from shared utilities

describe('AmazonApiGatewayV1Endpoint Events', () => {
  let mockLogger: Logger;
  let envParser: EnvironmentParser<{}>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
    envParser = new EnvironmentParser({});
  });

  it('should publish events after successful endpoint execution', async () => {
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const mockPublisherService: Service<
      'publisher',
      EventPublisher<TestEvent>
    > = {
      serviceName: 'publisher' as const,
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const outputSchema = z.object({ id: z.string(), email: z.string() });

    const events: MappedEvent<
      EventPublisher<TestEvent>,
      typeof outputSchema
    >[] = [
      {
        type: 'user.created',
        payload: (response) => ({ userId: response.id, email: response.email }),
      },
    ];

    const endpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      fn: async () => ({ id: '123', email: 'test@example.com' }),
      input: undefined,
      output: outputSchema,
      services: [],
      logger: mockLogger,
      timeout: undefined,
      status: 200,
      getSession: undefined,
      authorize: undefined,
      description: undefined,
      events,
      publisherService: mockPublisherService,
    });

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
    const handler = adapter.handler;

    const event = createMockEvent({
      httpMethod: 'POST',
      body: JSON.stringify({}),
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(
      JSON.stringify({ id: '123', email: 'test@example.com' }),
    );

    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'user.created',
        payload: { userId: '123', email: 'test@example.com' },
      },
    ]);
  });

  it('should publish multiple events after successful endpoint execution', async () => {
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const mockPublisherService: Service<string, EventPublisher<TestEvent>> = {
      serviceName: Math.random().toString(),
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const outputSchema = z.object({ id: z.string(), email: z.string() });

    const events: MappedEvent<
      EventPublisher<TestEvent>,
      typeof outputSchema
    >[] = [
      {
        type: 'user.created',
        payload: (response) => ({ userId: response.id, email: response.email }),
      },
      {
        type: 'notification.sent',
        payload: (response) => ({ userId: response.id, type: 'welcome' }),
      },
    ];

    const endpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      fn: async () => ({ id: '456', email: 'user@example.com' }),
      input: undefined,
      output: outputSchema,
      services: [],
      logger: mockLogger,
      timeout: undefined,
      status: 201,
      getSession: undefined,
      authorize: undefined,
      description: undefined,
      events,
      publisherService: mockPublisherService,
    });

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
    const handler = adapter.handler;

    const event = createMockEvent({
      httpMethod: 'POST',
      body: JSON.stringify({}),
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(201);
    expect(response.body).toBe(
      JSON.stringify({ id: '456', email: 'user@example.com' }),
    );

    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'user.created',
        payload: { userId: '456', email: 'user@example.com' },
      },
      {
        type: 'notification.sent',
        payload: { userId: '456', type: 'welcome' },
      },
    ]);
  });

  it('should respect when conditions for events', async () => {
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

    const events: MappedEvent<
      EventPublisher<TestEvent>,
      typeof outputSchema
    >[] = [
      {
        type: 'user.created',
        payload: (response) => ({ userId: response.id, email: response.email }),
        when: (response) => response.isNew === true,
      },
      {
        type: 'user.updated',
        payload: (response) => ({ userId: response.id, changes: ['email'] }),
        when: (response) => response.isNew === false,
      },
    ];

    const endpoint = new Endpoint({
      route: '/users/:id',
      method: 'PUT',
      fn: async () => ({
        id: '789',
        email: 'updated@example.com',
        isNew: false,
      }),
      input: undefined,
      output: outputSchema,
      services: [],
      logger: mockLogger,
      timeout: undefined,
      status: 200,
      getSession: undefined,
      authorize: undefined,
      description: undefined,
      events,
      publisherService: mockPublisherService,
    });

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
    const handler = adapter.handler;

    const event = createMockEvent({
      httpMethod: 'PUT',
      pathParameters: { id: '789' },
      body: JSON.stringify({}),
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(
      JSON.stringify({
        id: '789',
        email: 'updated@example.com',
        isNew: false,
      }),
    );

    // Only user.updated event should be published due to when condition
    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'user.updated',
        payload: { userId: '789', changes: ['email'] },
      },
    ]);
  });

  it('should not publish events when no publisher is configured', async () => {
    const outputSchema = z.object({ id: z.string(), email: z.string() });

    const events: MappedEvent<
      EventPublisher<TestEvent>,
      typeof outputSchema
    >[] = [
      {
        type: 'user.created',
        payload: (response) => ({ userId: response.id, email: response.email }),
      },
    ];

    const endpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      fn: async () => ({ id: '999', email: 'test@example.com' }),
      input: undefined,
      output: outputSchema,
      services: [],
      logger: mockLogger,
      timeout: undefined,
      status: 200,
      getSession: undefined,
      authorize: undefined,
      description: undefined,
      events,
      publisherService: undefined, // No publisher service
    });

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
    const handler = adapter.handler;

    const event = createMockEvent({
      httpMethod: 'POST',
      body: JSON.stringify({}),
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(
      JSON.stringify({ id: '999', email: 'test@example.com' }),
    );

    // No publisher calls should be made
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'No publisher service available',
    );
  });

  it('should not publish events when no events are configured', async () => {
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const mockPublisherService: Service<string, EventPublisher<TestEvent>> = {
      serviceName: Math.random().toString(),
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const outputSchema = z.object({ id: z.string(), email: z.string() });

    const endpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      fn: async () => ({ id: '111', email: 'test@example.com' }),
      input: undefined,
      output: outputSchema,
      services: [],
      logger: mockLogger,
      timeout: undefined,
      status: 200,
      getSession: undefined,
      authorize: undefined,
      description: undefined,
      events: undefined, // No events
      publisherService: mockPublisherService,
    });

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
    const handler = adapter.handler;

    const event = createMockEvent({
      httpMethod: 'POST',
      body: JSON.stringify({}),
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(
      JSON.stringify({ id: '111', email: 'test@example.com' }),
    );

    // No events should be published
    expect(mockPublisher.publish).not.toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith('No events to publish');
  });

  it('should continue processing even when event publishing fails', async () => {
    const publishError = new Error('Event bus connection failed');
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn().mockRejectedValue(publishError),
    };

    const mockPublisherService: Service<string, EventPublisher<TestEvent>> = {
      serviceName: Math.random().toString(),
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const outputSchema = z.object({ id: z.string(), email: z.string() });

    const events: MappedEvent<
      EventPublisher<TestEvent>,
      typeof outputSchema
    >[] = [
      {
        type: 'user.created',
        payload: (response) => ({ userId: response.id, email: response.email }),
      },
    ];

    const endpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      fn: async () => ({ id: '888', email: 'error@example.com' }),
      input: undefined,
      output: outputSchema,
      services: [],
      logger: mockLogger,
      timeout: undefined,
      status: 200,
      getSession: undefined,
      authorize: undefined,
      description: undefined,
      events,
      publisherService: mockPublisherService,
    });

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
    const handler = adapter.handler;

    const event = createMockEvent({
      httpMethod: 'POST',
      body: JSON.stringify({}),
    });
    const context = createMockContext();
    const response = await handler(event, context);

    // The endpoint should still succeed despite event publishing failure
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(
      JSON.stringify({ id: '888', email: 'error@example.com' }),
    );

    expect(mockPublisher.publish).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      { err: publishError },
      'Failed to publish events',
    );
  });

  it('should publish events with input data context', async () => {
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const mockPublisherService: Service<string, EventPublisher<TestEvent>> = {
      serviceName: Math.random().toString(),
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const bodySchema = z.object({ name: z.string(), email: z.string() });
    const outputSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
    });

    const events: MappedEvent<
      EventPublisher<TestEvent>,
      typeof outputSchema
    >[] = [
      {
        type: 'user.created',
        payload: (response) => ({ userId: response.id, email: response.email }),
      },
    ];

    const endpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      fn: async ({ body }) => ({
        id: '777',
        name: body.name,
        email: body.email,
      }),
      input: { body: bodySchema },
      output: outputSchema,
      services: [],
      logger: mockLogger,
      timeout: undefined,
      status: 201,
      getSession: undefined,
      authorize: undefined,
      description: undefined,
      events,
      publisherService: mockPublisherService,
    });

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
    const handler = adapter.handler;

    const event = createMockEvent({
      httpMethod: 'POST',
      body: JSON.stringify({ name: 'John Doe', email: 'john@example.com' }),
    });
    const context = createMockContext();
    const response = await handler(event, context);

    expect(response.statusCode).toBe(201);
    expect(response.body).toBe(
      JSON.stringify({
        id: '777',
        name: 'John Doe',
        email: 'john@example.com',
      }),
    );

    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'user.created',
        payload: { userId: '777', email: 'john@example.com' },
      },
    ]);
  });

  it('should not publish events when handler throws an error', async () => {
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const mockPublisherService: Service<
      'publisher',
      EventPublisher<TestEvent>
    > = {
      serviceName: 'publisher' as const,
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const outputSchema = z.object({ id: z.string(), email: z.string() });

    const events: MappedEvent<
      EventPublisher<TestEvent>,
      typeof outputSchema
    >[] = [
      {
        type: 'user.created',
        payload: (response) => ({ userId: response.id, email: response.email }),
      },
    ];

    const endpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      fn: async () => {
        throw new Error('Database connection failed');
      },
      input: undefined,
      output: outputSchema,
      services: [],
      logger: mockLogger,
      timeout: undefined,
      status: 200,
      getSession: undefined,
      authorize: undefined,
      description: undefined,
      events,
      publisherService: mockPublisherService,
    });

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
    const handler = adapter.handler;

    const event = createMockEvent({
      httpMethod: 'POST',
      body: JSON.stringify({}),
    });
    const context = createMockContext();
    const response = await handler(event, context);

    // The endpoint should return an error response
    expect(response.statusCode).toBe(500);

    // Events should not be published when handler fails
    expect(mockPublisher.publish).not.toHaveBeenCalled();
  });
});
