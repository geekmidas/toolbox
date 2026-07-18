# End-to-end example: application → build → infrastructure

> Status: **blueprint.** It shows the intended full loop and resolves how
> connection strings work with multiple queues/topics. The `q` builder, the
> `Queue`/`Topic` linkables, and their resolvers are **not built yet** — this is
> the spec for that work. Companion to [`sst-constructs.md`](./sst-constructs.md).

## Scenario

An orders service:

- `POST /orders` (an **endpoint**) validates input, writes to the DB, **sends a
  job to the `orders` queue**, and **emits an `order.created` event to the
  `events` topic**.
- A **queue worker** drains `orders` and fulfils each order (one consumer).
- A **topic subscriber** reacts to `order.created` to send a notification (one
  of many possible fan-out subscribers).

Two distinct messaging resources: a **queue** (`orders`) and a **topic**
(`events`). That's what surfaces the multi-connection-string question.

## 1. Application (`@geekmidas/constructs`)

```ts
// app/events/orders.ts — a queue + its single consumer (q builder)
import { q } from '@geekmidas/constructs/queue';
import { z } from 'zod';
import { databaseService } from '../services';

export const orders = q
  .queue('orders')
  .services([databaseService])               // array, per the services API
  .message(z.object({ orderId: z.string() }))
  .handle(async ({ messages, services }) => {
    for (const { orderId } of messages) await services.database.fulfil(orderId);
  });
```

```ts
// app/events/topic.ts — the event bus publisher + a subscriber (s builder)
import { publisher } from '@geekmidas/constructs/events';
import { s } from '@geekmidas/constructs/subscribers';
import { z } from 'zod';

export const events = publisher('events', {
  'order.created': z.object({ orderId: z.string() }),
});

export const notify = s
  .publisher(events)
  .subscribe('order.created')
  .handle(async ({ events }) => { /* send notification */ });
```

```ts
// app/endpoints/createOrder.ts — the caller; connects to BOTH resources
import { e } from '@geekmidas/constructs/endpoints';
import { databaseService } from '../services';
import { orders } from '../events/orders';
import { events } from '../events/topic';

export default e
  .services([databaseService])
  .publisher(orders.publisher)   // queue producer  → ORDERS_PUBLISHER_CONNECTION_STRING
  .publisher(events.publisher)   // topic producer  → EVENTS_PUBLISHER_CONNECTION_STRING
  .post('/orders')
  .body(z.object({ sku: z.string() }))
  .handle(async ({ body, services, publishers }) => {
    const order = await services.database.createOrder(body);
    await publishers.orders.publish([{ orderId: order.id }]);
    await publishers.events.publish([{ type: 'order.created', payload: { orderId: order.id } }]);
    return order;
  });
```

The handler is **transport-agnostic** — it just calls `publish`. Which transport
runs is decided by the connection string at runtime (next section).

## 2. What `gkm build` emits (manifest)

A **single TypeScript module** per provider — `<out>/manifest/aws.ts` —
`export const manifest = { … } as const`, with derived types. A queue is a new
`queues` field on that object:

```ts
// .gkm/manifest/aws.ts  (generated)
export const manifest = {
  routes: [
    { method: 'POST', path: '/orders', handler: 'createOrder.handler',
      environment: ['ORDERS_PUBLISHER_CONNECTION_STRING',
                    'EVENTS_PUBLISHER_CONNECTION_STRING'],
      authorizer: 'none' },
  ],
  queues: [                                   // new — from the q builder
    { name: 'orders', handler: 'orders.handler', environment: [] },
  ],
  subscribers: [                              // topic subscribers, from s
    { name: 'notify', handler: 'notify.handler',
      subscribedEvents: ['order.created'], transport: 'topic' },
  ],
} as const;

export type Route = (typeof manifest.routes)[number];
export type Queue = (typeof manifest.queues)[number];
// …derived Subscriber/etc.
```

(Item shapes — `RouteInfo`/`QueueInfo`/… — and the `Manifest`/`ManifestField`
types live in `@geekmidas/manifest`. A field can be a flat array or a
partitioned `Record<string, …[]>`.)

The endpoint's required env (`ORDERS_PUBLISHER_CONNECTION_STRING`,
`EVENTS_PUBLISHER_CONNECTION_STRING`) is captured **because it declared
`.publisher(orders.publisher)` / `.publisher(events.publisher)`** — the publisher
each needs that connection string env var. This is what drives the links in
infra.

