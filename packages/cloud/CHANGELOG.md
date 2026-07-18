# @geekmidas/cloud

## 1.1.0

### Minor Changes

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`b42e96b`](https://github.com/geekmidas/toolbox/commit/b42e96b9dd28d8926a1253a97aa553bd0e08bf56) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(cloud): add `fromManifest` integrators backed by a shared `@geekmidas/manifest` package

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

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`33c1dc9`](https://github.com/geekmidas/toolbox/commit/33c1dc95cacb507f8aa348bcb393f1597d6e3844) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(cloud): add Queue and Topic linkable constructs

  `Queue` (wraps `sst.aws.Queue`) and `Topic` (wraps `sst.aws.SnsTopic`) are
  linkable messaging resources. Linking one to a producer resolves a
  name-namespaced `<NAME>_PUBLISHER_CONNECTION_STRING` (plus `<NAME>_URL`/`_ARN`)
  that `@geekmidas/events`'s `Publisher.fromConnectionString` consumes. `Queue`
  overrides `getSSTLink` to also expose `arn` (SST's native link exposes only
  `url`). `QueueProps`/`TopicProps` extend the native `QueueArgs`/`SnsTopicArgs`.

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`a9532e8`](https://github.com/geekmidas/toolbox/commit/a9532e82e5f22070998e2d813532fbaff4399890) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(cloud): add the `@geekmidas/cloud/sst` constructs entry (first cut)

  Introduces a source-only `./sst` subpath for SST v4 (ion) constructs that map
  1:1 to deployable units and validate their environment before deploy.
  - 🔌 **`Api`** wraps `sst.aws.ApiGatewayV2`: `ApiProps` extends the native
    `ApiGatewayV2Args` (CORS/domain/etc. pass through untouched), with a typed
    route table, per-route env validation via `@geekmidas/envkit/sst`'s
    `EnvValidator`, least-privilege per-route linking, and a `nodejs24.x` runtime
    default that's overridable per route or API-wide.
  - Supporting `GkmLinkable`/`ResourceType` and a `StackType` context interface.
  - Distribution: `./sst` ships as raw TypeScript (it extends SST's ambient
    `.sst/platform` globals, which only exist after `sst install`), so it is
    excluded from the dist build. A `sst.config.ts` fixture + `sst install`
    postinstall + `tsconfig.sst.json` let `src/sst` type-check against the real
    SST v4 globals locally and in CI.
  - ✨ Bumps the `sst` peer dependency to `^4.15.2` and adds `@geekmidas/envkit`.

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`b966277`](https://github.com/geekmidas/toolbox/commit/b966277eb1fcd44d05edcd1ac46c9222443a89fa) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(cloud): add the `Storage` construct

  `Storage` is a linkable `sst.aws.Bucket` (`ResourceType.Bucket`). Link it to a
  `Function`/`Api`/`Cron` and the runtime resolves a `<NAME>_NAME` environment
  variable holding the bucket's name — exactly what `@geekmidas/storage`'s
  `AmazonStorageClient.create({ bucket })` consumes. `StorageProps` extends
  `sst.aws.BucketArgs`, so native options pass through.

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`03b08fe`](https://github.com/geekmidas/toolbox/commit/03b08feba2e735539c43f95b77792c18a627b07d) Thanks [@geekmidas](https://github.com/geekmidas)! - refactor(manifest): model the unified `gkm build` manifest and add `QueueInfo`

  `gkm build` emits a single TypeScript module per provider
  (`export const manifest = { routes, functions, crons, subscribers } as const`),
  not separate JSON files. `@geekmidas/manifest` now models that:
  - a unified `Manifest` type plus `ManifestField<T>` (a field is a flat
    `readonly T[]` or a partitioned `Record<string, readonly T[]>`) and a
    `flattenManifestField` helper;
  - the item types (`RouteInfo`/`FunctionInfo`/`CronInfo`/`SubscriberInfo`) gain a
    new `QueueInfo`, `SubscriberInfo.transport`, and readonly array fields so the
    `as const` manifest assigns cleanly;
  - 🔥 the per-unit `*Manifest` wrapper types are removed.

  `@geekmidas/cloud/sst`'s `Api`/`Function`/`Cron` `fromManifest` now take the
  manifest **field** (`Api.fromManifest(stack, id, manifest.routes, …)`) and
  flatten the flat-or-partitioned shape. `@geekmidas/cli` re-exports the updated
  types.

  Also fixes `@geekmidas/events` to externalise `pg-boss` (it was the one
  transport dep being bundled).

### Patch Changes

- Updated dependencies [[`b42e96b`](https://github.com/geekmidas/toolbox/commit/b42e96b9dd28d8926a1253a97aa553bd0e08bf56), [`7323f34`](https://github.com/geekmidas/toolbox/commit/7323f34176d63170dd53450889ac0b5959420c3c), [`79e2929`](https://github.com/geekmidas/toolbox/commit/79e292978d3dbc8927e25814bdb051d1c380600a), [`03b08fe`](https://github.com/geekmidas/toolbox/commit/03b08feba2e735539c43f95b77792c18a627b07d), [`0dad77e`](https://github.com/geekmidas/toolbox/commit/0dad77e574000e4018033b956ed4bb95935911a5)]:
  - @geekmidas/manifest@0.1.0
  - @geekmidas/envkit@1.1.0

## 1.0.1

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release
