---
'@geekmidas/events': minor
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
---

:sparkles: Topic subscribers on SNS are pushed to over HTTP; each consumer reaches its own topic or queue; topics fan out on pg-boss (#112)

- **SNS push.** On SNS a topic subscriber is no longer polled. The server mounts `POST /__gkm/subscribers/<name>` and, once listening, subscribes it to the topic with a filter policy of the events the subscriber names, so SNS fans out to each subscriber. Confirmations are handled, signatures verified (skipped only against an emulator), and startup converges: a stuck-pending subscription is replaced and a changed event list updates the filter. The route runs the subscriber through the same adaptor as Lambda. `GKM_SUBSCRIBER_PUSH_URL` is where SNS pushes; locally it defaults to `host.docker.internal`.
- **`@geekmidas/events/sns`**: `verifySnsMessage`, `confirmSnsSubscription`, `subscribeHttpEndpoint`, `toSnsEvent`. **`@geekmidas/constructs/aws`**: `SnsPushSubscriberAdaptor`.
- **Each consumer reaches what it consumes**, through that topic's or queue's own `<ID>_PUBLISHER_CONNECTION_STRING`. `EVENT_SUBSCRIBER_CONNECTION_STRING` is deleted: it was built from the first queue or topic in the plan, so every other consumer polled the wrong place. Crons schedule through `EVENT_PUBLISHER_CONNECTION_STRING`.
- **pg-boss fans out.** A topic's message is published as `<topic>/<type>` and each subscriber drains a queue of its own, so every subscriber sees every message; replicas of one subscriber share it. Subscribers used to compete for one queue per event type, and two topics with an event of the same name shared it. `Publisher.fromConnectionString(url, { topic })`, `Subscriber.fromConnection(connection, { topic, subscription })`.
- **Local SNS works.** On an AWS target `gkm dev` creates each topic and queue on the floci emulator and composes their addresses, instead of throwing `UnprovisionedEventsBackend`. The emulator's healthcheck no longer calls `curl`, which the image does not ship.
- **`gkm dev --no-subscribers`** runs no topic subscribers. Fan-out is the default.
- A queue consumer that fails now leaves its message for a retry instead of acknowledging it.
