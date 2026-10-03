---
'@geekmidas/constructs': minor
'@geekmidas/cli': patch
'@geekmidas/cloud': minor
'@geekmidas/manifest': patch
---

:boom: Queues and topics are constructs, and events name their topic (#110)

- A queue is built from a worker, `worker.queue('Emails').message(schema).handle(…)`: the queue and its one consumer, one construct. `q` and the public `QueueBuilder` export are gone. A producer depends on it, `.dependsOn([emails])`, and sends through `services.emails`.
- A topic is `new Topic('Users', { events })`. `t` and `TopicBuilder` are gone.
- `.publisher(service)` is gone everywhere: from `RestApi`, endpoint, function, cron and subscriber builders, and `Worker`. A construct publishes with `.event(users, { type, payload, when? })`, repeatable across topics; each event goes through its own topic's publisher, and the topic lands in `services` exactly as `.dependsOn([users])` would put it. `Topic.publisher`, `Queue.publisher`, `derivedFrom` and `edgesWith` are deleted.
- `TestEndpointAdaptor` / `TestFunctionAdaptor` / the MSW adaptor lose their `publisher` option: pass a recorder under the topic's name in `services`.
- Discovery records what a worker-owned queue's consumer depends on under the worker.
- SST: `fromManifest` subscribes each queue's consumer Lambda (`Queue.consume`), and skips `worker`, `cron` and `function` declarations instead of throwing `UnknownDeclarationKind`.
