# Running in Production

What to set up before a stage serves real traffic, and what `gkm` does for you
once it does. Each section is short; follow the links for the detail.

## Checklist

- [ ] The stage's secrets are in a store CI can read, and every value the
      constructs need is set ([Secrets](#secrets-and-the-master-key)).
- [ ] Mail goes through a real SMTP server and buckets are real object
      storage — set by hand, or created by a provider
      (`deploy.objects.<stage>: { provider: 's3' }`, which the deploy
      creates) — and no deploy passes `--allow-dev-services`
      ([Mail and object storage](#mail-and-object-storage),
      [Providers](./providers.md)).
- [ ] Deploy state is in a shared store (SSM or S3), not on one laptop
      ([State](#state)).
- [ ] Every backend answers `GET /health` ([Health checks](#health-checks)).
- [ ] Each surface and worker is given the `Telemetry` construct, its app has
      `@geekmidas/telescope` and the OpenTelemetry packages, and
      `deploy.telemetry` says where each deployed stage sends it — on
      `gkm compose` it runs OpenObserve when nothing is named
      ([Telemetry](#telemetry), [Logs](#logs)).
- [ ] Logs are redacted (the default) ([Logging](#logging)).
- [ ] The platform's stop timeout is longer than `GKM_SHUTDOWN_TIMEOUT_MS`
      ([Graceful shutdown](#graceful-shutdown)).
- [ ] You know how to roll back ([Rollback](#rollback)).
- [ ] Every seed is an idempotent upsert: a deploy runs each one, every time
      ([Migrations and seeds](#migrations-and-seeds)).
- [ ] Each `Worker`'s image is deployed beside the APIs, and its health
      check passes ([Workers](#workers)).
- [ ] On `gkm compose`, a server running more than one stack uses
      `proxy: 'traefik'` for each of them ([One server, several stacks](#one-server-several-stacks)).

## Secrets and the master key

There are two keys, and they do different jobs.

**The stage key** encrypts the stage's secrets at rest. With the default
`'file'` store, the secrets live in `.gkm/secrets/<stage>.json` and the key in
the CLI's home:

```
~/.gkm/keys/<namespace>/<project>/<stage>.key
```

`<namespace>/<project>` is the deploy identity, the same one a Dokploy deploy
claims its project by. Set `GKM_HOME` to move the CLI's home (a CI job, a
shared runner, a test). A key still at the old `~/.gkm/<folder>/<stage>.key`
is copied to the new place the first time it is read.

`.gkm/` is gitignored, so the file store cannot serve a deploy from CI. On
AWS, keep each deployed stage in SSM Parameter Store or Secrets Manager, in
the stage's own account — or pass your own `SecretsStore`:

```typescript
// gkm.config.ts
export default defineWorkspace({
  // …
  secrets: { store: { provider: 'ssm', region: 'eu-west-1' } },
  // or: { provider: 'secrets-manager', region: 'eu-west-1', kmsKeyId?: '…' }
});
```

| | SSM (`'ssm'`) | Secrets Manager (`'secrets-manager'`) |
|---|---|---|
| Name | `/gkm/<project>/<stage>/secrets` | `gkm/<project>/<stage>/secrets` |
| Size | 8 KB (free under 4 KB, advanced tier past it) | 64 KB |
| Cost | free for most stages | monthly per secret, plus API calls |
| Versions | parameter history | `AWSCURRENT` / `AWSPREVIOUS`, recovery window on delete |
| KMS | `aws/ssm` | `aws/secretsmanager`, or `kmsKeyId` |

Start with SSM; move a stage to Secrets Manager when its third-party
credentials outgrow 8 KB — a write past a store's limit fails with
`StageSecretsTooLarge` before anything is sent — or when you want its
versioning or your own KMS key. The credentials that manage and deploy a stage
need:

- **SSM:** `ssm:GetParameter` and `ssm:PutParameter` on
  `arn:aws:ssm:<region>:<account>:parameter/gkm/<project>/<stage>/secrets`.
- **Secrets Manager:** `secretsmanager:GetSecretValue`, `PutSecretValue`,
  `CreateSecret` and `DescribeSecret` on
  `arn:aws:secretsmanager:<region>:<account>:secret:gkm/<project>/<stage>/secrets-*`.
- **A customer-managed key** (`kmsKeyId`): `kms:Decrypt`, `kms:Encrypt` and
  `kms:GenerateDataKey` on it.

Move a stage between stores with `gkm secrets:migrate --stage production --to
secrets-manager`, then point `secrets.store` at the new one. See
[The secrets store on AWS](./deployment.md#the-secrets-store-on-aws) for the
full comparison and the switch, step by step.

Manage the secrets with:

```bash
gkm secrets:init --stage production      # create the stage's secrets and key
gkm secrets:set STRIPE_KEY sk_live_… --stage production
gkm secrets:import ./secrets.json --stage production
gkm secrets:show --stage production      # masked; --reveal to show values
gkm secrets:rotate --stage production    # rotate generated service passwords
```

A construct that needs a value nobody can derive fails the deploy with
`MissingSuppliedSecret`, naming the key and the `gkm secrets:set` command. A
third party's credentials that are set but that their construct's schema
refuses fail it with `CredentialsInvalid`, naming each key and field. An
app whose environment is incomplete fails with `MissingEnvVars`. None of them
waits for the app to crash on boot.

**The master key** decrypts the secrets baked into a production bundle.
`gkm build --production --stage <stage>` encrypts the stage's secrets into the
bundle with a fresh key on every build, and:

- writes that key to `.gkm/server/master.key` (mode `0600`), which the
  generated `.dockerignore` excludes from every image;
- prints only its **fingerprint**, the first 8 hex characters of its SHA-256,
  so you can tell which key a build used without the logs holding the key.

The key never travels as a build argument. When a deploy builds an image, the
encrypted payload is passed as a BuildKit secret
(`--secret=id=gkm_credentials,src=<file>`), read by a
`RUN --mount=type=secret` step, and the temporary file is removed afterwards.
Nothing lands in `docker history` or `ps`.

`GKM_MASTER_KEY` reaches the container **only at runtime**: the Dokploy target
sets it in the application's environment. If you run an image yourself, set
`GKM_MASTER_KEY` to the contents of `master.key` from the same build.

::: warning `DeployResult.masterKey` is deprecated
A deploy result still carries `masterKey`, but it will be removed: results are
easily logged. Read the key from the runtime environment or from
`.gkm/server/master.key` instead.
:::

## What each app holds

An app's environment is composed from its edges, not from everything the stage
resolves. It gets what its own surface provides and requires, and what each
construct it depends on provides — with one rule for surfaces: an app that
calls another surface is given that surface's **URL and nothing else**. Its
CORS list and cookie domain are the surface's own settings.

The auth server is where that matters most. `BetterAuth` runs in its own app,
which holds `AUTH_SECRET`, the auth tenant's database URL and the mail keys its
sign-in links go out through. An API whose endpoints `.dependsOn([auth])` holds
`AUTH_URL` alone: the handler's `services.auth` is a client that asks the auth
app `GET <basePath>/get-session` with the request's cookie, so the API never
builds Better Auth, never opens its tenant and cannot sign a session. See
[The auth server, and what its callers hold](/packages/constructs#the-auth-server-and-what-its-callers-hold).

`gkm compose` writes each backend's environment to its own `<app>.env`, so
what an app holds is a file you can read.

## Mail and object storage

On a server target (`dokploy`, `compose`), a deployed stage's mail and buckets
come from its secrets. gkm runs no Mailpit or MinIO for it unless told to:

```bash
gkm secrets:set MAIL_URL 'smtp://user:password@smtp.example.com:587' --stage production
gkm secrets:set MAIL_FROM 'noreply@example.com' --stage production
gkm secrets:set UPLOADS_URL 's3://AKIA…:…@acme-uploads?region=eu-west-1' --stage production
gkm secrets:set UPLOADS_SERVER_URL 'https://files.example.com' --stage production
```

Or let gkm ask for each one: `gkm secrets:add --stage production` walks every
key the stage lacks across all its apps — set it now, skip it, or stop — and
builds each you set by kind: a bucket from its provider, mail from its service
(Resend, SES, Postmark, Mailgun or any SMTP server), a third party's
credentials field by field from their schema. Each is saved to the stage's
store as soon as it is built. See
[Guided secrets](./deployment.md#guided-secrets).

The names follow the constructs: `Email('Mail')` reads `MAIL_URL` and
`MAIL_FROM`, `ObjectStorage('Uploads')` reads `UPLOADS_URL`, its file server
`UPLOADS_SERVER_URL`. Any SMTP provider works, and any S3-compatible store —
add `&endpoint=https://…` to the URL for one that is not S3. A deploy missing
any of them fails before it builds, provisions or writes anything, with
`ExternalServicesNotConfigured` listing every key it lacks.

A bucket's credentials are optional, and come from one of two places:

- **The bucket's URL** — `s3://KEY:SECRET@bucket?region=…`. Percent-encode the
  secret (`/` is `%2F`, `+` is `%2B`). A key here is used for this bucket
  only, and wins over anything else.
- **The stage's shared pair** — `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`,
  set once, used by every bucket whose URL carries no key. With neither, the
  S3 client's default chain applies, which is how a host with a role signs.

```bash
gkm secrets:set AWS_ACCESS_KEY_ID 'AKIA…' --stage production
gkm secrets:set AWS_SECRET_ACCESS_KEY '…' --stage production
```

Prefer a key per bucket, scoped to that bucket: an app that reads two buckets
then holds two narrow keys rather than one that opens both. The keys are never
printed — storage errors and the logger replace a URL's userinfo with
`REDACTED`.

Or let gkm create the buckets. With `deploy.objects.production: { provider:
's3' }`, every `gkm deploy --stage production` — with the stage account's
credentials, in CI the stage's role — creates each bucket (private, SSE-S3,
TLS-only, CORS for the stage's sites), an IAM user for it with a policy for
that bucket alone, and a key, and writes `UPLOADS_URL` (key included) and
`UPLOADS_SERVER_URL` into the stage's secrets, before its checks run. Each
later deploy repairs drift and says "up to date" when there is none; it never
deletes a bucket or a user. Rotate the key with `gkm deploy --stage production
--rotate-keys`. Every deploy checks the bucket answers that key. See
[Providers](./providers.md).

`--allow-dev-services` runs MinIO and Mailpit instead, for every bucket and
mail the stage does not account for — for a preview or a demo, never for
production: **Mailpit delivers no mail**, and MinIO keeps every object on one
container's disk with no backup. A key the stage set, or a provider backing
the kind, always wins. Each run that uses a dev service prints a warning and
emits a `dev-service.used` event, which a CI pipeline can fail on. See
[Deploy targets](./deploy-targets.md#mail-and-object-storage).

## The cache

On `gkm compose`, every declared cache — `new Cache('Sessions')` and
`database.cache('Sessions')` alike — lives in a Redis the stack runs beside
the apps, on every stage, local and deployed. It is a production service, not
a dev stand-in: on the compose network only with no published port, bounded at
256 MB with `allkeys-lru` eviction, persisted to an append-only file on the
`redis-data` volume, and password protected. A deployed stage's password is
generated on the first run and kept in its secrets as `REDIS_PASSWORD`; the
local stage uses the one generated for this machine with `gkm dev`'s logins. Each backend and worker that reads a cache gets
its URL (`SESSIONS_URL=redis://:…@redis:6379/0`) in its env file, and its image
registers the Redis cache driver.

To use a managed Redis instead, set the cache's URL in the stage's secrets —
the stack then runs no Redis for it:

```bash
gkm secrets:set SESSIONS_URL 'rediss://default:…@cache.example.com:6380' --stage production
```

Everything in a cache can be rebuilt, so losing the volume loses nothing but
warm entries. Dokploy keeps today's default — a table in the declared
database. See [Deploy with Docker Compose → The cache](./compose.md#the-cache).

## One server, several stacks

A `gkm compose` stack fronts itself with its own Caddy on 80 and 443, so a
second stack on the same server — another stage, another project — has
nowhere to go. Set `deploy.compose.proxy: 'traefik'` (for every deployed stage,
or per stage) and every stack registers its hosts with one shared Traefik edge
instead: the edge owns 80 and 443, Let's Encrypt and the redirect to HTTPS, and
`gkm compose --down` of one stack leaves the others served. Only each stack's
APIs and sites — and MinIO or OpenObserve when they are public — join the
edge's network; databases, Redis and workers never do.

Moving a running server from per-stack Caddy to the shared edge is a one-time
step: stop the stack's Caddy, then run `gkm compose` again. Until then it
refuses with `ComposeProxyClash`. See
[Proxy: Caddy or Traefik](./compose.md#proxy-caddy-or-traefik).

## State

A deploy records what it created for each stage: the project and application
ids, generated database passwords, each app's releases. Lose it and the next
deploy cannot find what it made.

- The default is `local`: `.gkm/deploy-<stage>.json`, mode `0600`. Fine for one
  person on one machine.
- For a team or CI, use `ssm` or `s3`, so every run sees the same state:

```typescript
// gkm.config.ts
state: { provider: 's3', bucket: 'acme-deploy-state', region: 'eu-west-1' },
```

Every run holds a lock on its stage. A second run fails with `StateLocked`,
naming who holds it. If a run crashed and left the lock behind:

```bash
gkm state:unlock --stage production
```

See [State stores](/guide/state) for the stores, the lock and migrating old
state.

## Health checks

Every production server entry answers `GET /health` with
`{ "status": "ok", "timestamp": … }`, before any of the app's own routes.
Backend images carry a Docker `HEALTHCHECK` on `/health`; site images (Next.js,
Vite, Node SSR) check `/`.

Each target checks the apps after releasing them:

| Target | What it asks | Passes when |
| --- | --- | --- |
| `dokploy` | `https://<host>/health` (backends), `/` (sites) | 3 consecutive 2xx, within 5 minutes |
| `compose` | `/health` (backends), `/` (sites), through the stack's Caddy — or the server's shared Traefik edge — over HTTPS with the certificate verified | a 2xx or 3xx |
| `sst` | each URL `run()` returns in `sst.config.ts`: `/health` for an API, `/` for a site | a 2xx |

On Dokploy the check is tunable:

```typescript
deploy: {
  dokploy: {
    endpoint: 'https://dokploy.example.com',
    verify: {
      healthCheckPath: '/health',   // default
      healthyAfter: 3,              // consecutive 2xx answers
      intervalMs: 2_000,            // between checks
      healthTimeoutMs: 300_000,     // per app
      deploymentTimeoutMs: 600_000, // waiting for Dokploy's own deployment
    },
  },
},
```

An app with no domain gets Dokploy's status check only. Every check emits a
`health.checked` event (see [the `deploy()` API](/guide/deploy-api)).

An API image answers HTTP and nothing else: a production build of a `RestApi`
leaves out crons, queue consumers and topic subscribers, and says so in the
build output. They run in their `Worker`'s image instead.

## Workers

Each `Worker` with crons, queue consumers or topic subscribers is a deploy unit
of its own: one entry, one image, one container. A workspace with several
workers gets one of each per worker.

`gkm build --provider server --production` writes the worker's entry beside the
server's, in the app whose directory holds the worker's work (the first backend
that generates a server, when its work sits outside every app):

```
apps/api/.gkm/server/workers/jobs/   # worker.ts, app.ts, crons.ts, queues.ts, subscribers.ts
apps/api/.gkm/server/dist/worker-jobs.mjs
```

The `crons.ts`, `queues.ts` and `subscribers.ts` it starts are the files
`gkm dev` runs, given only that worker's constructs. The process registers the
drivers its target needs, starts every cron (scheduled through pg-boss),
queue consumer and topic subscriber the worker owns, and serves one route:
`GET /health` on `PORT` (3000 in its image). It answers `200` when every
consumer started and every broker connection answers a query, and `503`
otherwise. Its connections to Postgres are named for the worker
(`application_name = 'Jobs'`), pg-boss's included.

`gkm docker` writes its Dockerfile, `.gkm/docker/Dockerfile.<worker>`. It is
built the way a backend is, entirely inside Docker: the host app's pruned slice,
installed, then `gkm build` with the credentials from the `gkm_credentials`
BuildKit secret. The runner is the worker's bundle alone on `node` with `tini`,
with a `HEALTHCHECK` on `/health` and no `EXPOSE`.

| Target | A worker runs as |
| --- | --- |
| `compose` | a service with no Caddy route and no published port, `restart: unless-stopped`, its own `0600` env file with exactly the keys its constructs read, checked by its Docker health check |
| `dokploy` | an application with no domain, released after the backends and checked by Dokploy's status (the container's own health check); rolled back like any app |
| `sst` | Lambdas, one per cron, queue and subscriber |

On a server target the broker is pg-boss, so each topic subscriber polls a queue
of its own. A build whose broker is SNS (server images for a project that
deploys to AWS) refuses a worker with topic subscribers with
`WorkerSubscribersNeedPush`: SNS pushes over HTTP, and a worker serves only its
health check. A worker reads the object storage keys its constructs reach
(`<BUCKET>_URL` and the S3 key pair), from the stage's bucket or the stack's
MinIO, as an API does.

## Telemetry

A process exports telemetry when it is given the
[`Telemetry` construct](./telemetry.md) — a `RestApi`, a `BetterAuth` server
or a `Worker` takes it like its logger. That is an edge in the manifest, and
it decides three things: the build of that process starts the OpenTelemetry
SDK, the build fails without the packages it needs, and the deploy hands that
process — and no other — the `OTEL_*` keys its stage resolves. A process
without the edge gets a stub that loads nothing.

`gkm build --production` writes a `telemetry.ts` beside `server.ts` (and each
worker's `worker.ts`). The server starts telemetry before it imports the app,
so the libraries the app loads are instrumented. It does nothing unless
`OTEL_EXPORTER_OTLP_ENDPOINT` is set — a stage that opted out, or `gkm test`.
When it is, it loads `@geekmidas/telescope/instrumentation` and starts the SDK
with:

- `service.name`: the surface's or worker's id — `OTEL_SERVICE_NAME`, the
  app's name, overrides it;
- `service.namespace`: the workspace name, and the construct's `attributes`;
- `deployment.environment.name` (and the older `deployment.environment`): the
  `STAGE` the deploy sets on every app.

The deploy sets the rest, for each process with the edge:

| Variable | Value |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | The provider's base URL. Traces go to `/v1/traces`, logs to `/v1/logs`. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Its login or headers. |
| `OTEL_SERVICE_NAME` | The app's name. |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` | `parentbased_traceidratio`, and the stage's `sampleRate` (1 by default). The rate also caps a caller's sampled flag: a request cannot force a trace the stage would not keep. |

### What is exported

The server is one bundled file, and OpenTelemetry's auto-instrumentations work
by hooking module loading — which sees nothing inside a bundle. So the two
signals that matter most are sent by explicit code instead:

- **A SERVER span per request.** The server mounts a Hono middleware ahead of
  every route. Each request becomes `GET /users/:id` — the route pattern, not
  the path — with `http.request.method`, `http.route`,
  `http.response.status_code`, `url.path`, `url.scheme`, `server.address`,
  `user_agent.original` and `client.address`. Never the query string, and no
  headers. A 5xx or a thrown error marks it `ERROR`, the exception recorded; a
  4xx does not. An incoming W3C `traceparent` is continued when it comes from
  one of the API's own sites or an internal caller, and any other caller's
  becomes a link on a new trace ([whose trace context is
  continued](/packages/telescope#whose-trace-context-is-continued)). The
  handler runs inside the span, so its logs and its outbound calls belong to
  it. The health check and `/ready` get none.
- **Every log record.** A logger made with `createLogger` from
  `@geekmidas/logger/pino` sends each record through the OpenTelemetry logs
  API as well as to stdout: the pino level as its severity, the message as its
  body, the record's fields as attributes — redacted exactly as stdout is —
  and the trace and span ids of the request it was logged in. A logger made
  with `pino()` directly gets the same with
  `hooks: { streamWrite: otelStreamWrite }` from `@geekmidas/logger/otel`.

- **The constructs' own spans.** Each construct records spans through the
  global tracer, so they reach the bundle's provider like the request's do: a
  CLIENT span per database query (`select orders`, with `db.system`, `db.name`,
  `db.operation` and `db.sql.table` — never a parameter value), cache and
  storage calls, email sends and `ExternalApi` calls. Each package's page lists
  its spans.
- **One trace across a queue.** A publish is a PRODUCER span whose context
  travels in the message; the worker's job is a CONSUMER span that continues
  it, so a request, the job it enqueued and that job's queries are one trace —
  on pg-boss, SNS, SQS and RabbitMQ. Crons start a trace of their own. See
  [Trace context](../packages/events.md#trace-context).

The auto-instrumentations still run (without `fs`) for what is loaded at run
time rather than bundled: outbound `fetch`, DNS and TCP, and the runtime's
metrics. A query also still carries its request's `request_id` in its SQL
comment.

An app whose process has the edge needs `@geekmidas/telescope` and its
`@opentelemetry/*` peer dependencies. The build checks they resolve, and fails
with `TelemetryPackagesMissing` — naming the app and the `pnpm --dir <app> add …`
that fixes it — when one does not. If a package is gone at run time anyway,
the server emits a `TelemetryUnavailable` warning and runs without telemetry:
a telemetry failure never stops the server.

If you call `setupTelemetry` yourself, it also takes `sampleRatio` (0–1, a
parent-based trace-id ratio; outside that range throws `InvalidSampleRatio`),
`serviceNamespace`, `deploymentEnvironment` and `handleSignals`.

### Where the telemetry goes

Where is the stage's, in `deploy.telemetry` — never the application's:

```ts
deploy: {
  telemetry: {
    staging: 'self-hosted',
    production: { provider: 'self-hosted', sampleRate: 0.1 },
    preview: { provider: 'otlp', endpoint: 'https://otlp.example.com' },
    scratch: false,
  },
}
```

- **`self-hosted`** — the target runs OpenObserve beside the apps. `gkm
  compose` does, and uses it for a stage that names nothing ([Logs](#logs)).
- **`otlp`** — any OTLP/HTTP endpoint — Grafana Cloud, Honeycomb, your own
  collector — with its `headers`.
- **`false`** — nothing is sent.

Dokploy runs no collector yet, and AWS has none, so a deployed stage there
that uses the construct names `otlp` or `false`; otherwise the deploy fails
before anything is built with `TelemetryProviderRequired`, and asking either
for `self-hosted` fails with `SelfHostedTelemetryUnavailable`. The stage's own
`OTEL_*` secrets are not passed to anything. Sites never get these keys: a
site's environment ends up in a bundle every browser downloads, and an
exporter's headers are a credential. The [Telemetry guide](./telemetry.md)
has the rest.

## Logs

On `gkm compose`, the self-hosted provider runs [OpenObserve](https://openobserve.ai)
in the stack and points each process with the `Telemetry` edge at it. In
short:

- **Options** are the provider's, per stage:
  `{ provider: 'self-hosted', port, retentionDays, public: { allow }, sampleRate }`.
  Data is kept 30 days by default (`retentionDays`, at least 3).
- **Reach it through an SSH tunnel.** It is published on `127.0.0.1:5080` of
  the server and nowhere else; `gkm compose` prints the
  `ssh -N -L 5080:localhost:5080 <user>@<host>` line to run, and the login.
  A `~/.ssh/config` entry with `LocalForward 5080 localhost:5080` makes it
  `ssh -N <name>`.
- **Mind ufw.** A port Docker publishes on every interface is opened by
  Docker's own iptables rules, ahead of ufw — `ufw deny` does not close it.
  That is why it is bound to loopback.
- **For a team, Tailscale**: bind the port to the machine's tailnet IP
  yourself, in the project's `docker-compose.<stage>.yml`, which `gkm compose`
  merges over the stack it generates.
- **Public, to some addresses**: `public: { allow: ['203.0.113.7'] }` serves
  it at `https://logs.<stage domain>` through the stack's edge, refusing every other
  address with 403, and publishes no port.

The root password is generated on the first run and kept in the stage's
secrets as `ZO_ROOT_USER_PASSWORD`. Every detail, and the tunnel and Tailscale
examples, is in [Deploy with Docker Compose → Telemetry](./compose.md#telemetry).

Every `gkm compose` service's Docker logs are rotated (`json-file`, 3 × 10 MB),
so a container's output never fills the disk.

## Logging

`createLogger` from `@geekmidas/logger/pino` redacts `DEFAULT_REDACT_PATHS`
(passwords, tokens, API keys, authorization headers, cookies, connection
strings and their nested forms) unless you say otherwise:

```typescript
createLogger();                               // default paths redacted
createLogger({ redact: ['user.ssn'] });       // merged with the defaults
createLogger({ redact: false });              // off: think twice
```

`pretty: true` is ignored when `NODE_ENV` is `production`, so production logs
stay JSON.

An `Error` is serialized with its type, message and stack under either `err`
(pino's own key) or `error` — `logger.error({ error }, 'Failed')` no longer
logs `"error":{}` — and redaction applies to both, URL credentials in a
message or a stack included.

A production server registers every endpoint the way `gkm dev` and a feature
test do, so a handler's context — `auditor`, `db`, `session`, `services`,
cookies and headers it sets — is the same in all three. An error a handler
throws is logged with its stack, and answered without it.

## Graceful shutdown

On `SIGTERM` or `SIGINT` a production server:

1. stops accepting connections and lets in-flight requests finish;
2. runs the shutdown hooks, which close every database pool;
3. exits `0`.

A worker:

1. stops pulling messages and scheduling crons;
2. lets the handlers in flight finish;
3. closes its broker connections, then its database pools;
4. exits `0`.

`GKM_SHUTDOWN_TIMEOUT_MS` bounds the whole drain. It defaults to `8000`, under
Docker's 10-second stop timeout, so the server exits on its own terms rather
than being killed mid-drain. Past the deadline it exits `1`, so a forced stop
shows, and a message a worker was handling is retried. If you raise it, raise the platform's stop timeout above it too.

When telemetry is on, buffered spans and logs are flushed on the same signal.

## Rollback

| Target | Rollback | Migrations and seeds |
| --- | --- | --- |
| `dokploy` | yes | applied, then seeded, by the deploy, before any app switches |
| `compose` | no | applied, then seeded, by the deploy, after the infrastructure starts and before any app |
| `sst` | no | run in the stack |

On Dokploy, the stage's state keeps each app's `releases`: `current`,
`previous`, and a `history` of the last 10. When `release` or `verify` fails,
the apps that failed go back to the image they ran before; with `--atomic`,
every app the run released goes back.

```bash
gkm deploy --stage production --atomic           # all-or-nothing release
gkm deploy:rollback --stage production --app api # one app back a release
gkm deploy:rollback --stage production --atomic  # every app back a release
```

Rollback restores images only. The environment stays the stage's current one,
and migrations are forward-only, so write migrations the previous release can
still run against. An app's first release has nothing to go back to.

Backends are released and checked before any site. A backend that fails stops
the run (`BackendDeployFailed`); a site that fails fails the run
(`FrontendDeployFailed`) after every site has been attempted.

## Migrations and seeds

A `dokploy` or `compose` deploy migrates the stage, then runs its seeds, every
time, before any app starts. Seeds keep reference data — roles, permissions,
plans — current, and have no history: each one runs on every deploy of every
stage, production included, in its own transaction, as the construct's owner.
So write every seed as an idempotent upsert:

```ts
// db/database/seeds/001_roles.ts
export async function seed(db, { stage }) {
  await db
    .insertInto('roles')
    .values([{ name: 'member' }, { name: 'admin' }])
    .onConflict((oc) => oc.column('name').doNothing())
    .execute();
}
```

A plain `insert` fails the second deploy on its unique key. A failing seed
stops the deploy before any app starts (`DeploySeedsFailed`, naming the
construct and the seed); its own writes are rolled back. Something that
belongs on some stages only — a demo tenant — decides by `stage`, typed by
`SeedContext` from `@geekmidas/constructs` as one of the declared stages (see
[Typed stages](./workspaces.md#typed-stages)).

## Database connections

Every pool opened by a `KyselyDatabase` names itself to Postgres, so
`pg_stat_activity` says who holds a connection:

- on Lambda, the function's name;
- on a server, the surface's id (`GKM_APP_NAME`, set by the generated entry);
- under `gkm dev`, the app.

It is a fallback: `PGAPPNAME` or `?application_name=` in the URL win.

A query run inside an endpoint, subscriber, queue or cron ends in a
sqlcommenter tag:

```sql
select … /*operation='POST /orders',request_id='…',traceparent='00-…-…-01'*/
```

With telemetry on, `traceparent` is the query's span (sqlcommenter's W3C
trace context), so a query in the log joins to its trace.

It shows in `pg_stat_activity.query` and the slow-query and `auto_explain`
logs. `pg_stat_statements` ignores comments, so its grouping is unchanged.
Turn it off per database:

```typescript
new KyselyDatabase('Database', { queryTags: false });
```

An idle connection the server ends (`idle_session_timeout`, a failover) is
logged and replaced; it no longer crashes the process.

## Dokploy API timeouts

Every request to the Dokploy API has a 30-second deadline
(`DEFAULT_DOKPLOY_TIMEOUT_MS`). A request that times out fails with
`DokployRequestTimedOut` and is not retried, since Dokploy may still act on
it. Dropped connections are retried. The deadline is set on `DokployApi`
(`timeoutMs`, `signal`) when you build one yourself; `gkm.config.ts` has no
setting for it.

## What is not deployed yet

- **Rollback on `compose` and `sst`.** Redeploy the previous tag instead
  (`gkm deploy --target compose --stage <stage> --tag <tag>`).

## See also

- [Deploy targets](/guide/deploy-targets)
- [The `deploy()` API](/guide/deploy-api)
- [The Sandbox](/guide/sandbox)
- [State stores](/guide/state)
- [Deployment](/guide/deployment)
