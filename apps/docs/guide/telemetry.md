# Telemetry

One request, one trace: the request's span, the lines its handler logged, its
queries and the queue jobs it sent, across every process it reached. The
application says **what** it emits; the deploy says **where it goes and how
much**, per stage. It works the same under `gkm dev` and deployed.

## The construct

```ts
// constructs/telemetry.ts — what the app emits, never where it goes
import { Telemetry } from '@geekmidas/constructs/telemetry';

export const telemetry = new Telemetry('Telemetry', {
  ignorePaths: ['/health', '/ready'],
  attributes: { 'service.namespace': 'shop' },
});
```

| Option | |
| --- | --- |
| `ignorePaths` | Request paths no span is recorded for, on every surface that uses it. A trailing `*` matches a prefix. |
| `attributes` | Resource attributes every span and log record carries. |

There is no sample rate and no endpoint here: both are the deploy's.

### Who uses it: an edge

A process is given the construct the way it is given its logger:

```ts
new RestApi('Api', { path: 'apps/api', defaultAuthorizer: 'none', logger, telemetry });
new BetterAuth('Auth', { path: 'apps/auth', database: authDb, telemetry });
new Worker('Jobs', { logger, telemetry }).database(database);
new StaticSite('Web', { path: 'apps/web', telemetry });
```

Each one is an edge to the `Telemetry` node in the manifest, and the edge
decides everything else:

