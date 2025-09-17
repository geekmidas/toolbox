# Events Quick Start Guide

A concise guide to get started with event publishing in `@geekmidas/api`.

## Basic Setup

### 1. Define Your Event Types

```typescript
type UserEvent =
  | { type: 'user.created'; payload: { userId: string; email: string } }
  | { type: 'user.updated'; payload: { userId: string; changes: string[] } };
```

### 2. Create an Event Publisher Service

```typescript
import { EventPublisher, Service } from '@geekmidas/api/server';
import { EnvironmentParser } from '@geekmidas/envkit';

class MyEventPublisher implements EventPublisher<UserEvent> {
  async publish(events: UserEvent[]): Promise<void> {
    for (const event of events) {
      console.log(`Published: ${event.type}`, event.payload);
      // Send to your event bus (EventBridge, SQS, etc.)
    }
  }
}

class MyEventPublisherService implements Service<'eventPublisher', MyEventPublisher> {
  serviceName = 'eventPublisher' as const;

  async register(envParser: EnvironmentParser<{}>): Promise<MyEventPublisher> {
    return new MyEventPublisher();
  }
}

const publisherService = new MyEventPublisherService();
```

### 3. Add Events to Your Endpoint

```typescript
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

const createUserEndpoint = e
  .publisher(publisherService)
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
  .publisher(publisherService)
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
  .publisher(publisherService)
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

### EventBridge Publisher Service

```typescript
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { EnvironmentParser } from '@geekmidas/envkit';
import { EventPublisher, Service } from '@geekmidas/api/server';

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

class EventBridgePublisherService implements Service<'eventPublisher', EventBridgePublisher> {
  serviceName = 'eventPublisher' as const;

  async register(envParser: EnvironmentParser<{}>): Promise<EventBridgePublisher> {
    const config = envParser.create((get) => ({
      eventBusName: get('EVENT_BUS_NAME').string(),
      region: get('AWS_REGION').string().default('us-east-1'),
    })).parse();

    const client = new EventBridgeClient({ region: config.region });
    return new EventBridgePublisher(client, config.eventBusName);
  }
}
```

### SQS Publisher Service

```typescript
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { EnvironmentParser } from '@geekmidas/envkit';
import { EventPublisher, Service } from '@geekmidas/api/server';

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

class SQSPublisherService implements Service<'eventPublisher', SQSPublisher> {
  serviceName = 'eventPublisher' as const;

  async register(envParser: EnvironmentParser<{}>): Promise<SQSPublisher> {
    const config = envParser.create((get) => ({
      queueUrl: get('SQS_QUEUE_URL').string(),
      region: get('AWS_REGION').string().default('us-east-1'),
    })).parse();

    const client = new SQSClient({ region: config.region });
    return new SQSPublisher(client, config.queueUrl);
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
import { Service } from '@geekmidas/api/server';

it('should publish events', async () => {
  const mockPublisher = {
    publish: vi.fn().mockResolvedValue(undefined),
  };

  const mockPublisherService: Service<'eventPublisher', typeof mockPublisher> = {
    serviceName: 'eventPublisher' as const,
    register: vi.fn().mockResolvedValue(mockPublisher),
  };

  // Create endpoint with mock publisher service
  const endpoint = e
    .publisher(mockPublisherService)
    .post('/users')
    .event({
      type: 'user.created',
      payload: (response) => ({ userId: response.id, email: response.email }),
    })
    .handle(async () => ({ id: '123', email: 'test@example.com' }));
  
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