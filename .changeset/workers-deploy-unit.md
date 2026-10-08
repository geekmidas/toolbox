---
'@geekmidas/cli': minor
'@geekmidas/events': patch
'@geekmidas/constructs': patch
'@geekmidas/manifest': patch
---

A Worker is its own deploy unit on a server target

`gkm build --provider server --production` now writes an entry for each `Worker` that has crons, queue consumers or topic subscribers, in the app whose directory holds that work, and bundles it to `.gkm/server/dist/worker-<worker>.mjs`. It registers the drivers its target needs, starts every cron (through pg-boss), consumer and subscriber the worker owns, and serves only `GET /health` on `PORT`: `200` when every consumer started and every broker connection answers, `503` otherwise. On `SIGTERM` it stops pulling messages and scheduling crons, lets the handlers in flight finish, closes its broker connections and database pools, and exits `0` within `GKM_SHUTDOWN_TIMEOUT_MS` (default 8000), or `1` at the deadline.

`gkm docker` writes a Dockerfile per worker (`.gkm/docker/Dockerfile.<worker>`), built inside Docker like a backend's, with credentials from the `gkm_credentials` BuildKit secret; the runner is the bundle on `node` with `tini` and a `HEALTHCHECK` on `/health`.

`gkm compose` runs each worker as a service with no Caddy route and no published port, `restart: unless-stopped`, log rotation, its own `0600` env file holding exactly the keys its constructs read, and `depends_on` the stack's infrastructure; it starts after migrations, the plan lists it, and `verify` waits for its Docker health check. Dokploy deploys each worker as an application with no domain after the backends, checked by Dokploy's status and rolled back like any app. A worker with topic subscribers in a build whose broker is SNS fails with `WorkerSubscribersNeedPush`.

The generated `queues.ts`, `subscribers.ts` and `crons.ts` no longer install their own `SIGTERM` handlers; they export `stopQueues`, `stopSubscribers` and `stopCrons`, and a status function each, for the entry that runs them. pg-boss connections name themselves to Postgres with `GKM_APP_NAME` when it is set.
