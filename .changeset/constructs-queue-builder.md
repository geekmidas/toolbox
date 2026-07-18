---
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
---

feat: queue workers (`q`) — producer, runtime adaptors, and `gkm` discovery

Adds end-to-end support for point-to-point queues, alongside subscribers (`s`):

**`@geekmidas/constructs/queue`** — the `q` builder:

```ts
import { q } from '@geekmidas/constructs/queue';

export const orders = q
  .queue('orders')
  .services([db])              // array; sniffed for required env vars
  .message(z.object({ orderId: z.string() }))
  .handle(async ({ messages, services }) => { … }); // the single consumer
```

Unlike `s` (topic fan-out, filtered by `subscribedEvents`), a queue drains
*every* message of its one typed `message`.

- **Producer side** — `orders.publisher`, a ready-to-inject `Service` typed to
  the queue's message. Drop it into any `.services([...])` and call
  `services.ordersPublisher.publish([{ type: 'orders', payload }])`. It reads
  `<NAME>_PUBLISHER_CONNECTION_STRING` and picks its transport from the URL
  protocol — `pgboss://` locally, `sqs://` deployed — so the same code targets
  Postgres in dev and SQS in prod. The env requirement is sniffed into the
  manifest, so infra links exactly that queue with least privilege.
- **Runtime adaptors** — `AWSLambdaQueue` (`@geekmidas/constructs/aws`, SQS
  event-source with partial-batch failures) and `TestQueueAdaptor`
  (`@geekmidas/constructs/testing`).

**`@geekmidas/cli`** — `gkm build`/`gkm dev` discover `q` definitions:

- New `queues: './src/queues/**/*.ts'` config glob.
- Server / `gkm dev`: an in-process pg-boss poller (`setupQueues()`) runs
  alongside the Hono server — each queue subscribes by its name on the shared
  `EVENT_SUBSCRIBER_CONNECTION_STRING`. Queues are background workers, not HTTP
  routes.
- AWS: one `AWSLambdaQueue` handler per queue.
- Queues are recorded in the manifest's `queues` field (`QueueInfo`).
