---
'@geekmidas/cli': minor
---

`gkm dev` serves a discovery endpoint on `127.0.0.1:4983`

A tool can now find what `gkm dev` is running without being told any ports.
`GET /__gkm` lists every running workspace on the machine — name, stage,
construct manifest, and each app with its port, URL, status and data APIs
(Telescope's JSON API, `/__gkm/db`, `/__docs`). `GET /__gkm/events` streams
apps starting, stopping and reloading as server-sent events, and
`/__gkm/workspaces/<id>/apps/<app>/…` forwards to an app's data APIs so a
client needs one origin. `gkm dev` prints a connect URL carrying the token.

Every `gkm dev` registers in `~/.gkm/dev`; the first to bind the port serves
it, and another takes over when it exits. It is loopback-only, needs the token
on every request, checks the `Host` header against DNS rebinding, answers only
browser origins listed in the new `dev.allowedOrigins` (empty by default), and
is read-only. `dev.discoveryPort` or `GKM_DISCOVERY_PORT` moves it. The
response types are exported from `@geekmidas/cli/config`.
