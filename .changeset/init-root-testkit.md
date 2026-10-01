---
'@geekmidas/cli': patch
---

`gkm init` installs what the root test factory imports, at the root

A monorepo's `test/factories/database.ts` sits at the workspace root. It
resolves its imports from the root `node_modules`, but testkit and faker were
only installed for the API app, so a freshly scaffolded monorepo's tests failed
with `Cannot find package '@geekmidas/testkit'`.

- **Root dependencies:** with a database, the root `package.json` now adds
  `@geekmidas/testkit` and `@faker-js/faker`, plus `kysely` in an API
  monorepo, whose root installs nothing for constructs.
- **The factory's import:** an API monorepo's factory imports the database
  construct from the app (`../../apps/api/src/constructs/database.ts`). Its root
  has no `@<name>/constructs` alias; only a fullstack workspace maps one.

**Existing monorepo:** add `@geekmidas/testkit` and `@faker-js/faker` to the
root `devDependencies`.
