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

## CLI Integration

### Event Backend Setup

The `gkm init` and workspace configuration support automatic event backend provisioning:

```typescript
// gkm.workspace.ts
import { defineWorkspace } from '@geekmidas/cli';

export default defineWorkspace({
  apps: { /* ... */ },
  services: {
    db: true,
    events: 'pgboss', // or 'sns' or 'rabbitmq'
  },
});
```

| Backend | Infrastructure | Connection String Protocol |
|---------|---------------|---------------------------|
| `pgboss` | Reuses PostgreSQL (dedicated user/schema) | `pgboss://` |
| `sns` | LocalStack container (SNS+SQS) | `sns://` |
| `rabbitmq` | RabbitMQ container | `rabbitmq://` |

When configured, the CLI automatically:
- Generates service credentials and connection strings
- Adds the appropriate Docker containers to `docker-compose.yml`
- Sets `EVENT_PUBLISHER_CONNECTION_STRING` and `EVENT_SUBSCRIBER_CONNECTION_STRING`
- For **pgboss**: creates a dedicated PostgreSQL user and schema via an idempotent init script
- For **sns**: adds a LocalStack container with `LSIA`-prefixed access keys
- For **rabbitmq**: adds a RabbitMQ container with management plugin

## Dev Server

When running `gkm dev`, subscribers are automatically started for local development. The CLI discovers all subscriber definitions in your routes, generates setup code, and begins polling for events on server startup.

To enable this, set the connection string in your environment (auto-configured when using `services.events`):

```bash
# .env (auto-generated by gkm secrets:init when events backend is configured)
EVENT_SUBSCRIBER_CONNECTION_STRING=pgboss://pgboss:password@localhost:5432/mydb?schema=pgboss
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

## Integration with Constructs

The `@geekmidas/constructs` package provides builders for both publishing events (from endpoints, crons, and functions) and subscribing to events. This section covers the end-to-end flow.

### Defining a Publisher Service

Both publishers and subscribers use a service that wraps the `Publisher`/`Subscriber` from `@geekmidas/events`. The service reads the connection string from environment variables:

```typescript
import type { Service } from '@geekmidas/services';
import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import { Publisher } from '@geekmidas/events';

// Define all event types in one place
type AppEvents =
  | PublishableMessage<'user.created', { userId: string; email: string }>
  | PublishableMessage<'user.updated', { userId: string; changes: string[] }>
  | PublishableMessage<'order.placed', { orderId: string; total: number }>;

// Create the publisher service
const eventPublisherService = {
  serviceName: 'eventPublisher' as const,
  async register(envParser) {
    const config = envParser.create((get) => ({
      connectionString: get('EVENT_PUBLISHER_CONNECTION_STRING').string(),
    })).parse();

    return Publisher.fromConnectionString<AppEvents>(config.connectionString);
  },
} satisfies Service<'eventPublisher', EventPublisher<AppEvents>>;
```

### Publishing from Endpoints

Use `.publisher()` and `.event()` on endpoint or factory builders:

```typescript
import { e } from '@geekmidas/constructs/endpoints';

// Declarative — events published automatically after handler returns
const createUser = e
  .post('/users')
  .publisher(eventPublisherService)
  .body(userSchema)
  .output(userResponseSchema)
  .event({
    type: 'user.created',
    payload: (response) => ({ userId: response.id, email: response.email }),
    when: (response) => response.verified, // optional condition
  })
  .handle(async ({ body }) => {
    return await insertUser(body);
  });

// Manual — publish inside the handler
const transferFunds = e
  .post('/transfers')
  .publisher(eventPublisherService)
  .handle(async ({ body, publish }) => {
    const result = await processTransfer(body);
    await publish('order.placed', { orderId: result.id, total: result.amount });
    return result;
  });
```

### Subscribing to Events

Use the `s` builder from `@geekmidas/constructs/subscribers`:

```typescript
import { s } from '@geekmidas/constructs/subscribers';

