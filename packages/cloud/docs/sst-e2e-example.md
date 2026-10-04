# End-to-end example: application → build → infrastructure

> Status: **built, not yet proven on a live stack.** The constructs, the
> manifest, the `Queue`/`Topic` components and `fromManifest` exist and are
> unit-tested; SNS subscriptions for topic subscribers are still outstanding
> (§5). Companion to [`sst-constructs.md`](./sst-constructs.md).

## Scenario

An orders service:

- `POST /orders` (an **endpoint**) validates input, writes to the DB, **sends a
  job to the `Fulfilment` queue**, and **publishes `order.created` to the
  `Orders` topic**.
- The queue's **one consumer** drains `Fulfilment` and fulfils each order.
- A **topic subscriber** reacts to `order.created` to send a notification (one
  of any number of fan-out subscribers).

Two distinct messaging resources: a **queue** (`Fulfilment`) and a **topic**
(`Orders`). That's what surfaces the multi-connection-string question.

## 1. Application (`@geekmidas/constructs`)

```ts
// constructs/topics.ts — the topic: an event contract, and its publisher
import { Topic } from '@geekmidas/constructs/topic';
import { z } from 'zod';

export const orders = new Topic('Orders', {
  events: {
    'order.created': z.object({ orderId: z.string() }),
  },
});
```

```ts
// constructs/worker.ts — the process with no port
import { Worker } from '@geekmidas/constructs/worker';

export const worker = new Worker('Jobs', { logger }).database(database);
```

```ts
// queues/fulfilment.ts — a queue and its single consumer, one construct
export const fulfilment = worker
  .queue('Fulfilment')
  .dependsOn([database])
  .message(z.object({ orderId: z.string() }))
  .handle(async ({ messages, services }) => {
    for (const { orderId } of messages) await fulfil(services.database, orderId);
  });
```

```ts
// subscribers/notify.ts — bound to the topic, granted nothing on it
export const notify = worker
  .topic(orders)
  .subscribe(['order.created'])
  .handle(async ({ events }) => { /* send notification */ });
```

```ts
// endpoints/createOrder.ts — the caller; connects to BOTH resources
export const createOrder = api
  .database(database)
  .post('/orders')
  .dependsOn([fulfilment])          // queue producer → FULFILMENT_PUBLISHER_CONNECTION_STRING
  .body(z.object({ sku: z.string() }))
  .output(z.object({ id: z.string() }))
  .event(orders, {                  // topic producer → ORDERS_PUBLISHER_CONNECTION_STRING
    type: 'order.created',
    payload: (order) => ({ orderId: order.id }),
  })
  .handle(async ({ body, db, services }) => {
    const order = await insertOrder(db, body);
    await services.fulfilment.publish([
      { type: 'Fulfilment', payload: { orderId: order.id } },
    ]);
    return order;
  });
```

The handler is **transport-agnostic** — it calls `publish`, and `.event()`
publishes after it returns. Which transport runs is decided by the connection
string at runtime (§4). `.event(orders, …)` also puts `services.orders` in the
handler, as `.dependsOn([orders])` would, for an event the handler decides on.

## 2. What `gkm build` emits (manifest)

A **single TypeScript module** at the workspace root — `.gkm/manifest/aws.ts`,
written once by the root `gkm build`, its handler paths relative to the root,
where `sst.config.ts` runs — whose `constructs` export is every declaration
keyed by id. Each `RestApi` carries its endpoints; each queue nests its one
consumer; each topic lists the subscribers bound to it:

```ts
// .gkm/manifest/aws.ts  (generated, abridged)
export const constructs = {
  Fulfilment: {
    kind: 'queue',
    id: 'Fulfilment',
    provides: ['FULFILMENT_PUBLISHER_CONNECTION_STRING'],
    worker: {
      id: 'FulfilmentWorker',
      handler: 'apps/api/.gkm/aws/queues/fulfilment.handler',
      dependencies: [{ target: 'Database', kind: 'database' }],
    },
  },
  Orders: {
    kind: 'topic',
    id: 'Orders',
    provides: ['ORDERS_PUBLISHER_CONNECTION_STRING'],
    events: ['order.created'],
    subscribers: [
      {
        id: 'notify',
        handler: 'apps/api/.gkm/aws/subscribers/notify.handler',
        events: ['order.created'],
        dependencies: [],
      },
    ],
  },
  Api: {
    kind: 'rest-api',
    id: 'Api',
    path: 'apps/api',
    endpoints: [
      {
        id: 'ApiPOST/orders',
        method: 'POST',
        path: '/orders',
        handler: 'apps/api/.gkm/aws/routes/createOrder.handler',
        dependencies: [
          { target: 'Fulfilment', kind: 'queue' },
          { target: 'Orders', kind: 'topic' },
        ],
      },
    ],
  },
} as const satisfies ConstructManifest;
```

