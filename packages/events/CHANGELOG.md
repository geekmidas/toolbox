# @geekmidas/events

## 1.1.5

### Patch Changes

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

## 1.1.4

### Patch Changes

- 🐛 [`75954ab`](https://github.com/geekmidas/toolbox/commit/75954ab60413ecba60b24aad7f9e0a08f29863dd) Thanks [@geekmidas](https://github.com/geekmidas)! - Republish with the `package.json` exports fix that nests `types` inside each `import`/`require` condition and points at the `.d.mts`/`.d.cts` files that `tsdown` actually emits. The previous version (1.1.3) was tagged but failed to publish to npm; this bump retries publication so consumers can resolve types correctly under NodeNext/Bundler module resolution.

## 1.1.3

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

- Updated dependencies [[`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651)]:
  - @geekmidas/schema@1.0.2

## 1.1.2

### Patch Changes

- 🐛 [`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix schema, openapi generation and events testkit

- Updated dependencies [[`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553)]:
  - @geekmidas/schema@1.0.1

## 1.1.1

### Patch Changes

- ⬆️ [`bf6c028`](https://github.com/geekmidas/toolbox/commit/bf6c0286c046794c322ebf7765378fc6ae1f9155) Thanks [@geekmidas](https://github.com/geekmidas)! - Upgrade pg-boss to 12

## 1.1.0

### Minor Changes

- ✨ [`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661) Thanks [@geekmidas](https://github.com/geekmidas)! - Add pg-boss event publisher/subscriber, CLI setup and upgrade commands, and secrets sync via AWS SSM
  - ✨ **@geekmidas/events**: Add pg-boss backend for event publishing and subscribing with connection string support
  - ✨ **@geekmidas/cli**: Add `gkm setup` command for dev environment initialization, `gkm upgrade` command with workspace detection, and secrets push/pull via AWS SSM Parameter Store
  - 🐛 **@geekmidas/testkit**: Fix database creation race condition in PostgresMigrator
  - ✨ **@geekmidas/constructs**: Add integration tests for pg-boss with HonoEndpoint

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release

### Patch Changes

- Updated dependencies [[`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8)]:
  - @geekmidas/schema@1.0.0
