---
'@geekmidas/cli': patch
---

The scaffolded AGENTS.md sets standards for Kysely queries and relations

A project with a database gets a "Writing queries and relations" section:
camelCase in TypeScript through `CamelCasePlugin` (snake_case in Postgres and in
migrations; `sql.ref` in raw fragments), `Generated`/`Selectable`/`Insertable`
types, every `*_id` a foreign key with its `onDelete` written out (`restrict`
by default, `cascade` for owned rows, `set null` for optional links) and an
index, related rows nested in one query with `jsonArrayFrom`/`jsonObjectFrom`
rather than a query per row, multi-table writes in `withTransaction`, and
cursor pagination with `paginatedSearch`.

The scaffold follows it: `constructs/database.ts` passes
`plugins: [new CamelCasePlugin()]` to the construct — written out, the
project's to keep or change — with a camelCase schema, and a single-app
project's tests connect through the construct (`connection: database`) so they
use the same plugins the app does.
