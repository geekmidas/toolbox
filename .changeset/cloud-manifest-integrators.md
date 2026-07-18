---
'@geekmidas/manifest': minor
'@geekmidas/cloud': minor
'@geekmidas/cli': patch
---

feat(cloud): add `fromManifest` integrators backed by a shared `@geekmidas/manifest` package

Introduces `@geekmidas/manifest` — a dependency-free package holding the
deployment manifest types (`RouteInfo`/`FunctionInfo`/`CronInfo`/`SubscriberInfo`
and their `*Manifest` containers) that `gkm build` emits. `@geekmidas/cli`
re-exports these from the shared package (no behaviour change), so producer and
consumers share one contract.

`@geekmidas/cloud/sst` constructs gain static `fromManifest` factories that map
a manifest straight into infrastructure:

- `Api.fromManifest(stack, id, routesManifest, props)` — one route per
  `RouteInfo` (env vars, authorizer, timeout/memory mapped); supply
  `authorizers`/`links`/native args via `props`.
- `Function.fromManifest(stack, functionsManifest, props)` — one `Function` per
  entry.
- `Cron.fromManifest(stack, cronsManifest, { links, ... })` — one `Cron` per
  entry; each handler becomes a validated `Function` the cron triggers.

`Api` routes also gain per-route `timeout`/`memory` passthrough.
