# Event Publishing in @geekmidas/api

The `@geekmidas/api` package includes a comprehensive event publishing system that allows endpoints to automatically publish events after successful execution. This enables event-driven architectures and decoupled system communication.

## Table of Contents

- [Overview](#overview)
- [Key Concepts](#key-concepts)
- [Event Types](#event-types)
- [Event Publishers](#event-publishers)
- [Defining Events](#defining-events)
- [Conditional Events](#conditional-events)
- [Adapter Support](#adapter-support)
- [Error Handling](#error-handling)
- [Testing](#testing)
- [Examples](#examples)
- [Best Practices](#best-practices)

## Overview

The event publishing system automatically publishes events after successful endpoint execution (2xx status codes). Events are only published when:

1. The endpoint execution completes successfully
2. The response has a 2xx status code
3. An event publisher is configured
4. Events are defined for the endpoint

## Key Concepts

### Event Publisher

An event publisher is responsible for actually publishing events to an event bus, message queue, or other destination. Publishers implement the `EventPublisher<T>` interface:

```typescript
interface EventPublisher<T> {
  publish(events: T[]): Promise<void>;
}
```

### Event Definition

Events are defined using the `MappedEvent` type, which includes:

- `type`: The event type/name
- `payload`: A function that transforms the endpoint response into event data
- `when` (optional): A condition function that determines if the event should be published

### Event Flow

1. Endpoint executes successfully
2. Response is validated (if output schema exists)
3. For each defined event:
   - Check if `when` condition is met (if provided)
   - Transform response using `payload` function
   - Add to events batch
4. Publish all events using the configured publisher

## Event Types

Define your application's event types using TypeScript unions:

```typescript
type UserEvent =
  | PublishableMessage<'user.created', { userId: string; email: string }>
  | PublishableMessage<'user.updated', { userId: string; changes: string[] }>
  | PublishableMessage<'user.deleted', { userId: string; deletedAt: string }>;

type OrderEvent =
  | PublishableMessage<'order.placed', { orderId: string; customerId: string; total: number }>
  | PublishableMessage<'order.shipped', { orderId: string; trackingNumber: string }>
  | PublishableMessage<'order.delivered', { orderId: string; deliveredAt: string }>;

// Combine multiple event types
type AppEvent = UserEvent | OrderEvent;
```

## Event Publishers

### Simple Console Publisher

```typescript
class ConsoleEventPublisher implements EventPublisher<AppEvent> {
  async publish(events: AppEvent[]): Promise<void> {
    for (const event of events) {
      console.log(`[EVENT] ${event.type}:`, event.payload);
    }
  }
}
```

### AWS EventBridge Publisher

```typescript
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

class EventBridgePublisher implements EventPublisher<AppEvent> {
  constructor(
    private client: EventBridgeClient,
    private eventBusName: string,
    private source: string,
  ) {}

  async publish(events: AppEvent[]): Promise<void> {
    if (events.length === 0) return;

    const entries = events.map(event => ({
      Source: this.source,
      DetailType: event.type,
      Detail: JSON.stringify(event.payload),
      EventBusName: this.eventBusName,
    }));

    await this.client.send(
      new PutEventsCommand({
        Entries: entries,
      }),
    );
  }
}
```

### SQS Publisher

```typescript
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';

class SQSEventPublisher implements EventPublisher<AppEvent> {
  constructor(
    private client: SQSClient,
    private queueUrl: string,
  ) {}

  async publish(events: AppEvent[]): Promise<void> {
    if (events.length === 0) return;

    const entries = events.map((event, index) => ({
      Id: index.toString(),
      MessageBody: JSON.stringify(event),
    }));

    await this.client.send(
      new SendMessageBatchCommand({
        QueueUrl: this.queueUrl,
        Entries: entries,
      }),
    );
  }
}
```

## Defining Events

### Using Endpoint Builder

```typescript
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

const publisher = new EventBridgePublisher(client, 'my-event-bus', 'user-service');

const createUserEndpoint = e
  .publisher(publisher)
  .post('/users')
  .body(z.object({
    name: z.string(),
    email: z.string().email(),
  }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    createdAt: z.string(),
  }))
  .event({
    type: 'user.created',
    payload: (response) => ({
      userId: response.id,
      email: response.email,
    }),
  })
  .handle(async ({ body }) => {
    // Create user logic
    const user = await createUser(body);
    return user;
  });
```

### Using Endpoint Constructor

```typescript
const endpoint = new Endpoint({
  route: '/users',
  method: 'POST',
  fn: async ({ body }) => createUser(body),
  input: { body: createUserSchema },
  output: userSchema,
  publisher,
  events: [
    {
      type: 'user.created',
      payload: (response) => ({
        userId: response.id,
        email: response.email,
      }),
    },
  ],
  // ... other options
});
```

## Conditional Events

Use the `when` property to conditionally publish events:

```typescript
const updateUserEndpoint = e
  .publisher(publisher)
  .put('/users/:id')
  .params(z.object({ id: z.string() }))
  .body(z.object({
    name: z.string().optional(),
    email: z.string().email().optional(),
  }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    emailChanged: z.boolean(),
    nameChanged: z.boolean(),
  }))
  .event({
    type: 'user.updated',
    payload: (response) => {
      const changes = [];
      if (response.emailChanged) changes.push('email');
      if (response.nameChanged) changes.push('name');
      return {
        userId: response.id,
        changes,
      };
    },
    when: (response) => response.emailChanged || response.nameChanged,
  })
  .event({
    type: 'user.email.changed',
    payload: (response) => ({
      userId: response.id,
      newEmail: response.email,
    }),
    when: (response) => response.emailChanged,
  })
  .handle(async ({ params, body }) => {
    // Update user logic
    const updatedUser = await updateUser(params.id, body);
    return updatedUser;
  });
```

## Adapter Support

All three main adapters support event publishing:

### Hono Adapter

```typescript
import { HonoEndpoint } from '@geekmidas/api/hono';

const app = new Hono();

// Apply event middleware globally
HonoEndpoint.applyEventMiddleware(app);

// Add endpoints
const endpoint = new HonoEndpoint(createUserEndpoint);
endpoint.addRoute(serviceDiscovery, app);
```

### AWS API Gateway V1

```typescript
import { AmazonApiGatewayV1Endpoint } from '@geekmidas/api/aws-apigateway';

const handler = new AmazonApiGatewayV1Endpoint(envParser, createUserEndpoint).handler;

export { handler };
```

### AWS API Gateway V2

```typescript
import { AmazonApiGatewayV2Endpoint } from '@geekmidas/api/aws-apigateway';

const handler = new AmazonApiGatewayV2Endpoint(envParser, createUserEndpoint).handler;

export { handler };
```

## Error Handling

### Publisher Errors

If event publishing fails, the endpoint response is still returned successfully. Publisher errors are logged but don't affect the client response:

```typescript
class RobustEventPublisher implements EventPublisher<AppEvent> {
  async publish(events: AppEvent[]): Promise<void> {
    try {
      await this.actualPublish(events);
    } catch (error) {
      // Log error but don't throw
      console.error('Failed to publish events:', error);
      // Optionally send to error tracking service
      await this.reportError(error, events);
    }
  }

  private async actualPublish(events: AppEvent[]): Promise<void> {
    // Actual publishing logic
  }

  private async reportError(error: Error, events: AppEvent[]): Promise<void> {
    // Report to error tracking service
  }
}
```

### Event Publication Only on Success

Events are only published when:

- The endpoint handler completes without throwing
- The response status code is in the 2xx range
- Output validation passes (if output schema is defined)

```typescript
// Events will be published
const successEndpoint = e
  .post('/success')
  .event({
    type: 'action.completed',
    payload: () => ({ success: true }),
  })
  .handle(async () => ({ result: 'ok' })); // Returns 200

// Events will NOT be published
const errorEndpoint = e
  .post('/error')
  .event({
    type: 'action.completed', // This won't be published
    payload: () => ({ success: true }),
  })
  .handle(async () => {
    throw new Error('Something went wrong'); // Throws error, returns 500
  });
```

## Testing

### Testing Event Publishing

```typescript
import { describe, expect, it, vi } from 'vitest';
import { createMockV1Event, createMockContext } from './test-helpers';

describe('User Events', () => {
  it('should publish user.created event', async () => {
    const mockPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const mockPublisherService: Service<'eventPublisher', typeof mockPublisher> = {
      serviceName: 'eventPublisher' as const,
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const endpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      fn: async () => ({ id: '123', email: 'test@example.com' }),
      output: z.object({ id: z.string(), email: z.string() }),
      publisherService: mockPublisherService,
      events: [
        {
          type: 'user.created',
          payload: (response) => ({
            userId: response.id,
            email: response.email,
          }),
        },
      ],
      // ... other options
    });

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
    const handler = adapter.handler;

    const event = createMockV1Event({
      httpMethod: 'POST',
      body: JSON.stringify({}),
    });
    const context = createMockContext();

    const response = await handler(event, context);

    expect(response.statusCode).toBe(200);
    expect(mockPublisher.publish).toHaveBeenCalledWith([
      {
        type: 'user.created',
        payload: { userId: '123', email: 'test@example.com' },
      },
    ]);
  });

  it('should not publish events on error', async () => {
    const mockPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    const mockPublisherService: Service<'eventPublisher', typeof mockPublisher> = {
      serviceName: 'eventPublisher' as const,
      register: vi.fn().mockResolvedValue(mockPublisher),
    };

    const endpoint = new Endpoint({
      route: '/users',
      method: 'POST',
      fn: async () => {
        throw new Error('Something went wrong');
      },
      publisherService: mockPublisherService,
      events: [
        {
          type: 'user.created',
          payload: () => ({ userId: '123' }),
        },
      ],
      // ... other options
    });

    const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
    const handler = adapter.handler;

    const event = createMockV1Event({
      httpMethod: 'POST',
      body: JSON.stringify({}),
    });
    const context = createMockContext();

    const response = await handler(event, context);

    expect(response.statusCode).toBe(500);
    expect(mockPublisher.publish).not.toHaveBeenCalled();
  });
});
```

### Testing Conditional Events

```typescript
it('should only publish events when conditions are met', async () => {
  const mockPublisher = {
    publish: vi.fn().mockResolvedValue(undefined),
  };

  const mockPublisherService: Service<'eventPublisher', typeof mockPublisher> = {
    serviceName: 'eventPublisher' as const,
    register: vi.fn().mockResolvedValue(mockPublisher),
  };

  const endpoint = new Endpoint({
    route: '/users/:id',
    method: 'PUT',
    fn: async () => ({
      id: '123',
      emailChanged: false,
      nameChanged: true,
    }),
    output: z.object({
      id: z.string(),
      emailChanged: z.boolean(),
      nameChanged: z.boolean(),
    }),
    publisherService: mockPublisherService,
    events: [
      {
        type: 'user.email.changed',
        payload: (response) => ({ userId: response.id }),
        when: (response) => response.emailChanged,
      },
      {
        type: 'user.name.changed',
        payload: (response) => ({ userId: response.id }),
        when: (response) => response.nameChanged,
      },
    ],
    // ... other options
  });

  // Test the endpoint...

  expect(mockPublisher.publish).toHaveBeenCalledWith([
    {
      type: 'user.name.changed',
      payload: { userId: '123' },
    },
  ]);
  // Note: user.email.changed is not published because emailChanged is false
});
```

## Examples

### Complete E-commerce Example

```typescript
// Event types
type EcommerceEvent =
  | PublishableMessage<'order.created', { orderId: string; customerId: string; total: number }>
  | PublishableMessage<'order.paid', { orderId: string; paymentId: string }>
  | PublishableMessage<'order.shipped', { orderId: string; trackingNumber: string }>
  | PublishableMessage<'inventory.reserved', { productId: string; quantity: number }>
  | PublishableMessage<'customer.notified', { customerId: string; type: string }>;

// Publisher
const publisher = new EventBridgePublisher(client, 'ecommerce-events', 'order-service');

// Create order endpoint
const createOrderEndpoint = e
  .publisher(publisher)
  .post('/orders')
  .body(z.object({
    customerId: z.string(),
    items: z.array(z.object({
      productId: z.string(),
      quantity: z.number(),
      price: z.number(),
    })),
  }))
  .output(z.object({
    id: z.string(),
    customerId: z.string(),
    total: z.number(),
    status: z.string(),
    requiresPayment: z.boolean(),
  }))
  .event({
    type: 'order.created',
    payload: (response) => ({
      orderId: response.id,
      customerId: response.customerId,
      total: response.total,
    }),
  })
  .event({
    type: 'customer.notified',
    payload: (response) => ({
      customerId: response.customerId,
      type: 'order_confirmation',
    }),
  })
  .handle(async ({ body }) => {
    const order = await createOrder(body);
    return order;
  });

// Update order status endpoint
const updateOrderStatusEndpoint = e
  .publisher(publisher)
  .put('/orders/:id/status')
  .params(z.object({ id: z.string() }))
  .body(z.object({
    status: z.enum(['paid', 'shipped', 'delivered']),
    paymentId: z.string().optional(),
    trackingNumber: z.string().optional(),
  }))
  .output(z.object({
    id: z.string(),
    customerId: z.string(),
    status: z.string(),
    paymentId: z.string().optional(),
    trackingNumber: z.string().optional(),
  }))
  .event({
    type: 'order.paid',
    payload: (response) => ({
      orderId: response.id,
      paymentId: response.paymentId!,
    }),
    when: (response) => response.status === 'paid' && !!response.paymentId,
  })
  .event({
    type: 'order.shipped',
    payload: (response) => ({
      orderId: response.id,
      trackingNumber: response.trackingNumber!,
    }),
    when: (response) => response.status === 'shipped' && !!response.trackingNumber,
  })
  .event({
    type: 'customer.notified',
    payload: (response) => ({
      customerId: response.customerId,
      type: `order_${response.status}`,
    }),
  })
  .handle(async ({ params, body }) => {
    const order = await updateOrderStatus(params.id, body);
    return order;
  });
```

## Best Practices

### 1. Event Type Design

- Use descriptive, hierarchical names (e.g., `user.created`, `order.payment.failed`)
- Include entity type and action in the event name
- Keep event payloads focused and minimal
- Use consistent naming conventions across your application

### 2. Payload Design

- Include only necessary data in event payloads
- Include entity IDs for easy correlation
- Consider including timestamps
- Avoid sensitive data in event payloads

```typescript
// Good
{
  type: 'user.created',
  payload: {
    userId: '123',
    email: 'user@example.com',
    createdAt: '2024-01-01T10:00:00Z',
  }
}

// Avoid
{
  type: 'user.created',
  payload: {
    userId: '123',
    email: 'user@example.com',
    password: 'hashed-password', // Sensitive data
    internalNotes: 'Created via admin panel', // Internal data
    fullUserObject: { /* large object */ }, // Too much data
  }
}
```

### 3. Error Handling

- Always handle publisher errors gracefully
- Use circuit breakers for external event buses
- Implement retry logic with exponential backoff
- Consider dead letter queues for failed events

### 4. Testing

- Test event publishing in integration tests
- Mock publishers in unit tests
- Test conditional logic thoroughly
- Verify events are not published on errors

### 5. Performance

- Batch events when possible
- Use asynchronous publishing
- Consider event deduplication
- Monitor publisher performance and latency

### 6. Monitoring

- Log all published events
- Monitor publisher success/failure rates
- Set up alerts for publishing failures
- Track event processing downstream

```typescript
class MonitoredEventPublisher implements EventPublisher<AppEvent> {
  constructor(
    private actualPublisher: EventPublisher<AppEvent>,
    private metrics: MetricsClient,
  ) {}

  async publish(events: AppEvent[]): Promise<void> {
    const startTime = Date.now();
    
    try {
      await this.actualPublisher.publish(events);
      
      // Record success metrics
      this.metrics.increment('events.published.success', events.length);
      this.metrics.timing('events.publish.duration', Date.now() - startTime);
      
      // Log published events
      for (const event of events) {
        console.log(`[EVENT PUBLISHED] ${event.type}`, {
          eventId: generateEventId(),
          timestamp: new Date().toISOString(),
          payload: event.payload,
        });
      }
    } catch (error) {
      // Record failure metrics
      this.metrics.increment('events.published.failure', events.length);
      this.metrics.timing('events.publish.error_duration', Date.now() - startTime);
      
      // Log error
      console.error('[EVENT PUBLISH FAILED]', {
        error: error.message,
        eventCount: events.length,
        events: events.map(e => ({ type: e.type, payload: e.payload })),
      });
      
      throw error;
    }
  }
}
```

### 7. Documentation

- Document all event types and their payloads
- Provide examples for each event
- Document when events are published
- Keep event schemas versioned and backward-compatible

---

This documentation provides a comprehensive guide to using the event publishing system in `@geekmidas/api`. The system is designed to be type-safe, testable, and production-ready while remaining simple to use and understand.