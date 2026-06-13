---
'@geekmidas/constructs': minor
---

feat(constructs): add the `q` queue builder (`@geekmidas/constructs/queue`)

Adds a `QueueBuilder` exported as `q`, alongside `e`/`s`/`f`/`c`, for defining a
point-to-point queue worker — a queue and its single consumer:

```ts
import { q } from '@geekmidas/constructs/queue';

export const orders = q
  .queue('orders')
  .services([databaseService])           // array; sniffed for required env vars
  .message(z.object({ orderId: z.string() }))
  .handle(async ({ messages, services }) => { … }); // the one consumer
```

A `Queue` is a `Construct` (`ConstructType.Queue`) that `gkm build` will discover
into the manifest's `queues` field. Unlike `s` (topic fan-out, filtered by
`subscribedEvents`), a queue drains every message of its one typed `message`.

The producer-side auto-`publisher` (a `Service` reading the queue's
`<NAME>_PUBLISHER_CONNECTION_STRING`) and `gkm build` discovery land next.
