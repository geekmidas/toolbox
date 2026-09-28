---
'@geekmidas/cli': patch
'@geekmidas/testkit': patch
---

A fresh fullstack scaffold's `pnpm test` runs

Found by moving a real project onto v10: every fault below stood between a
newly scaffolded workspace and its first green test run.

`gkm test` from the workspace root skipped the reconcile. The root is not an
app, so loading the app failed and the command fell back to the pre-constructs
path: no container started, and every URL was whatever the stored secrets said,
on ports nothing listened on. The root is exactly where the scaffold's own
`pnpm test` runs it from. The workspace is now loaded there too, and what it
declares is reconciled the same as from inside an app.

The monorepo scaffold migrated as the wrong role. Its `test/globalSetup.ts` and
`kysely.config.ts` rendered `Credentials.DATABASE_URL ?? Credentials.DATABASE_URL`
— a branch from before the root declared the database — so migrations connected
as the runtime role, which may create nothing, and failed on the first table.
Both layouts now read `DATABASE_OWNER_URL`.

`PostgresMigrator`'s cleanup dropped a database it had not created. `gkm test`
provisions the test database before the suite starts, with an owner role that
may migrate it but not drop it, so an otherwise green run ended in "must be
owner of database". The cleanup now drops only a database `start()` created.

Renaming a stage broke the local edge. Caddy imports every file under
`.gkm/caddy-sites/`, and the old stage's file declared the same hosts as the
new one's, so Caddy refused the config as ambiguous and never became healthy.
Files for stages that are neither the local stage nor `test` are now removed
when the routes are written.
