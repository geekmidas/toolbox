---
'@geekmidas/cli': patch
'@geekmidas/constructs': patch
---

Feature tests are handed every database by name: `db` and `factories`, keyed by service name

A factory belongs to a database, not to an app, so it's named after one:
`test/factories/<construct>.ts` at the project root (`database.ts` for
`Database`, `auth-database.ts` for `AuthDatabase`), exporting
`createFactory(db)`. `gkm test` finds them and every app's generated harness
imports them, so a test no longer imports and builds its own:

```ts
it('reads a user', async ({ browser, factories }) => {
  const ada = await factories.database.insert('users', { name: 'Ada' });
});
```

- **Keyed by service name** (`factories.database`, `factories.authDatabase`),
  and typed from each `createFactory`.
- **Built on the test's transactions:** each factory gets its database's
  transaction for that test, so the endpoints and the auth server see the rows,
  and they're rolled back with everything else.
- **Refused, not skipped:** a file named after no database construct throws
  `UnknownFactoryFile`, and one without a `createFactory` export throws
  `FactoryHasNoCreate`.
- **`test: { factories: '…' }`** in `gkm.config.ts` moves the folder.
- **`featureTest({ factories })`** takes them directly; `UnknownFactory` names a
  key no declared database has.

**`db` is keyed by construct too — breaking.** A test used to get one `db`,
inferred from whichever database the endpoints named first. It now gets every
database construct's transaction for the test, by service name, each typed by
its schema:

```ts
it('…', async ({ db }) => {
  await db.database.selectFrom('users')…;
  await db.authDatabase.selectFrom('session')…;
});
```

Nothing is inferred, so nothing can be picked wrongly: `featureTest({ database })`
and `UnknownDatabase` are gone. In existing tests, `db.selectFrom(…)` becomes
`db.database.selectFrom(…)`, and `FeatureContext<Browser, unknown>` becomes
`FeatureContext<Browser>`.
- **`gkm init`** scaffolds `test/factories/database.ts` at the project root, in
  both layouts, instead of `test/factory/` inside the API app.

**Moving an existing project:** move the factory to
`test/factories/database.ts` at the root, keep its `createFactory(db)` export,
and replace `createFactory(db)` in tests with the `factories.database` the test
is handed.
