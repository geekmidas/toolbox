---
'@geekmidas/constructs': patch
'@geekmidas/testkit': patch
---

A feature test's database client is built with the construct's own Kysely config

`featureTest` handed endpoints, and the test's `db`, a Kysely it built itself —
with a dialect and nothing else. A database declared with
`plugins: [new CamelCasePlugin()]` ran without it under test, so a test wrote
`createdAt` to a `created_at` column and failed on code production ran fine
(or passed on code it would not).

`KyselyDatabase` exposes `clientConfig` — the Kysely options it was declared
with, less `schema`/`roles`/`version` — and `connect()` builds from it.
`openBoundTransaction(url, config)` and `TransactionRegistry.get(key, url,
config)` take it, and `featureTest` passes it for every test transaction.
