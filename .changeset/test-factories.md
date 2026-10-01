---
'@geekmidas/cli': patch
'@geekmidas/constructs': patch
---

Feature tests: `db.get`, `factories.get` and `browser.signIn`

A feature test is handed the app's own databases by name, a factory for each,
and a way to sign in, with nothing to import:

```ts
it('lets a member join a tournament', async ({ browser, db, factories }) => {
  const factory = await factories.get('database');
  const tournament = await factory.insert('tournaments', {});

  const { user } = await browser.signIn('ada@example.com');
  await browser.api.post('/tournaments/{id}/join', {
    params: { id: tournament.id },
  });

  const app = await db.get('database');
  const members = await app.selectFrom('tournamentMembers').selectAll().execute();
  expect(members).toMatchObject([{ userId: user.id }]);
});
```

- **`db.get(name)`:** a database's transaction for this test, by service name
  and typed by its schema. It opens on first use by whatever reaches it first
  (the test, a factory or an endpoint), and they all share it.
- **The app's own databases only:** a schema tenant an auth server owns is
  reached through that server, as the app reaches it, and a reader is the same
  database through a read-only role. Neither is handed to a test.
  `db.get('authDb')` throws `UnknownDatabase` and doesn't compile.
- **`factories.get(name)`:** one per database, from
  `test/factories/<construct>.ts` at the project root (`database.ts` for
  `Database`), exporting `createFactory(db)`. It's built once on that
  database's transaction for the test, so endpoints see the rows and they're
  rolled back with everything else.
  - A file named after no database of the app's, the auth tenant included,
    throws `UnknownFactoryFile`.
  - A file without `createFactory` throws `FactoryHasNoCreate`.
  - `test: { factories: '…' }` in `gkm.config.ts` moves the folder.
- **`browser.signIn(email)`:** generated when one auth server has the
  magic-link plugin and the app sends mail. It requests the link, reads it
  from the inbox (cleared first, so it's this request's), follows it, and
  returns the session the auth server reports. `SignInFailed` says which step
  failed.
- **`gkm init`** scaffolds `test/factories/database.ts` at the project root, in
  both layouts.

**Breaking:** `db` used to be one transaction, inferred from whichever database
the endpoints named first, and opened before every test. Nothing is inferred
now, and nothing opens before it's used. `featureTest({ database })` is gone.

**Moving an existing project:**
- move the factory to `test/factories/database.ts` at the root, keeping its
  `createFactory(db)` export;
- replace `createFactory(db)` with `await factories.get('database')`;
- replace `db.selectFrom(…)` with `(await db.get('database')).selectFrom(…)`;
- replace a hand-written magic-link helper with `browser.signIn(email)`;
- replace `FeatureContext<Browser, unknown>` with `FeatureContext<Browser>`.
