---
'@geekmidas/manifest': minor
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
'@geekmidas/cloud': patch
---

:boom: One manifest for every command: discovery nests every handler, `.calls()` is removed

- **Discovery writes the whole application.** Every endpoint is nested in its surface, every WebSocket route in its socket (`routes`), every cron and function as its own node, and every queue consumer and subscriber where it runs — each with the edges its `.dependsOn([...])` declares, and `owner` naming the `Worker` that runs it. `gkm dev`, `gkm exec`, `gkm test`, `gkm build` and every deploy read the same graph. Before, a surface's endpoints reached the manifest only in a `gkm build --provider aws`, and every other command carried their edges beside it in a side map only some readers saw. So locally a bucket an endpoint used had no caller, and a phone was handed `localhost` links to it (#337).
- **A handler is its source** — `apps/api/endpoints/users.ts#createUser` — until a build that generates one handler per function points it at the generated entry. That is the only thing a build changes in the manifest (`withHandlers`, replacing `withRoutes`).
- **`.calls()` is removed** from `RestApi`, `WebSocketApi` and `Worker`. A handler's `.dependsOn([...])` is the edge, and also hands it the client; a worker's process reaches the edges of everything it owns.
- **A surface's `auth` is an edge**, `{ target, kind }`, read by `dependenciesOf` — not an id with a hidden `calls` copy beside it.
- **An auth server says it serves itself** (`servesItself: true`) instead of being inferred from a surface that listed endpoints.
- **A file server follows its bucket onto the LAN.** On a local stage with a mobile app, a `FileServer` whose bucket a phone-facing endpoint uses links on the LAN address too: the edge is to the bucket, so #336 never moved the server.