- **The build.** A process with the edge is built with the OpenTelemetry SDK
  and the request middleware; one without it gets a stub that loads nothing,
  whatever is installed. See [The packages](#the-packages).
- **The environment.** The node provides OpenTelemetry's own keys, and the
  deploy hands them to exactly the processes with the edge — see
  [What each process is given](#what-each-process-is-given).
- **Sites.** A site's edge is recorded, and it is handed none of the node's
  keys: an exporter's endpoint and headers are a server's, and a site's
  environment is a bundle every browser downloads. Nothing about telemetry
  reaches a site's public values. What the edge does give a site is trace
  context: the typed client generated for each API it calls sends
  `traceparent` to that API by default (`telemetryDefault` in
  `.gkm/client/<surface>.ts`), sampled per page view at the stage's
  `sampleRate` — every trace locally, none for a stage set to `false`. Built
  on the host, one client serves every site that calls the API, so a site
  with the edge turns it on; a site's image generates its own clients
  (`gkm openapi --app <api> --telemetry <rate>`) from its own edge. See
  [Trace context](../packages/client.md#trace-propagation) for what the client sends and to
  whom.

Under `gkm dev`, a worker's crons and consumers run in the dev server of the
one app that hosts the worker (the app whose directory holds its work). That
server uses telemetry when its API or a worker it hosts has the edge. Any other
`RestApi` runs only its own endpoints, so a worker's edge never counts for it.

### One route: `.telemetry()`

```ts
router.get('/health').telemetry({ ignore: true }).handle(() => ({ ok: true }));

router
  .get('/orders/:id')
  .telemetry({ attributes: { 'app.area': 'orders' } })
  .handle(…);
```

`ignore: true` records no span for that route (its log lines are still
exported); `attributes` are set on its request span.

## Where it goes: `deploy.telemetry`

Per deployed stage, in `gkm.config.ts`:

```ts
deploy: {
  telemetry: {
    staging: 'self-hosted',
    production: { provider: 'self-hosted', retentionDays: 14, sampleRate: 0.1 },
    preview: {
      provider: 'otlp',
      endpoint: 'https://otlp.example.com',
      headers: { 'x-team': 'shop' },
      sampleRate: 0.5,
    },
    scratch: false,
  },
}
```

| Value | |
| --- | --- |
| `'self-hosted'` | The target runs the collector and its UI — OpenObserve, on `gkm compose`. |
| `{ provider: 'self-hosted', port?, retentionDays?, public?: { allow }, sampleRate? }` | The same, with its options — see [Deploy with Docker Compose → Telemetry](./compose.md#telemetry). |
| `{ provider: 'otlp', endpoint, headers?, sampleRate? }` | Any OTLP/HTTP endpoint: Grafana Cloud, Honeycomb, your own collector. `/v1/traces` and `/v1/logs` are added to `endpoint`. |
| `false` | Nothing is sent. |

`sampleRate` is the fraction of traces kept, 0 to 1 (default 1). It is decided
where a trace starts and followed by every service it reaches
(`parentbased_traceidratio`). Logs are not sampled.

`headers` live in `gkm.config.ts`, which is committed: put no credential
there. Providers with a credential of their own (a stage secret
`TELEMETRY_CREDENTIALS`, validated like an `ExternalApi`'s) are coming as named
presets; until then, use a collector that needs no secret header, or one on
your own network.

### Defaults, by target

- **`gkm compose`** runs the self-hosted provider for a stage that names
  nothing.
- **Dokploy** runs no collector yet, and **AWS** has none, so a deployed
  stage there that uses the construct must name `otlp` or `false`. A deploy
  that does not fails before anything is built, with
  `TelemetryProviderRequired`; asking either for `'self-hosted'` fails with
  `SelfHostedTelemetryUnavailable`.
- A workspace in which no process uses the construct needs no
  `deploy.telemetry` at all.

A bad entry — a rate outside 0–1 (`TelemetrySampleRateInvalid`), an endpoint
that is not an http(s) URL (`TelemetryEndpointInvalid`), a retention under 3
days — fails `gkm.config.ts` to load, with the words a deploy would fail with.

**The local stage ignores `deploy.telemetry`.** `gkm dev` and `gkm compose
--stage <local>` always run OpenObserve and keep every trace.

### What each process is given

Each process with the edge — and no other — is handed:

| Variable | Value |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | The provider's base URL — the stack's OpenObserve, or `endpoint`. |
| `OTEL_EXPORTER_OTLP_HEADERS` | OpenObserve's login, or `headers`. |
| `OTEL_SERVICE_NAME` | The app's name: `api`, `auth`, `jobs`. |
| `OTEL_TRACES_SAMPLER` | `parentbased_traceidratio` |
| `OTEL_TRACES_SAMPLER_ARG` | The stage's `sampleRate`, `1` by default. |

They come from the node's provides, like every other construct's keys — not
from the stage's secrets. An `OTEL_*` key set in a stage's secrets is passed to
nothing; name the provider instead.

## Locally

### `gkm dev`

When any surface or worker uses the construct, reconcile adds an `openobserve`
service to `docker-compose.constructs.yml` beside the other dev services, and
prints where it is with them — and its login with the other local logins.
The root user is `admin@gkm.localhost`, with a password generated once for
this machine and project, like every local login; `gkm dev:credentials`
prints it again:

```
🐳 Services
   postgres       localhost:20718
   …
   openobserve    http://localhost:20717
🔑 Logins (again any time: gkm dev:credentials)
   …
   OpenObserve    http://localhost:20717
                  user admin@gkm.localhost, password … — when running: gkm dev
```

Open the URL and sign in with that login. Every process with the edge sends to
it at 100%, named for its app. The [discovery endpoint](./dev-server.md#discovery-endpoint)
lists it as `telemetry: { url, email }` — never the password.

The dev server's entry starts the same SDK and mounts the same request
middleware as the production server: both are generated from one
`telemetry.ts`. So what you see locally is what a deployed stage sends:

- a SERVER span per request (`POST /users`, with its status and route);
- every line a `createLogger` logger writes, in the trace of the request
  that wrote it;
- the constructs' own spans — each query, cache and storage call, mail send
  and `ExternalApi` call (see [Tracing](../packages/constructs.md#tracing));
- a queue job or topic delivery as a CONSUMER span in the trace of the
  request that published it (see
  [Trace context](../packages/events.md#trace-context));
- an API's session check as part of the request's trace: the API's SERVER
  span → the `GET …/get-session` CLIENT span → the auth server's own SERVER
  span. The call carries the trace context and no forwarding header (the
  client's address goes as `x-gkm-client-ip` —
  [see the auth server](../packages/constructs.md#the-auth-server-and-what-its-callers-hold)),
  so the auth server trusts it as an internal caller and continues the trace.

Each query also carries its span in its
[sqlcommenter](https://google.github.io/sqlcommenter/) tag —
`/*…,traceparent='00-<trace id>-<span id>-01'*/` — so a slow query in
Postgres's log or a row of `pg_stat_activity` leads straight to its trace.

To find a request's logs and spans, search OpenObserve's `default` stream by
`trace_id`.

### `gkm compose --stage <local>`

The same OpenObserve, in the stack, on `127.0.0.1:5080` —
`GKM_COMPOSE_LOGS_PORT` moves it. The run prints how to open it.

### `gkm test`

Exports nothing: the test stage starts no collector and hands no process a
telemetry key, so the entry starts nothing. The container stays defined in
`docker-compose.constructs.yml`, for `gkm dev`.

## The packages

A process with the edge needs `@geekmidas/telescope` and every OpenTelemetry
package its instrumentation loads, resolvable from its app:

- `@opentelemetry/api`
- `@opentelemetry/auto-instrumentations-node`
- `@opentelemetry/exporter-logs-otlp-http`
- `@opentelemetry/exporter-trace-otlp-http`
- `@opentelemetry/instrumentation-pino`
- `@opentelemetry/resources`
- `@opentelemetry/sdk-logs`
- `@opentelemetry/sdk-node`
- `@opentelemetry/sdk-trace-base`
- `@opentelemetry/sdk-trace-node`
- `@opentelemetry/semantic-conventions`

Without them, `gkm build` and `gkm dev` fail with `TelemetryPackagesMissing`,
naming the app and the command that fixes it:

```
'api' uses a Telemetry construct, and @opentelemetry/sdk-node does not
resolve from it — its server would start without exporting a span. Add them
to the app and build again:

  pnpm --dir apps/api add @opentelemetry/sdk-node
```

An app none of whose processes uses the construct needs none of them, and
loads none of them.

If a package is gone at run time anyway, the server warns with
`TelemetryUnavailable` and serves without telemetry: an outage in
observability is never an outage in the service.
