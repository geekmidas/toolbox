---
'@geekmidas/constructs': minor
'@geekmidas/manifest': minor
'@geekmidas/cli': minor
---

feat(topic): add the `t` topic construct + derived publisher (closes the topic/queue asymmetry)

Topics now have the same app-driven story queues already had — declare the topic
in the app, get a typed publisher for free, and let `gkm build` capture it. This
removes the need to hand-write a publisher `Service` (e.g. `EventsService`) to
fan events out.

**`@geekmidas/constructs/topic`** — the `t` builder:

```ts
import { t } from '@geekmidas/constructs/topic';

export const userTopic = t.topic('users').events({
  'user.created': z.object({ userId: z.string(), email: z.string() }),
  'user.updated': z.object({ userId: z.string(), changes: z.array(z.string()) }),
});
```

- A `Topic` is a *resource* construct (`ConstructType.Topic`) — fan-out, owned by
  no single handler. It declares the event contract and derives a publisher.
- **`userTopic.publisher`** — a derived `Service` typed to the union of the topic's
  events, reading `<NAME>_PUBLISHER_CONNECTION_STRING` (transport by protocol:
  `sns://` deployed, `pgboss://` local). Replaces hand-written publisher services.
  Inject via `.publisher(userTopic.publisher)` (declarative `.event(...)`) or
  `.services([userTopic.publisher])`.
- **`s.topic(userTopic)`** — binds a subscriber to a topic: supplies the
  subscribable event types/payloads *and* records the binding for the manifest.
  A consumer doesn't publish, so this requires **no** publisher connection string
  (least privilege) — unlike typing via `.publisher(...)`.

**`@geekmidas/manifest`** — new `TopicInfo` + `manifest.topics`; `SubscriberInfo`
gains `topic` (the bound topic name).

**`@geekmidas/cli`** — `TopicGenerator` discovers `t` topics into `manifest.topics`
(a topic has no handler to generate); new `topics` config glob; wired through
`gkm build`/`gkm dev` and both manifest writers.

Hand-written publisher services still work; `t` is the encouraged path.
