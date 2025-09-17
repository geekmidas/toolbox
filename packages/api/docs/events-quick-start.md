# Events Quick Start Guide

A concise guide to get started with event publishing in `@geekmidas/api`.

## Basic Setup

### 1. Define Your Event Types

```typescript
type UserEvent =
  | { type: 'user.created'; payload: { userId: string; email: string } }
  | { type: 'user.updated'; payload: { userId: string; changes: string[] } };
```

### 2. Create an Event Publisher

```typescript
import { EventPublisher } from '@geekmidas/api/server';

class MyEventPublisher implements EventPublisher<UserEvent> {
  async publish(events: UserEvent[]): Promise<void> {
    for (const event of events) {
      console.log(`Published: ${event.type}`, event.payload);
      // Send to your event bus (EventBridge, SQS, etc.)
    }
  }
}

const publisher = new MyEventPublisher();
```

### 3. Add Events to Your Endpoint

```typescript
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

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
  }))
  .event({
    type: 'user.created',
    payload: (response) => ({
      userId: response.id,
      email: response.email,
    }),
  })
  .handle(async ({ body }) => {
    const user = await createUser(body);
    return user; // Event published automatically after successful response
  });
```

## Conditional Events

Publish events only when certain conditions are met:

```typescript
const updateUserEndpoint = e
  .publisher(publisher)
  .put('/users/:id')
  .params(z.object({ id: z.string() }))
  .body(z.object({
    email: z.string().email().optional(),
    name: z.string().optional(),
  }))
  .output(z.object({
    id: z.string(),
    emailChanged: z.boolean(),
  }))
  .event({
    type: 'user.updated',
    payload: (response) => ({
      userId: response.id,
      changes: ['email'],
    }),
    when: (response) => response.emailChanged, // Only publish if email changed
  })
  .handle(async ({ params, body }) => {
    const user = await updateUser(params.id, body);
    return user;
  });
```

## Multiple Events

Publish multiple events from a single endpoint:

```typescript
const processOrderEndpoint = e
  .publisher(publisher)
  .post('/orders')
  .body(orderSchema)
  .output(orderResponseSchema)
  .event({
    type: 'order.created',
    payload: (response) => ({ orderId: response.id }),
  })
  .event({
    type: 'inventory.reserved',
    payload: (response) => ({ items: response.items }),
  })
  .event({
    type: 'customer.notified',
    payload: (response) => ({ customerId: response.customerId }),
  })
  .handle(async ({ body }) => {
    const order = await processOrder(body);
    return order; // All 3 events published automatically
  });
```

## AWS Integration

### EventBridge Publisher

```typescript
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

class EventBridgePublisher implements EventPublisher<UserEvent> {
  constructor(
    private client: EventBridgeClient,
    private eventBusName: string,
  ) {}

  async publish(events: UserEvent[]): Promise<void> {
    if (events.length === 0) return;

    const entries = events.map(event => ({
      Source: 'user-service',
      DetailType: event.type,
      Detail: JSON.stringify(event.payload),
      EventBusName: this.eventBusName,
    }));

    await this.client.send(new PutEventsCommand({ Entries: entries }));
  }
}
```

### SQS Publisher

```typescript
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';

class SQSPublisher implements EventPublisher<UserEvent> {
  constructor(
    private client: SQSClient,
    private queueUrl: string,
  ) {}

  async publish(events: UserEvent[]): Promise<void> {
    if (events.length === 0) return;

    const entries = events.map((event, index) => ({
      Id: index.toString(),
      MessageBody: JSON.stringify(event),
    }));

    await this.client.send(new SendMessageBatchCommand({
      QueueUrl: this.queueUrl,
      Entries: entries,
    }));
  }
}
```

## Important Notes

- ✅ Events are only published on successful responses (2xx status codes)
- ✅ Events are published after response validation passes
- ✅ Publisher errors don't affect the client response
- ✅ Works with all adapters (Hono, AWS API Gateway V1/V2)
- ✅ Fully type-safe with TypeScript

## Testing

```typescript
import { vi } from 'vitest';

it('should publish events', async () => {
  const mockPublisher = {
    publish: vi.fn().mockResolvedValue(undefined),
  };

  // Create endpoint with mock publisher
  const endpoint = createUserEndpoint.withPublisher(mockPublisher);
  
  // Test your endpoint...
  
  expect(mockPublisher.publish).toHaveBeenCalledWith([
    {
      type: 'user.created',
      payload: { userId: '123', email: 'test@example.com' },
    },
  ]);
});
```

That's it! Your endpoints will now automatically publish events after successful execution. For more advanced usage and examples, see the [complete events documentation](./events.md).