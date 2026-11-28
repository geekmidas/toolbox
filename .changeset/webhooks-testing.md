---
'@geekmidas/constructs': minor
---

A `featureTest` runs an app's webhooks in-process, on MSW and the test's clock

A `Webhooks` construct is loaded with the app's other constructs, and its
tenant is bound to the test's transaction even when the app does not export it
on its own. Two seams are replaced, and nothing else:

- `hooks.transport` sends through `fetch`, which MSW intercepts. The new `msw`
  fixture adds handlers for one test (`msw.use(http.post(url, …))`). A delivery
  nothing answers never leaves the process: it fails as a connection would,
  with `WebhookReceiverNotFaked` (a `TypeError`).
- `hooks.clock`, a new field defaulting to `() => new Date()`, reads the new
  `clock` fixture: frozen at the test's start, moved by `clock.advance('1m')`
  (`ms`/`s`/`m`/`h`/`d` or milliseconds) and `clock.set(date)`. No global fake
  timers, so Postgres and pg-boss are unaffected. The subscription client's
  rotation overlap is reckoned by it too.

The new `cron(c).run()` fixture runs a cron on demand, as the server side of
the test, and delivers what it published before resolving to its output.
