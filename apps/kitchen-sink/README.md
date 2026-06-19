# @geekmidas/kitchen-sink

A kitchen-sink example that exercises **every** `@geekmidas/toolbox` integration
point in one runnable app. Use it as a reference for how the pieces fit together.

## What it demonstrates

### Constructs (the app drives the infrastructure)

| Construct | File | Locally (`gkm dev`) | Deployed |
|-----------|------|---------------------|----------|
| `e` endpoint | `src/endpoints/*` | Hono route | API Gateway v2 |
| `f` function | `src/functions/reindex.ts` | direct invoke | Lambda |
| `c` cron | `src/crons/cleanup.ts` | — | EventBridge schedule → Lambda |
| `s` subscriber (topic fan-out) | `src/subscribers/userEvents.ts` | in-process pg-boss poller | SNS subscription |
| `q` queue (point-to-point) | `src/queues/emails.ts` | in-process pg-boss poller | SQS event-source |

### Services & DI (`src/services/`)

`database` (Kysely), `events` (topic publisher), `auth` (mock JWT), `auditStorage`,
`cache` (InMemoryCache), `storage` (S3 via `@geekmidas/storage`). Each `register`s
itself, reading its own config from the `envParser` — those `get(...)` calls are
**sniffed** into the deployment manifest so infra provisions exactly what's needed.
No sniffer guards or singletons: `ServiceDiscovery` caches resolved instances and a
failed connect during env-sniffing is swallowed (the var is still captured).

### Dev tooling

- **Telescope** — requests/logs/exceptions at `/telescope`
- **Studio** — DB browser at `/__studio`
- **OpenAPI** — generated on startup (`openapi: true`)
- **envkit** + `Credentials` — `src/config/env.ts`
- **Server hooks** — CORS + error handlers in `src/config/hooks.ts`

### Cross-construct event flow

`POST /users` does it all in one request: insert → publish `user.created` to the
**topic** (the `userEvents` subscriber fans out) → enqueue a welcome email on the
**queue** (the `emails` worker drains it) → audit → invalidate the cache. Both the
topic and the queue run over pg-boss locally and SNS/SQS when deployed — the same
code, transport chosen by the connection-string protocol.

## Running locally

```bash
# 1. Start Postgres (pg-boss reuses it for events/queues)
gkm docker            # generates docker-compose; or bring your own Postgres
docker compose up -d

# 2. Migrate
cp .env.example .env
pnpm migrate

# 3. Boot Hono + the subscriber/queue pollers
pnpm dev
```

Then:

```bash
# create a user → fires the topic event AND enqueues the email job
curl -XPOST localhost:3000/users -H 'content-type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com"}'

# watch the subscriber + queue worker logs in the console / at /telescope
curl localhost:3000/users               # served from cache when warm
curl -XPOST localhost:3000/uploads -H 'content-type: application/json' \
  -d '{"path":"docs/readme.txt","contentType":"text/plain","contentLength":12}'
```

## Building

```bash
pnpm build     # server + aws-apigatewayv2 manifests under .gkm/
```
