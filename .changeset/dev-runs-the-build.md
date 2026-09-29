---
'@geekmidas/cli': patch
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
