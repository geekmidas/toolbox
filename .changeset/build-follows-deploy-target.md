---
'@geekmidas/cli': minor
'@geekmidas/cloud': minor
---

:boom: `gkm build` builds for where the project deploys; the legacy providers are gone, and an SST deploy mounts its routes

- **No legacy providers.** `aws-apigatewayv1`, `aws-apigatewayv2` and `aws-lambda` are gone, along with `--providers` and the `providers` block in `gkm.config.ts` (`providers.server.port`/`production`/`enableOpenApi` and `providers.dokploy` included). A bare `gkm build` follows `deploy.default`; `--provider aws|server` remains only as an override, which is what a Dockerfile's `gkm build --provider server` is.
- **`sst` is a deploy target.** `deploy: { default: 'sst' }` builds one Lambda per construct and resolves the AWS backends (cache, storage, events) everywhere, `gkm dev` included. Without it an SST project was normalised into a Dokploy one. `gkm init --deploy sst` writes it, and its deploy scripts are `gkm build && sst deploy --stage <stage>`.
- **One AWS tree, one manifest at the root.** Handlers are written to `<app>/.gkm/aws/{routes,functions,crons,queues,subscribers}`, and the manifest to the workspace root's `.gkm/manifest/aws.ts` (or `server.ts`), with every handler path measured from the root, where `sst.config.ts` runs. Routes fold into the surface the app serves rather than the first one without endpoints. `gkm init` maps `@<name>/manifest` to it in the root tsconfig, and no longer exports a `./endpoints` the AWS build never writes.
- **`fromManifest` mounts each surface's endpoints.** An API Gateway used to deploy with no routes. Each endpoint is now its own Lambda, linked only to what it depends on, in the database's VPC when it reaches one (queue consumers too). `iam` is enforced by the gateway; every other authorizer runs in the handler.
- **A `--production` server runs its background work.** Queues, crons and subscribers are wired into the production entry. They used to be left out unless `providers.server.production.subscribers` said `'include'`, so a Docker deploy never ran its worker.
- **`gkm deploy:init` writes nothing into `gkm.config.ts`.** The `providers.dokploy` block it wrote was never read; the ids are rediscovered by name and kept in the state file.