The endpoint's required env (`FULFILMENT_PUBLISHER_CONNECTION_STRING`,
`ORDERS_PUBLISHER_CONNECTION_STRING`) is captured **because it named both** —
`.dependsOn([fulfilment])` and `.event(orders, …)` are edges, and each
construct's `service` reads its own connection string. That is what drives the
links in infra.

## 3. Infrastructure (`sst.config.ts`)

```ts
const { App, fromManifest, Stack } = await import('@geekmidas/cloud/sst');
const { backends, constructs } = await import('./.gkm/manifest/aws.js');

const vpc = new sst.aws.Vpc('Vpc', { nat: 'ec2' });
const app = new App({ name: 'shop', stage: $app.stage, domain: 'example.com', hostedZoneId, region: 'us-east-1' });
const stack = new Stack(app, 'Orders');

return fromManifest(stack, constructs, { Database: { vpc } }, backends);
```

No queue, topic, link or IAM is written here. `fromManifest`:

- provisions `Fulfilment` as a `Queue` and `Orders` as a `Topic`;
- once everything exists, subscribes each queue's one consumer with
  `queue.consume({ handler, link })` — the handler the build wrote, linked to
  what the consumer declared (`Database`); the queue itself is always linked.
  `Queue.consume` also takes `timeout` and `batchSize`;
- mounts `POST /orders` on the `Api` as its own Lambda, linked only to what
  the endpoint depends on (`Fulfilment`, `Orders`);
- skips `worker` (`PROVISIONED_ELSEWHERE`): a worker is a process, not a
  resource. Any function or cron would be built as its own Lambda, once
  everything it links to exists.

## 4. Resolving connection strings with multiple resources

This is the answer to "multiple topics/queues → multiple connection strings."

Each messaging component's `provides()` emits a **name-namespaced** connection
string:

| Resource | Component | env var produced |
| --- | --- | --- |
| `Fulfilment` | `Queue` | `FULFILMENT_PUBLISHER_CONNECTION_STRING` = `sqs://?queueUrl=…&region=…` |
| `Orders` | `Topic` (SnsTopic) | `ORDERS_PUBLISHER_CONNECTION_STRING` = `sns://?topicArn=…&region=…` |

So linking **both** to the `POST /orders` Lambda yields **both** env vars — no
collision, because each is keyed by the resource id.

Each construct's **publisher knows its own key**, so it reads its own var:

```ts
// fulfilment.service  ≈  Publisher.fromConnectionString(get('FULFILMENT_PUBLISHER_CONNECTION_STRING'))
// orders.service      ≈  Publisher.fromConnectionString(get('ORDERS_PUBLISHER_CONNECTION_STRING'))
```

Least-privilege linking ties it together: because `createOrder` named both,
its environment requires both connection strings, so infra links the route to
**exactly** the queue and the topic (and the database) — granting send
permission and resolving those two strings, nothing more. The subscriber is
*bound* to the topic rather than depending on it, so it is never given the
topic's string and cannot publish.

### Local vs deployed (same code)

The protocol in each connection string selects the transport (see
[`sst-constructs.md`](./sst-constructs.md) §14 and the events registry):

| | `FULFILMENT_PUBLISHER_CONNECTION_STRING` | transport |
| --- | --- | --- |
| **`gkm dev`** | `pgboss://…` (or the AWS emulator's `sqs://…localhost:4566…`) | Postgres / emulator |
| **deployed** | `sqs://?queueUrl=https://sqs…/shop-orders-fulfilment` | real SQS |

`gkm dev` injects the local strings (per the deploy target's broker); the
`Queue`/`Topic` link injects the deployed strings. The handler and its
`publish(...)` calls are identical.

## 5. What is still outstanding

- **SNS subscriptions for topic subscribers.** The binding is in the manifest
  (`Orders.subscribers`), but `fromManifest` does not yet turn it into a
  subscription.
- **A stack that has come up.** The decisions are unit-tested as pure
  functions; a deploy has not been run end to end.