## 3. Infrastructure (`sst.config.ts`)

```ts
import { App, Api, Database, Queue, QueueSubscriber, Topic, Subscriber } from '@geekmidas/cloud/sst';
import { manifest } from './.gkm/manifest/aws';

const { zoneId } = await aws.route53.getZone({ name: 'example.com' });
const app = new App({ name: 'shop', stage: 'prod', domain: 'example.com', hostedZoneId: zoneId, region: 'us-east-1' });
const stack = app.stack('orders');

const db      = new Database(stack, 'main');
const ordersQ = new Queue(stack, 'orders');   // SQS + DLQ, linkable
const eventsT = new Topic(stack, 'events');    // SNS, linkable

// Queue worker (one consumer) — SQS event source
QueueSubscriber.fromManifest(stack, manifest.queues, { queue: ordersQ, links: [db] });

// Topic subscribers (fan-out)
Subscriber.fromManifest(stack, manifest.subscribers, { topic: eventsT, links: [db] });

// The API — its routes are linked to the resources they publish to
Api.fromManifest(stack, 'Api', manifest.routes, { links: [db, ordersQ, eventsT] });
```

Each integrator takes the relevant **field** (`manifest.routes`,
`manifest.queues`, …) — flat or partitioned.

## 4. Resolving connection strings with multiple resources

This is the answer to "multiple topics/queues → multiple connection strings."

Each messaging linkable's resolver (in `@geekmidas/envkit/sst`) emits a
**name-namespaced** connection string:

| Resource (`_id`) | `_type` | env var produced |
| --- | --- | --- |
| `orders` | `Queue` | `ORDERS_PUBLISHER_CONNECTION_STRING` = `sqs://?queueUrl=…&region=…` |
| `events` | `Topic` (SnsTopic) | `EVENTS_PUBLISHER_CONNECTION_STRING` = `sns://?topicArn=…&region=…` |

So linking **both** to the `POST /orders` Lambda yields **both** env vars — no
collision, because each is keyed by the resource name (`environmentCase(_id)`).

The **auto-publisher knows its own name**, so it reads its own var:

```ts
// orders.publisher  ≈  Publisher.fromConnectionString(get('ORDERS_PUBLISHER_CONNECTION_STRING'))
// events.publisher  ≈  Publisher.fromConnectionString(get('EVENTS_PUBLISHER_CONNECTION_STRING'))
```

Least-privilege linking ties it together: because `createOrder` declared both
publishers, validation requires both connection-string vars, so infra links the
route to **exactly** `ordersQ` and `eventsT` (and `db`) — granting send
permission and resolving those two strings, nothing more.

### Local vs deployed (same code)

The protocol in each connection string selects the transport (see
[`sst-constructs.md`](./sst-constructs.md) §14 and the events registry):

| | `ORDERS_PUBLISHER_CONNECTION_STRING` | transport |
| --- | --- | --- |
| **`gkm dev`** | `pgboss://…?queue=orders` (or localstack `sqs://…localhost:4566…`) | Postgres / localstack |
| **deployed** | `sqs://?queueUrl=https://sqs…/shop-orders-orders` | real SQS |

`gkm dev` injects the local strings (per the configured backend + docker
compose); the `Queue`/`Topic` link injects the deployed strings. The handler and
`publish(...)` calls are identical.

## 5. What this requires building

1. `Queue` + `Topic` `ResourceType`s + resolvers in `@geekmidas/envkit/sst`
   emitting `<NAME>_PUBLISHER_CONNECTION_STRING` (and `…_SUBSCRIBER_…` where
   relevant).
2. `Queue` / `Topic` linkable constructs in `@geekmidas/cloud/sst`.
3. The `q` `QueueBuilder` + auto-`publisher` in `@geekmidas/constructs/queue`,
   and the auto-`publisher` on the `events` publisher.
4. `QueueInfo`/`QueuesManifest` in `@geekmidas/manifest` + `gkm build` discovery
   of `q` definitions and the `transport` field on `SubscriberInfo`.
5. `QueueSubscriber` (SQS event source) + `Subscriber`/`TopicSubscriber` (SNS) in
   `@geekmidas/cloud/sst`, with `fromManifest`.
6. `gkm dev` / secrets emitting per-resource connection strings locally.
