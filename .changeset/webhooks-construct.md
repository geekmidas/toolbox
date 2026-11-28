---
'@geekmidas/constructs': minor
'@geekmidas/manifest': minor
'@geekmidas/cli': minor
---

A `Webhooks` construct stores who receives a service's events

`api.webhooks('BillingHooks', { topic, events, database, encryption })` is a
construct owned by the API it was built from. It keeps subscriptions in a
tenant of the app's database — tables written by `gkm migration BillingHooks`
as a committed migration — with each signing secret encrypted by the given
`Encryption` key.

`.dependsOn([billingHooks])` gives a handler `services.billingHooks`:
`subscribe` (the secret is returned once), `list`, `get`, `disable`, `enable`,
`remove` and `rotateSecret`, whose old secret keeps signing for a day. The
runnable also gets edges to the tenant and the key, so a deploy grants exactly
those: a construct can now list what it `reaches`, and `.dependsOn()` follows
it.

A subscription's URL has to be public HTTPS on a deployed stage —
`WebhookUrlNotDeliverable` otherwise. The manifest has a `webhooks` kind, which
provisions nothing of its own.

The old `api.webhooks(topic, …)`, which only documented events, is deprecated.
