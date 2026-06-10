# @geekmidas/services

## 1.1.1

### Patch Changes

- 🐛 [`9f02e9c`](https://github.com/geekmidas/toolbox/commit/9f02e9c8419db1e41692e996e177f2473237ca76) Thanks [@geekmidas](https://github.com/geekmidas)! - fix(services): bind `this` when invoking request-scoped logger methods

  The request-scoped logger proxy re-resolved log methods at call time but
  invoked them unbound. Pino's log methods read internal state off the
  receiver (`this[Symbol(pino.msgPrefix)]`), so calling them without `this`
  threw "Cannot read properties of undefined (reading 'Symbol(pino.msgPrefix)')"
  in production (pino), while dev/test console & spy loggers were unaffected.
  The proxy now invokes the resolved method with the current request's logger
  as `this`.

## 1.1.0

### Minor Changes

- [#5](https://github.com/geekmidas/toolbox/pull/5) [`811d740`](https://github.com/geekmidas/toolbox/commit/811d740ae3875d59ad1b0dc50261266963c8cb76) Thanks [@geekmidas](https://github.com/geekmidas)! - Move the tRPC and Middy service integrations from `@geekmidas/constructs` to `@geekmidas/services`, where they belong — they depend only on `@geekmidas/services`, not on any construct.
  - ✨ **`@geekmidas/constructs`:** the `@geekmidas/constructs/trpc` and `@geekmidas/constructs/middy` entry points are removed (they were only just added). Import from `@geekmidas/services/trpc` and `@geekmidas/services/middy` instead. (`@trpc/server` is no longer a peer dependency of `@geekmidas/constructs`.)
  - ✨ **`@geekmidas/services`:** adds `/trpc` (`createServicesMiddleware`, `createRequestContextMiddleware`) and `/middy` (`requestContext`, `addServices`, `withServices`, `EventServices`) exports.

  The Middy middlewares were also tightened:
  - `requestContext` / `withServices` now require an explicit `logger` (no `ConsoleLogger` default) and are generic over `TLogger extends Logger`, so a custom logger type is preserved.
  - `addServices` / `withServices` now require an `envParser` (no implicit `process.env` default).
  - 🐛 Resolved services are attached to `event.services` (matching the `Function`/`Cron` constructs).

## 1.0.4

### Patch Changes

- 🐛 [#3](https://github.com/geekmidas/toolbox/pull/3) [`42fda53`](https://github.com/geekmidas/toolbox/commit/42fda532bdf4489a3352f6a684f5f30beafccedd) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix stale logger from service initialization

## 1.0.3

### Patch Changes

- ✨ [`351f73b`](https://github.com/geekmidas/toolbox/commit/351f73b032bc0742b7f611a9fbcdfc85bbfd69a8) Thanks [@geekmidas](https://github.com/geekmidas)! - Update request context and add support for trpc

## 1.0.2

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

- Updated dependencies [[`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651)]:
  - @geekmidas/envkit@1.0.7
  - @geekmidas/logger@1.0.2

## 1.0.1

### Patch Changes

- 🔥 [`4bed570`](https://github.com/geekmidas/toolbox/commit/4bed57049db24417ef81279bc88fa0e1255f7b9a) Thanks [@geekmidas](https://github.com/geekmidas)! - Remove singleton enforcement so people can use it how they see fit

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release

### Patch Changes

- Updated dependencies [[`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8)]:
  - @geekmidas/envkit@1.0.0
  - @geekmidas/logger@1.0.0
