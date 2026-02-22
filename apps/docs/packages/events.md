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

### pg-boss (PostgreSQL)

pg-boss uses your existing PostgreSQL database as a message queue, so there's no need for a separate message broker.

#### Connection String Format

```
pgboss://user:pass@host:5432/database?schema=pgboss
```

| Parameter | Description | Default |
|-----------|-------------|---------|
| `schema` | PostgreSQL schema for pg-boss tables | `pgboss` |
| `batchSize` | Messages per poll cycle (subscribers) | - |
| `pollingIntervalSeconds` | Poll frequency in seconds (subscribers) | `30` |

#### Using Connection Strings

```typescript
import { Publisher, Subscriber } from '@geekmidas/events';

const publisher = await Publisher.fromConnectionString<AppEvents>(
  'pgboss://user:pass@localhost:5432/mydb'
);

const subscriber = await Subscriber.fromConnectionString<AppEvents>(
  'pgboss://user:pass@localhost:5432/mydb?pollingIntervalSeconds=5&batchSize=10'
);

await subscriber.subscribe(['user.created'], async (message) => {
  console.log('User created:', message.payload.userId);
});

await publisher.publish([
  { type: 'user.created', payload: { userId: '123', email: 'test@example.com' } },
]);
```

#### Direct Instantiation

```typescript
import {
  PgBossConnection,
  PgBossPublisher,
  PgBossSubscriber,
} from '@geekmidas/events/pgboss';

const connection = new PgBossConnection({
  connectionString: 'postgres://user:pass@localhost:5432/mydb',
  schema: 'pgboss',
});
await connection.connect();

const publisher = new PgBossPublisher<AppEvents>(connection);
const subscriber = new PgBossSubscriber<AppEvents>(connection, {
  pollingIntervalSeconds: 5,
  batchSize: 10,
});
```

#### Dev Server Integration

`gkm dev` automatically starts pg-boss subscribers when you set the `EVENT_SUBSCRIBER_CONNECTION_STRING` environment variable:

```bash
EVENT_SUBSCRIBER_CONNECTION_STRING=pgboss://user:pass@localhost:5432/mydb?schema=pgboss
```

The dev server will discover your subscribers, connect to pg-boss, and begin polling for events in the background. See [Dev Server](#dev-server) for more details.

## Dev Server

When running `gkm dev`, subscribers are automatically started for local development. The CLI discovers all subscriber definitions in your routes, generates setup code, and begins polling for events on server startup.

To enable this, set the connection string in your environment:

```bash
# .env
EVENT_SUBSCRIBER_CONNECTION_STRING=pgboss://user:pass@localhost:5432/mydb
```

Supported connection string protocols:

- `pgboss://` - pg-boss (PostgreSQL)
- `rabbitmq://` - RabbitMQ
- `sqs://` - AWS SQS
- `sns://` - AWS SNS
- `basic://` - In-memory (for testing)

::: tip
For AWS-based backends (SQS/SNS), production deployments should use Lambda with event source mappings for proper scaling and dead letter queues. For pg-boss and RabbitMQ, the polling approach is also suitable for production via `gkm build --provider server`.
:::

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
