# @geekmidas/kitchen-sink

A kitchen-sink example that exercises **every** `@geekmidas/toolbox` integration
point in one runnable app. Use it as a reference for how the pieces fit together.

## What it demonstrates

### Resources (`src/constructs/`) — the app declares, the target provides

Nothing here is built by hand and nothing lists a service. Each declaration is
what makes a container exist locally, what gets created inside it, and what URL
is injected — `gkm dev` reconciles all of it before the server starts.

| Construct | File | Declares | Locally (`gkm dev`) | Deployed |
|-----------|------|----------|---------------------|----------|
| `KyselyDatabase` | `src/constructs/database.ts` | `KITCHEN_SINK_URL` | Postgres container, `kitchensink` database | RDS |
| `.schema()` tenant | `src/constructs/auth.ts` | `AUTH_DB_URL` | the `authdb` schema, on its own search path | own role, no grant to the app |
| `BetterAuth` | `src/constructs/auth.ts` | `AUTH_SECRET` | a real auth server on the tenant above, signing in by magic link | same server, real mail |
| `Cache` | `src/constructs/cache.ts` | `SESSIONS_URL` | Redis + the HTTP proxy the client speaks | Upstash |
| `ObjectStorage` | `src/constructs/storage.ts` | `UPLOADS_URL` | MinIO container, `uploads` bucket | S3 bucket |
| `Email` | `src/constructs/email.ts` | `MAIL_URL`, `MAIL_FROM` | Mailpit — a real inbox on its own port | SES over SMTP |
| `t` topic | `src/constructs/topics.ts` | `USERS_PUBLISHER_CONNECTION_STRING` | pg-boss, in the declared database | SNS topic |
| `q` queue | `src/queues/emails.ts` | `EMAILS_PUBLISHER_CONNECTION_STRING` | pg-boss, in the declared database | SQS queue |

Ports are allocated, not fixed, so several projects run at once; the app never
sees one. Run `gkm setup` to converge the containers without starting the server.

### Handlers

| Construct | File | Locally (`gkm dev`) | Deployed |
|-----------|------|---------------------|----------|
| `e` endpoint | `src/endpoints/*` | Hono route | API Gateway v2 |
| `f` function | `src/functions/reindex.ts` | direct invoke | Lambda |
| `c` cron | `src/crons/cleanup.ts` | — | EventBridge schedule → Lambda |
| `s` subscriber (topic fan-out) | `src/subscribers/userEvents.ts` | in-process pg-boss poller | SNS subscription |
| `q` queue worker (point-to-point) | `src/queues/emails.ts` | in-process pg-boss poller | SQS event-source |

Each reaches a resource by *consuming its construct* — `.database(database.service)`,
`.services([uploads.service, mail.service])`, `.publisher(users.publisher)`. No
handler names a host, a port, a bucket, a broker, or a provider.

### Services & DI (`src/services/`)

What is left after the resources became constructs: `auth` (mock JWT),
`auditStorage`, and `cache` (InMemoryCache). None of them is a resource — nothing
is provisioned for them and nothing has an address — so they stay `Service`s,
`register`ing themselves from the `envParser`. Those `get(...)` calls are
**sniffed** into the deployment manifest, so infra still provisions exactly what
is needed.

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
# 1. Containers, databases, buckets, and URLs — all derived from src/constructs
gkm setup

# 2. Migrate (through `gkm exec`, which is what injects the database URL)
pnpm migrate

# 3. Boot Hono + the subscriber/queue pollers
pnpm dev
```

There is no `docker-compose.yml` to write and nothing to copy into `.env`:
`gkm dev` runs the same reconcile as `gkm setup`, so step 1 is optional.

Then:

```bash
# create a user → fires the topic event AND enqueues the email job
curl -XPOST localhost:3000/users -H 'content-type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com"}'

# watch the subscriber + queue worker logs in the console / at /telescope
curl localhost:3000/users               # served from cache when warm

# sign in by magic link — this sends real mail, to Mailpit
curl -XPOST localhost:3000/api/auth/sign-in/magic-link \
  -H 'content-type: application/json' -d '{"email":"ada@example.com"}'

# open the inbox, follow the link (curl -c to keep the cookie), then:
curl -b /tmp/gkm.cookies localhost:3000/api/auth/get-session

# a presigned upload URL, signed for MinIO
curl -XPOST localhost:3000/uploads -H 'content-type: application/json' \
  -d '{"path":"docs/readme.txt","contentType":"text/plain","contentLength":12}'
```

The welcome mail the queue worker sends is really sent: open Mailpit's inbox on
the port `gkm setup` printed (`cat .gkm/ports.json` — the `mailpit-web` entry)
and it is there.

## Testing

```bash
pnpm test      # the whole suite, against real containers
pnpm test:watch
```

`gkm test` is what makes this work: it reconciles a **`test` stage** — its own
database, its own roles, its own bucket — injects the URLs the constructs
declared, and then runs vitest. There is nothing to set up and no `.env` to
write, and the suite refuses to run without it, because an app with no addresses
has nothing to test.

**What it drives is the generated entry point**, the same `.gkm/server/app.ts`
that `gkm dev` runs, booted in-process with a `serve` that listens on nothing.
Hono dispatches through `app.request()`, so there is no port to collide over —
and `start()` still brings up the subscriber and queue pollers, which is most of
what the suite is about.

That choice is the point. The entry is where driver registration lives, and a
mismatch between the driver it registers and the URL the target composes is
invisible to every unit test in the repo, because no unit test loads it. It is
also the bug this suite was written after.

Nothing is mocked:

| Spec | What it proves |
|------|----------------|
| `wiring.spec.ts` | the app boots, the right cache driver was registered, the hooks mounted, CORS came off the surface |
| `auth.spec.ts` | magic-link sign-in through **real mail in Mailpit** — request, read the inbox, follow the link, hold the session |
| `users.spec.ts` | CRUD, schema validation, the cache serving and being invalidated, the session gate refusing and allowing |
| `events.spec.ts` | `user.created` **and** `user.updated` fanned out on the topic into rows; the queue worker sending the welcome mail, once |
| `uploads.spec.ts` | a presigned URL that really accepts bytes, and the `open` patterns as an enforced bucket policy — 200 on `brand/**`, 403 elsewhere |

Assertions wait on outcomes rather than sleeping: a subscriber and a worker run
on their own clock, so the request that caused the work returns before the work
is done.

### The other event backend

```bash
pnpm test:sns   # currently fails, deliberately — see below
```

The same suite is meant to run over SNS and SQS against the local AWS emulator,
which is why `services.events` reads `KITCHEN_SINK_EVENTS`: the handlers do not
change, only the connection string's protocol does, and that claim is worth
testing rather than asserting.

It does not run yet. The local target refuses with `UnprovisionedEventsBackend`
— SNS and SQS are addressed by ARN, and nothing creates the topic, the queue or
the subscription in the emulator, so there is no URL to compose. The event
clients already accept a custom endpoint; what is missing is the provisioning
step beside the one that creates buckets in MinIO. Failing loudly there is
better than composing a string that fails at the first publish.

## Building

```bash
pnpm build     # server + aws-apigatewayv2 manifests under .gkm/
```
