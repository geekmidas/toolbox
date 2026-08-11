---
'@geekmidas/audit': minor
---

Add Knex audit storage via a new `@geekmidas/audit/knex` entry point.

`KnexAuditStorage` mirrors `KyselyAuditStorage` — same config (`db`,
`tableName`, `databaseServiceName`, `autoId`), same `query()`/`count()`
filters, and the same transaction semantics. A `withAuditableTransaction`
helper is included; passing an existing transaction reuses it instead of
opening a savepoint, so audits roll back with the outer transaction.

Because it implements `withTransaction()`, `getDatabase()` and
`databaseServiceName`, endpoints wrap handlers and audit flushes in a single
transaction with Knex just as they do with Kysely.

`knex` is an optional peer dependency, so Kysely-only users are unaffected.
