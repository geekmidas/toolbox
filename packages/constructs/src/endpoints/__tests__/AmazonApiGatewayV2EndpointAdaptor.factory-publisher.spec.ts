import { EnvironmentParser } from '@geekmidas/envkit';
import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import type { Service } from '@geekmidas/services';
import { createMockContext, createMockV2Event } from '@geekmidas/testkit/aws';
import { createMockLogger } from '@geekmidas/testkit/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AmazonApiGatewayV2Endpoint } from '../AmazonApiGatewayV2EndpointAdaptor';
import { e } from '../EndpointFactory';

// Test event types
type TestEvent =
  | PublishableMessage<'user.created', { userId: string; email: string }>
  | PublishableMessage<'user.updated', { userId: string; changes: string[] }>;

describe('AmazonApiGatewayV2Endpoint Factory Publisher Pattern', () => {
  let mockLogger: Logger;
  let envParser: EnvironmentParser<{}>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
    envParser = new EnvironmentParser({});
  });

  it('should publish events when using factory.publisher() pattern', async () => {
    // Create mock publisher exactly as user would
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const EventsService: Service<'EventsService', EventPublisher<TestEvent>> = {
      serviceName: 'EventsService' as const,
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    // Create factory with publisher exactly as user described
    const r = e.logger(mockLogger).services([]).publisher(EventsService);

    // Create endpoint from factory
    const endpoint = r
      .post('/orders')
      .body(z.object({ productId: z.string(), quantity: z.number() }))
      .output(z.object({ orderId: z.string(), amount: z.number() }))
      .event({
        type: 'user.created',
        payload: (response) => ({
          userId: response.orderId,
          email: `order-${response.orderId}@example.com`,
        }),
      })
      .handle(async () => ({
        orderId: 'order-123',
        amount: 99.99,
      }));

    // Verify publisher is set on endpoint
    expect(endpoint.publisherService).toBeDefined();
    expect(endpoint.publisherService?.serviceName).toBe('EventsService');

    // Create adapter and test
    const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);
    const handler = adapter.handler;

    const event = createMockV2Event({
      requestContext: {
        ...createMockV2Event().requestContext,
        http: {
          method: 'POST',
          path: '/orders',
          protocol: 'HTTP/1.1',
          sourceIp: '127.0.0.1',
          userAgent: 'test-agent',
        },
      },
      body: JSON.stringify({ productId: 'prod-456', quantity: 2 }),
    });
    const context = createMockContext();

    const response = await handler(event, context);

    // Verify successful response
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(
      JSON.stringify({ orderId: 'order-123', amount: 99.99 }),
    );

    // Verify publisher was called correctly
    expect(EventsService.register).toHaveBeenCalled();
    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'user.created',
        payload: {
          userId: 'order-123',
          email: 'order-order-123@example.com',
        },
      },
    ]);
  });

  it('should handle factory publisher with conditional events', async () => {
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const ConditionalEventsService: Service<
      'ConditionalEventsService',
      EventPublisher<TestEvent>
    > = {
      serviceName: 'ConditionalEventsService' as const,
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const factory = e.logger(mockLogger).publisher(ConditionalEventsService);

    const endpoint = factory
      .put('/orders/:id')
      .params(z.object({ id: z.string() }))
      .body(z.object({ status: z.enum(['pending', 'completed', 'cancelled']) }))
      .output(
        z.object({
          orderId: z.string(),
          status: z.string(),
          isNew: z.boolean(),
        }),
      )
      .event({
        type: 'user.created',
        payload: (response) => ({
          userId: response.orderId,
          email: `new-${response.orderId}@example.com`,
        }),
        when: (response) => response.isNew === true,
      })
      .event({
        type: 'user.updated',
        payload: (response) => ({
          userId: response.orderId,
          changes: ['status'],
        }),
        when: (response) => response.isNew === false,
      })
      .handle(async ({ params }) => ({
        orderId: params.id,
        status: 'completed',
        isNew: false, // Existing order
      }));

    const adapter = new AmazonApiGatewayV2Endpoint(envParser, endpoint);
    const handler = adapter.handler;

    const event = createMockV2Event({
      requestContext: {
        ...createMockV2Event().requestContext,
        http: {
          method: 'PUT',
          path: '/orders/order-789',
          protocol: 'HTTP/1.1',
          sourceIp: '127.0.0.1',
          userAgent: 'test-agent',
        },
      },
      pathParameters: { id: 'order-789' },
      body: JSON.stringify({ status: 'completed' }),
    });
    const context = createMockContext();

    const response = await handler(event, context);

    // Should succeed
    expect(response.statusCode).toBe(200);

    // Only user.updated should be published (isNew = false)
    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'user.updated',
        payload: { userId: 'order-789', changes: ['status'] },
      },
    ]);
  });

  it('should work with multiple factory publisher endpoints', async () => {
    const mockPublisher: EventPublisher<TestEvent> = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const SharedEventsService: Service<
      'SharedEventsService',
      EventPublisher<TestEvent>
    > = {
      serviceName: 'SharedEventsService' as const,
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    // Create shared factory
    const factory = e.logger(mockLogger).publisher(SharedEventsService);

    // Create multiple endpoints from same factory
    const createEndpoint = factory
      .post('/orders')
      .output(z.object({ orderId: z.string() }))
      .event({
        type: 'user.created',
        payload: (response) => ({
          userId: response.orderId,
          email: 'create@example.com',
        }),
      })
      .handle(async () => ({ orderId: 'create-order' }));

    const updateEndpoint = factory
      .put('/orders/:id')
      .params(z.object({ id: z.string() }))
      .output(z.object({ orderId: z.string() }))
      .event({
        type: 'user.updated',
        payload: (response) => ({
          userId: response.orderId,
          changes: ['status'],
        }),
      })
      .handle(async ({ params }) => ({ orderId: params.id }));

    // Both endpoints should have the shared publisher
    expect(createEndpoint.publisherService?.serviceName).toBe(
      'SharedEventsService',
    );
    expect(updateEndpoint.publisherService?.serviceName).toBe(
      'SharedEventsService',
    );

    // Test create endpoint
    const createAdapter = new AmazonApiGatewayV2Endpoint(
      envParser,
      createEndpoint,
    );
    const createHandler = createAdapter.handler;

    const createEvent = createMockV2Event({
      requestContext: {
        ...createMockV2Event().requestContext,
        http: {
          method: 'POST',
          path: '/orders',
          protocol: 'HTTP/1.1',
          sourceIp: '127.0.0.1',
          userAgent: 'test-agent',
        },
      },
    });

    await createHandler(createEvent, createMockContext());

    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'user.created',
        payload: { userId: 'create-order', email: 'create@example.com' },
      },
    ]);

    // Reset mock
    vi.clearAllMocks();
    (SharedEventsService.register as any).mockResolvedValue(mockPublisher);

    // Test update endpoint
    const updateAdapter = new AmazonApiGatewayV2Endpoint(
      envParser,
      updateEndpoint,
    );
    const updateHandler = updateAdapter.handler;

    const updateEvent = createMockV2Event({
      requestContext: {
        ...createMockV2Event().requestContext,
        http: {
          method: 'PUT',
          path: '/orders/update-order',
          protocol: 'HTTP/1.1',
          sourceIp: '127.0.0.1',
          userAgent: 'test-agent',
        },
      },
      pathParameters: { id: 'update-order' },
    });

    await updateHandler(updateEvent, createMockContext());

    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'user.updated',
        payload: { userId: 'update-order', changes: ['status'] },
      },
    ]);
  });
});
