# @geekmidas/envkit

## 1.1.0

### Minor Changes

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`7323f34`](https://github.com/geekmidas/toolbox/commit/7323f34176d63170dd53450889ac0b5959420c3c) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(envkit): add Queue resolver and publisher connection strings (sst)

  `@geekmidas/envkit/sst` gains a `Queue` resource type (`ResourceType.Queue` /
  `SSTQueue`) whose resolver emits `<NAME>_URL`, `<NAME>_ARN`, and a
  `<NAME>_PUBLISHER_CONNECTION_STRING` (`sqs://?queueUrl=…`). The SNS topic
  resolver now also emits `<NAME>_PUBLISHER_CONNECTION_STRING` (`sns://?topicArn=…`).

  These name-namespaced connection strings are what `@geekmidas/events`'
  `Publisher.fromConnectionString` consumes, so a linked queue/topic resolves to a
  ready-to-use publisher (the protocol selects the transport — SQS/SNS deployed,
  or a local backend in dev).

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`79e2929`](https://github.com/geekmidas/toolbox/commit/79e292978d3dbc8927e25814bdb051d1c380600a) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(envkit): add an SST env-var validator to `@geekmidas/envkit/sst`

  Adds `EnvValidator`, `resolveEnvKeys`, and `EnvValidationError` alongside
  `SstEnvironmentBuilder`, so a deployable unit's required environment variables
  can be validated **before** deploy — at `sst.config.ts` synth time.
  - `resolveEnvKeys` derives the env-var keys a set of linked resources will
    produce by replaying the **same** `sstResolvers` used at runtime (reduced to
    the resource `type`, so no SST `Output` value is ever read). The infra-time
    validator and the runtime resolution share a single source of truth — they
    cannot drift, and there is no parallel suffix table to maintain.
  - `EnvValidationError` is a structured, catchable error carrying `.missing`,
    `.available`, `.suggestions`, and `.context`. Its message names the failing
    unit and gives a nearest-match "did you mean DB_URL?" hint per missing
    variable (edit-distance + token-overlap).
  - Platform whitelists are **exported, never assumed** — SST deploys to AWS, GCP,
    and Cloudflare. `AWS_RUNTIME_ENV_VARS`, `GCP_RUNTIME_ENV_VARS`,
    `CLOUDFLARE_RUNTIME_ENV_VARS`, the `PLATFORM_ENV_VARS` registry, and
    `platformEnvVars(platform)` are exported; the caller opts in via
    `new EnvValidator(links, { platform })`. Optional vars are marked with a
    trailing `?`.
  - `getProvidersForEnvVars(requested)` returns the link names that provide a
    requested var, for least-privilege linking (attach only the links a unit needs).

## 1.0.7

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

## 1.0.6

### Patch Changes

- ✨ [`e90d1fa`](https://github.com/geekmidas/toolbox/commit/e90d1fa0838769b346a98f0762c77295ef4fd09b) Thanks [@geekmidas](https://github.com/geekmidas)! - Add url support for database

## 1.0.5

### Patch Changes

- ✨ [`56e71bc`](https://github.com/geekmidas/toolbox/commit/56e71bcb57a5305270909f695a4539fa504a463b) Thanks [@geekmidas](https://github.com/geekmidas)! - Add optional params support and open api on build

## 1.0.4

### Patch Changes

- 🐛 [`a483d4c`](https://github.com/geekmidas/toolbox/commit/a483d4c193d27673ccad2aeed6f56b1c5708b5b4) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix credentials injection to work with esm/cjs

## 1.0.3

### Patch Changes

- ✨ [`bf094cd`](https://github.com/geekmidas/toolbox/commit/bf094cd29df2d18e75213f0976c0c9ff8047d14c) Thanks [@geekmidas](https://github.com/geekmidas)! - Add legacy dynamo resolution

## 1.0.2

### Patch Changes

- ✨ [`bfa41ad`](https://github.com/geekmidas/toolbox/commit/bfa41ad86c74c73a98e3922a536805fdf65d7607) Thanks [@geekmidas](https://github.com/geekmidas)! - Add support for dynamo links

## 1.0.1

### Patch Changes

- 🐛 [`8bdda11`](https://github.com/geekmidas/toolbox/commit/8bdda11f5c0f7c2eaea605befb0eca38ecc56e44) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix iam resolution for authorizers and fixed exported types for envkit

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release
