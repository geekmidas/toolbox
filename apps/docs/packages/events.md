# @geekmidas/events

Unified event messaging library with support for multiple backends.

## Installation

```bash
pnpm add @geekmidas/events
```

## Features

- Unified interface for publishing and subscribing
- Type-safe message types with full TypeScript inference
- Multiple backends: Basic (in-memory), RabbitMQ, AWS SQS, AWS SNS, pg-boss (PostgreSQL)
- Connection string-based configuration
- Message filtering by event type
- SNS-SQS integration with automatic queue management

## Package Exports

- `/` - Core interfaces and factory functions
- `/basic` - Basic (in-memory) implementation
- `/rabbitmq` - RabbitMQ implementation
- `/sqs` - AWS SQS implementation
- `/sns` - AWS SNS implementation
- `/pgboss` - pg-boss (PostgreSQL) implementation

## Basic Usage

### Define Message Types

```typescript
import type { PublishableMessage } from '@geekmidas/events';

type AppEvents =
  | PublishableMessage<'user.created', { userId: string; email: string }>
  | PublishableMessage<'user.updated', { userId: string; changes: string[] }>
  | PublishableMessage<'order.placed', { orderId: string; total: number }>;
```

### Create Publisher and Subscriber

```typescript
import { Publisher, Subscriber } from '@geekmidas/events';

// Create from connection string
const publisher = await Publisher.fromConnectionString<AppEvents>(
  'rabbitmq://localhost:5672?exchange=events'
);

const subscriber = await Subscriber.fromConnectionString<AppEvents>(
  'rabbitmq://localhost:5672?exchange=events&queue=user-service'
);
```

### Publish Events

```typescript
await publisher.publish([
  {
    type: 'user.created',
    payload: { userId: '123', email: 'test@example.com' },
  },
]);
```

### Subscribe to Events

```typescript
await subscriber.subscribe(['user.created', 'user.updated'], async (message) => {
  console.log('Event received:', message.type, message.payload);
});
```

## Backend-Specific Usage

### In-Memory (Basic)

```typescript
import { BasicPublisher, BasicSubscriber } from '@geekmidas/events/basic';

const publisher = new BasicPublisher<AppEvents>();
const subscriber = new BasicSubscriber<AppEvents>(publisher);

await subscriber.subscribe(['user.created'], async (message) => {
  console.log('User created:', message.payload.userId);
});
```

### RabbitMQ

```typescript
import { RabbitMQPublisher, RabbitMQSubscriber } from '@geekmidas/events/rabbitmq';

const publisher = await RabbitMQPublisher.create<AppEvents>({
  url: 'amqp://localhost:5672',
  exchange: 'events',
});

const subscriber = await RabbitMQSubscriber.create<AppEvents>({
  url: 'amqp://localhost:5672',
  exchange: 'events',
  queue: 'user-service',
});
```

### AWS SQS

```typescript
import { SQSPublisher, SQSSubscriber } from '@geekmidas/events/sqs';

const publisher = await SQSPublisher.create<AppEvents>({
  region: 'us-east-1',
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/events',
});

const subscriber = await SQSSubscriber.create<AppEvents>({
  region: 'us-east-1',
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/events',
});
```

### AWS SNS

```typescript
import { SNSPublisher } from '@geekmidas/events/sns';

const publisher = await SNSPublisher.create<AppEvents>({
  region: 'us-east-1',
  topicArn: 'arn:aws:sns:us-east-1:123456789:events',
});
```

## Integration with Endpoints

```typescript
import { e } from '@geekmidas/constructs/endpoints';

const endpoint = e
  .post('/users')
  .body(UserSchema)
  .output(UserResponseSchema)
  .events([
    {
      type: 'user.created',
      payload: (response) => ({
        userId: response.id,
        email: response.email,
      }),
    },
  ])
  .handle(async ({ body }) => {
    // Create user...
    return { id: '123', ...body };
  });
```
