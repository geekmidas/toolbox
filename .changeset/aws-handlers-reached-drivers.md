---
'@geekmidas/cli': patch
---

An AWS handler registers only the drivers its construct reaches

`gkm build --provider aws` writes one Lambda per endpoint, cron, queue,
subscriber, function and processor, and every one of them registered the same
drivers: S3, the cache, the broker and the API Gateway WebSocket sink — the
app's whole set. So a cron that published nothing and pushed to no socket still
imported `pg-boss` and `@geekmidas/constructs/aws-websocket`, which brought
`electrodb` and `@aws-sdk/client-dynamodb` with it. Every bundle was larger than
its construct needed, and an older esbuild could not bundle one at all: it
fails on the `with { type: 'json' }` import attributes in pg-boss's `dist`.

The server target already decided its drivers from what each process reaches.
The AWS handlers now do the same, per construct: the reach is the construct's
owner — the surface or worker it was built from — with that owner's own edges,
plus what the construct itself depends on or consumes, as `reachedBy` reads a
process. A surface contributes its own edges and not its routes', since a
Lambda runs one route, not all of them; a processor reaches its file server's
bucket. From that reach:

- **storage** is registered only for a construct that reaches an `objects` or a
  `file-server` (and, as before, only where `@geekmidas/storage` is installed);
- **the cache** only for one that reaches a cache;
- **the broker** only for one that reaches a topic or a queue — not for a
  worker beside a database, the server-side rule for pg-boss scheduling crons,
  because on AWS EventBridge fires a cron;
- **the KMS cipher** and **the WebSocket sink**, as before, only for one that
  reaches an `Encryption` or a `WebSocketApi`.

A construct whose owner is unknown — one built from a free-standing builder, or
whose owner was not discovered — keeps the app's whole set, which is what every
handler registered before. The server target is unchanged.
