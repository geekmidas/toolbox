# @geekmidas/schema

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
