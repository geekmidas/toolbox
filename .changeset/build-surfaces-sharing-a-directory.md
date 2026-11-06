---
'@geekmidas/cli': patch
---

Two surfaces in one directory each build their own endpoints

Two `RestApi`s can share a `path` — an API and its webhooks, both `apps/api` — and each is an app of its own. The build recognised the app it was building by its folder alone, so building the second built the first:

- Its server, and its image, served the first surface's endpoints, and its own routes answered `404`.
- On AWS the second app's build generated the first surface's Lambdas again, into the same `.gkm/aws` — which each build empties first — so no handler was ever generated for the second surface's endpoints. They were left in `.gkm/manifest/aws.ts` with their source as their handler, `apps/api/src/webhooks.ts#paymentsWebhook`, instead of a built one.

Each build is now told which app it is, and serves the surface that app is named for (`Webhooks` is the app `webhooks`). In a directory that more than one surface names, each app writes a tree of its own, `.gkm/aws/<app>/` and `.gkm/server/<app>/`, so neither app's build removes or overwrites the other's, and the manifest has a built handler for every endpoint of both. A directory with one surface is built where it always was; none of its handler paths move.

`gkm build` takes `--app <name>` to build one app by its workspace name. The Dockerfile of an app sharing its directory passes it, and copies the bundle from that app's tree — as does the Dockerfile of a worker or processors that app hosts. Every other Dockerfile is unchanged. `gkm dev` hands the build its app and starts the entry from where that build wrote it.
