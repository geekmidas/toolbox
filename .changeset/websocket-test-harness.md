---
'@geekmidas/constructs': minor
---

A `WebSocketApi` has a test harness: `route.request()`, a recording publisher, and an MSW adaptor

- **`route.request()`** runs a route's handler through the surface's core,
  with no server or socket, as `endpoint.request()` runs an endpoint.
  `connect.request({ connectionId?, headers?, query?, session?, services? })`
  resolves with the connection's `data`, or rejects with the `HttpError` that
  refused it. `say.request({ connection?, body, services? })` checks `body`
  against the route's schema and resolves with the handler's return.
  `fullRequest()` also returns every frame written back. `disconnect.request()`
  rejects with what the handler threw. A refused body rejects with
  `InvalidWebSocketRequest`. Requests are typed by the route: its body
  schema, its `.dependsOn()` services and its handler's return.
- **`surface.testPublisher()`** returns a `TestWebSocketPublisher`, of the
  type `services.<surface>` is. It records `sent`, `broadcasts` and `closed`,
  each send checked by the declared `messages` and carrying the encoded
  `frame`.
- **`featureTest`** hands each test a recorder per surface: `sockets(realtime)`
  reads what its handlers sent. `UnknownWebSocketApi` is thrown for a surface
  the manifest does not declare.
- **`createMswWebSocketHandlers(surface, modules, { url })`** (from
  `@geekmidas/constructs/testing`) serves the real routes behind MSW's
  `ws.link()`. The context travels as `TEST_CONTEXT_PARAM`, a refusal closes
  with `4000 + status`, and `publisher` / `connectionString` reach the
  intercepted sockets over an in-process channel.
- **`surface.publisher(sink)`** is the surface's typed publisher over an
  adaptor's own sink.

A route now carries the surface it was built from (`route.surface` is the
`WebSocketApi`, still with its `id`), and `WebSocketRoute` takes type
parameters for its kind, body schema, services and return. They all default,
so a bare `WebSocketRoute` still means any route.
