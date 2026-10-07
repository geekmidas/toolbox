# Running in Production

What to set up before a stage serves real traffic, and what `gkm` does for you
once it does. Each section is short; follow the links for the detail.

## Checklist

- [ ] The stage's secrets are in a store CI can read, and every value the
      constructs need is set ([Secrets](#secrets-and-the-master-key)).
- [ ] Mail goes through a real SMTP server and buckets are real object
      storage, and no deploy passes `--allow-dev-services`
      ([Mail and object storage](#mail-and-object-storage)).
- [ ] Deploy state is in a shared store (SSM or S3), not on one laptop
      ([State](#state)).
- [ ] Every backend answers `GET /health` ([Health checks](#health-checks)).
- [ ] `OTEL_EXPORTER_OTLP_ENDPOINT` points at a collector — or, on
      `gkm compose`, `deploy.compose.logs` runs one ([Logs](#logs)) — and
      `@geekmidas/telescope` is installed in each app ([Telemetry](#telemetry)).
- [ ] Logs are redacted (the default) ([Logging](#logging)).
- [ ] The platform's stop timeout is longer than `GKM_SHUTDOWN_TIMEOUT_MS`
      ([Graceful shutdown](#graceful-shutdown)).
- [ ] You know how to roll back ([Rollback](#rollback)).
- [ ] Background work (crons, queues, subscribers) has somewhere to run
      ([What is not deployed yet](#what-is-not-deployed-yet)).

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

`.gkm/` is gitignored, so the file store cannot serve a deploy from CI. Use
SSM, or pass your own `SecretsStore`:

```typescript
// gkm.config.ts
export default defineWorkspace({
  // …
  secrets: { store: { provider: 'ssm', region: 'eu-west-1' } },
});
```

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

## Mail and object storage

On a server target (`dokploy`, `compose`), a deployed stage's mail and buckets
come from its secrets. gkm runs no Mailpit or MinIO for it unless told to:

```bash
gkm secrets:set MAIL_URL 'smtp://user:password@smtp.example.com:587' --stage production
gkm secrets:set MAIL_FROM 'noreply@example.com' --stage production
gkm secrets:set UPLOADS_URL 's3://AKIA…:…@acme-uploads?region=eu-west-1' --stage production
gkm secrets:set UPLOADS_SERVER_URL 'https://files.example.com' --stage production
```

Or let gkm ask for each one: `gkm secrets:add --stage production` lists every
key the stage lacks across all its apps, builds each by kind — a bucket from
its provider, mail from its SMTP server, a third party's credentials field by
field from their schema — and saves them to the stage's store. See
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

`--allow-dev-services minio,mailpit` runs MinIO and Mailpit instead — for a
preview or a demo, never for production: **Mailpit delivers no mail**, and
MinIO keeps every object on one container's disk with no backup. Each run that
uses one prints a warning and emits a `dev-service.used` event, which a CI
pipeline can fail on. See [Deploy targets](./deploy-targets.md#mail-and-object-storage).

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
| `compose` | `/health` (backends), `/` (sites), through Caddy over HTTPS with the certificate verified | a 2xx or 3xx |
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
build output. See [What is not deployed yet](#what-is-not-deployed-yet).

## Telemetry

`gkm build --production` writes a `telemetry.ts` beside `server.ts`. The server
starts telemetry before it imports the app, so the libraries the app loads are
instrumented.

It does nothing unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. When it is, it
loads `@geekmidas/telescope/instrumentation` and starts the OpenTelemetry SDK
with:

- `service.name`: the surface's id, or the app directory's name;
- `service.namespace`: the workspace name;
- `deployment.environment.name` (and the older `deployment.environment`): the
  `STAGE` the deploy sets on every app.

Everything else comes from the standard variables:

| Variable | What it does |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector base URL. Traces go to `/v1/traces`, logs to `/v1/logs`. Turns telemetry on. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Headers for the exporter, e.g. an API key. |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` | Sampling, e.g. `parentbased_traceidratio` and `0.1`. |
| `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` | Override or add resource attributes. |

Node auto-instrumentations are on (HTTP, `pg` and the rest, without `fs`).

Install `@geekmidas/telescope` and its `@opentelemetry/*` peer dependencies in
each app that should export. The build checks they resolve. If they do not,
the entry contains no telemetry import, and a server started with the endpoint
set emits a `TelemetryUnavailable` warning and runs without telemetry. A
telemetry failure never stops the server.

If you call `setupTelemetry` yourself, it also takes `sampleRatio` (0–1, a
parent-based trace-id ratio; outside that range throws `InvalidSampleRatio`),
`serviceNamespace`, `deploymentEnvironment` and `handleSignals`.

### Where the telemetry goes

Every deploy target hands each backend the `OTEL_*` variables the stage's
secrets hold — the exporter's
`OTEL_EXPORTER_OTLP_{ENDPOINT,HEADERS,PROTOCOL,TIMEOUT,COMPRESSION}` (for all
signals, or one: `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`), `OTEL_TRACES_SAMPLER`,
`OTEL_TRACES_SAMPLER_ARG`, `OTEL_RESOURCE_ATTRIBUTES` and `OTEL_SERVICE_NAME`,
which defaults to the app's name. They are matched by pattern rather than by
the bare `OTEL_` prefix, so a stray `OTEL_LOG_LEVEL=debug` is not forwarded.
Values are secrets, masked in output. Sites never get them: a site's
environment ends up in a bundle every browser downloads, and an exporter's
headers are a credential.

```bash
gkm secrets:set OTEL_EXPORTER_OTLP_ENDPOINT 'https://otlp.example.com' --stage production
gkm secrets:set OTEL_EXPORTER_OTLP_HEADERS 'x-api-key=…' --stage production
```

That is all a hosted backend — Grafana Cloud, Honeycomb, your own collector —
needs, on Dokploy and on `gkm compose` alike.

## Logs

With no hosted backend, a `gkm compose` stack can run its own log UI:
`deploy.compose.logs: true` adds [OpenObserve](https://openobserve.ai) to the
stack and points every backend at it. In short:

- **Enable it** in `gkm.config.ts`: `deploy: { compose: { logs: true } }`, or
  `{ port, retentionDays, public: { allow } }`. Data is kept 30 days by
  default (`retentionDays`, at least 3).
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
  it at `https://logs.<stage domain>` through Caddy, refusing every other
  address with 403, and publishes no port.
- **Or a hosted backend**: leave `logs` off and set the `OTEL_*` variables
  above in the stage's secrets. Setting both fails with
  `LogsEndpointConflict`.

The root password is generated on the first run and kept in the stage's
secrets as `ZO_ROOT_USER_PASSWORD`. Every detail, and the tunnel and Tailscale
examples, is in [Deploy with Docker Compose → Logs](./compose.md#logs).

Dokploy runs no log UI: `deploy.compose.logs` is the compose target's alone,
and a Dokploy deploy never reads it. Its backends get the stage's `OTEL_*`
variables as above, so point those at a backend you run or rent.

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

## Graceful shutdown

On `SIGTERM` or `SIGINT` a production server:

1. stops accepting connections and lets in-flight requests finish;
2. runs the shutdown hooks, which close every database pool;
3. exits `0`.

`GKM_SHUTDOWN_TIMEOUT_MS` bounds the whole drain. It defaults to `8000`, under
Docker's 10-second stop timeout, so the server exits on its own terms rather
than being killed mid-drain. Past the deadline it exits `1`, so a forced stop
shows. If you raise it, raise the platform's stop timeout above it too.

When telemetry is on, buffered spans and logs are flushed on the same signal.

## Rollback

| Target | Rollback | Migrations |
| --- | --- | --- |
| `dokploy` | yes | applied by the deploy, before any app switches |
| `compose` | no | applied by the deploy, after the infrastructure starts |
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
select … /*operation='POST /orders',request_id='…'*/
```

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

- **Background work on servers.** A `RestApi` image serves HTTP only, and a
  `Worker` has no image of its own yet. So on `dokploy` and `compose`, crons,
  queue consumers and topic subscribers (including SNS push routes) do not
  run. Publishing still works. `sst` deploys workers as Lambdas. Tracked in
  [#183](https://github.com/geekmidas/toolbox/issues/183).
- **Rollback on `compose` and `sst`.** Redeploy the previous tag instead
  (`gkm deploy --target compose --stage <stage> --tag <tag>`).
- **Shutdown of consumers and subscribers.** The drain above covers HTTP
  servers; it follows the worker image.

## See also

- [Deploy targets](/guide/deploy-targets)
- [The `deploy()` API](/guide/deploy-api)
- [The Sandbox](/guide/sandbox)
- [State stores](/guide/state)
- [Deployment](/guide/deployment)
