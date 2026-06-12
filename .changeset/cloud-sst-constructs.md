---
'@geekmidas/cloud': minor
---

feat(cloud): add the `@geekmidas/cloud/sst` constructs entry (first cut)

Introduces a source-only `./sst` subpath for SST v4 (ion) constructs that map
1:1 to deployable units and validate their environment before deploy.

- **`Api`** wraps `sst.aws.ApiGatewayV2`: `ApiProps` extends the native
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
- Bumps the `sst` peer dependency to `^4.15.2` and adds `@geekmidas/envkit`.
