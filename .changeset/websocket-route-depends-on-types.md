---
'@geekmidas/constructs': patch
---

A `WebSocketApi` route's `.dependsOn()` types its handler's `services`

`.dependsOn([database])` on `connect()`, `disconnect()` or `route()` typed
`services` as empty, so `services.database` was a type error even though the
service was there at runtime. The constructs are inferred as a readonly tuple,
and the route builder only kept their services when that tuple extended the
mutable `Service[]`, which it never does. It now appends them as an endpoint's
`.dependsOn()` does, and repeated calls accumulate.
