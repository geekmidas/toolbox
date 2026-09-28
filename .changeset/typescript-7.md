---
'@geekmidas/client': patch
'@geekmidas/cloud': patch
---

Built and typechecked with TypeScript 7

The packages now build with the native compiler; declarations are emitted by
tsgo. Nothing in their public types changes.

`@geekmidas/client` no longer ships `dist/openapi.*`: a stale spec from another
app that no export named and nothing imported.

`@geekmidas/cloud`'s `fromManifest` types a database's provider inputs as
`DatabaseProps` — the `Vpc` component its bootstrap function needs — rather
than RDS's wider `PostgresArgs`, which also accepts bare subnet ids.
