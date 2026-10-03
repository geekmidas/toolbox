# @geekmidas/events

Unified event messaging library with support for multiple backends.

::: tip Topics and queues are constructs
In an application you rarely build a publisher by hand. Declare a `Topic` and
its publisher is its `service`, typed to the topic's events:

```typescript
import { Topic } from '@geekmidas/constructs/topic';

export const users = new Topic('Users', {
  events: {
    'user.created': z.object({ userId: z.string(), email: z.email() }),
  },
});
```

An endpoint publishes to it with `.event(users, { type, payload })`; anything
that `.dependsOn([users])` gets it as `services.users`. This package is what
those constructs are built on, and what you reach for directly when you are
wiring a broker yourself.
:::

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

`gkm dev` automatically starts pg-boss subscribers. When PostgreSQL is enabled, the CLI creates a dedicated pgboss user and sets `EVENT_SUBSCRIBER_CONNECTION_STRING` automatically — no manual configuration needed.

The dev server discovers your subscribers, connects to pg-boss, and begins polling for events in the background. See [Dev Server](#dev-server) for more details.

## CLI Integration

### Event Backend Setup

When a database is declared, the CLI automatically sets up **pg-boss** as the default event backend — no explicit configuration needed. A dedicated `pgboss` user and schema are created in your PostgreSQL database, and `EVENT_PUBLISHER_CONNECTION_STRING` / `EVENT_SUBSCRIBER_CONNECTION_STRING` are set automatically.

The backend follows the deploy target — there is nothing to configure. A
project deploying to a server uses pg-boss, in the Postgres its declared
database already brings up; one deploying to AWS uses SNS and SQS, against the
local AWS emulator in development.

| Backend | Infrastructure | Connection String Protocol |
|---------|---------------|---------------------------|
| `pgboss` (default) | Reuses PostgreSQL (dedicated user/schema) | `pgboss://` |
| `sns` | LocalStack container (SNS+SQS) | `sns://` / `sqs://` |
| `rabbitmq` | RabbitMQ container | `rabbitmq://` |

The CLI automatically:
- Creates a dedicated `pgboss` PostgreSQL user and schema via an idempotent init script
- Generates `EVENT_PUBLISHER_CONNECTION_STRING` and `EVENT_SUBSCRIBER_CONNECTION_STRING`
- For **sns**: adds a LocalStack container with `LSIA`-prefixed access keys
- For **rabbitmq**: adds a RabbitMQ container with management plugin

## Dev Server

When running `gkm dev`, subscribers are automatically started for local development. The CLI discovers all subscriber definitions in your routes, generates setup code, and begins polling for events on server startup.

The connection strings are set automatically when PostgreSQL is enabled — no manual configuration needed. You can verify them with `gkm secrets:show`:

```bash
EVENT_PUBLISHER_CONNECTION_STRING=pgboss://pgboss:...@localhost:5432/mydb?schema=pgboss
EVENT_SUBSCRIBER_CONNECTION_STRING=pgboss://pgboss:...@localhost:5432/mydb?schema=pgboss
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

`@geekmidas/constructs` declares the topics and queues, publishes to them from
endpoints, functions and crons, and runs the subscribers and queue consumers.
This section covers the end-to-end flow; the
[Constructs](/packages/constructs#event-publishing) page has every option.

### A Topic Is the Publisher

```typescript
// constructs/topics.ts
import { Topic } from '@geekmidas/constructs/topic';

export const users = new Topic('Users', {
  events: {
    'user.created': z.object({ userId: z.string(), email: z.email() }),
    'user.updated': z.object({ userId: z.string(), changes: z.array(z.string()) }),
  },
});
```

The event map is the contract: it types every `.event(users, …)` that publishes
to the topic and every subscriber that binds to it. The topic's `service` reads
`USERS_PUBLISHER_CONNECTION_STRING` and calls `Publisher.fromConnectionString`
with it — the hand-written publisher service this page used to show, derived.

### Publishing from Endpoints

```typescript
import { users } from '../constructs/topics';
import { router } from './router';

// Declarative — published once the handler has succeeded
export const createUser = router
  .post('/users')
  .body(userSchema)
  .output(userResponseSchema)
  .event(users, {
    type: 'user.created',
    payload: (user) => ({ userId: user.id, email: user.email }),
    when: (user) => user.verified, // optional condition
  })
  .handle(async ({ body, db }) => insertUser(db, body));

// Imperative — `.event()` and `.dependsOn([users])` both put the topic's
// publisher in the handler as `services.users`
export const renameUser = router
  .patch('/users/:id')
  .dependsOn([users])
  .handle(async ({ params, body, services }) => {
    const changes = await rename(params.id, body.name);
    if (changes.length) {
      await services.users.publish([
        { type: 'user.updated', payload: { userId: params.id, changes } },
      ]);
    }
    return { changes };
  });
```

`.event()` is repeatable across topics. An endpoint that names two topics
publishes to each, every event through its own topic's publisher.

### Subscribing to Events

A subscriber is built from a `Worker` and binds to the topic:

```typescript
import { users } from '../constructs/topics';
import { worker } from '../constructs/worker';

export const onUserCreated = worker
  .topic(users)
  .dependsOn([mail])
  .subscribe(['user.created'])
  .handle(async ({ events, services, logger }) => {
    for (const event of events) {
      await services.mail.sendTemplate('welcome', {
        to: event.payload.email,
        subject: 'Welcome',
        props: {},
      });
      logger.info({ userId: event.payload.userId }, 'Welcome email sent');
    }
  });
```

Binding is not depending: the subscriber is never handed the topic's publisher
connection string. One that publishes follow-up events depends on the topic it
publishes to, `.dependsOn([notifications])`.

### Queues

A queue is point-to-point: one construct, the queue and its single consumer.

```typescript
export const emails = worker
  .queue('Emails')
  .message(z.object({ to: z.email(), template: z.enum(['welcome']) }))
  .dependsOn([mail])
  .handle(async ({ messages, services }) => { /* … */ });

// A producer depends on it; `type` is the queue's name as written
export const invite = router
  .post('/invites')
  .dependsOn([emails])
  .handle(async ({ body, services }) => {
    await services.emails.publish([
      { type: 'Emails', payload: { to: body.email, template: 'welcome' } },
    ]);
  });
```

See [Constructs: Event Subscribers](/packages/constructs#event-subscribers) and
[Queues](/packages/constructs#queues) for testing and every option.

### End-to-End Flow

```
1. Endpoint handler returns response
         │
2. Framework publishes each .event() through its topic's publisher
   (using <TOPIC>_PUBLISHER_CONNECTION_STRING)
         │
3. Events arrive at the backend (pgboss queue, RabbitMQ exchange,
   SNS topic, SQS queue, or in-memory)
         │
4. Subscriber receives events:
   - Dev: CLI polls via EVENT_SUBSCRIBER_CONNECTION_STRING
   - Prod (Lambda): SQS/SNS event source mapping triggers handler
   - Prod (Server): Built-in polling loop
         │
5. Subscriber handler processes events, optionally publishing
   follow-ups to a topic it depends on
```

### Resolution: How Connection Strings Get Set

Declaring a topic or a queue is what puts a broker in the local plan. There is
no `events` configuration:

```typescript
// gkm.config.ts — nothing to configure: on a server target, pg-boss lives in
// the Postgres your declared database already implies.
export default defineWorkspace({
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: './constructs/**/*.ts',
  deploy: { default: 'dokploy' },
});
```

The CLI automatically:
1. Creates a dedicated `pgboss` PostgreSQL user and schema
2. Resolves `<ID>_PUBLISHER_CONNECTION_STRING` for each topic and queue, given
   only to what depends on it, plus `EVENT_SUBSCRIBER_CONNECTION_STRING` for
   the pollers
3. Injects them into your environment during `gkm dev` and `gkm exec`

On an AWS target the CLI uses SNS and SQS instead — it adds the AWS emulator
container locally and switches the connection string protocol to `sns://` and
`sqs://`.

The publisher picks its transport from the protocol, so the same code works
across all backends — only the connection string changes.
