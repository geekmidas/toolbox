---
'@geekmidas/cli': patch
'@geekmidas/constructs': patch
---

`gkm dev` runs the build's own pipeline, and starts an auth server

`gkm dev` had its own copy of the steps from constructs to a server entry, and
each time `gkm build` learned something about constructs, dev did not. An auth
app (`BetterAuth`, whose routes are a wildcard no glob finds) crashed on start
with `Cannot find module '.gkm/server/app.js'`. Dev now calls the same
`buildApp` the build does, so the two generate the same entry.

Whether a surface serves itself is now asked of the construct (it has a
`server()`), not inferred from a glob that found nothing.

Also fixed on the way, each found by running `gkm dev` against a real app:

- The generated `subscribers.ts` and `queues.ts` imported `@geekmidas/events`
  even when the app declared no Topic or Queue, so any app without that package
  installed crashed in dev.
- Restarting or stopping the dev server ran `kill -9` on every process with a
  socket on its port — the browser, the web app's server — not only the one
  listening on it.
- `gkm dev` at a workspace root ran turbo with no filter, so turbo also ran the
  root package's own `dev` — `gkm dev` again — and every app started twice,
  fighting over its port. Dev now names each app's package, as `gkm build` does.
- Every app in a workspace asked for port 3000, because the CLI turned a
  missing `--port` into 3000 before the workspace's port was consulted.
- A `Worker`'s crons never scheduled on a server. They are now scheduled
  through the events broker — the app's one pg-boss, as the broker's role, in
  its schema — rather than a second pg-boss on the worker's database as the
  runtime role, which could neither create a schema nor use the broker's.
  Reconcile resolves the broker's connection strings for a declared worker on
  pg-boss even when no queue or topic is declared.
- From an app with its own tsconfig — a Vite or Next frontend — every `gkm`
  command failed to load another app's constructs through the root tsconfig's
  path aliases. The hook that resolves them was installed with
  `module.register()`, and tsx 4.23's in-thread resolver threw before it was
  asked; it is now installed with `module.registerHooks()` when Node has it.
