# @geekmidas/schema

## 9.2.1

### Patch Changes

- [#324](https://github.com/geekmidas/toolbox/pull/324) [`836d73e`](https://github.com/geekmidas/toolbox/commit/836d73e8ab6db8ab0bcda2eb7847dcd9df023cbb) Thanks [@geekmidas](https://github.com/geekmidas)! - Dependency changes that let consumers clear security advisories
  - 🐛 **constructs, envkit**: no longer depend on `lodash.pick` and `lodash.set` (GHSA-p6mc-m468-83gw, no fixed release). Native code does the same work, and constructs no longer bundles either module into its dist.
  - **emailkit**: `nodemailer` ^6.9.7 → ^7.0.7. emailkit only uses the SMTP transport, which v7 leaves unchanged.
  - **envkit, client, schema, storage**: the `zod` peer range widens from `~4.1.13` to `^4.1.13`, so apps can move to zod 4.6.6 (GHSA-mrhx-c7xc-m3w5).
    - The OpenAPI client generator no longer emits `export type User = User` for an endpoint whose output is a registered schema, which zod 4.6 started producing.
  - **telescope**: the OpenTelemetry peers accept the 2.x line (`@opentelemetry/sdk-trace-node` ^2 and the matching 0.2xx packages) as well as 1.x. This clears GHSA-45rx-2jwx-cxfr and GHSA-8988-4f7v-96qf.
    - `setupTelemetry` works on both lines.
    - Its log records are now exported through the SDK. Before, they went to a logger provider that was never registered.
  - **testkit, db**: `@faker-js/faker` ~9.9.0 → ^10.4.1 (GHSA-qxc2-j82w-r537), and the `vitest` peer accepts `^3.2.4 || ^4.1.11`.
    - 🔥 `@geekmidas/testkit/faker` extends faker, so faker 10's removed APIs apply to it.
    - faker 10 is ESM-only. It needs Node 22.13 or later, its own minimum, and loading testkit from CommonJS relies on that version's `require()` of ES modules.

## 9.2.0

## 9.1.0

## 9.0.2

### Patch Changes

- [#12](https://github.com/geekmidas/toolbox/pull/12) [`d53863a`](https://github.com/geekmidas/toolbox/commit/d53863a84db2e4ab5420e08f79128b637043fc42) Thanks [@geekmidas](https://github.com/geekmidas)! - Align every published package on a single version and keep them in step.

  All packages now share one version, enforced by a changesets `fixed` group. The
  baseline is 9.0.1 — @geekmidas/client's published version — so nothing moves
  backwards; this release takes the whole set to 9.0.2 together.

  Independent versions made "which version of the docs applies to me"
  unanswerable: a reader on constructs@7 and cli@2 was on no version at all. One
  number per release makes versioned documentation possible, and lets 9 freeze as
  the current paradigm while the constructs rework is developed against it.

  Every release now publishes every package, and a major anywhere is a major
  everywhere. Peer ranges get simpler in return.

## 1.0.4

### Patch Changes

- 🐛 [#11](https://github.com/geekmidas/toolbox/pull/11) [`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309) Thanks [@geekmidas](https://github.com/geekmidas)! - Patch release across all packages to realign published versions with the
  registry. The previous release only published the four packages that had
  version bumps; the remaining packages failed with "cannot publish over the
  previously published versions" because their versions were unchanged.

## 1.0.3

### Patch Changes

- [#7](https://github.com/geekmidas/toolbox/pull/7) [`e0d06b3`](https://github.com/geekmidas/toolbox/commit/e0d06b38dfd275758f7955f5754900ab78779302) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(constructs): allow endpoint handlers to return the output schema's input type

  Endpoint handlers previously had to return the output schema's _parsed_ type
  (`InferStandardSchema`). When an output schema coerces its value (e.g. a `Date`
  serialized to an ISO `string`, or an applied default), that forced handlers to
  pre-coerce values themselves even though the schema would do it on the way out.

  A new `InferStandardSchemaInput` type is added to `@geekmidas/schema`, exposing a
  Standard Schema's _input_ type (`StandardSchemaV1.InferInput`). `Endpoint`'s
  handler return type now uses it, so handlers may return the looser pre-coercion
  input while consumers (`EndpointOutput` and the generated client) still see the
  narrower parsed output type.

## 1.0.2

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

## 1.0.1

### Patch Changes

- 🐛 [`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix schema, openapi generation and events testkit

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release
