---
"@geekmidas/testkit": minor
"@geekmidas/db": minor
"@geekmidas/audit": minor
"@geekmidas/studio": minor
"@geekmidas/telescope": minor
"@geekmidas/cli": patch
---

Support kysely 0.29.

kysely 0.29 moved `Migrator` and `FileMigrationProvider` from the root barrel
(`'kysely'`) to the `'kysely/migration'` subpath. `@geekmidas/testkit`'s
`PostgresKyselyMigrator` now imports `Migrator` from `'kysely/migration'` and
its kysely peer becomes `~0.29.4` — consumers must be on kysely 0.29+.

The library packages that only declare a kysely *peer* (`db`, `audit`, `studio`,
`telescope`) don't touch the moved symbols, so their peer range is *widened* to
`>=0.28.2 <0.30.0` — they now support both 0.28 and 0.29 (non-breaking).

`@geekmidas/cli`'s scaffolded `test/globalSetup.ts` template now imports
`FileMigrationProvider` from `'kysely/migration'` so generated projects work on
kysely 0.29.
