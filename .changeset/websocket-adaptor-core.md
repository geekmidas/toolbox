---
'@geekmidas/constructs': minor
---

WebSocketApi: one transport-agnostic core, served by the Node adaptor

A `WebSocketApi`'s route dispatch, connect/disconnect handling and service
injection now live in a `WebSocketCore` with no socket in it.
`realtime.core({ envParser, sink, modules })` returns it, and a runtime calls
`connect({ connectionId, headers, query, session? })`,
`message(connection, raw, write)` and `disconnect(connection, { code, reason })`
on it. Each returns an outcome (accepted or refused with a status; the reply
or the `$error` and what was thrown) rather than writing to a socket itself.
Each also takes `{ services }` to hand in what it would otherwise register.

`WebSocketSurfaceServer`, what `realtime.server()` runs, is now the Node
adaptor over the core. It keeps the upgrade, the Origin check, connection ids,
the heartbeat and backpressure, and behaves as before.

The publisher sends through a `WebSocketSink` (`send`, `broadcast`, `close` of
encoded frames) instead of a transport. `TransportSink` is the one over
Redis/memory that `services.<surface>` and the Node adaptor use, so an API
Gateway sink (`postToConnection`) or a recording one for tests can sit in the
same place.

**Migrating:** `DuplicateWebSocketRoute` is thrown by the core; it is still
exported from `@geekmidas/constructs/websocket-api`.
`WebSocketServerOptions` takes `core: (sink) => WebSocketCore` in place of
`surface`, `routes`, `messages`, `frame`, `envParser`, `logger` and
`authenticator`. `new WebSocketPublisher(sink, declared, frame)` takes a sink
where it took a transport and a local deliverer.
