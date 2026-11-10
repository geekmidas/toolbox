---
'@geekmidas/constructs': minor
---

Queues fed by something other than their publisher can take bodies as they come

`q(...).envelope(false)` marks a queue whose messages are not the `{ type, payload }` envelope its publisher writes: an IoT rule, a webhook forwarder, any sender outside gkm. `AWSLambdaQueue` then takes each record's body as the message, parsed when it is JSON and as a string when it is not, and never unwraps it.

Before, every body with a top-level `payload` field was unwrapped, so a message that had a `payload` field of its own reached the handler as just that field:

```ts
// A device message, as an IoT rule forwards it to the queue
{ "deviceId": "device-1", "topic": "devices/device-1/telemetry", "payload": "temperature=21.5" }
```

```ts
export const deviceQueue = q
  .queue('processDeviceMessages')
  .envelope(false)
  .message(DeviceMessageSchema)
  .handle(async ({ records }) => { … });
```

The default stays `true`, so existing queues are unchanged.
