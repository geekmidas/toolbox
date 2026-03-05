# @geekmidas/cli

## 1.10.6

### Patch Changes

- 🐛 [`d77b70e`](https://github.com/geekmidas/toolbox/commit/d77b70ebf8f68ae39a6daec02023703c2025167b) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix credentials for tests

## 1.10.5

### Patch Changes

- 🐛 [`c97b9db`](https://github.com/geekmidas/toolbox/commit/c97b9db7cb66040b461cd3682f0b82ae2f24bd14) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix credentials embedding

## 1.10.4

### Patch Changes

- 🐛 [`6123575`](https://github.com/geekmidas/toolbox/commit/6123575f05ba5c8563413fffdad67d0e2880fb08) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix config hosts

- 🐛 [`96618ff`](https://github.com/geekmidas/toolbox/commit/96618ff36fd3248bfc29f4517fda79eea4a66dda) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix credentials loading for tests

## 1.10.3

### Patch Changes

- 🐛 [`6a92fa7`](https://github.com/geekmidas/toolbox/commit/6a92fa737057d77178a4d31480505013fbe033af) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix dev scripts and spawns also when canceling prcocess.

## 1.10.2

### Patch Changes

- 🐛 [`fefefe0`](https://github.com/geekmidas/toolbox/commit/fefefe0e7825d95c333375ea280e9aba23599bf0) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix issue with env loading on docker during setup

## 1.10.1

### Patch Changes

- ✨ [`bfc5a4f`](https://github.com/geekmidas/toolbox/commit/bfc5a4f656445bb389b0532e9d3385d2e66a28fe) Thanks [@geekmidas](https://github.com/geekmidas)! - Add function context and suport for partitions

- Updated dependencies [[`bfc5a4f`](https://github.com/geekmidas/toolbox/commit/bfc5a4f656445bb389b0532e9d3385d2e66a28fe)]:
  - @geekmidas/constructs@3.0.1

## 1.10.0

### Minor Changes

- ✨ [`be4f7a9`](https://github.com/geekmidas/toolbox/commit/be4f7a9bd5de7f08adbca582916d6902e0c24de2) Thanks [@geekmidas](https://github.com/geekmidas)! - Add partition support for manifest generation. Users can now group constructs (routes, functions, crons, subscribers) into named partitions by providing a `partition` callback per construct type in the config. Manifests output partitioned fields as `Record<string, T[]>` while remaining flat `T[]` arrays when no partitions are configured.

  Fix mutation type inference in endpoint hooks by using `UseMutationResult` and `UseQueryResult` types directly instead of `ReturnType<typeof useMutation>`, which could resolve to `never` for complex path definitions.

  Add `FileCache` implementation that persists cache entries to a JSON file on disk. Default location is `process.cwd()/.gkm/cache.json`. Uses an in-process mutex combined with `proper-lockfile` for safe concurrent and cross-process writes.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@3.0.0

## 1.9.1

### Patch Changes

- ✨ [`3d20e46`](https://github.com/geekmidas/toolbox/commit/3d20e46aa2454c322ffa9e482f23c12c9e9686d4) Thanks [@geekmidas](https://github.com/geekmidas)! - Add secret reconsilation and fix bug with dev loading credentials

## 1.9.0

### Minor Changes

- ✨ [`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661) Thanks [@geekmidas](https://github.com/geekmidas)! - Add pg-boss event publisher/subscriber, CLI setup and upgrade commands, and secrets sync via AWS SSM
  - ✨ **@geekmidas/events**: Add pg-boss backend for event publishing and subscribing with connection string support
  - ✨ **@geekmidas/cli**: Add `gkm setup` command for dev environment initialization, `gkm upgrade` command with workspace detection, and secrets push/pull via AWS SSM Parameter Store
  - 🐛 **@geekmidas/testkit**: Fix database creation race condition in PostgresMigrator
  - ✨ **@geekmidas/constructs**: Add integration tests for pg-boss with HonoEndpoint

### Patch Changes

- Updated dependencies [[`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661)]:
  - @geekmidas/constructs@2.0.0

## 1.8.0

### Minor Changes

- ⬆️ [`5c5d844`](https://github.com/geekmidas/toolbox/commit/5c5d8447d0bab29397879bcd723bf1f44c50e61c) Thanks [@geekmidas](https://github.com/geekmidas)! - Bump version to capture latest version of constructs

## 1.7.0

### Minor Changes

- 🔥 [`66a0eac`](https://github.com/geekmidas/toolbox/commit/66a0eacfb2aa711da5d67ec10f28a8fa8bcbdf1e) Thanks [@geekmidas](https://github.com/geekmidas)! - Remove test adaptor from subscriber exports

## 1.6.0

### Minor Changes

- ⚡️ [`73511d9`](https://github.com/geekmidas/toolbox/commit/73511d912062eb0776935168c9f72d42c7c854a6) Thanks [@geekmidas](https://github.com/geekmidas)! - Improve dev script experience and export function tester

### Patch Changes

- Updated dependencies [[`73511d9`](https://github.com/geekmidas/toolbox/commit/73511d912062eb0776935168c9f72d42c7c854a6)]:
  - @geekmidas/constructs@1.1.0

## 1.5.1

### Patch Changes

- 🐛 [`1a74469`](https://github.com/geekmidas/toolbox/commit/1a744694de77cdcc030ad5a5d99d6fc9800c0533) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix function adaptor for lambda

## 1.5.0

### Minor Changes

- ✨ [`36166de`](https://github.com/geekmidas/toolbox/commit/36166defde0a66e68cb9ac5c6a6856ea23e2da62) Thanks [@geekmidas](https://github.com/geekmidas)! - Add sniffing and config for frontend apps. Also ensure next.js apps get args at build time.

## 1.4.0

### Minor Changes

- 🐛 [`bebf821`](https://github.com/geekmidas/toolbox/commit/bebf821ce4534e314d3d536e9956260c4230a183) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix dependecy output injecttion for urls

## 1.3.0

### Minor Changes

- 🐛 [`bee0e64`](https://github.com/geekmidas/toolbox/commit/bee0e64367dc937869556de516fedfea64f2a438) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix route53 profile setting for state management, fix web templates on init.

## 1.2.3

### Patch Changes

- 🐛 [`11c96af`](https://github.com/geekmidas/toolbox/commit/11c96af896fa5355f37edd276fc96010cd177ccc) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix cli client generation for monorepos

## 1.2.2

### Patch Changes

- 🐛 [`ab91786`](https://github.com/geekmidas/toolbox/commit/ab917864eaf64793e5bc93818a98caeb5b766324) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix env var injection for dev, and make sure openapi generation for client apps

## 1.2.1

### Patch Changes

- 🐛 [`e4ab724`](https://github.com/geekmidas/toolbox/commit/e4ab724fc044bbcab9e4a1426e55b515a4185a2b) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix bug when running gkm exec so tsx is importted correctly

## 1.2.0

### Minor Changes

- 🔥 [`43d4451`](https://github.com/geekmidas/toolbox/commit/43d44510f1077ecdf0c64ae56c8d2d97d446cea2) Thanks [@geekmidas](https://github.com/geekmidas)! - Remove projectId from workspace config and move to state

## 1.1.0

### Minor Changes

- ✨ [`3b6d7d9`](https://github.com/geekmidas/toolbox/commit/3b6d7d9ed41dc08675395d937248a8ab754af9e1) Thanks [@geekmidas](https://github.com/geekmidas)! - Add state provider configuration to workspace config

## 1.0.2

### Patch Changes

- 🐛 [`159e365`](https://github.com/geekmidas/toolbox/commit/159e36572adb2b489629d4ab2a0142f8ff59b7a8) Thanks [@geekmidas](https://github.com/geekmidas)! - Resolve correct cli version at runtime

## 1.0.1

### Patch Changes

- [`169ccd6`](https://github.com/geekmidas/toolbox/commit/169ccd62ada0dfd23f47434b57b967213d1538e5) Thanks [@geekmidas](https://github.com/geekmidas)! - Use the correct version for cli dependencies

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release

### Patch Changes

- Updated dependencies [[`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8)]:
  - @geekmidas/constructs@1.0.0
  - @geekmidas/envkit@1.0.0
  - @geekmidas/errors@1.0.0
  - @geekmidas/logger@1.0.0
  - @geekmidas/schema@1.0.0
  - @geekmidas/telescope@1.0.0
