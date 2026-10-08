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

| Subpath | Driver | Peer dependency |
| --- | --- | --- |
| `/` | Interfaces, factories, `registerEventsDriver` | — |
| `/basic` | `basicEventsDriver` (in-memory) | — |
| `/pgboss` | `pgbossEventsDriver` (PostgreSQL) | `pg-boss` |
| `/rabbitmq` | `rabbitmqEventsDriver` | `amqplib` |
| `/sns` | `snsEventsDriver` | `@aws-sdk/client-sns`, `@aws-sdk/client-sqs` |
| `/sqs` | `sqsEventsDriver` | `@aws-sdk/client-sqs` |

Each subpath also exports its broker's classes (`PgBossPublisher`,
`SNSConnection`, …), and is the only module that imports its peer dependency.

## Registering a Broker

The core never loads a broker itself. The scheme of a connection string
(`pgboss://`, `sns://`, …) picks a **driver**, and which drivers exist is the
decision of whoever starts the process. That is what keeps a bundle to the one
broker it uses: a server bundled for pg-boss never has to resolve the AWS SDK,
and an SNS one never resolves `pg-boss` or `amqplib`.

Everything `gkm` generates registers its target's broker for you, when the app
declares a `Topic` or a `Queue`:

| Target | Registers |
| --- | --- |
| server (Dokploy) | `pgbossEventsDriver` |
| AWS | `snsEventsDriver`, `sqsEventsDriver` |
| `gkm dev`, `gkm test` | the local stage's broker — the target's |

A script that builds a publisher or subscriber itself registers once, before the
first call:

```typescript
import { Publisher, registerEventsDriver } from '@geekmidas/events';
import { pgbossEventsDriver } from '@geekmidas/events/pgboss';

registerEventsDriver(pgbossEventsDriver);

const publisher = await Publisher.fromConnectionString(process.env.URL!);
```

A scheme whose driver nothing registered throws `UnregisteredEventsScheme`,
carrying the `scheme`, the `subpath` and `driver` to register, and what is
`registered`. A scheme no broker here implements still throws
`UnsupportedEventTransport`.

A driver is an `EventsDriver`: its `scheme`, and the connections, publishers and
subscribers for it. `eventsDriverFor(scheme)` looks one up, and
`registeredEventsSchemes()` lists what is registered.

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
import {
  Publisher,
  registerEventsDriver,
  Subscriber,
} from '@geekmidas/events';
import { rabbitmqEventsDriver } from '@geekmidas/events/rabbitmq';

// Once, where the process starts — see "Registering a Broker".
registerEventsDriver(rabbitmqEventsDriver);

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

#### Push Delivery over HTTP

SNS can deliver to an HTTP(S) endpoint instead of a queue that is polled: it
POSTs each message to the subscribed URL, in the same envelope a Lambda
subscription receives. `/sns` has the three pieces an endpoint needs:

```typescript
import {
  SNSConnection,
  confirmSnsSubscription,
  subscribeHttpEndpoint,
  verifySnsMessage,
} from '@geekmidas/events/sns';

const connection = await SNSConnection.fromConnectionString(
  process.env.USERS_PUBLISHER_CONNECTION_STRING!,
);

// Safe on every start — converges on one confirmed subscription
await subscribeHttpEndpoint(connection, {
  endpoint: 'https://worker.example.com/__gkm/subscribers/onUserCreated',
  events: ['user.created'], // FilterPolicy on the `type` message attribute
  deadLetterQueueArn: 'arn:aws:sqs:us-east-1:123456789:users-dlq', // optional
});

// In the route: throws unless SNS signed it
await verifySnsMessage(message);
if (message.Type === 'SubscriptionConfirmation') {
  await confirmSnsSubscription(message);
}
```

- `subscribeHttpEndpoint` subscribes with a filter policy on the `type`
  attribute `SNSPublisher` sets, so each endpoint gets only the events it names.
  Run again, it converges: a confirmed subscription has its filter (and
  dead-letter queue) brought up to date, and one stuck pending confirmation is
  dropped and subscribed afresh. SNS retries an endpoint for a limited time and
  then drops the message; `deadLetterQueueArn` keeps what it gives up on.
- `verifySnsMessage` checks the signature against a certificate that must be
  served over https from `sns.<region>.amazonaws.com` — anywhere else is a
  certificate the sender chose. It throws rather than returning `false`.
- `confirmSnsSubscription` visits the `SubscribeURL`; until then SNS delivers
  nothing.