export const onUserCreated = s
  .services([databaseService, emailService])
  .publisher(eventPublisherService) // optional, for chaining events
  .subscribe('user.created')
  .handle(async ({ events, services, logger }) => {
    for (const event of events) {
      await services.email.send('welcome', { to: event.payload.email });
      logger.info({ userId: event.payload.userId }, 'Welcome email sent');
    }
  });
```

See the [Constructs: Event Subscribers](/packages/constructs#event-subscribers) section for full subscriber builder documentation, including testing.

### End-to-End Flow

Here's how events flow through the system:

```
1. Endpoint handler returns response
         │
2. Framework publishes declared events via Publisher
   (using EVENT_PUBLISHER_CONNECTION_STRING)
         │
3. Events arrive at the backend (pgboss queue, RabbitMQ exchange,
   SNS topic, SQS queue, or in-memory)
         │
4. Subscriber receives events:
   - Dev: CLI polls via EVENT_SUBSCRIBER_CONNECTION_STRING
   - Prod (Lambda): SQS/SNS event source mapping triggers handler
   - Prod (Server): Built-in polling loop
         │
5. Subscriber handler processes events, optionally publishes
   follow-up events via its own publisher
```

### Resolution: How Connection Strings Get Set

When you configure `services.events` in your workspace:

```typescript
// gkm.config.ts
export default defineWorkspace({
  services: {
    db: true,
    events: 'pgboss', // or 'sns' or 'rabbitmq'
  },
});
```

The CLI automatically:
1. Adds the appropriate containers to `docker-compose.yml`
2. Generates credentials (passwords, access keys)
3. Sets `EVENT_PUBLISHER_CONNECTION_STRING` and `EVENT_SUBSCRIBER_CONNECTION_STRING` in your environment
4. For **pgboss**: creates a dedicated PostgreSQL user and schema via an init script
5. For **sns**: adds a LocalStack container; connection strings use `sns://` protocol
6. For **rabbitmq**: adds a RabbitMQ container with management plugin

Your publisher and subscriber services read these env vars via `envParser`, so the same code works across all backends — only the connection string changes.

### Example: Complete Event System

```typescript
// src/events/types.ts — shared event types
import type { PublishableMessage } from '@geekmidas/events';

export type AppEvents =
  | PublishableMessage<'user.created', { userId: string; email: string }>
  | PublishableMessage<'user.updated', { userId: string }>;

// src/services/eventPublisher.ts — publisher service
import { Publisher } from '@geekmidas/events';
import type { Service } from '@geekmidas/services';
import type { EventPublisher } from '@geekmidas/events';
import type { AppEvents } from '../events/types';

export const eventPublisherService = {
  serviceName: 'eventPublisher' as const,
  async register(envParser) {
    const config = envParser.create((get) => ({
      url: get('EVENT_PUBLISHER_CONNECTION_STRING').string(),
    })).parse();
    return Publisher.fromConnectionString<AppEvents>(config.url);
  },
} satisfies Service<'eventPublisher', EventPublisher<AppEvents>>;

// src/endpoints/users.ts — endpoint that publishes
import { e } from '@geekmidas/constructs/endpoints';
import { eventPublisherService } from '../services/eventPublisher';

export const createUser = e
  .post('/users')
  .publisher(eventPublisherService)
  .body(createUserSchema)
  .output(userSchema)
  .event({
    type: 'user.created',
    payload: (res) => ({ userId: res.id, email: res.email }),
  })
  .handle(async ({ body }) => {
    return await db.insertInto('users').values(body).returningAll().executeTakeFirstOrThrow();
  });

// src/subscribers/userEvents.ts — subscriber that reacts
import { s } from '@geekmidas/constructs/subscribers';

export const onUserCreated = s
  .services([emailService])
  .subscribe('user.created')
  .handle(async ({ events, services }) => {
    for (const event of events) {
      await services.email.send('welcome', { to: event.payload.email });
    }
  });
```
