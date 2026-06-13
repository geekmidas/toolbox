---
'@geekmidas/manifest': minor
'@geekmidas/cloud': minor
'@geekmidas/cli': patch
'@geekmidas/events': patch
---

refactor(manifest): model the unified `gkm build` manifest and add `QueueInfo`

`gkm build` emits a single TypeScript module per provider
(`export const manifest = { routes, functions, crons, subscribers } as const`),
not separate JSON files. `@geekmidas/manifest` now models that:

- a unified `Manifest` type plus `ManifestField<T>` (a field is a flat
  `readonly T[]` or a partitioned `Record<string, readonly T[]>`) and a
  `flattenManifestField` helper;
- the item types (`RouteInfo`/`FunctionInfo`/`CronInfo`/`SubscriberInfo`) gain a
  new `QueueInfo`, `SubscriberInfo.transport`, and readonly array fields so the
  `as const` manifest assigns cleanly;
- the per-unit `*Manifest` wrapper types are removed.

`@geekmidas/cloud/sst`'s `Api`/`Function`/`Cron` `fromManifest` now take the
manifest **field** (`Api.fromManifest(stack, id, manifest.routes, …)`) and
flatten the flat-or-partitioned shape. `@geekmidas/cli` re-exports the updated
types.

Also fixes `@geekmidas/events` to externalise `pg-boss` (it was the one
transport dep being bundled).
