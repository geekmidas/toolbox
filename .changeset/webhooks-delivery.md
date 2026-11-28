---
'@geekmidas/constructs': minor
'@geekmidas/client': minor
---

Webhooks are delivered, signed, retried and recorded

`worker.webhooks(billingHooks)` returns `{ deliver, sweep }`, exported as
`export const { deliver: deliverBilling, sweep: retryBilling } = …`. `deliver`
subscribes to the construct's topic and, in one transaction, writes a pending
delivery for each active subscription that wants the event, then attempts it.
`sweep` is a cron (`rate(1 minute)` unless given) that claims due deliveries
`FOR UPDATE SKIP LOCKED` and tries them again: at once, then 1m, 5m, 30m, 2h,
5h, 10h and 10h, after which a delivery is abandoned.

Requests are signed per Standard Webhooks (`webhook-id`, `webhook-timestamp`,
`webhook-signature`, both secrets during a rotation) with a
`{ id, type, occurredAt, payload }` body. The default transport refuses
private and reserved addresses as it connects, follows no redirect, times out
after 10 s and reads 64 KiB at most. A 2xx delivers, a 410 disables the
subscription, and five abandoned deliveries in a row (`disableAfter`) disable
it too. Every attempt is recorded. `services.<hooks>.deliveries()` lists them
and `redeliver(id)` sends one again under the same id.

The construct publishes its lifecycle on a topic it owns, `hooks.events`:
`delivery.succeeded`, `delivery.failed`, `delivery.abandoned`,
`subscription.disabled` and `secret.rotated`. The delivered event types moved
from `hooks.events` to `hooks.eventTypes`. Time comes from `hooks.clock` and
requests go through `hooks.transport`, both swappable in tests. `deliverEvent`
and `sweepDue` are exported from `@geekmidas/constructs/webhooks`.

`verifyWebhook(secret, request)` from `@geekmidas/client/webhooks` checks a
delivery with WebCrypto and returns its typed event.
