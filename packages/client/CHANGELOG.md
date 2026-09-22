# @geekmidas/client

## 10.0.0-alpha.4

### Patch Changes

- Updated dependencies [[`dce9588`](https://github.com/geekmidas/toolbox/commit/dce958803067a24ec3c9ecbba2c76fd00d971904)]:
  - @geekmidas/schema@10.0.0-alpha.4
  - @geekmidas/constructs@10.0.0-alpha.4

## 10.0.0-alpha.3

### Patch Changes

- [#31](https://github.com/geekmidas/toolbox/pull/31) [`633c217`](https://github.com/geekmidas/toolbox/commit/633c217c7e23e024db7d6c6224121a8792190e45) Thanks [@geekmidas](https://github.com/geekmidas)! - A coercing schema no longer rejects what it coerces

  `z.coerce.number()` accepts `'100'` and produces `100`. The handler is
  downstream of parsing, so it reads a number; the client is upstream, so it
  sends the string. The generated client types took both from the schema's
  **output**, and so demanded the parsed type of a request that had not been sent
  yet — rejecting at compile time exactly what the endpoint accepts at runtime.

  Query parameters made it plainest. A query string is text on the wire, always,
  so a coerced query parameter asked callers for a number that cannot be put in a
  URL.

  `requestBody` and `parameters.query` are now typed from the schema's input.
  Responses are unchanged: those are read rather than sent, so the parsed type is
  the right one. For a schema that coerces nothing the two are identical, so this
  costs nothing where it does not matter.

  Type tests now run. `tsconfig.json` excludes `src/__tests__/**`, so every
  `expectTypeOf` in the package compiled to nothing and passed for that reason —
  this bug sat behind those assertions the whole time. `*.test-d.ts` files are
  compiled under `typecheck` and their errors reported as failures.

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.3
  - @geekmidas/schema@10.0.0-alpha.3

## 10.0.0-alpha.2

### Patch Changes

- Updated dependencies [[`3426eae`](https://github.com/geekmidas/toolbox/commit/3426eaec72e0837a33dae873d7fe36282445158b)]:
  - @geekmidas/constructs@10.0.0-alpha.2
  - @geekmidas/schema@10.0.0-alpha.2

## 10.0.0-alpha.1

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.1
  - @geekmidas/schema@10.0.0-alpha.1

## 10.0.0-alpha.0

### Major Changes

- [#23](https://github.com/geekmidas/toolbox/pull/23) [`25f346f`](https://github.com/geekmidas/toolbox/commit/25f346fb240b2a51996f6f67bbbe39baff32569d) Thanks [@geekmidas](https://github.com/geekmidas)! - v10: the manifest is the single source of truth

  `gkm.config.ts` used to restate what the constructs already declared — the
  apps, their paths, their routes, the containers they wanted, the origins they
  trusted. Every one of those was a second place to be wrong. In v10 the config
  carries a name, where to find the constructs, the services and the deploy
  target; everything else is read from the manifest.

  **The surface is the factory.** `e` is gone. An endpoint is built from the
  surface that will serve it — `api.post('/users').handle(...)` — so the logger,
  the env parser and the authorizers come from the `RestApi` rather than being
  threaded in per endpoint. `Endpoint` carries the surface it belongs to, and
  that is how the build knows which process an endpoint runs in.

  **Apps come from the manifest.** `apps` is no longer a config block. A
  declaration carries an `AppSpec` (`path`, and a `code` glob when the surface is
  built from files), and the CLI derives the workspace from that. A `RestApi`
  that declares its own routes — an auth server mounting a wildcard, where no
  glob has anything to find — now has its entry generated from the declaration
  itself.

  **Every surface gets its own deployment.** An api, an auth server and a studio
  are three containers, not one with three route prefixes. Sharing is something a
  declaration asks for, never a default. Which site holds the base domain is
  declared, and a construct is named by the same rule on every provider.

  **Derived rather than configured:** CORS origins from the auth construct's
  trusted origins, Studio from the declared database, containers from what the
  manifest says exists. Telescope's tables moved into a schema and dropped their
  prefix.

  **Fixed in the same release:** all four auth middlewares found a cookie by
  searching the `Cookie` header for `name=`, so `evil_auth_token=…;
auth_token=…` yielded the attacker's value; `@geekmidas/client` and
  `@geekmidas/ui` published exports that resolved to nothing; the MinIO image
  moved off Docker Hub and an unpinned `latest` took the dev stack with it.

  Upgrading is not mechanical. The config shrinks, `e` disappears, and anything
  that assumed one container per workspace now gets one per surface.

### Patch Changes

- Updated dependencies [[`25f346f`](https://github.com/geekmidas/toolbox/commit/25f346fb240b2a51996f6f67bbbe39baff32569d)]:
  - @geekmidas/constructs@10.0.0-alpha.0
  - @geekmidas/schema@10.0.0-alpha.0

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

- Updated dependencies [[`d53863a`](https://github.com/geekmidas/toolbox/commit/d53863a84db2e4ab5420e08f79128b637043fc42)]:
  - @geekmidas/constructs@9.0.2
  - @geekmidas/schema@9.0.2

## 9.0.1

### Patch Changes

- 🐛 [#11](https://github.com/geekmidas/toolbox/pull/11) [`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309) Thanks [@geekmidas](https://github.com/geekmidas)! - Patch release across all packages to realign published versions with the
  registry. The previous release only published the four packages that had
  version bumps; the remaining packages failed with "cannot publish over the
  previously published versions" because their versions were unchanged.
- Updated dependencies [[`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309)]:
  - @geekmidas/constructs@7.0.1
  - @geekmidas/schema@1.0.4

## 9.0.0

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@7.0.0

## 8.0.0

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@6.0.0

## 7.0.0

### Patch Changes

- Updated dependencies [[`b004fd8`](https://github.com/geekmidas/toolbox/commit/b004fd8ee74b5f20a047260b16669d16d8fc03b4), [`0dad77e`](https://github.com/geekmidas/toolbox/commit/0dad77e574000e4018033b956ed4bb95935911a5)]:
  - @geekmidas/constructs@5.0.0

## 6.0.0

### Patch Changes

- Updated dependencies [[`811d740`](https://github.com/geekmidas/toolbox/commit/811d740ae3875d59ad1b0dc50261266963c8cb76)]:
  - @geekmidas/constructs@4.0.0

## 5.0.0

### Patch Changes

- Updated dependencies [[`a20be2f`](https://github.com/geekmidas/toolbox/commit/a20be2faa4795600358904b751fa947d3cbb4c45), [`07093f5`](https://github.com/geekmidas/toolbox/commit/07093f5f911bf1ee48e53275da3cce398cc78ff6)]:
  - @geekmidas/constructs@3.1.0

## 4.0.5

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

- Updated dependencies [[`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651)]:
  - @geekmidas/constructs@3.0.12
  - @geekmidas/schema@1.0.2

## 4.0.4

### Patch Changes

- ✨ [`6f8f28a`](https://github.com/geekmidas/toolbox/commit/6f8f28a1317c0b519fd2067a2cd39b73c0585755) Thanks [@geekmidas](https://github.com/geekmidas)! - Add method preservation on the client and add query helpers to hooks

## 4.0.3

### Patch Changes

- ✨ [`54589f8`](https://github.com/geekmidas/toolbox/commit/54589f89d4707c287a133be5c7dbb224b86d630c) Thanks [@geekmidas](https://github.com/geekmidas)! - Add ok discriminator for wrapped clients

## 4.0.2

### Patch Changes

- ✨ [`414e7e1`](https://github.com/geekmidas/toolbox/commit/414e7e1f8ca038e397a5533279bf3a2f6f193a6d) Thanks [@geekmidas](https://github.com/geekmidas)! - Add .wrap on the fetch client for no throw handling

## 4.0.1

### Patch Changes

- [`a39b41f`](https://github.com/geekmidas/toolbox/commit/a39b41fae9c6cfbde8e6d78bf5a11fbb9e59f67d) Thanks [@geekmidas](https://github.com/geekmidas)! - Use qs to process query params instead of custom solution

- Updated dependencies [[`a39b41f`](https://github.com/geekmidas/toolbox/commit/a39b41fae9c6cfbde8e6d78bf5a11fbb9e59f67d)]:
  - @geekmidas/constructs@3.0.3

## 4.0.0

### Patch Changes

- ✨ [`be4f7a9`](https://github.com/geekmidas/toolbox/commit/be4f7a9bd5de7f08adbca582916d6902e0c24de2) Thanks [@geekmidas](https://github.com/geekmidas)! - Add partition support for manifest generation. Users can now group constructs (routes, functions, crons, subscribers) into named partitions by providing a `partition` callback per construct type in the config. Manifests output partitioned fields as `Record<string, T[]>` while remaining flat `T[]` arrays when no partitions are configured.

  Fix mutation type inference in endpoint hooks by using `UseMutationResult` and `UseQueryResult` types directly instead of `ReturnType<typeof useMutation>`, which could resolve to `never` for complex path definitions.

  Add `FileCache` implementation that persists cache entries to a JSON file on disk. Default location is `process.cwd()/.gkm/cache.json`. Uses an in-process mutex combined with `proper-lockfile` for safe concurrent and cross-process writes.

- Updated dependencies []:
  - @geekmidas/constructs@3.0.0

## 3.0.0

### Patch Changes

- Updated dependencies [[`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661)]:
  - @geekmidas/constructs@2.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [[`73511d9`](https://github.com/geekmidas/toolbox/commit/73511d912062eb0776935168c9f72d42c7c854a6)]:
  - @geekmidas/constructs@1.1.0

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release

### Patch Changes

- Updated dependencies [[`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8)]:
  - @geekmidas/constructs@1.0.0
  - @geekmidas/schema@1.0.0
