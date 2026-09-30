---
'@geekmidas/cli': patch
'@geekmidas/manifest': patch
---

`gkm seed`, `gkm dev --migrate`/`--seed`, and `db/<construct>/migrations/` + `seeds/`

A database construct's folder now holds two folders, and nothing else:

```
db/database/
  migrations/   # the schema's history, applied once each
  seeds/        # reference data the app needs, run on every pass
```

**Moving an existing project:** move every file in `db/<construct>/` into
`db/<construct>/migrations/`. History is recorded by name, not path, so nothing
re-runs. A file left at the old level is refused with `MigrationsOutsideFolder`
rather than silently never running, and any other folder beside the two with
`UnknownDatabaseFolder`.

- **Seeds are reference data:** a permission catalogue, roles and their grants,
  lookup tables. A `.ts` exporting `seed(db, { stage })`, or `.sql`, run in name order,
  each in its own transaction, as the construct's owner. There is no history:
  every seed runs every time, so a seed is an upsert and a changed one is
  applied by running it again. A failure rolls that seed back and throws
  `SeedFailed`; a script with no `seed` export throws `SeedHasNoSeed`.
- **Seeds run on every stage, production included,** and each is handed the
  stage it is seeding, so one that belongs only somewhere decides for itself
  (`if (stage === 'production') return;`). `seedDatabases` and
  `migrateAndSeed` take the stage, so a deploy runs them the same way.
- **Seeds always run after migrations.** `gkm seed [construct]` migrates, then
  seeds — for one construct, the database it lives in is migrated too.
  `gkm migrate` still only migrates.
- **`gkm dev --migrate`** applies pending migrations before the apps start;
  **`gkm dev --seed`** migrates and seeds. Once, at startup, never on a save,
  and a failure stops `dev`. Without either, `dev` only reports what is pending.
- **Tests migrate and seed:** `gkm test` and `@geekmidas/cli/vitest` do both,
  and a watch-mode rerun applies an edited seed.
- `MigrationTarget` gains `migrations` and `seeds`; `databaseFolder()` and
  `seedFolder()` join `migrationFolder()`, which now names
  `db/<construct>/migrations`.
- The scaffolded AGENTS.md says where reference data goes: a seed, written from
  the typed constant, never a migration.