`gkm dev` and server builds wire all of this for each topic subscriber — see
[Dev Server](#dev-server).

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

#### Topic Fan-out

pg-boss has one address for every topic and queue, so it is told when a
publisher is a topic and who a subscriber is. Without that, a message goes to
the queue named by its type — a work queue, shared among whoever drains it.

```typescript
const publisher = await Publisher.fromConnectionString<AppEvents>(url, {
  topic: 'Users',
});

const connection = await EventConnectionFactory.fromConnectionString(url);
const subscriber = await Subscriber.fromConnection<AppEvents>(connection, {
  topic: 'Users',
  subscription: 'onUserCreated',
});
```

A topic's message is published as the pg-boss event `<topic>/<type>`
(`Users/user.created`). Each subscriber drains a queue of its own,
`<topic>/<subscription>`, bound to the events it names — so every subscriber
sees every message, and replicas of one subscriber share its queue and compete.
A `topic` without a `subscription` throws `PgBossSubscriptionNeedsName`. A
`Topic` construct's publisher is created with `{ topic }`, and the generated
runtime names each subscriber by its export name; queues stay work queues named
by the queue.

#### Dev Server Integration

`gkm dev` automatically starts pg-boss subscribers and queue consumers, each
through the `<ID>_PUBLISHER_CONNECTION_STRING` of the topic or queue it
consumes — no manual configuration needed. See [Dev Server](#dev-server).

## CLI Integration

### Event Backend Setup

When a database is declared, the CLI automatically sets up **pg-boss** as the default event backend — no explicit configuration needed. A dedicated `pgboss` user and schema are created in your PostgreSQL database, and each topic and queue gets its own `<ID>_PUBLISHER_CONNECTION_STRING`, plus `EVENT_PUBLISHER_CONNECTION_STRING` for crons to schedule through.

The backend follows the deploy target — there is nothing to configure. A
project deploying to a server uses pg-boss, in the Postgres its declared
database already brings up; one deploying to AWS uses SNS and SQS, against the
local AWS emulator in development.

| Backend | Infrastructure | Connection String Protocol |
|---------|---------------|---------------------------|
| `pgboss` (default) | Reuses PostgreSQL (dedicated user/schema) | `pgboss://` |
| `sns` | AWS emulator container (floci) | `sns://` / `sqs://` |
| `rabbitmq` | RabbitMQ container | `rabbitmq://` |

The CLI automatically:
- Creates a dedicated `pgboss` PostgreSQL user and schema via an idempotent init script
- Generates `<ID>_PUBLISHER_CONNECTION_STRING` for each topic and queue — read by
  its producers and its consumers alike — and, on pg-boss and RabbitMQ,
  `EVENT_PUBLISHER_CONNECTION_STRING`, the one broker crons schedule through
  (SNS has no single broker address, so it has none)
- For **sns**: adds the AWS emulator container (`LSIA`-prefixed access keys),
  creates each topic and queue on it, and composes the `sns://` / `sqs://`
  strings from its deterministic ARNs and queue URLs with the emulator's
  credential
- For **rabbitmq**: adds a RabbitMQ container with management plugin

## Dev Server

When running `gkm dev`, every topic subscriber and queue consumer is started on
server startup. There is no shared subscriber connection string: each consumer
reaches the thing it consumes through that thing's own
`<ID>_PUBLISHER_CONNECTION_STRING` — a queue's consumer its queue's, a
subscriber its topic's. You can see them with `gkm secrets:show`:

```bash
USERS_PUBLISHER_CONNECTION_STRING=pgboss://pgboss:...@localhost:5432/mydb?schema=pgboss
EMAILS_PUBLISHER_CONNECTION_STRING=pgboss://pgboss:...@localhost:5432/mydb?schema=pgboss
EVENT_PUBLISHER_CONNECTION_STRING=pgboss://pgboss:...@localhost:5432/mydb?schema=pgboss
```

How each consumer is fed:

- **Queues are polled** on every transport, on the queue's own address — SQS
  cannot push.
- **Topic subscribers on pg-boss or RabbitMQ are polled.** On pg-boss each
  drains its own queue, so every subscriber sees every message
  ([Topic Fan-out](#topic-fan-out)).
- **Topic subscribers on SNS are pushed to**, not polled. The server mounts
  `POST /__gkm/subscribers/<exportName>` per subscriber and, once listening,
  subscribes it to the topic with a filter policy on the `type` attribute from
  `.subscribe([...])` — SNS does the fan-out, one subscription per subscriber.
  The route runs the notification through the same parsing and handler a
  Lambda subscription uses, minus middy (`SnsPushSubscriberAdaptor` from
  `@geekmidas/constructs/subscribers`). Confirmations are confirmed automatically and
  signatures verified, except against an emulator, which signs nothing —
  decided by the `endpoint` in the connection string. Startup converges, so a
  stale pending subscription is replaced and a changed event list updates the
  filter.

`GKM_SUBSCRIBER_PUSH_URL` is the public base URL SNS pushes to; against the
local emulator it defaults to `http://host.docker.internal:<port>`.
`gkm dev --no-subscribers` runs no topic subscribers (queues still run).

::: tip
On Lambda nothing changes: SNS invokes each subscriber's function, and a queue
is consumed through its SQS event source. For pg-boss and RabbitMQ, the polling
runtime is also suitable for production via `gkm build --provider server`.
Tests (`gkm test`, `featureTest`) record publishes rather than deliver them.
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
The generated entry registers the target's broker before any of that runs.

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

Binding is not depending: the subscriber's handler is never handed the topic's
publisher — the runtime that feeds it reaches the topic through
`USERS_PUBLISHER_CONNECTION_STRING`. One that publishes follow-up events
depends on the topic it publishes to, `.dependsOn([notifications])`.

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
4. Subscriber receives events, through its topic's own string:
   - Server (dev or prod), SNS: pushed to POST /__gkm/subscribers/<name>
   - Server, pg-boss/RabbitMQ: polled (pg-boss: one queue per subscriber)
   - Lambda: SNS invokes the function
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
   to what depends on it and to the server that runs its consumers
3. Injects them into your environment during `gkm dev` and `gkm exec`

On an AWS target the CLI uses SNS and SQS instead — it adds the AWS emulator
container locally, creates each topic and queue on it, and composes `sns://`
and `sqs://` strings from the emulator's deterministic ARNs and queue URLs.

The publisher picks its transport from the protocol, so the same code works
across all backends — only the connection string changes.
