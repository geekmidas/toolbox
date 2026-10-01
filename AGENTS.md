# Agent conventions

Rules for anyone — human or agent — writing code in this repository. The stack,
layout, and architectural patterns live in [CLAUDE.md](./CLAUDE.md); this file is
for conventions that are easy to get wrong and cheap to state.

## Validation schemas (Zod)

**Use Zod's top-level format validators. Never chain a format onto
`z.string()`.**

```ts
// yes
z.email()
z.url()
z.uuid()

// no
z.string().email()
z.string().url()
z.string().uuid()
```

Zod 4 moved the formats out of `ZodString`, where they were methods on a type
they did not belong to, and made each one a schema in its own right. The chained
form is deprecated: it still runs, but it types as a `ZodString` carrying a
check, so a format cannot be composed, extended, or narrowed the way a schema
can. Emitted JSON Schema and OpenAPI also differ between the two, and an API's
published contract should not depend on which spelling someone reached for.

This applies everywhere Zod is used — endpoint bodies, outputs, params, queue
and topic payloads, tests, benchmarks, docs, and the templates `gkm init`
scaffolds.

**Not affected:** `@geekmidas/envkit`'s parser has its own builder, and
`get('ADMIN_EMAIL').string().email()` is that API rather than Zod's. Leave it
alone.

## Database hygiene

A database construct's folder holds two folders and nothing else:
`db/<construct>/migrations/` for the schema's history, and
`db/<construct>/seeds/` for the reference data the app needs to run.

**Migrations hold schema, never data.** Tables, columns, constraints, indexes,
extensions. No inserts, updates or deletes against the application's rows.

- **Reference data is a seed.** A permission catalogue, the system roles and
  what they grant, a list of statuses — rows the app needs in order to run —
  are written by a seed in `db/<construct>/seeds/`, never by a migration.
- **A seed is an upsert, run every time.** There is no history: every seed
  runs on every pass, after the migrations, so changing what it writes and
  running it again is how the change is applied. Write
  `onConflict(…).doUpdateSet(…)` (or `doNothing()`), never a bare insert.
- **Seeds run on every stage, production included.** Each is handed the stage
  — `seed(db, { stage })` — and one that belongs only somewhere returns early
  (`if (stage === 'production') return;`). A `.sql` seed has no stage, so it
  must be right everywhere.
- **Define it once, typed, where every app can import it.** A catalogue in
  code belongs in a shared package (`packages/models`), declared `as const` so
  its keys are a union type, and the seed writes the table from that constant
  — so the two cannot drift, and no test is needed to keep them in step. The
  API's guards, the web app's gates and a mobile app's gates all name the same
  keys, and a typo fails to compile instead of failing closed at runtime.
- **Sample data is factories'.** Demo users, a tournament for a test — those
  come from test factories, never a seed and never a migration.
- **A backfill is the one data change a migration makes.** When a schema
  change needs existing rows transformed — a new non-null column filled from
  an old one — do it in the same migration, keyed on the rows it transforms.
  It never inserts rows that were not there.

```bash
gkm migrate         # migrations only
gkm seed            # migrations, then seeds
gkm dev --migrate   # migrate before the apps start
gkm dev --seed      # migrate and seed before the apps start
```

`gkm test` and the `@geekmidas/cli/vitest` setup migrate and seed the test
stage before any test runs.

## Feature tests

A feature test imports `it` from `#test` — the harness `gkm test` generates —
and asks for what it uses by construct name. Nothing is imported or built by
hand:

```typescript
it('lets a member join a tournament', async ({ browser, db, factories }) => {
  const factory = await factories.get('database');
  const tournament = await factory.insert('tournaments', {});

  await browser.signIn('ada@example.com');
  await browser.api.post('/tournaments/{id}/join', {
    params: { id: tournament.id },
  });

  const app = await db.get('database');
  // … assert on what was written …
});
```

- **`db.get(name)`** — the app's own databases by service name, each this
  test's transaction, opened on first use and shared with the endpoints. A
  tenant an auth server owns is reached through that server, never directly;
  a reader is not handed over.
- **`factories.get(name)`** — one factory per database, from
  `test/factories/<construct>.ts` at the project root, exporting
  `createFactory(db)`, on the same transaction.
- **`browser.signIn(email)`** — sign in the way a person does, through the
  auth server's magic link and the app's inbox. Returns the session.
