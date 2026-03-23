# @geekmidas/client

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
