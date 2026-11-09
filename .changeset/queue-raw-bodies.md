---
'@geekmidas/constructs': minor
---

Queues fed by something other than their publisher can take bodies as they come

`q(...).envelope(false)` marks a queue whose messages are not the `{ type, payload }` envelope its publisher writes: an IoT rule, a webhook forwarder, any sender outside gkm. `AWSLambdaQueue` then takes each record's body as the message, parsed when it is JSON and as a string when it is not, and never unwraps it.

Before, every body with a top-level `payload` field was unwrapped, so a message that had a `payload` field of its own reached the handler as just that field:

```ts
// An MBS relay message, as an IoT rule writes it to the queue
{ "relayId": "relay-1", "csvFileName": "…_vitals.csv", "payload": "1664450907670,,,36.0,…" }
```

```ts
export const relayQueue = q
  .queue('processRelayVitals')
  .envelope(false)
  .message(RelayMessageSchema)
  .handle(async ({ records }) => { … });
```

The default stays `true`, so existing queues are unchanged.
