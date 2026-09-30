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

**Migrations hold schema, never data.** Tables, columns, constraints, indexes.
No inserts, updates or deletes against the application's rows.

- **Data the code defines lives in the code.** A permission catalogue, the
  system roles, a list of statuses — if a constant in the source already says
  what they are, a table holding them is a copy, and a copy drifts. Keep the
  constant; store only what users create (a custom role, which permission keys
  it grants), checked against the constant in code.
- **Define it once, typed, where every app can import it.** A catalogue in
  code belongs in a shared package (`packages/models`), declared `as const`
  so its keys are a union type. The API's guards, the web app's gates and a
  mobile app's gates then all name the same keys, and a typo — or a removed
  permission still checked somewhere — fails to compile instead of failing
  closed at runtime.
- **A rule is not a row.** "Every user is a member", "a super admin has every
  permission" are logic. A row per user, or a grant per permission, is a
  snapshot of the rule that goes stale the moment the rule's inputs change.
- **Nothing needs seeding to run.** If the app fails without some rows present,
  those rows are code in the wrong place. Sample and demo data comes from test
  factories — never a migration, never a deploy.
- **A backfill is the one exception.** When a schema change needs existing rows
  transformed — a new non-null column filled from an old one — do it in the
  same migration, keyed on the rows it transforms. It never inserts rows that
  were not there.
- **A test that only keeps two copies in step is the smell.** Delete a copy,
  and the test with it.
