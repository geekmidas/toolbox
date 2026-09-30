---
'@geekmidas/cli': patch
'@geekmidas/manifest': patch
---

`gkm migrate`, `gkm migration`, and a Vitest setup that migrates

Every database construct — and every schema tenant — has its own migrations
folder, named after it: `Database` is `db/database/`, `AuthDatabase` is
`db/auth-database/`. Which constructs those are, in what order, from which
folder, is `migrationTargets(manifest)` in `@geekmidas/manifest`, and nothing
else decides it.

- `gkm migrate [construct] [--stage test]` reconciles the stage (containers,
  roles, grants) and applies each folder as that construct's **owner** role —
  never the runtime one, never a fallback — parents before tenants. Each
  construct's history lives in its own schema. `.ts` files export `up`/`down`;
  `.sql` files run whole. Unordered migrations are allowed, so a branch merged
  late still applies. Deployed stages are refused: their deploy migrates them.
- `gkm migration <construct> [name]` writes the next file, stamped
  `YYYYMMDDHHmmss` UTC: an empty `up`/`down` for a database, or — for a
  `BetterAuth` construct — the SQL its tenant is missing.
- `globalSetup: ['@geekmidas/cli/vitest']` in the root Vitest config readies
  the test stage and migrates every construct before any test runs, however
  the suite starts: `gkm test`, plain `vitest`, an editor. `gkm test` does the
  same before starting Vitest; `gkm test --setup` does it and stops.
- `gkm dev` reports pending migrations and applies none.
- The scaffold writes its migration to `db/database/`, the root Vitest config
  carries the setup, and `kysely.config.ts`, `test/globalSetup.ts` and
  `kysely-ctl` are gone. AGENTS.md has a Migrations section.
