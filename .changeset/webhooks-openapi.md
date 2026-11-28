---
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
---

An API's OpenAPI document lists the webhooks it owns

`api.webhooks('BillingHooks', { topic, … })` records the construct on the API
that built it, and that API's document lists each event it delivers under
`webhooks`: the envelope actually sent (`{ id, type, occurredAt, payload }`,
the payload's schema from the topic), the three Standard Webhooks headers
(`webhook-id`, `webhook-timestamp`, `webhook-signature`), the retry schedule,
and the `2XX` and `410` answers. `.auth()` copies keep the list. An endpoint on
another API that `.dependsOn([billingHooks])` does not make that API's
document list them. Two `Webhooks` delivering the same event type to one
document are refused with `WebhookEventDeclaredTwice`.

The generated client's `webhooks` interface is built from the same owned
constructs, each event typed as the envelope a receiver is sent.

**Removed:** the deprecated `api.webhooks(topic, { signature, events,
description })`, which only documented a topic's events, together with
`WebhookOptions`, `WebhookSignature` and the `Webhook` type. Build the
webhooks from the API instead — `api.webhooks(id, { topic, events, database,
encryption })` — which stores, signs and delivers them as well as documenting
them.
