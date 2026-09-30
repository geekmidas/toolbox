---
'@geekmidas/constructs': patch
---

`BetterAuth#pendingMigration()` replaces `migrations()`

Better Auth's schema is now committed SQL in its tenant's migrations folder,
written by `gkm migration auth`, instead of being diffed and applied at
runtime. `pendingMigration(options)` returns what the tenant is missing — as
`create table if not exists`/`create index if not exists`/`add column if not
exists`, so the first migration also applies to a database Better Auth set up
at runtime — or `undefined` when it matches. `databaseId` names the tenant.

A feature test's harness also trusts the local edge's CA in each worker, so a
suite started by plain `vitest` reaches `https://` addresses as one started by
`gkm test` does.
