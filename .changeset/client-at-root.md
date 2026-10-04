---
'@geekmidas/cli': minor
---

:boom: Each API's typed client is the application's: written to the root's `.gkm/client/<surface>.ts`, imported as `@<name>/client/<surface>`

A root `gkm build` builds every backend from the workspace root, so a client written relative to the working directory landed at the root — where the `@<name>/api/client` export, pointing into `apps/api/.gkm/openapi/`, could not find it, and a Next.js site failed to build. The location was right and the reference was wrong: like the manifest, the client belongs to the application, so it is always written at the root — by `gkm build`, `gkm dev` and `gkm openapi` alike, whichever directory they run in — under `.gkm/client/` rather than `.gkm/openapi/`.

`gkm init` maps `@<name>/client/*` in the root tsconfig and in each frontend's own (an app's `paths` replaces the root's), and the templates import `@<name>/client/api`. What the client imports — `@geekmidas/client`, React Query and React — is installed at the root, where the client resolves it from, rather than in the api package, which no longer has a `./client` export (nor the frontends a dependency on it). The root's React is the workspace's: every frontend that imports a client runs that one, or its hooks see two.

An existing project: replace `@<name>/api/client` with `@<name>/client/api`, map `"@<name>/client/*": ["../../.gkm/client/*"]` in each frontend's tsconfig, and add `@geekmidas/client` and `@tanstack/react-query` to the root package.
