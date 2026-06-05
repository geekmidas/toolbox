# @geekmidas/constructs

## 3.0.13

### Patch Changes

- ✨ [`351f73b`](https://github.com/geekmidas/toolbox/commit/351f73b032bc0742b7f611a9fbcdfc85bbfd69a8) Thanks [@geekmidas](https://github.com/geekmidas)! - Update request context and add support for trpc

- Updated dependencies [[`351f73b`](https://github.com/geekmidas/toolbox/commit/351f73b032bc0742b7f611a9fbcdfc85bbfd69a8)]:
  - @geekmidas/services@1.0.3

## 3.0.12

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

- Updated dependencies [[`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651)]:
  - @geekmidas/audit@2.0.1
  - @geekmidas/cache@1.1.1
  - @geekmidas/db@1.0.2
  - @geekmidas/envkit@1.0.7
  - @geekmidas/errors@1.0.1
  - @geekmidas/events@1.1.3
  - @geekmidas/logger@1.0.2
  - @geekmidas/rate-limit@2.0.1
  - @geekmidas/schema@1.0.2
  - @geekmidas/services@1.0.2

## 3.0.11

### Patch Changes

- [`fb1e721`](https://github.com/geekmidas/toolbox/commit/fb1e721ec38c1b328d41466564c6fa1c9305e80b) Thanks [@geekmidas](https://github.com/geekmidas)! - Return 403 Forbidden instead of 401 Unauthorized when an endpoint's `.authorize()` returns false. Authorization runs after `getSession()`, so by the time it rejects, the caller is already identified — 403 is the correct semantic. Callers that want 401 for missing authentication should throw `UnauthorizedError` from `getSession()` (or `.authorize()`) directly.

## 3.0.10

### Patch Changes

- 🐛 [`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix schema, openapi generation and events testkit

- Updated dependencies [[`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553)]:
  - @geekmidas/events@1.1.2
  - @geekmidas/schema@1.0.1

## 3.0.9

### Patch Changes

- ✨ [`363c67f`](https://github.com/geekmidas/toolbox/commit/363c67fb3c3406bac6823326ab80ba55bff29e31) Thanks [@geekmidas](https://github.com/geekmidas)! - Add dynamic return types

## 3.0.8

### Patch Changes

- ✨ [`0830c6e`](https://github.com/geekmidas/toolbox/commit/0830c6e0d60842526788e0e1f0e78827514ea7b3) Thanks [@geekmidas](https://github.com/geekmidas)! - Add optional sniff support

- Updated dependencies [[`0830c6e`](https://github.com/geekmidas/toolbox/commit/0830c6e0d60842526788e0e1f0e78827514ea7b3)]:
  - @geekmidas/logger@1.0.1

## 3.0.7

### Patch Changes

- ✨ [`79e17a8`](https://github.com/geekmidas/toolbox/commit/79e17a84e630f102023005994d9d45b37f7d9d8f) Thanks [@geekmidas](https://github.com/geekmidas)! - Add msw support for construct testing for ui

## 3.0.6

### Patch Changes

- ✨ [`3941ae6`](https://github.com/geekmidas/toolbox/commit/3941ae6c9027fddb32999b9f98af813a12867877) Thanks [@geekmidas](https://github.com/geekmidas)! - Add db to authorizer

## 3.0.5

### Patch Changes

- [`fba83f3`](https://github.com/geekmidas/toolbox/commit/fba83f3ceee1d058874e62b31e38a9da205a6742) Thanks [@geekmidas](https://github.com/geekmidas)! - Release constructs

## 3.0.4

### Patch Changes

- ✨ [`f005956`](https://github.com/geekmidas/toolbox/commit/f005956573aac6bcdfcc95d2a31c17cf5b9688d4) Thanks [@geekmidas](https://github.com/geekmidas)! - Add params to authorize and decode content type on routes

## 3.0.3

### Patch Changes

- [`a39b41f`](https://github.com/geekmidas/toolbox/commit/a39b41fae9c6cfbde8e6d78bf5a11fbb9e59f67d) Thanks [@geekmidas](https://github.com/geekmidas)! - Use qs to process query params instead of custom solution

## 3.0.2

### Patch Changes

- 🐛 [`317e53e`](https://github.com/geekmidas/toolbox/commit/317e53e91c07bbc23dad3ae81faf573be91cb992) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix v2 cookie loading

## 3.0.1

### Patch Changes

- ✨ [`bfc5a4f`](https://github.com/geekmidas/toolbox/commit/bfc5a4f656445bb389b0532e9d3385d2e66a28fe) Thanks [@geekmidas](https://github.com/geekmidas)! - Add function context and suport for partitions

## 3.0.0

### Patch Changes

- Updated dependencies [[`be4f7a9`](https://github.com/geekmidas/toolbox/commit/be4f7a9bd5de7f08adbca582916d6902e0c24de2)]:
  - @geekmidas/cache@1.1.0
  - @geekmidas/audit@2.0.0
  - @geekmidas/rate-limit@2.0.0

## 2.0.0

### Patch Changes

- ✨ [`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661) Thanks [@geekmidas](https://github.com/geekmidas)! - Add pg-boss event publisher/subscriber, CLI setup and upgrade commands, and secrets sync via AWS SSM
  - ✨ **@geekmidas/events**: Add pg-boss backend for event publishing and subscribing with connection string support
  - ✨ **@geekmidas/cli**: Add `gkm setup` command for dev environment initialization, `gkm upgrade` command with workspace detection, and secrets push/pull via AWS SSM Parameter Store
  - 🐛 **@geekmidas/testkit**: Fix database creation race condition in PostgresMigrator
  - ✨ **@geekmidas/constructs**: Add integration tests for pg-boss with HonoEndpoint

- Updated dependencies [[`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661)]:
  - @geekmidas/events@1.1.0

## 1.1.1

### Patch Changes

- 🔥 [`9ac81f2`](https://github.com/geekmidas/toolbox/commit/9ac81f25fbf3676e39580c916dc0085358af99cb) Thanks [@geekmidas](https://github.com/geekmidas)! - Remove subscriber adaptor from root exports

## 1.1.0

### Minor Changes

- ⚡️ [`73511d9`](https://github.com/geekmidas/toolbox/commit/73511d912062eb0776935168c9f72d42c7c854a6) Thanks [@geekmidas](https://github.com/geekmidas)! - Improve dev script experience and export function tester

## 1.0.5

### Patch Changes

- ⬆️ [`53c39a0`](https://github.com/geekmidas/toolbox/commit/53c39a0ed9244be6ca2ff6ec8e39138a0fc88692) Thanks [@geekmidas](https://github.com/geekmidas)! - Update RLS types

## 1.0.4

### Patch Changes

- 🐛 [`05a6302`](https://github.com/geekmidas/toolbox/commit/05a6302a37ef2285aaf07ee46eeb9135ed658a68) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix lambda function generator to use correct adaptor import

## 1.0.3

### Patch Changes

- 🐛 [`8bdda11`](https://github.com/geekmidas/toolbox/commit/8bdda11f5c0f7c2eaea605befb0eca38ecc56e44) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix iam resolution for authorizers and fixed exported types for envkit

- Updated dependencies [[`8bdda11`](https://github.com/geekmidas/toolbox/commit/8bdda11f5c0f7c2eaea605befb0eca38ecc56e44)]:
  - @geekmidas/envkit@1.0.1

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release

### Patch Changes

- Updated dependencies [[`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8)]:
  - @geekmidas/audit@1.0.0
  - @geekmidas/cache@1.0.0
  - @geekmidas/db@1.0.0
  - @geekmidas/envkit@1.0.0
  - @geekmidas/errors@1.0.0
  - @geekmidas/events@1.0.0
  - @geekmidas/logger@1.0.0
  - @geekmidas/rate-limit@1.0.0
  - @geekmidas/schema@1.0.0
  - @geekmidas/services@1.0.0
