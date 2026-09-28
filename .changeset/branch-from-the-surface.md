---
'@geekmidas/constructs': minor
'@geekmidas/cli': patch
---

Branch from the surface: `api.database(db)`; `api.endpoints` is gone

`api.get()` was already sugar for `api.endpoints.get()`, but a group had to
reach through the factory — `api.endpoints.database(database)`. The branching
methods now live on the surface like the verbs do: `api.database()`,
`api.session()`, `api.auditor()`, `api.actor()`, `api.publisher()`,
`api.authorizer()`, `api.authorize()`, `api.rls()` and `api.route()`. Each
returns a new factory and leaves the surface untouched, so a route built
straight from `api` gets none of what a group opted into. The factory itself is
private.

Two methods deliberately stay off the surface. `dependsOn` is per endpoint —
`api.post('/x').dependsOn([uploads])`. `services` is replaced by `dependsOn` on
constructs. `logger` is the surface's config (`new RestApi(id, { logger })`),
and `api.logger` is that logger.

**Migrating:** `api.endpoints.database(db)` → `api.database(db)`;
`api.endpoints.get(…)` → `api.get(…)`; `api.endpoints.dependsOn([x]).get(p)` →
`api.get(p).dependsOn([x])`.

The scaffold's `AGENTS.md` now shows what the scaffold generates: handlers
read `db` (not `services.database`), the router is imported from
`~/router.ts`, and a single endpoint can name its own database with
`.database(other)`.
