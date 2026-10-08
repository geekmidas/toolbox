# @geekmidas/constructs

## 10.0.0-alpha.81

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.81
  - @geekmidas/auth@10.0.0-alpha.81
  - @geekmidas/cache@10.0.0-alpha.81
  - @geekmidas/db@10.0.0-alpha.81
  - @geekmidas/emailkit@10.0.0-alpha.81
  - @geekmidas/envkit@10.0.0-alpha.81
  - @geekmidas/errors@10.0.0-alpha.81
  - @geekmidas/events@10.0.0-alpha.81
  - @geekmidas/logger@10.0.0-alpha.81
  - @geekmidas/manifest@10.0.0-alpha.81
  - @geekmidas/rate-limit@10.0.0-alpha.81
  - @geekmidas/schema@10.0.0-alpha.81
  - @geekmidas/services@10.0.0-alpha.81
  - @geekmidas/storage@10.0.0-alpha.81
  - @geekmidas/telescope@10.0.0-alpha.81
  - @geekmidas/testkit@10.0.0-alpha.81

## 10.0.0-alpha.80

### Minor Changes

- [#208](https://github.com/geekmidas/toolbox/pull/208) [`f3638fb`](https://github.com/geekmidas/toolbox/commit/f3638fb116f7aeebbbb29c8f06deaa7813cc760e) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: One trace from a request through a queue to the worker: every events driver
  (pg-boss, SNS, SQS, RabbitMQ, basic) wraps each publish in a PRODUCER span and
  carries its W3C trace context in the message — SQS/SNS message attributes,
  RabbitMQ headers, or pg-boss job data under the reserved key `__gkmTrace`,
  which is removed before a handler sees the payload. Consumers run each job in a
  CONSUMER span that continues it (a message without context starts a new
  trace), Lambda queue and subscriber adaptors do the same from their records,
  and each cron run is a root trace of its own. The constructs record their own
  spans: a span per database query (`select orders`, with `db.system`, `db.name`,
  `db.operation`, never parameter values), `cache.get`/`set`/`delete` with
  hit/miss on the Redis and Postgres drivers, `storage.presign`/`put`/`delete`,
  `email.send`, and a span per `ExternalApi` client call. Everything goes through
  the global `@opentelemetry/api` and is a no-op without a registered provider.

### Patch Changes

- Updated dependencies [[`f3638fb`](https://github.com/geekmidas/toolbox/commit/f3638fb116f7aeebbbb29c8f06deaa7813cc760e)]:
  - @geekmidas/events@10.0.0-alpha.80
  - @geekmidas/cache@10.0.0-alpha.80
  - @geekmidas/storage@10.0.0-alpha.80
  - @geekmidas/emailkit@10.0.0-alpha.80
  - @geekmidas/audit@10.0.0-alpha.80
  - @geekmidas/auth@10.0.0-alpha.80
  - @geekmidas/db@10.0.0-alpha.80
  - @geekmidas/envkit@10.0.0-alpha.80
  - @geekmidas/errors@10.0.0-alpha.80
  - @geekmidas/logger@10.0.0-alpha.80
  - @geekmidas/manifest@10.0.0-alpha.80
  - @geekmidas/rate-limit@10.0.0-alpha.80
  - @geekmidas/schema@10.0.0-alpha.80
  - @geekmidas/services@10.0.0-alpha.80
  - @geekmidas/telescope@10.0.0-alpha.80
  - @geekmidas/testkit@10.0.0-alpha.80

## 10.0.0-alpha.79

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.79
  - @geekmidas/auth@10.0.0-alpha.79
  - @geekmidas/cache@10.0.0-alpha.79
  - @geekmidas/db@10.0.0-alpha.79
  - @geekmidas/emailkit@10.0.0-alpha.79
  - @geekmidas/envkit@10.0.0-alpha.79
  - @geekmidas/errors@10.0.0-alpha.79
  - @geekmidas/events@10.0.0-alpha.79
  - @geekmidas/logger@10.0.0-alpha.79
  - @geekmidas/manifest@10.0.0-alpha.79
  - @geekmidas/rate-limit@10.0.0-alpha.79
  - @geekmidas/schema@10.0.0-alpha.79
  - @geekmidas/services@10.0.0-alpha.79
  - @geekmidas/storage@10.0.0-alpha.79
  - @geekmidas/telescope@10.0.0-alpha.79
  - @geekmidas/testkit@10.0.0-alpha.79

## 10.0.0-alpha.78

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.78
  - @geekmidas/auth@10.0.0-alpha.78
  - @geekmidas/cache@10.0.0-alpha.78
  - @geekmidas/db@10.0.0-alpha.78
  - @geekmidas/emailkit@10.0.0-alpha.78
  - @geekmidas/envkit@10.0.0-alpha.78
  - @geekmidas/errors@10.0.0-alpha.78
  - @geekmidas/events@10.0.0-alpha.78
  - @geekmidas/logger@10.0.0-alpha.78
  - @geekmidas/manifest@10.0.0-alpha.78
  - @geekmidas/rate-limit@10.0.0-alpha.78
  - @geekmidas/schema@10.0.0-alpha.78
  - @geekmidas/services@10.0.0-alpha.78
  - @geekmidas/storage@10.0.0-alpha.78
  - @geekmidas/telescope@10.0.0-alpha.78
  - @geekmidas/testkit@10.0.0-alpha.78

## 10.0.0-alpha.77

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.77
  - @geekmidas/auth@10.0.0-alpha.77
  - @geekmidas/cache@10.0.0-alpha.77
  - @geekmidas/db@10.0.0-alpha.77
  - @geekmidas/emailkit@10.0.0-alpha.77
  - @geekmidas/envkit@10.0.0-alpha.77
  - @geekmidas/errors@10.0.0-alpha.77
  - @geekmidas/events@10.0.0-alpha.77
  - @geekmidas/logger@10.0.0-alpha.77
  - @geekmidas/manifest@10.0.0-alpha.77
  - @geekmidas/rate-limit@10.0.0-alpha.77
  - @geekmidas/schema@10.0.0-alpha.77
  - @geekmidas/services@10.0.0-alpha.77
  - @geekmidas/storage@10.0.0-alpha.77
  - @geekmidas/telescope@10.0.0-alpha.77
  - @geekmidas/testkit@10.0.0-alpha.77

## 10.0.0-alpha.76

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.76
  - @geekmidas/auth@10.0.0-alpha.76
  - @geekmidas/cache@10.0.0-alpha.76
  - @geekmidas/db@10.0.0-alpha.76
  - @geekmidas/emailkit@10.0.0-alpha.76
  - @geekmidas/envkit@10.0.0-alpha.76
  - @geekmidas/errors@10.0.0-alpha.76
  - @geekmidas/events@10.0.0-alpha.76
  - @geekmidas/logger@10.0.0-alpha.76
  - @geekmidas/manifest@10.0.0-alpha.76
  - @geekmidas/rate-limit@10.0.0-alpha.76
  - @geekmidas/schema@10.0.0-alpha.76
  - @geekmidas/services@10.0.0-alpha.76
  - @geekmidas/storage@10.0.0-alpha.76
  - @geekmidas/telescope@10.0.0-alpha.76
  - @geekmidas/testkit@10.0.0-alpha.76

## 10.0.0-alpha.75

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.75
  - @geekmidas/auth@10.0.0-alpha.75
  - @geekmidas/cache@10.0.0-alpha.75
  - @geekmidas/db@10.0.0-alpha.75
  - @geekmidas/emailkit@10.0.0-alpha.75
  - @geekmidas/envkit@10.0.0-alpha.75
  - @geekmidas/errors@10.0.0-alpha.75
  - @geekmidas/events@10.0.0-alpha.75
  - @geekmidas/logger@10.0.0-alpha.75
  - @geekmidas/manifest@10.0.0-alpha.75
  - @geekmidas/rate-limit@10.0.0-alpha.75
  - @geekmidas/schema@10.0.0-alpha.75
  - @geekmidas/services@10.0.0-alpha.75
  - @geekmidas/storage@10.0.0-alpha.75
  - @geekmidas/telescope@10.0.0-alpha.75
  - @geekmidas/testkit@10.0.0-alpha.75

## 10.0.0-alpha.74

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.74
  - @geekmidas/auth@10.0.0-alpha.74
  - @geekmidas/cache@10.0.0-alpha.74
  - @geekmidas/db@10.0.0-alpha.74
  - @geekmidas/emailkit@10.0.0-alpha.74
  - @geekmidas/envkit@10.0.0-alpha.74
  - @geekmidas/errors@10.0.0-alpha.74
  - @geekmidas/events@10.0.0-alpha.74
  - @geekmidas/logger@10.0.0-alpha.74
  - @geekmidas/manifest@10.0.0-alpha.74
  - @geekmidas/rate-limit@10.0.0-alpha.74
  - @geekmidas/schema@10.0.0-alpha.74
  - @geekmidas/services@10.0.0-alpha.74
  - @geekmidas/storage@10.0.0-alpha.74
  - @geekmidas/telescope@10.0.0-alpha.74
  - @geekmidas/testkit@10.0.0-alpha.74

## 10.0.0-alpha.73

### Patch Changes

- [#196](https://github.com/geekmidas/toolbox/pull/196) [`5db7b84`](https://github.com/geekmidas/toolbox/commit/5db7b84aba6455989163abcd2c203b6dc28b7cb3) Thanks [@geekmidas](https://github.com/geekmidas)! - A Worker is its own deploy unit on a server target

  `gkm build --provider server --production` now writes an entry for each `Worker` that has crons, queue consumers or topic subscribers, in the app whose directory holds that work, and bundles it to `.gkm/server/dist/worker-<worker>.mjs`. It registers the drivers its target needs, starts every cron (through pg-boss), consumer and subscriber the worker owns, and serves only `GET /health` on `PORT`: `200` when every consumer started and every broker connection answers, `503` otherwise. On `SIGTERM` it stops pulling messages and scheduling crons, lets the handlers in flight finish, closes its broker connections and database pools, and exits `0` within `GKM_SHUTDOWN_TIMEOUT_MS` (default 8000), or `1` at the deadline.

  `gkm docker` writes a Dockerfile per worker (`.gkm/docker/Dockerfile.<worker>`), built inside Docker like a backend's, with credentials from the `gkm_credentials` BuildKit secret; the runner is the bundle on `node` with `tini` and a `HEALTHCHECK` on `/health`.

  `gkm compose` runs each worker as a service with no Caddy route and no published port, `restart: unless-stopped`, log rotation, its own `0600` env file holding exactly the keys its constructs read, and `depends_on` the stack's infrastructure; it starts after migrations, the plan lists it, and `verify` waits for its Docker health check. Dokploy deploys each worker as an application with no domain after the backends, checked by Dokploy's status and rolled back like any app. A worker with topic subscribers in a build whose broker is SNS fails with `WorkerSubscribersNeedPush`.

  The generated `queues.ts`, `subscribers.ts` and `crons.ts` no longer install their own `SIGTERM` handlers; they export `stopQueues`, `stopSubscribers` and `stopCrons`, and a status function each, for the entry that runs them. pg-boss connections name themselves to Postgres with `GKM_APP_NAME` when it is set.

- Updated dependencies [[`5db7b84`](https://github.com/geekmidas/toolbox/commit/5db7b84aba6455989163abcd2c203b6dc28b7cb3)]:
  - @geekmidas/events@10.0.0-alpha.73
  - @geekmidas/manifest@10.0.0-alpha.73
  - @geekmidas/audit@10.0.0-alpha.73
  - @geekmidas/auth@10.0.0-alpha.73
  - @geekmidas/cache@10.0.0-alpha.73
  - @geekmidas/db@10.0.0-alpha.73
  - @geekmidas/emailkit@10.0.0-alpha.73
  - @geekmidas/envkit@10.0.0-alpha.73
  - @geekmidas/errors@10.0.0-alpha.73
  - @geekmidas/logger@10.0.0-alpha.73
  - @geekmidas/rate-limit@10.0.0-alpha.73
  - @geekmidas/schema@10.0.0-alpha.73
  - @geekmidas/services@10.0.0-alpha.73
  - @geekmidas/storage@10.0.0-alpha.73
  - @geekmidas/telescope@10.0.0-alpha.73
  - @geekmidas/testkit@10.0.0-alpha.73

## 10.0.0-alpha.72

### Patch Changes

- Updated dependencies [[`b55a94c`](https://github.com/geekmidas/toolbox/commit/b55a94ceb3d07f1e0b336fb34503a1566177e624)]:
  - @geekmidas/events@10.0.0-alpha.72
  - @geekmidas/audit@10.0.0-alpha.72
  - @geekmidas/auth@10.0.0-alpha.72
  - @geekmidas/cache@10.0.0-alpha.72
  - @geekmidas/db@10.0.0-alpha.72
  - @geekmidas/emailkit@10.0.0-alpha.72
  - @geekmidas/envkit@10.0.0-alpha.72
  - @geekmidas/errors@10.0.0-alpha.72
  - @geekmidas/logger@10.0.0-alpha.72
  - @geekmidas/manifest@10.0.0-alpha.72
  - @geekmidas/rate-limit@10.0.0-alpha.72
  - @geekmidas/schema@10.0.0-alpha.72
  - @geekmidas/services@10.0.0-alpha.72
  - @geekmidas/storage@10.0.0-alpha.72
  - @geekmidas/telescope@10.0.0-alpha.72
  - @geekmidas/testkit@10.0.0-alpha.72

## 10.0.0-alpha.71

### Minor Changes

- [#191](https://github.com/geekmidas/toolbox/pull/191) [`5b5cc7b`](https://github.com/geekmidas/toolbox/commit/5b5cc7bf2141558b03418d4338de4f5ac6b4be6c) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: `.dependsOn([auth])` outside the auth app now yields an HTTP client, not the server

  - ✨ **`BetterAuth.service` is an `AuthClient`.** A handler's `services.auth` used to be the Better Auth server itself, built in whichever process asked: it read `AUTH_SECRET`, opened the auth tenant and wired the mailer, so an API that only checked sessions crashed wherever it was (rightly) not given the auth app's secret. It is now `{ api: { getSession({ headers }) } }`, which asks `GET <AUTH_URL><basePath>/get-session` with the request's `cookie`, `authorization` and `x-forwarded-for`, and answers Better Auth's `{ user, session }` or `null` (for a `null` body or a 401). A failure answer throws `SessionCheckFailed`; a server it cannot reach throws the new `AuthServerUnreachable`. `getSession` is the one call the client makes — other server `api` calls belong to the auth app.
  - **The server is only `auth.server()`**, which the auth app's generated entry calls, and which now also returns the better-auth instance as `auth`. Which one a process holds follows from how it reaches the construct, not from where it runs.
  - `verify()` — what a surface's `.auth(auth)` calls — is the same request, and also reads a 401 as signed out.
  - better-auth is imported only when the server is built, so a process holding the client never loads it to get one.
  - **The Hono adaptor loads `@geekmidas/audit`, `@geekmidas/rate-limit` and `@geekmidas/db/rls` only for an endpoint that uses them.** They are optional peers, but the adaptor imported them at the top, so an app without them could not bundle a production server (or start `gkm dev`). A missing one now fails the request that needs it with `OptionalPeerMissing`, naming the package.
  - An endpoint's error answer no longer carries the stack outside `gkm dev` (`NODE_ENV=development`), and a 5xx no longer carries the error it wrapped (`details.originalError` — a missing variable's name, a failed query). Both go to the log, which the adaptor now writes under `err`, so a ZodError is serialized with its stack instead of being spread into the line.
  - 🤕 Errors are logged under `err` rather than `error` (database pool, subscriber, Lambda and SNS adaptors), so a pino logger serializes them.

### Patch Changes

- Updated dependencies [[`20264e6`](https://github.com/geekmidas/toolbox/commit/20264e62b0fcd1f9e3c523197cf4bf9828c8ced1)]:
  - @geekmidas/logger@10.0.0-alpha.71
  - @geekmidas/audit@10.0.0-alpha.71
  - @geekmidas/auth@10.0.0-alpha.71
  - @geekmidas/cache@10.0.0-alpha.71
  - @geekmidas/db@10.0.0-alpha.71
  - @geekmidas/emailkit@10.0.0-alpha.71
  - @geekmidas/envkit@10.0.0-alpha.71
  - @geekmidas/errors@10.0.0-alpha.71
  - @geekmidas/events@10.0.0-alpha.71
  - @geekmidas/manifest@10.0.0-alpha.71
  - @geekmidas/rate-limit@10.0.0-alpha.71
  - @geekmidas/schema@10.0.0-alpha.71
  - @geekmidas/services@10.0.0-alpha.71
  - @geekmidas/storage@10.0.0-alpha.71
  - @geekmidas/telescope@10.0.0-alpha.71
  - @geekmidas/testkit@10.0.0-alpha.71

## 10.0.0-alpha.70

### Patch Changes

- [#189](https://github.com/geekmidas/toolbox/pull/189) [`42e6e4e`](https://github.com/geekmidas/toolbox/commit/42e6e4ef52b465df702c927758be58120b9a5976) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm compose` can run a log UI, every target passes `OTEL_*` to its backends, and Docker logs are rotated

  **`OTEL_*` reach the backends.** A production server exports traces and pino
  logs over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, but each backend's
  environment held only the keys its constructs declare, so a stage's telemetry
  settings never arrived. Now the standard variables the stage's secrets hold —
  the exporter's endpoint, headers, protocol, timeout and compression (for all
  signals or one), the sampler and its argument, resource attributes and the
  service name — go to every backend on `gkm compose` and on Dokploy, with
  `OTEL_SERVICE_NAME` defaulting to the app's name. They are matched by a
  pattern over the `OTEL_` prefix, not the bare prefix, so an unrelated
  `OTEL_LOG_LEVEL` is not forwarded. Sites get none: their environment ends up
  in a browser bundle.

  **`deploy.compose.logs`** runs OpenObserve (`v1.0.4`, pinned) in a compose
  stack and points every backend's telemetry at it:

  ```ts
  deploy: {
    compose: {
      logs: true;
    }
  }
  // or { port?: number; retentionDays?: number; public?: { allow: string[] } }
  ```

  - Published on `127.0.0.1:5080` only, because Docker opens a port published
    on every interface past ufw. The run ends with the `ssh -N -L` line that
    reaches it, and a `logs.ready` event.
  - `public: { allow: [...] }` serves it at `https://logs.<stage domain>`
    through Caddy instead, to those IPs and CIDRs only (403 otherwise), with no
    host port.
  - Its root password is generated once per deployed stage and kept in the
    stage's secrets as `ZO_ROOT_USER_PASSWORD`; the local stage uses a fixed
    one. Data is kept 30 days (`retentionDays`, at least 3).
  - `verify` checks it is healthy; `--down` keeps its volume.
  - A stage that also sets its own OTLP endpoint fails with
    `LogsEndpointConflict`; a bad config with `LogsAllowEmpty`,
    `LogsAllowEntryInvalid`, `LogsRetentionInvalid` or `LogsPortInvalid`.
  - Dokploy never reads it.

  **Docker's logs are rotated.** Every service a compose stack runs — apps,
  Caddy, Postgres, Mailpit, MinIO, OpenObserve — logs through `json-file` with
  `max-size: 10m` and `max-file: 3`. Docker never rotates that driver by
  default, and a busy container filled a small server's disk.

  **`docker-compose.<stage>.yml`** at the workspace root, where there is one, is
  merged over the generated stack — on every run and on `--down` — for what the
  generated file cannot know, such as a port bound to a tailnet address or
  another `logging` block.

  **Request spans and logs from a bundled server.** A production server is one
  bundled file, where OpenTelemetry's load-time hooks see neither pino nor
  `node:http`, so only DNS, TCP and `fetch` spans arrived. The server now mounts
  telescope's `honoTelemetryMiddleware` ahead of every route: a SERVER span per
  request named `GET /users/:id`, with method, route, status code, `url.path`,
  `url.scheme` and user agent — never the query string or headers — `ERROR` on a
  5xx or a thrown error (the exception recorded; a 4xx is not an error), an
  incoming `traceparent` continued, and the handler run inside it. Logs come from
  `@geekmidas/logger`'s own bridge, in the request's trace. The generated setup
  turns `@opentelemetry/instrumentation-pino` and the http instrumentation's
  incoming spans off, so nothing is sent twice where they can hook. `pg` is
  bundled too, so there are no query spans yet.

  The middleware itself changed to fit: it names the span after the matched
  route once the handler has run (it used the raw path), drops `url.full`, sets
  `ERROR` only on a 5xx, and records the error Hono hands `onError`.
  `setupTelemetry` takes `incomingHttpSpans: false`. An endpoint whose handler
  fails with a 5xx leaves the error on `c.error` for middleware.

- Updated dependencies [[`42e6e4e`](https://github.com/geekmidas/toolbox/commit/42e6e4ef52b465df702c927758be58120b9a5976), [`f3114d7`](https://github.com/geekmidas/toolbox/commit/f3114d70a385d28908167d42e29cd846bb3f4fcc)]:
  - @geekmidas/telescope@10.0.0-alpha.70
  - @geekmidas/logger@10.0.0-alpha.70
  - @geekmidas/audit@10.0.0-alpha.70
  - @geekmidas/auth@10.0.0-alpha.70
  - @geekmidas/cache@10.0.0-alpha.70
  - @geekmidas/db@10.0.0-alpha.70
  - @geekmidas/emailkit@10.0.0-alpha.70
  - @geekmidas/envkit@10.0.0-alpha.70
  - @geekmidas/errors@10.0.0-alpha.70
  - @geekmidas/events@10.0.0-alpha.70
  - @geekmidas/manifest@10.0.0-alpha.70
  - @geekmidas/rate-limit@10.0.0-alpha.70
  - @geekmidas/schema@10.0.0-alpha.70
  - @geekmidas/services@10.0.0-alpha.70
  - @geekmidas/storage@10.0.0-alpha.70
  - @geekmidas/testkit@10.0.0-alpha.70

## 10.0.0-alpha.69

### Minor Changes

- [#188](https://github.com/geekmidas/toolbox/pull/188) [`f209d09`](https://github.com/geekmidas/toolbox/commit/f209d09a763538fdb843833a7519f744647239e4) Thanks [@geekmidas](https://github.com/geekmidas)! - `ExternalApi` and `Credential` expose their credentials schema as `credentialsSchema`, so a tool can check a value, and describe its fields, before it is stored. `decodeCredentials` — how a stored `<ID>_CREDENTIALS` value is read (JSON when it is JSON, the string otherwise, `json:` to keep a JSON string a string) — is exported from `@geekmidas/constructs/credential`.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.69
  - @geekmidas/auth@10.0.0-alpha.69
  - @geekmidas/cache@10.0.0-alpha.69
  - @geekmidas/db@10.0.0-alpha.69
  - @geekmidas/emailkit@10.0.0-alpha.69
  - @geekmidas/envkit@10.0.0-alpha.69
  - @geekmidas/errors@10.0.0-alpha.69
  - @geekmidas/events@10.0.0-alpha.69
  - @geekmidas/logger@10.0.0-alpha.69
  - @geekmidas/manifest@10.0.0-alpha.69
  - @geekmidas/rate-limit@10.0.0-alpha.69
  - @geekmidas/schema@10.0.0-alpha.69
  - @geekmidas/services@10.0.0-alpha.69
  - @geekmidas/storage@10.0.0-alpha.69
  - @geekmidas/telescope@10.0.0-alpha.69
  - @geekmidas/testkit@10.0.0-alpha.69

## 10.0.0-alpha.68

### Patch Changes

- Updated dependencies [[`871ba05`](https://github.com/geekmidas/toolbox/commit/871ba057aa0a0f69cf8233366b5f4c311359a7cc), [`871ba05`](https://github.com/geekmidas/toolbox/commit/871ba057aa0a0f69cf8233366b5f4c311359a7cc)]:
  - @geekmidas/logger@10.0.0-alpha.68
  - @geekmidas/storage@10.0.0-alpha.68
  - @geekmidas/audit@10.0.0-alpha.68
  - @geekmidas/auth@10.0.0-alpha.68
  - @geekmidas/cache@10.0.0-alpha.68
  - @geekmidas/db@10.0.0-alpha.68
  - @geekmidas/emailkit@10.0.0-alpha.68
  - @geekmidas/envkit@10.0.0-alpha.68
  - @geekmidas/errors@10.0.0-alpha.68
  - @geekmidas/events@10.0.0-alpha.68
  - @geekmidas/manifest@10.0.0-alpha.68
  - @geekmidas/rate-limit@10.0.0-alpha.68
  - @geekmidas/schema@10.0.0-alpha.68
  - @geekmidas/services@10.0.0-alpha.68
  - @geekmidas/telescope@10.0.0-alpha.68
  - @geekmidas/testkit@10.0.0-alpha.68

## 10.0.0-alpha.67

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.67
  - @geekmidas/auth@10.0.0-alpha.67
  - @geekmidas/cache@10.0.0-alpha.67
  - @geekmidas/db@10.0.0-alpha.67
  - @geekmidas/emailkit@10.0.0-alpha.67
  - @geekmidas/envkit@10.0.0-alpha.67
  - @geekmidas/errors@10.0.0-alpha.67
  - @geekmidas/events@10.0.0-alpha.67
  - @geekmidas/logger@10.0.0-alpha.67
  - @geekmidas/manifest@10.0.0-alpha.67
  - @geekmidas/rate-limit@10.0.0-alpha.67
  - @geekmidas/schema@10.0.0-alpha.67
  - @geekmidas/services@10.0.0-alpha.67
  - @geekmidas/storage@10.0.0-alpha.67
  - @geekmidas/telescope@10.0.0-alpha.67
  - @geekmidas/testkit@10.0.0-alpha.67

## 10.0.0-alpha.66

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.66
  - @geekmidas/auth@10.0.0-alpha.66
  - @geekmidas/cache@10.0.0-alpha.66
  - @geekmidas/db@10.0.0-alpha.66
  - @geekmidas/emailkit@10.0.0-alpha.66
  - @geekmidas/envkit@10.0.0-alpha.66
  - @geekmidas/errors@10.0.0-alpha.66
  - @geekmidas/events@10.0.0-alpha.66
  - @geekmidas/logger@10.0.0-alpha.66
  - @geekmidas/manifest@10.0.0-alpha.66
  - @geekmidas/rate-limit@10.0.0-alpha.66
  - @geekmidas/schema@10.0.0-alpha.66
  - @geekmidas/services@10.0.0-alpha.66
  - @geekmidas/storage@10.0.0-alpha.66
  - @geekmidas/telescope@10.0.0-alpha.66
  - @geekmidas/testkit@10.0.0-alpha.66

## 10.0.0-alpha.65

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.65
  - @geekmidas/auth@10.0.0-alpha.65
  - @geekmidas/cache@10.0.0-alpha.65
  - @geekmidas/db@10.0.0-alpha.65
  - @geekmidas/emailkit@10.0.0-alpha.65
  - @geekmidas/envkit@10.0.0-alpha.65
  - @geekmidas/errors@10.0.0-alpha.65
  - @geekmidas/events@10.0.0-alpha.65
  - @geekmidas/logger@10.0.0-alpha.65
  - @geekmidas/manifest@10.0.0-alpha.65
  - @geekmidas/rate-limit@10.0.0-alpha.65
  - @geekmidas/schema@10.0.0-alpha.65
  - @geekmidas/services@10.0.0-alpha.65
  - @geekmidas/storage@10.0.0-alpha.65
  - @geekmidas/telescope@10.0.0-alpha.65
  - @geekmidas/testkit@10.0.0-alpha.65

## 10.0.0-alpha.64

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.64
  - @geekmidas/auth@10.0.0-alpha.64
  - @geekmidas/cache@10.0.0-alpha.64
  - @geekmidas/db@10.0.0-alpha.64
  - @geekmidas/emailkit@10.0.0-alpha.64
  - @geekmidas/envkit@10.0.0-alpha.64
  - @geekmidas/errors@10.0.0-alpha.64
  - @geekmidas/events@10.0.0-alpha.64
  - @geekmidas/logger@10.0.0-alpha.64
  - @geekmidas/manifest@10.0.0-alpha.64
  - @geekmidas/rate-limit@10.0.0-alpha.64
  - @geekmidas/schema@10.0.0-alpha.64
  - @geekmidas/services@10.0.0-alpha.64
  - @geekmidas/storage@10.0.0-alpha.64
  - @geekmidas/telescope@10.0.0-alpha.64
  - @geekmidas/testkit@10.0.0-alpha.64

## 10.0.0-alpha.63

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.63
  - @geekmidas/auth@10.0.0-alpha.63
  - @geekmidas/cache@10.0.0-alpha.63
  - @geekmidas/db@10.0.0-alpha.63
  - @geekmidas/emailkit@10.0.0-alpha.63
  - @geekmidas/envkit@10.0.0-alpha.63
  - @geekmidas/errors@10.0.0-alpha.63
  - @geekmidas/events@10.0.0-alpha.63
  - @geekmidas/logger@10.0.0-alpha.63
  - @geekmidas/manifest@10.0.0-alpha.63
  - @geekmidas/rate-limit@10.0.0-alpha.63
  - @geekmidas/schema@10.0.0-alpha.63
  - @geekmidas/services@10.0.0-alpha.63
  - @geekmidas/storage@10.0.0-alpha.63
  - @geekmidas/telescope@10.0.0-alpha.63
  - @geekmidas/testkit@10.0.0-alpha.63

## 10.0.0-alpha.62

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.62
  - @geekmidas/auth@10.0.0-alpha.62
  - @geekmidas/cache@10.0.0-alpha.62
  - @geekmidas/db@10.0.0-alpha.62
  - @geekmidas/emailkit@10.0.0-alpha.62
  - @geekmidas/envkit@10.0.0-alpha.62
  - @geekmidas/errors@10.0.0-alpha.62
  - @geekmidas/events@10.0.0-alpha.62
  - @geekmidas/logger@10.0.0-alpha.62
  - @geekmidas/manifest@10.0.0-alpha.62
  - @geekmidas/rate-limit@10.0.0-alpha.62
  - @geekmidas/schema@10.0.0-alpha.62
  - @geekmidas/services@10.0.0-alpha.62
  - @geekmidas/storage@10.0.0-alpha.62
  - @geekmidas/telescope@10.0.0-alpha.62
  - @geekmidas/testkit@10.0.0-alpha.62

## 10.0.0-alpha.61

### Patch Changes

- [#177](https://github.com/geekmidas/toolbox/pull/177) [`7aece20`](https://github.com/geekmidas/toolbox/commit/7aece20749fef144a790a8f3077dc3de2055e0de) Thanks [@geekmidas](https://github.com/geekmidas)! - Production images: an auth server gets a server, a session reaches its endpoint, an HttpError keeps its status, and a site gets its URLs at build time

  - `gkm build --production` for a surface that serves itself — a `BetterAuth` server — now writes and bundles a server that listens on `PORT`, answers `/health` and drains on SIGTERM. It wrote only the dev entry, so its image had no bundle to run.
  - ⚡️ An endpoint built from a factory's `.session()` with no authorizer was handed `undefined` for its session in a production build, and its session under `gkm dev`. The optimized handlers now read the session whenever one is configured (`Endpoint.hasSession`).
  - An `HttpError` thrown by a handler or a session callback answered 500 from a production server; it now answers with its own status, as under `gkm dev`, without the stack.
  - `gkm docker`: a site's public URLs (`VITE_*`, `NEXT_PUBLIC_*`) are build args in `docker-compose.constructs.yml` rather than runtime environment, which a built bundle never reads, and its Dockerfile declares an `ARG` for every one its declaration implies. A site gets no server environment and waits on no infrastructure, and the app services address each other on the compose network rather than through the local edge's hostnames.

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.61
  - @geekmidas/auth@10.0.0-alpha.61
  - @geekmidas/cache@10.0.0-alpha.61
  - @geekmidas/db@10.0.0-alpha.61
  - @geekmidas/emailkit@10.0.0-alpha.61
  - @geekmidas/envkit@10.0.0-alpha.61
  - @geekmidas/errors@10.0.0-alpha.61
  - @geekmidas/events@10.0.0-alpha.61
  - @geekmidas/logger@10.0.0-alpha.61
  - @geekmidas/manifest@10.0.0-alpha.61
  - @geekmidas/rate-limit@10.0.0-alpha.61
  - @geekmidas/schema@10.0.0-alpha.61
  - @geekmidas/services@10.0.0-alpha.61
  - @geekmidas/storage@10.0.0-alpha.61
  - @geekmidas/telescope@10.0.0-alpha.61
  - @geekmidas/testkit@10.0.0-alpha.61

## 10.0.0-alpha.60

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.60
  - @geekmidas/auth@10.0.0-alpha.60
  - @geekmidas/cache@10.0.0-alpha.60
  - @geekmidas/db@10.0.0-alpha.60
  - @geekmidas/emailkit@10.0.0-alpha.60
  - @geekmidas/envkit@10.0.0-alpha.60
  - @geekmidas/errors@10.0.0-alpha.60
  - @geekmidas/events@10.0.0-alpha.60
  - @geekmidas/logger@10.0.0-alpha.60
  - @geekmidas/manifest@10.0.0-alpha.60
  - @geekmidas/rate-limit@10.0.0-alpha.60
  - @geekmidas/schema@10.0.0-alpha.60
  - @geekmidas/services@10.0.0-alpha.60
  - @geekmidas/storage@10.0.0-alpha.60
  - @geekmidas/telescope@10.0.0-alpha.60
  - @geekmidas/testkit@10.0.0-alpha.60

## 10.0.0-alpha.59

### Patch Changes

- Updated dependencies [[`57eea44`](https://github.com/geekmidas/toolbox/commit/57eea445c114acbb398d4dfedc86f1c22dab3f10)]:
  - @geekmidas/logger@10.0.0-alpha.59
  - @geekmidas/audit@10.0.0-alpha.59
  - @geekmidas/auth@10.0.0-alpha.59
  - @geekmidas/cache@10.0.0-alpha.59
  - @geekmidas/db@10.0.0-alpha.59
  - @geekmidas/emailkit@10.0.0-alpha.59
  - @geekmidas/envkit@10.0.0-alpha.59
  - @geekmidas/errors@10.0.0-alpha.59
  - @geekmidas/events@10.0.0-alpha.59
  - @geekmidas/manifest@10.0.0-alpha.59
  - @geekmidas/rate-limit@10.0.0-alpha.59
  - @geekmidas/schema@10.0.0-alpha.59
  - @geekmidas/services@10.0.0-alpha.59
  - @geekmidas/storage@10.0.0-alpha.59
  - @geekmidas/telescope@10.0.0-alpha.59
  - @geekmidas/testkit@10.0.0-alpha.59

## 10.0.0-alpha.58

### Patch Changes

- Updated dependencies [[`476aeda`](https://github.com/geekmidas/toolbox/commit/476aedab3128ec29948df93f9776dae4e42d3488)]:
  - @geekmidas/telescope@10.0.0-alpha.58
  - @geekmidas/logger@10.0.0-alpha.58
  - @geekmidas/audit@10.0.0-alpha.58
  - @geekmidas/auth@10.0.0-alpha.58
  - @geekmidas/cache@10.0.0-alpha.58
  - @geekmidas/db@10.0.0-alpha.58
  - @geekmidas/emailkit@10.0.0-alpha.58
  - @geekmidas/envkit@10.0.0-alpha.58
  - @geekmidas/errors@10.0.0-alpha.58
  - @geekmidas/events@10.0.0-alpha.58
  - @geekmidas/manifest@10.0.0-alpha.58
  - @geekmidas/rate-limit@10.0.0-alpha.58
  - @geekmidas/schema@10.0.0-alpha.58
  - @geekmidas/services@10.0.0-alpha.58
  - @geekmidas/storage@10.0.0-alpha.58
  - @geekmidas/testkit@10.0.0-alpha.58

## 10.0.0-alpha.57

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.57
  - @geekmidas/auth@10.0.0-alpha.57
  - @geekmidas/cache@10.0.0-alpha.57
  - @geekmidas/db@10.0.0-alpha.57
  - @geekmidas/emailkit@10.0.0-alpha.57
  - @geekmidas/envkit@10.0.0-alpha.57
  - @geekmidas/errors@10.0.0-alpha.57
  - @geekmidas/events@10.0.0-alpha.57
  - @geekmidas/logger@10.0.0-alpha.57
  - @geekmidas/manifest@10.0.0-alpha.57
  - @geekmidas/rate-limit@10.0.0-alpha.57
  - @geekmidas/schema@10.0.0-alpha.57
  - @geekmidas/services@10.0.0-alpha.57
  - @geekmidas/storage@10.0.0-alpha.57
  - @geekmidas/telescope@10.0.0-alpha.57
  - @geekmidas/testkit@10.0.0-alpha.57

## 10.0.0-alpha.56

### Patch Changes

- Updated dependencies [[`efd9019`](https://github.com/geekmidas/toolbox/commit/efd9019cd2d8ec93dea462675da3ded175e732ee)]:
  - @geekmidas/telescope@10.0.0-alpha.56
  - @geekmidas/db@10.0.0-alpha.56
  - @geekmidas/audit@10.0.0-alpha.56
  - @geekmidas/auth@10.0.0-alpha.56
  - @geekmidas/cache@10.0.0-alpha.56
  - @geekmidas/emailkit@10.0.0-alpha.56
  - @geekmidas/envkit@10.0.0-alpha.56
  - @geekmidas/errors@10.0.0-alpha.56
  - @geekmidas/events@10.0.0-alpha.56
  - @geekmidas/logger@10.0.0-alpha.56
  - @geekmidas/manifest@10.0.0-alpha.56
  - @geekmidas/rate-limit@10.0.0-alpha.56
  - @geekmidas/schema@10.0.0-alpha.56
  - @geekmidas/services@10.0.0-alpha.56
  - @geekmidas/storage@10.0.0-alpha.56
  - @geekmidas/testkit@10.0.0-alpha.56

## 10.0.0-alpha.55

### Minor Changes

- [#142](https://github.com/geekmidas/toolbox/pull/142) [`eedac53`](https://github.com/geekmidas/toolbox/commit/eedac53aeec2d88d46a74ec9f3d4a55e2845b2b2) Thanks [@geekmidas](https://github.com/geekmidas)! - Database connections say who holds them, and queries say what ran them
  - **`application_name` on every connection** — the Lambda function's name, or the surface's id on a server (`GKM_APP_NAME`, set by the generated entry), or the app under `gkm dev`. A fallback: `PGAPPNAME` or `?application_name=` in the URL still win. `pg_stat_activity` can now say which function or app is holding connections.
  - ✨ **Query tags.** A query run inside an endpoint, subscriber, queue or cron ends in a sqlcommenter comment, `/*operation='POST /orders',request_id='…'*/`, visible in `pg_stat_activity` and the server's logs. `pg_stat_statements` ignores it. Off with `new KyselyDatabase(id, { queryTags: false })`.
  - **An idle connection ended by the server no longer crashes the process.** Pools had no `'error'` listener, so `idle_session_timeout` or a failover surfaced as an uncaught exception.
  - ✨ **Production servers close their pools on shutdown.** On `SIGTERM` the server stops taking requests, lets in-flight ones finish, and runs `runShutdownHooks()` (new, from `@geekmidas/constructs`) before exiting, instead of waiting 30s with every connection still open. It exits by `GKM_SHUTDOWN_TIMEOUT_MS` (8s by default, under Docker's 10s stop timeout), with code 1 if it had to cut a request off.
  - `@geekmidas/services`: the request context carries the `operation` it is for; `currentRequestContext()` reads it without throwing outside a request.

### Patch Changes

- Updated dependencies [[`eedac53`](https://github.com/geekmidas/toolbox/commit/eedac53aeec2d88d46a74ec9f3d4a55e2845b2b2)]:
  - @geekmidas/services@10.0.0-alpha.55
  - @geekmidas/audit@10.0.0-alpha.55
  - @geekmidas/auth@10.0.0-alpha.55
  - @geekmidas/cache@10.0.0-alpha.55
  - @geekmidas/db@10.0.0-alpha.55
  - @geekmidas/emailkit@10.0.0-alpha.55
  - @geekmidas/envkit@10.0.0-alpha.55
  - @geekmidas/errors@10.0.0-alpha.55
  - @geekmidas/events@10.0.0-alpha.55
  - @geekmidas/logger@10.0.0-alpha.55
  - @geekmidas/manifest@10.0.0-alpha.55
  - @geekmidas/rate-limit@10.0.0-alpha.55
  - @geekmidas/schema@10.0.0-alpha.55
  - @geekmidas/storage@10.0.0-alpha.55
  - @geekmidas/telescope@10.0.0-alpha.55
  - @geekmidas/testkit@10.0.0-alpha.55

## 10.0.0-alpha.54

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.54
  - @geekmidas/auth@10.0.0-alpha.54
  - @geekmidas/cache@10.0.0-alpha.54
  - @geekmidas/db@10.0.0-alpha.54
  - @geekmidas/emailkit@10.0.0-alpha.54
  - @geekmidas/envkit@10.0.0-alpha.54
  - @geekmidas/errors@10.0.0-alpha.54
  - @geekmidas/events@10.0.0-alpha.54
  - @geekmidas/logger@10.0.0-alpha.54
  - @geekmidas/manifest@10.0.0-alpha.54
  - @geekmidas/rate-limit@10.0.0-alpha.54
  - @geekmidas/schema@10.0.0-alpha.54
  - @geekmidas/services@10.0.0-alpha.54
  - @geekmidas/storage@10.0.0-alpha.54
  - @geekmidas/telescope@10.0.0-alpha.54
  - @geekmidas/testkit@10.0.0-alpha.54

## 10.0.0-alpha.53

### Minor Changes

- [#139](https://github.com/geekmidas/toolbox/pull/139) [`6fb1ce4`](https://github.com/geekmidas/toolbox/commit/6fb1ce4406c4dc8517b65923190af169c2aa70a7) Thanks [@geekmidas](https://github.com/geekmidas)! - SNS topic subscribers start under `gkm dev` without `@middy/core`

  `SnsPushSubscriberAdaptor` handed each pushed notification to `AWSLambdaSubscriber`, which imports `@middy/core`. middy is an optional peer that only Lambda needs, so a project that doesn't deploy to Lambda didn't install it, and every SNS subscriber logged `Failed to set up subscriber` with `ERR_MODULE_NOT_FOUND`. The push adaptor now runs the subscriber directly, with the same parsing, services, database and error handling as the Lambda adaptor. middy stays in the Lambda wrapper only.

  - 💥 **Breaking (alpha):** `SnsPushSubscriberAdaptor` moved from `@geekmidas/constructs/aws` to `@geekmidas/constructs/subscribers`. Every other export of `/aws` loads middy.
  - A subscriber that fails to set up now logs the error's message, which names the missing module.
  - A subscriber whose output fails its `.output()` schema throws `SubscriberOutputInvalid` instead of a bare `Error`.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.53
  - @geekmidas/auth@10.0.0-alpha.53
  - @geekmidas/cache@10.0.0-alpha.53
  - @geekmidas/db@10.0.0-alpha.53
  - @geekmidas/emailkit@10.0.0-alpha.53
  - @geekmidas/envkit@10.0.0-alpha.53
  - @geekmidas/errors@10.0.0-alpha.53
  - @geekmidas/events@10.0.0-alpha.53
  - @geekmidas/logger@10.0.0-alpha.53
  - @geekmidas/manifest@10.0.0-alpha.53
  - @geekmidas/rate-limit@10.0.0-alpha.53
  - @geekmidas/schema@10.0.0-alpha.53
  - @geekmidas/services@10.0.0-alpha.53
  - @geekmidas/storage@10.0.0-alpha.53
  - @geekmidas/telescope@10.0.0-alpha.53
  - @geekmidas/testkit@10.0.0-alpha.53

## 10.0.0-alpha.52

### Minor Changes

- [#136](https://github.com/geekmidas/toolbox/pull/136) [`0eb2628`](https://github.com/geekmidas/toolbox/commit/0eb2628f0fc00dc65543f6c6fe64400cd3bbd6b5) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm dev` runs crons and queue consumers it was silently skipping
  - ✨ **Crons under `gkm dev` on the SST target.** Server crons are scheduled through pg-boss. A project that deploys to AWS has no pg-boss locally, so `setupCrons` logged one error and scheduled nothing. Under `gkm dev`, which is one process, crons now run in-process on their schedule, in UTC, via the new `scheduleInProcess` in `@geekmidas/constructs/crons`. Outside `gkm dev` it is still an error, because a timer in each deployed replica would fire every job once per replica.
  - ✨ **Server-target crons never ran their handler.** The generated `run` called `cron.handler()`, which a `Cron` doesn't have, so every firing logged "Cron failed", on pg-boss too. Crons now run through the new `runCron`, with the same steps as the Lambda adaptor: services, the worker's database as `db`, an auditor if declared, parsed output, and published events.
  - 🐛 **The S3 driver for a workspace that installs `@geekmidas/storage` at its root.** The entry registered the S3 driver only when the app's own `package.json` listed storage. In a workspace that lists it once at the root, any service that injected a bucket threw `UnregisteredStorageScheme`. A queue consumer that depended on a bucket logged that once and was never polled, so its messages sat on the queue. The dependency is now found the way Node resolves it: the app's `package.json` or any directory above it.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.52
  - @geekmidas/auth@10.0.0-alpha.52
  - @geekmidas/cache@10.0.0-alpha.52
  - @geekmidas/db@10.0.0-alpha.52
  - @geekmidas/emailkit@10.0.0-alpha.52
  - @geekmidas/envkit@10.0.0-alpha.52
  - @geekmidas/errors@10.0.0-alpha.52
  - @geekmidas/events@10.0.0-alpha.52
  - @geekmidas/logger@10.0.0-alpha.52
  - @geekmidas/manifest@10.0.0-alpha.52
  - @geekmidas/rate-limit@10.0.0-alpha.52
  - @geekmidas/schema@10.0.0-alpha.52
  - @geekmidas/services@10.0.0-alpha.52
  - @geekmidas/storage@10.0.0-alpha.52
  - @geekmidas/telescope@10.0.0-alpha.52
  - @geekmidas/testkit@10.0.0-alpha.52

## 10.0.0-alpha.51

### Minor Changes

- [#133](https://github.com/geekmidas/toolbox/pull/133) [`1aa7b43`](https://github.com/geekmidas/toolbox/commit/1aa7b434e28ef24e4bdf057847b510fa9cfa1fcf) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: `deploy.domains` for every target, a `subdomain` on each surface, and each `RestApi` on its own host
  - ✨ **`deploy.dokploy.domains` is now `deploy.domains`.** A stage's base domain is a fact about the deployment, not about Dokploy, so every target reads it. Move the block up one level: `deploy: { domains: { production: 'myapp.com' }, dokploy: { endpoint, registry } }`. A stage with no domain fails with `NoDomainForStage`, naming the stage and where to add it.
  - ✨ **`subdomain` on `RestApi`, `BetterAuth` and `StaticSite`.** A surface answers on `{subdomain}.{domain}` — `new RestApi('Api', { path: 'apps/api', subdomain: 'v1' })` is `v1.myapp.com` — and on the same label locally, `v1.shop.localhost`. Absent, the id kebab-cased, as before.
  - **Each `RestApi` on its own host.** A deploy handed every surface the first backend's address, so a workspace with two APIs pointed both at one. Each now gets its own app's URL.

### Patch Changes

- Updated dependencies [[`1aa7b43`](https://github.com/geekmidas/toolbox/commit/1aa7b434e28ef24e4bdf057847b510fa9cfa1fcf)]:
  - @geekmidas/manifest@10.0.0-alpha.51
  - @geekmidas/audit@10.0.0-alpha.51
  - @geekmidas/auth@10.0.0-alpha.51
  - @geekmidas/cache@10.0.0-alpha.51
  - @geekmidas/db@10.0.0-alpha.51
  - @geekmidas/emailkit@10.0.0-alpha.51
  - @geekmidas/envkit@10.0.0-alpha.51
  - @geekmidas/errors@10.0.0-alpha.51
  - @geekmidas/events@10.0.0-alpha.51
  - @geekmidas/logger@10.0.0-alpha.51
  - @geekmidas/rate-limit@10.0.0-alpha.51
  - @geekmidas/schema@10.0.0-alpha.51
  - @geekmidas/services@10.0.0-alpha.51
  - @geekmidas/storage@10.0.0-alpha.51
  - @geekmidas/telescope@10.0.0-alpha.51
  - @geekmidas/testkit@10.0.0-alpha.51

## 10.0.0-alpha.50

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.50
  - @geekmidas/auth@10.0.0-alpha.50
  - @geekmidas/cache@10.0.0-alpha.50
  - @geekmidas/db@10.0.0-alpha.50
  - @geekmidas/emailkit@10.0.0-alpha.50
  - @geekmidas/envkit@10.0.0-alpha.50
  - @geekmidas/errors@10.0.0-alpha.50
  - @geekmidas/events@10.0.0-alpha.50
  - @geekmidas/logger@10.0.0-alpha.50
  - @geekmidas/manifest@10.0.0-alpha.50
  - @geekmidas/rate-limit@10.0.0-alpha.50
  - @geekmidas/schema@10.0.0-alpha.50
  - @geekmidas/services@10.0.0-alpha.50
  - @geekmidas/storage@10.0.0-alpha.50
  - @geekmidas/telescope@10.0.0-alpha.50
  - @geekmidas/testkit@10.0.0-alpha.50

## 10.0.0-alpha.49

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.49
  - @geekmidas/auth@10.0.0-alpha.49
  - @geekmidas/cache@10.0.0-alpha.49
  - @geekmidas/db@10.0.0-alpha.49
  - @geekmidas/emailkit@10.0.0-alpha.49
  - @geekmidas/envkit@10.0.0-alpha.49
  - @geekmidas/errors@10.0.0-alpha.49
  - @geekmidas/events@10.0.0-alpha.49
  - @geekmidas/logger@10.0.0-alpha.49
  - @geekmidas/manifest@10.0.0-alpha.49
  - @geekmidas/rate-limit@10.0.0-alpha.49
  - @geekmidas/schema@10.0.0-alpha.49
  - @geekmidas/services@10.0.0-alpha.49
  - @geekmidas/storage@10.0.0-alpha.49
  - @geekmidas/telescope@10.0.0-alpha.49
  - @geekmidas/testkit@10.0.0-alpha.49

## 10.0.0-alpha.48

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.48
  - @geekmidas/auth@10.0.0-alpha.48
  - @geekmidas/cache@10.0.0-alpha.48
  - @geekmidas/db@10.0.0-alpha.48
  - @geekmidas/emailkit@10.0.0-alpha.48
  - @geekmidas/envkit@10.0.0-alpha.48
  - @geekmidas/errors@10.0.0-alpha.48
  - @geekmidas/events@10.0.0-alpha.48
  - @geekmidas/logger@10.0.0-alpha.48
  - @geekmidas/manifest@10.0.0-alpha.48
  - @geekmidas/rate-limit@10.0.0-alpha.48
  - @geekmidas/schema@10.0.0-alpha.48
  - @geekmidas/services@10.0.0-alpha.48
  - @geekmidas/storage@10.0.0-alpha.48
  - @geekmidas/telescope@10.0.0-alpha.48
  - @geekmidas/testkit@10.0.0-alpha.48

## 10.0.0-alpha.47

### Minor Changes

- [#124](https://github.com/geekmidas/toolbox/pull/124) [`10ef53d`](https://github.com/geekmidas/toolbox/commit/10ef53d921d519afa62c773a6682581e19c06b1e) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: `Encryption` — a key that encrypts what the application stores

  `new Encryption('Pii')` gives a handler that `.dependsOn([pii])` `services.pii.encrypt`, `decrypt`, `index` (a blind index, so an encrypted column can still be looked up) and `reencrypt`. The app names no cipher: the construct provides one `PII_URL` whose scheme picks the backend.

  - **Locally and in tests**, an `aes256gcm://` keyring derived from the project and stage, like a secret — nothing to set.
  - **On a server stage**, a keyring generated into the stage's secrets on its first deploy and never replaced by a redeploy.
  - **On AWS**, envelope encryption under a KMS key that rotates yearly, and a KMS HMAC key for the index, each granted to exactly the functions that depend on the construct (`kms:GenerateDataKey`/`kms:Decrypt`, `kms:GenerateMac`). `@aws-sdk/client-kms` is an optional peer, loaded only for a `kms://` URL.

  Every ciphertext names the key that wrote it and is bound to its construct. `gkm encryption:rotate <Id> --stage <stage>` adds a key and keeps the old ones; after a `reencrypt` sweep, `gkm encryption:retire <Id> <key> --stage <stage>` removes one, and a value still under an old key warns the first time it is decrypted. The index key never rotates.

### Patch Changes

- Updated dependencies [[`f1fc3e7`](https://github.com/geekmidas/toolbox/commit/f1fc3e7e9a8fdc995e3a4b957e29ce451f6fd959), [`10ef53d`](https://github.com/geekmidas/toolbox/commit/10ef53d921d519afa62c773a6682581e19c06b1e)]:
  - @geekmidas/manifest@10.0.0-alpha.47
  - @geekmidas/envkit@10.0.0-alpha.47
  - @geekmidas/audit@10.0.0-alpha.47
  - @geekmidas/auth@10.0.0-alpha.47
  - @geekmidas/cache@10.0.0-alpha.47
  - @geekmidas/db@10.0.0-alpha.47
  - @geekmidas/emailkit@10.0.0-alpha.47
  - @geekmidas/errors@10.0.0-alpha.47
  - @geekmidas/events@10.0.0-alpha.47
  - @geekmidas/logger@10.0.0-alpha.47
  - @geekmidas/rate-limit@10.0.0-alpha.47
  - @geekmidas/schema@10.0.0-alpha.47
  - @geekmidas/services@10.0.0-alpha.47
  - @geekmidas/storage@10.0.0-alpha.47
  - @geekmidas/telescope@10.0.0-alpha.47
  - @geekmidas/testkit@10.0.0-alpha.47

## 10.0.0-alpha.46

### Patch Changes

- Updated dependencies [[`31585c5`](https://github.com/geekmidas/toolbox/commit/31585c55f294520ce77483c653c543a835133d6e)]:
  - @geekmidas/manifest@10.0.0-alpha.46
  - @geekmidas/audit@10.0.0-alpha.46
  - @geekmidas/auth@10.0.0-alpha.46
  - @geekmidas/cache@10.0.0-alpha.46
  - @geekmidas/db@10.0.0-alpha.46
  - @geekmidas/emailkit@10.0.0-alpha.46
  - @geekmidas/envkit@10.0.0-alpha.46
  - @geekmidas/errors@10.0.0-alpha.46
  - @geekmidas/events@10.0.0-alpha.46
  - @geekmidas/logger@10.0.0-alpha.46
  - @geekmidas/rate-limit@10.0.0-alpha.46
  - @geekmidas/schema@10.0.0-alpha.46
  - @geekmidas/services@10.0.0-alpha.46
  - @geekmidas/storage@10.0.0-alpha.46
  - @geekmidas/telescope@10.0.0-alpha.46
  - @geekmidas/testkit@10.0.0-alpha.46

## 10.0.0-alpha.45

### Patch Changes

- 🐛 [#121](https://github.com/geekmidas/toolbox/pull/121) [`8dbf325`](https://github.com/geekmidas/toolbox/commit/8dbf325495de962ea5889459b31e2700dc4d6726) Thanks [@geekmidas](https://github.com/geekmidas)! - :bug: Each test's browser connects from its own address, and a session check carries the client's

  - ✨ **`Browser` has an `address`** — a fresh private one by default, or `new Browser({ address })` — sent as `x-forwarded-for` on its requests, the way a proxy in front of the app adds it. Each browser is a different person on a different connection. Without it every test was the same client to Better Auth (`127.0.0.1` in tests), so its rate limit counted every test in one row: concurrent tests queued on each other's uncommitted inserts into `rateLimit` until they ended — sign-ins refused and timeouts, more of them the bigger the suite. A request that sets the header itself keeps its own.
  - **A surface's session check forwards `x-forwarded-for`** with the session headers. Better Auth rate-limits `/get-session` too, by client; without the address every user's session check came from the surface itself — one shared bucket, so enough traffic from anyone turned session checks into 429s (`SessionCheckFailed`).

- Updated dependencies [[`8dbf325`](https://github.com/geekmidas/toolbox/commit/8dbf325495de962ea5889459b31e2700dc4d6726)]:
  - @geekmidas/testkit@10.0.0-alpha.45
  - @geekmidas/audit@10.0.0-alpha.45
  - @geekmidas/auth@10.0.0-alpha.45
  - @geekmidas/cache@10.0.0-alpha.45
  - @geekmidas/db@10.0.0-alpha.45
  - @geekmidas/emailkit@10.0.0-alpha.45
  - @geekmidas/envkit@10.0.0-alpha.45
  - @geekmidas/errors@10.0.0-alpha.45
  - @geekmidas/events@10.0.0-alpha.45
  - @geekmidas/logger@10.0.0-alpha.45
  - @geekmidas/manifest@10.0.0-alpha.45
  - @geekmidas/rate-limit@10.0.0-alpha.45
  - @geekmidas/schema@10.0.0-alpha.45
  - @geekmidas/services@10.0.0-alpha.45
  - @geekmidas/storage@10.0.0-alpha.45
  - @geekmidas/telescope@10.0.0-alpha.45

## 10.0.0-alpha.44

### Minor Changes

- [#120](https://github.com/geekmidas/toolbox/pull/120) [`067b7a9`](https://github.com/geekmidas/toolbox/commit/067b7a9b3ede9e2de4f52b9d4fdf5af008abc269) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: `featureTest`: a `services` fixture — assert through the client a handler gets, with the fake behind it hidden (#119)

  `await services.get('shipping')` returns what a handler depending on that construct is handed, resolved the way the test's endpoints resolve it: an external API's client aimed at whatever the test stage resolved (its fake, which the test never sees), a topic or queue as its recorder, a database as the test's transaction. The generated harness types it per service name (`ClientOf<typeof shipping>`); a name the app does not declare is a type error, and `UnknownService` at runtime.

  A test asserts on an external API through the provider's own contract — the fake implements the provider's read endpoints too — so the same assertion holds against the provider's sandbox. Fakes stay hidden: tests no longer import a fake's module to read its state.

  The delivery errors from #115 (`DeliveryFailed`, `MessageRejected`, `DeliveryDidNotSettle`) are now exported from `@geekmidas/constructs/testing`.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.44
  - @geekmidas/auth@10.0.0-alpha.44
  - @geekmidas/cache@10.0.0-alpha.44
  - @geekmidas/db@10.0.0-alpha.44
  - @geekmidas/emailkit@10.0.0-alpha.44
  - @geekmidas/envkit@10.0.0-alpha.44
  - @geekmidas/errors@10.0.0-alpha.44
  - @geekmidas/events@10.0.0-alpha.44
  - @geekmidas/logger@10.0.0-alpha.44
  - @geekmidas/manifest@10.0.0-alpha.44
  - @geekmidas/rate-limit@10.0.0-alpha.44
  - @geekmidas/schema@10.0.0-alpha.44
  - @geekmidas/services@10.0.0-alpha.44
  - @geekmidas/storage@10.0.0-alpha.44
  - @geekmidas/telescope@10.0.0-alpha.44
  - @geekmidas/testkit@10.0.0-alpha.44

## 10.0.0-alpha.43

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.43
  - @geekmidas/auth@10.0.0-alpha.43
  - @geekmidas/cache@10.0.0-alpha.43
  - @geekmidas/db@10.0.0-alpha.43
  - @geekmidas/emailkit@10.0.0-alpha.43
  - @geekmidas/envkit@10.0.0-alpha.43
  - @geekmidas/errors@10.0.0-alpha.43
  - @geekmidas/events@10.0.0-alpha.43
  - @geekmidas/logger@10.0.0-alpha.43
  - @geekmidas/manifest@10.0.0-alpha.43
  - @geekmidas/rate-limit@10.0.0-alpha.43
  - @geekmidas/schema@10.0.0-alpha.43
  - @geekmidas/services@10.0.0-alpha.43
  - @geekmidas/storage@10.0.0-alpha.43
  - @geekmidas/telescope@10.0.0-alpha.43
  - @geekmidas/testkit@10.0.0-alpha.43

## 10.0.0-alpha.42

### Minor Changes

- [#116](https://github.com/geekmidas/toolbox/pull/116) [`9917e96`](https://github.com/geekmidas/toolbox/commit/9917e9608582a11170d289f14476c5ed72d18d3b) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: `featureTest` delivers what a test publishes to its consumers, end to end without a broker (#115)

  Once each request a test makes has answered, what it published reaches the consumers that would receive it deployed: a queue's messages its one consumer, a topic's events every subscriber that named them, and only those. Each payload is checked against the consumer's schema first (`MessageRejected`); consumers run in the test's transaction, so they see the endpoint's rows and their writes roll back; what they publish is delivered in turn until nothing is left (`DeliveryDidNotSettle`); and a consumer that throws fails the test (`DeliveryFailed`). `published(...)` still records, and `queue(q).invoke()` / `subscriber(s).invoke()` deliver what they publish too.

  `gkm test` now records each topic subscriber in the test manifest (`subscribers`).

- [#117](https://github.com/geekmidas/toolbox/pull/117) [`9d96389`](https://github.com/geekmidas/toolbox/commit/9d9638977a5b24dd64bb8135d6bcdc1ed182b594) Thanks [@geekmidas](https://github.com/geekmidas)! - `worker.database(db)` is now the default database for everything built from the worker: crons, queues, subscribers and functions receive it as `db`, typed from the construct, and it still names where a server keeps cron schedules. `.database(other)` on a cron, queue or subscriber overrides it — retyping `db` and replacing the manifest edge rather than adding to it. Queues and subscribers gain `.database()`, carry `databaseService`, and contribute the database's env; the Lambda, test and generated server runtimes (`queues.ts`, `subscribers.ts`, SNS push) pass `db` to their handlers.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.42
  - @geekmidas/auth@10.0.0-alpha.42
  - @geekmidas/cache@10.0.0-alpha.42
  - @geekmidas/db@10.0.0-alpha.42
  - @geekmidas/emailkit@10.0.0-alpha.42
  - @geekmidas/envkit@10.0.0-alpha.42
  - @geekmidas/errors@10.0.0-alpha.42
  - @geekmidas/events@10.0.0-alpha.42
  - @geekmidas/logger@10.0.0-alpha.42
  - @geekmidas/manifest@10.0.0-alpha.42
  - @geekmidas/rate-limit@10.0.0-alpha.42
  - @geekmidas/schema@10.0.0-alpha.42
  - @geekmidas/services@10.0.0-alpha.42
  - @geekmidas/storage@10.0.0-alpha.42
  - @geekmidas/telescope@10.0.0-alpha.42
  - @geekmidas/testkit@10.0.0-alpha.42

## 10.0.0-alpha.41

### Patch Changes

- Updated dependencies [[`ec054c3`](https://github.com/geekmidas/toolbox/commit/ec054c3c54f7ca7913c3d0552c961d4d08ac1595)]:
  - @geekmidas/testkit@10.0.0-alpha.41
  - @geekmidas/audit@10.0.0-alpha.41
  - @geekmidas/auth@10.0.0-alpha.41
  - @geekmidas/cache@10.0.0-alpha.41
  - @geekmidas/db@10.0.0-alpha.41
  - @geekmidas/emailkit@10.0.0-alpha.41
  - @geekmidas/envkit@10.0.0-alpha.41
  - @geekmidas/errors@10.0.0-alpha.41
  - @geekmidas/events@10.0.0-alpha.41
  - @geekmidas/logger@10.0.0-alpha.41
  - @geekmidas/manifest@10.0.0-alpha.41
  - @geekmidas/rate-limit@10.0.0-alpha.41
  - @geekmidas/schema@10.0.0-alpha.41
  - @geekmidas/services@10.0.0-alpha.41
  - @geekmidas/storage@10.0.0-alpha.41
  - @geekmidas/telescope@10.0.0-alpha.41

## 10.0.0-alpha.40

### Minor Changes

- [#113](https://github.com/geekmidas/toolbox/pull/113) [`e8d29dd`](https://github.com/geekmidas/toolbox/commit/e8d29dd29084e59b40a3b5bd1a2806c3b9c93f6d) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: Topic subscribers on SNS are pushed to over HTTP; each consumer reaches its own topic or queue; topics fan out on pg-boss (#112)
  - ⬆️ **SNS push.** On SNS a topic subscriber is no longer polled. The server mounts `POST /__gkm/subscribers/<name>` and, once listening, subscribes it to the topic with a filter policy of the events the subscriber names, so SNS fans out to each subscriber. Confirmations are handled, signatures verified (skipped only against an emulator), and startup converges: a stuck-pending subscription is replaced and a changed event list updates the filter. The route runs the subscriber through the same adaptor as Lambda. `GKM_SUBSCRIBER_PUSH_URL` is where SNS pushes; locally it defaults to `host.docker.internal`.
  - **`@geekmidas/events/sns`**: `verifySnsMessage`, `confirmSnsSubscription`, `subscribeHttpEndpoint`, `toSnsEvent`. **`@geekmidas/constructs/aws`**: `SnsPushSubscriberAdaptor`.
  - 🔥 **Each consumer reaches what it consumes**, through that topic's or queue's own `<ID>_PUBLISHER_CONNECTION_STRING`. `EVENT_SUBSCRIBER_CONNECTION_STRING` is deleted: it was built from the first queue or topic in the plan, so every other consumer polled the wrong place. Crons schedule through `EVENT_PUBLISHER_CONNECTION_STRING`.
  - **pg-boss fans out.** A topic's message is published as `<topic>/<type>` and each subscriber drains a queue of its own, so every subscriber sees every message; replicas of one subscriber share it. Subscribers used to compete for one queue per event type, and two topics with an event of the same name shared it. `Publisher.fromConnectionString(url, { topic })`, `Subscriber.fromConnection(connection, { topic, subscription })`.
  - **Local SNS works.** On an AWS target `gkm dev` creates each topic and queue on the floci emulator and composes their addresses, instead of throwing `UnprovisionedEventsBackend`. The emulator's healthcheck no longer calls `curl`, which the image does not ship.
  - **`gkm dev --no-subscribers`** runs no topic subscribers. Fan-out is the default.
  - A queue consumer that fails now leaves its message for a retry instead of acknowledging it.

### Patch Changes

- Updated dependencies [[`e8d29dd`](https://github.com/geekmidas/toolbox/commit/e8d29dd29084e59b40a3b5bd1a2806c3b9c93f6d)]:
  - @geekmidas/events@10.0.0-alpha.40
  - @geekmidas/audit@10.0.0-alpha.40
  - @geekmidas/auth@10.0.0-alpha.40
  - @geekmidas/cache@10.0.0-alpha.40
  - @geekmidas/db@10.0.0-alpha.40
  - @geekmidas/emailkit@10.0.0-alpha.40
  - @geekmidas/envkit@10.0.0-alpha.40
  - @geekmidas/errors@10.0.0-alpha.40
  - @geekmidas/logger@10.0.0-alpha.40
  - @geekmidas/manifest@10.0.0-alpha.40
  - @geekmidas/rate-limit@10.0.0-alpha.40
  - @geekmidas/schema@10.0.0-alpha.40
  - @geekmidas/services@10.0.0-alpha.40
  - @geekmidas/storage@10.0.0-alpha.40
  - @geekmidas/telescope@10.0.0-alpha.40
  - @geekmidas/testkit@10.0.0-alpha.40

## 10.0.0-alpha.39

### Minor Changes

- [#111](https://github.com/geekmidas/toolbox/pull/111) [`087444c`](https://github.com/geekmidas/toolbox/commit/087444c16591656ab7d85b7713939982231cb1f2) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: Queues and topics are constructs, and events name their topic (#110)
  - A queue is built from a worker, `worker.queue('Emails').message(schema).handle(…)`: the queue and its one consumer, one construct. `q` and the public `QueueBuilder` export are gone. A producer depends on it, `.dependsOn([emails])`, and sends through `services.emails`.
  - ✨ A topic is `new Topic('Users', { events })`. `t` and `TopicBuilder` are gone.
  - 🔥 `.publisher(service)` is gone everywhere: from `RestApi`, endpoint, function, cron and subscriber builders, and `Worker`. A construct publishes with `.event(users, { type, payload, when? })`, repeatable across topics; each event goes through its own topic's publisher, and the topic lands in `services` exactly as `.dependsOn([users])` would put it. `Topic.publisher`, `Queue.publisher`, `derivedFrom` and `edgesWith` are deleted.
  - `TestEndpointAdaptor` / `TestFunctionAdaptor` / the MSW adaptor lose their `publisher` option: pass a recorder under the topic's name in `services`.
  - Discovery records what a worker-owned queue's consumer depends on under the worker.
  - SST: `fromManifest` subscribes each queue's consumer Lambda (`Queue.consume`), and skips `worker`, `cron` and `function` declarations instead of throwing `UnknownDeclarationKind`.

### Patch Changes

- Updated dependencies [[`9bfd949`](https://github.com/geekmidas/toolbox/commit/9bfd94997337b1990a5413d3127717cbf560be91), [`087444c`](https://github.com/geekmidas/toolbox/commit/087444c16591656ab7d85b7713939982231cb1f2)]:
  - @geekmidas/testkit@10.0.0-alpha.39
  - @geekmidas/manifest@10.0.0-alpha.39
  - @geekmidas/audit@10.0.0-alpha.39
  - @geekmidas/auth@10.0.0-alpha.39
  - @geekmidas/cache@10.0.0-alpha.39
  - @geekmidas/db@10.0.0-alpha.39
  - @geekmidas/emailkit@10.0.0-alpha.39
  - @geekmidas/envkit@10.0.0-alpha.39
  - @geekmidas/errors@10.0.0-alpha.39
  - @geekmidas/events@10.0.0-alpha.39
  - @geekmidas/logger@10.0.0-alpha.39
  - @geekmidas/rate-limit@10.0.0-alpha.39
  - @geekmidas/schema@10.0.0-alpha.39
  - @geekmidas/services@10.0.0-alpha.39
  - @geekmidas/storage@10.0.0-alpha.39
  - @geekmidas/telescope@10.0.0-alpha.39

## 10.0.0-alpha.38

### Patch Changes

- [#107](https://github.com/geekmidas/toolbox/pull/107) [`5475a96`](https://github.com/geekmidas/toolbox/commit/5475a96d1d8ee0c99109c65cba76f7e269f42265) Thanks [@geekmidas](https://github.com/geekmidas)! - `ExternalApi` for third-party HTTP APIs, `<ID>_CREDENTIALS`, and `faker` and `signIn()` in feature tests

  - **`ExternalApi`** (`@geekmidas/constructs/external-api`) declares an API
    somebody else runs: a `url`, one string or one per stage name with a
    `default`, a `credentials` schema, and the `client` a handler is given. It
    provides `<ID>_URL` and `<ID>_CREDENTIALS` (kind `external-api`).
  - **Its fake lives at `test/fakes/<id>.ts`**, never in the construct, so it
    cannot reach a deployed bundle. The file default-exports
    `fake.app(handler, { credentials })` or
    `fake.image('stripe/stripe-mock', { port, credentials })`.
    - **Fakes are opt-in:** only `gkm test` and `gkm dev --fake` use them.
      Plain `gkm dev` calls the real API at its `url` for the local stage, with
      that stage's own credentials.
    - ✨ **Feature tests** serve an app fake in-process through MSW, and
      `gkm dev --fake` serves it on an allocated port.
    - **An image fake** runs as a container on an allocated host port.
    - **No fake:** an external API without one fails `gkm test` or
      `gkm dev --fake` with `NoFake`.
  - 🐛 **Deploying** resolves the URL for the stage (`NoUrlForStage` when it has
    none) and the credentials from the stage's secrets, on Dokploy and on AWS.
  - **`Credential` provides `<ID>_CREDENTIALS`**, renamed from `<ID>_CREDENTIAL`.
  - **AWS `Credential` links under `<ID>_CREDENTIALS`.** It reported SST's
    secret type, which resolves to the bare `<ID>`, so a function that declared
    `STRIPE_CREDENTIALS` was linked to nothing. It now has its own type
    (`gkm:aws:Credential`) and resolver, and holds the `sst.Secret` under the
    same name, so values already set with `sst secret set Stripe …` still apply.
  - 🐛 **Dokploy now resolves credentials.** A stage missing `<ID>_CREDENTIALS` for
    a `Credential` or an `ExternalApi` fails `gkm deploy` with
    `MissingSuppliedSecret`, naming the `gkm secrets:set` command. Before this,
    Dokploy never resolved a credential at all.
  - ✨ **Feature tests get `faker`**, testkit's faker seeded from the test's name.
    `browser.signIn()` with no address signs in as a new, unique user. testkit's
    `faker` regains `seed()`, which the spread had dropped.
  - **Every command reads and writes the stage's own secrets store.** `gkm
deploy`, `build`, `dev`, `test`, `exec`, `setup` and `secrets:*` resolve the
    store for the stage they act on: the file for the local stage, and
    `secrets.store` for a deployed one. A stage kept in SSM is set with
    `gkm secrets:set` and read by the deploy, with nothing pushed or pulled in
    between. `secrets:push` and `secrets:pull` are removed. `gkm setup` no
    longer offers to push, `deploy:github` no longer pushes, and the generated
    SST workflow has no pull step.
  - **`SecretsStore` is `{ name, read(stage), write(stage, secrets) }`.** The
    file store is `FileSecretsStore` (`name: 'file'`), and SSM is
    `AwsSecretsStore` (`name: 'ssm'`), renamed from `SsmSecretsStore`. The free
    functions `readStageSecrets`, `writeStageSecrets`, `setCustomSecret`,
    `secretsExist` and `getSecretsPath` are gone.
  - 🔒 **Security: Dokploy no longer derives secrets from repo facts.** An auth
    server's signing secret, and every Dokploy database and bucket password,
    were a SHA-256 of the project name, stage and construct id, all of which
    are in the repo. Now:
    - **Signing secrets** are random, generated on the stage's first deploy and
      kept in its secrets store.
    - **Derived passwords** are salted with a random per-stage seed kept in the
      same store.
    - **Role passwords** are set on every apply (`ALTER ROLE … PASSWORD`), so an
      existing database moves to the new passwords rather than locking the app
      out.
  - **An app is found by its configured path, never by a `package.json`
    name.**
    - **`gkm dev`, `test` and `exec`** run the app whose `path` in
      `gkm.config.ts` holds the current directory, and anywhere else `gkm dev`
      hands the workspace to turbo. A folder no app lives in fails with
      `NotInAnApp`.
    - **`gkm docker`** names its default image after the config's `name`.
    - 🔥 **Removed:** `getAppNameFromCwd` and `getAppNameFromPackageJson`.

  **Moving an existing app:**

  - Rename every `<ID>_CREDENTIAL` secret to `<ID>_CREDENTIALS` and set it on
    each deployed stage: `gkm secrets:set STRIPE_CREDENTIALS '{…}' --stage production`.
  - A custom `secrets.store` provider renames `pull` to `read` and `push` to
    `write`, and adds a `name`.
  - A deployed stage whose secrets were only in this machine's file: set
    `secrets.store`, then write its values to the store with
    `gkm secrets:import --stage <stage> --file …` or `gkm secrets:set`.
  - An existing Dokploy stage's next deploy generates its seed and signing
    secret: live sessions end once, the database roles take their new passwords,
    and a bucket's root user is reset.

- Updated dependencies [[`5475a96`](https://github.com/geekmidas/toolbox/commit/5475a96d1d8ee0c99109c65cba76f7e269f42265)]:
  - @geekmidas/manifest@10.0.0-alpha.38
  - @geekmidas/envkit@10.0.0-alpha.38
  - @geekmidas/testkit@10.0.0-alpha.38
  - @geekmidas/audit@10.0.0-alpha.38
  - @geekmidas/auth@10.0.0-alpha.38
  - @geekmidas/cache@10.0.0-alpha.38
  - @geekmidas/db@10.0.0-alpha.38
  - @geekmidas/emailkit@10.0.0-alpha.38
  - @geekmidas/errors@10.0.0-alpha.38
  - @geekmidas/events@10.0.0-alpha.38
  - @geekmidas/logger@10.0.0-alpha.38
  - @geekmidas/rate-limit@10.0.0-alpha.38
  - @geekmidas/schema@10.0.0-alpha.38
  - @geekmidas/services@10.0.0-alpha.38
  - @geekmidas/storage@10.0.0-alpha.38
  - @geekmidas/telescope@10.0.0-alpha.38

## 10.0.0-alpha.37

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.37
  - @geekmidas/auth@10.0.0-alpha.37
  - @geekmidas/cache@10.0.0-alpha.37
  - @geekmidas/db@10.0.0-alpha.37
  - @geekmidas/emailkit@10.0.0-alpha.37
  - @geekmidas/envkit@10.0.0-alpha.37
  - @geekmidas/errors@10.0.0-alpha.37
  - @geekmidas/events@10.0.0-alpha.37
  - @geekmidas/logger@10.0.0-alpha.37
  - @geekmidas/manifest@10.0.0-alpha.37
  - @geekmidas/rate-limit@10.0.0-alpha.37
  - @geekmidas/schema@10.0.0-alpha.37
  - @geekmidas/services@10.0.0-alpha.37
  - @geekmidas/storage@10.0.0-alpha.37
  - @geekmidas/telescope@10.0.0-alpha.37
  - @geekmidas/testkit@10.0.0-alpha.37

## 10.0.0-alpha.36

### Patch Changes

- ✨ [#103](https://github.com/geekmidas/toolbox/pull/103) [`95cef66`](https://github.com/geekmidas/toolbox/commit/95cef66e07893be917b5d560a06618c60504b94e) Thanks [@geekmidas](https://github.com/geekmidas)! - `MobileApp`: one scheme for every stage, and the app adds `expo()` itself

  - **One scheme.** A mobile app's scheme is the project's name (`shop`), or the
    one its construct gives, on every stage: local, test and deployed. It was
    suffixed locally (`shop-dev`). `appScheme` is gone from `@geekmidas/manifest`,
    and `schemeBase` is the scheme.
  - **`@geekmidas/constructs` no longer depends on `@better-auth/expo`.** The
    auth construct imported it as an optional peer, and pnpm gives
    `@geekmidas/constructs` a separate copy for every workspace package that
    resolves that peer differently. A construct from one copy is not an instance
    of the other, so the test harness found none of an app's databases and every
    feature test failed with `UnknownFactory`.
  - ✨ **The app adds `expo()` to its auth server's plugins.** When the graph says a
    mobile app calls the auth server (a scheme among its derived trusted
    origins) and the plugin is missing, the server refuses to start with
    `ExpoPluginRequired`, naming the scheme. It finds the plugin by its `id`
    without importing the package. An origin the app trusts by hand is not
    checked. `gkm init` with Expo writes `expo()` into `constructs/auth.ts`.

  **Moving an existing app:**

  - ✨ add `import { expo } from '@better-auth/expo'` and `options: { plugins: [expo()] }`
    to the auth construct;
  - 🐛 install `@better-auth/expo` where that file resolves its imports;
  - rebuild the app with the scheme without its stage suffix.

- Updated dependencies [[`95cef66`](https://github.com/geekmidas/toolbox/commit/95cef66e07893be917b5d560a06618c60504b94e)]:
  - @geekmidas/manifest@10.0.0-alpha.36
  - @geekmidas/audit@10.0.0-alpha.36
  - @geekmidas/auth@10.0.0-alpha.36
  - @geekmidas/cache@10.0.0-alpha.36
  - @geekmidas/db@10.0.0-alpha.36
  - @geekmidas/emailkit@10.0.0-alpha.36
  - @geekmidas/envkit@10.0.0-alpha.36
  - @geekmidas/errors@10.0.0-alpha.36
  - @geekmidas/events@10.0.0-alpha.36
  - @geekmidas/logger@10.0.0-alpha.36
  - @geekmidas/rate-limit@10.0.0-alpha.36
  - @geekmidas/schema@10.0.0-alpha.36
  - @geekmidas/services@10.0.0-alpha.36
  - @geekmidas/storage@10.0.0-alpha.36
  - @geekmidas/telescope@10.0.0-alpha.36
  - @geekmidas/testkit@10.0.0-alpha.36

## 10.0.0-alpha.35

### Patch Changes

- [#102](https://github.com/geekmidas/toolbox/pull/102) [`78d87ac`](https://github.com/geekmidas/toolbox/commit/78d87ace5e9a6027c8bba74e0bb40260431f7912) Thanks [@geekmidas](https://github.com/geekmidas)! - `MobileApp`: an Expo app declared as a construct

  ```ts
  // constructs/app.ts
  export const app = new MobileApp("App", { path: "apps/app" }).dependsOn([
    api,
    auth,
  ]);
  ```

  Like a `StaticSite`, its `.dependsOn()` is the single fact everything a mobile
  app otherwise writes down by hand is derived from:

  - **Shaped like `StaticSite`:** `path`, `port?`, `config?` and
    `variant?` (`'expo'`), plus `scheme?`. A mobile app is given a port in the
    same stable order, and `gkm exec` hands it to Expo as `RCT_METRO_PORT`.
  - **A scheme per stage:** the project's name deployed (`shop`), suffixed
    locally (`shop-dev`), so a development build and the store build on one
    phone never answer each other's links. It arrives as `APP_SCHEME`.
  - **URLs a phone can reach:** `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_AUTH_URL`.
    Locally they're each server's own port, which the app points at the LAN
    address Metro served it from on a phone, or `10.0.2.2` on the Android
    emulator, instead of an edge hostname that only resolves on this machine.
  - **Trusted origins:** the scheme, in every surface it depends on. Locally that
    also covers the `exp://` origins Expo Go sends from, for this machine's exact
    LAN address and `localhost` on Metro's port, never a subnet.
  - ✨ **Better Auth's Expo plugin:** `BetterAuth` adds `expo()` itself when a
    mobile app depends on it. `@better-auth/expo` is an optional peer, and
    `ExpoPluginMissing` says to install it.
  - **Sign-in links a phone can open:** locally, a magic link the app asked for
    (its `callbackURL` is the scheme) is built on the auth server's LAN address,
    `AUTH_DEVICE_URL`. A browser's link is left alone.
  - **Signing in from the emailed link:** the server's Expo plugin carries the
    session back into the app as `?cookie=` (tested for the dev build's scheme
    and Expo Go). The scaffold's `useSessionFromLink()` stores it, merged with
    the client's `getSetCookie`, since the Expo client only does this for social
    sign-in.
  - **Deployed:** Dokploy and AWS trust the bare scheme. Neither builds the app;
    EAS and the stores do.

  `gkm init` with Expo scaffolds on Expo SDK 57 (React Native 0.86, with
  `react-native-worklets` for Reanimated 4), declares the app in
  `constructs/app.ts` and installs
  `@better-auth/expo` at the root. Its `app.config.ts` parses `APP_SCHEME` and
  both URLs into `extra.config`, which `config.ts` reads at runtime. `eas.json`
  no longer hard-codes local URLs. `gkm dev` lists the app with its scheme and
  the address devices reach.

  `@geekmidas/manifest` adds the `mobile-app` declaration kind, and
  `schemeBase`, `appScheme`, `mobileOrigins` and `isWebOrigin` for the rules all
  three targets share.

  See `docs/design/mobile-app.md`.

- Updated dependencies [[`78d87ac`](https://github.com/geekmidas/toolbox/commit/78d87ace5e9a6027c8bba74e0bb40260431f7912)]:
  - @geekmidas/manifest@10.0.0-alpha.35
  - @geekmidas/audit@10.0.0-alpha.35
  - @geekmidas/auth@10.0.0-alpha.35
  - @geekmidas/cache@10.0.0-alpha.35
  - @geekmidas/db@10.0.0-alpha.35
  - @geekmidas/emailkit@10.0.0-alpha.35
  - @geekmidas/envkit@10.0.0-alpha.35
  - @geekmidas/errors@10.0.0-alpha.35
  - @geekmidas/events@10.0.0-alpha.35
  - @geekmidas/logger@10.0.0-alpha.35
  - @geekmidas/rate-limit@10.0.0-alpha.35
  - @geekmidas/schema@10.0.0-alpha.35
  - @geekmidas/services@10.0.0-alpha.35
  - @geekmidas/storage@10.0.0-alpha.35
  - @geekmidas/telescope@10.0.0-alpha.35
  - @geekmidas/testkit@10.0.0-alpha.35

## 10.0.0-alpha.34

### Patch Changes

- Updated dependencies [[`1e71b33`](https://github.com/geekmidas/toolbox/commit/1e71b33cf55a6eff0f458b3b8e80ab98d1058acc)]:
  - @geekmidas/db@10.0.0-alpha.34
  - @geekmidas/audit@10.0.0-alpha.34
  - @geekmidas/auth@10.0.0-alpha.34
  - @geekmidas/cache@10.0.0-alpha.34
  - @geekmidas/emailkit@10.0.0-alpha.34
  - @geekmidas/envkit@10.0.0-alpha.34
  - @geekmidas/errors@10.0.0-alpha.34
  - @geekmidas/events@10.0.0-alpha.34
  - @geekmidas/logger@10.0.0-alpha.34
  - @geekmidas/manifest@10.0.0-alpha.34
  - @geekmidas/rate-limit@10.0.0-alpha.34
  - @geekmidas/schema@10.0.0-alpha.34
  - @geekmidas/services@10.0.0-alpha.34
  - @geekmidas/storage@10.0.0-alpha.34
  - @geekmidas/telescope@10.0.0-alpha.34
  - @geekmidas/testkit@10.0.0-alpha.34

## 10.0.0-alpha.33

### Patch Changes

- [#97](https://github.com/geekmidas/toolbox/pull/97) [`e7178a8`](https://github.com/geekmidas/toolbox/commit/e7178a8d804b7f9ffbffd2df3f6974d8f65feeb5) Thanks [@geekmidas](https://github.com/geekmidas)! - Feature tests: `db.get`, `factories.get` and `browser.signIn`

  A feature test is handed the app's own databases by name, a factory for each,
  and a way to sign in, with nothing to import:

  ```ts
  it("lets a member join a tournament", async ({ browser, db, factories }) => {
    const factory = await factories.get("database");
    const tournament = await factory.insert("tournaments", {});

    const { user } = await browser.signIn("ada@example.com");
    await browser.api.post("/tournaments/{id}/join", {
      params: { id: tournament.id },
    });

    const app = await db.get("database");
    const members = await app
      .selectFrom("tournamentMembers")
      .selectAll()
      .execute();
    expect(members).toMatchObject([{ userId: user.id }]);
  });
  ```

  - **`db.get(name)`:** a database's transaction for this test, by service name
    and typed by its schema. It opens on first use by whatever reaches it first
    (the test, a factory or an endpoint), and they all share it.
  - **The app's own databases only:** a schema tenant an auth server owns is
    reached through that server, as the app reaches it, and a reader is the same
    database through a read-only role. Neither is handed to a test.
    `db.get('authDb')` throws `UnknownDatabase` and doesn't compile.
  - **`factories.get(name)`:** one per database, from
    `test/factories/<construct>.ts` at the project root (`database.ts` for
    `Database`), exporting `createFactory(db)`. It's built once on that
    database's transaction for the test, so endpoints see the rows and they're
    rolled back with everything else.
    - A file named after no database of the app's, the auth tenant included,
      throws `UnknownFactoryFile`.
    - A file without `createFactory` throws `FactoryHasNoCreate`.
    - ✅ `test: { factories: '…' }` in `gkm.config.ts` moves the folder.
  - **`browser.signIn(email)`:** generated when one auth server has the
    magic-link plugin and the app sends mail. It requests the link, reads it
    from the inbox (cleared first, so it's this request's), follows it, and
    returns the session the auth server reports. `SignInFailed` says which step
    failed.
  - **`gkm init`** scaffolds `test/factories/database.ts` at the project root, in
    both layouts.

  **Breaking:** `db` used to be one transaction, inferred from whichever database
  the endpoints named first, and opened before every test. Nothing is inferred
  now, and nothing opens before it's used. `featureTest({ database })` is gone.

  **Moving an existing project:**

  - move the factory to `test/factories/database.ts` at the root, keeping its
    `createFactory(db)` export;
  - replace `createFactory(db)` with `await factories.get('database')`;
  - replace `db.selectFrom(…)` with `(await db.get('database')).selectFrom(…)`;
  - replace a hand-written magic-link helper with `browser.signIn(email)`;
  - replace `FeatureContext<Browser, unknown>` with `FeatureContext<Browser>`.

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.33
  - @geekmidas/auth@10.0.0-alpha.33
  - @geekmidas/cache@10.0.0-alpha.33
  - @geekmidas/db@10.0.0-alpha.33
  - @geekmidas/emailkit@10.0.0-alpha.33
  - @geekmidas/envkit@10.0.0-alpha.33
  - @geekmidas/errors@10.0.0-alpha.33
  - @geekmidas/events@10.0.0-alpha.33
  - @geekmidas/logger@10.0.0-alpha.33
  - @geekmidas/manifest@10.0.0-alpha.33
  - @geekmidas/rate-limit@10.0.0-alpha.33
  - @geekmidas/schema@10.0.0-alpha.33
  - @geekmidas/services@10.0.0-alpha.33
  - @geekmidas/storage@10.0.0-alpha.33
  - @geekmidas/telescope@10.0.0-alpha.33
  - @geekmidas/testkit@10.0.0-alpha.33

## 10.0.0-alpha.32

### Patch Changes

- Updated dependencies [[`9b647d0`](https://github.com/geekmidas/toolbox/commit/9b647d09e28ba095178d33613ee4a9e91b8eb47d)]:
  - @geekmidas/manifest@10.0.0-alpha.32
  - @geekmidas/audit@10.0.0-alpha.32
  - @geekmidas/auth@10.0.0-alpha.32
  - @geekmidas/cache@10.0.0-alpha.32
  - @geekmidas/db@10.0.0-alpha.32
  - @geekmidas/emailkit@10.0.0-alpha.32
  - @geekmidas/envkit@10.0.0-alpha.32
  - @geekmidas/errors@10.0.0-alpha.32
  - @geekmidas/events@10.0.0-alpha.32
  - @geekmidas/logger@10.0.0-alpha.32
  - @geekmidas/rate-limit@10.0.0-alpha.32
  - @geekmidas/schema@10.0.0-alpha.32
  - @geekmidas/services@10.0.0-alpha.32
  - @geekmidas/storage@10.0.0-alpha.32
  - @geekmidas/telescope@10.0.0-alpha.32
  - @geekmidas/testkit@10.0.0-alpha.32

## 10.0.0-alpha.31

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.31
  - @geekmidas/auth@10.0.0-alpha.31
  - @geekmidas/cache@10.0.0-alpha.31
  - @geekmidas/db@10.0.0-alpha.31
  - @geekmidas/emailkit@10.0.0-alpha.31
  - @geekmidas/envkit@10.0.0-alpha.31
  - @geekmidas/errors@10.0.0-alpha.31
  - @geekmidas/events@10.0.0-alpha.31
  - @geekmidas/logger@10.0.0-alpha.31
  - @geekmidas/manifest@10.0.0-alpha.31
  - @geekmidas/rate-limit@10.0.0-alpha.31
  - @geekmidas/schema@10.0.0-alpha.31
  - @geekmidas/services@10.0.0-alpha.31
  - @geekmidas/storage@10.0.0-alpha.31
  - @geekmidas/telescope@10.0.0-alpha.31
  - @geekmidas/testkit@10.0.0-alpha.31

## 10.0.0-alpha.30

### Patch Changes

- [#93](https://github.com/geekmidas/toolbox/pull/93) [`58eba5c`](https://github.com/geekmidas/toolbox/commit/58eba5cd5bc0e76565668bd9a48d836dd622ef98) Thanks [@geekmidas](https://github.com/geekmidas)! - `BetterAuth#pendingMigration()` replaces `migrations()`

  Better Auth's schema is now committed SQL in its tenant's migrations folder,
  written by `gkm migration auth`, instead of being diffed and applied at
  runtime. `pendingMigration(options)` returns what the tenant is missing — as
  `create table if not exists`/`create index if not exists`/`add column if not
exists`, so the first migration also applies to a database Better Auth set up
  at runtime — or `undefined` when it matches. `databaseId` names the tenant.

  A feature test's harness also trusts the local edge's CA in each worker, so a
  suite started by plain `vitest` reaches `https://` addresses as one started by
  `gkm test` does.

- Updated dependencies [[`58eba5c`](https://github.com/geekmidas/toolbox/commit/58eba5cd5bc0e76565668bd9a48d836dd622ef98)]:
  - @geekmidas/manifest@10.0.0-alpha.30
  - @geekmidas/audit@10.0.0-alpha.30
  - @geekmidas/auth@10.0.0-alpha.30
  - @geekmidas/cache@10.0.0-alpha.30
  - @geekmidas/db@10.0.0-alpha.30
  - @geekmidas/emailkit@10.0.0-alpha.30
  - @geekmidas/envkit@10.0.0-alpha.30
  - @geekmidas/errors@10.0.0-alpha.30
  - @geekmidas/events@10.0.0-alpha.30
  - @geekmidas/logger@10.0.0-alpha.30
  - @geekmidas/rate-limit@10.0.0-alpha.30
  - @geekmidas/schema@10.0.0-alpha.30
  - @geekmidas/services@10.0.0-alpha.30
  - @geekmidas/storage@10.0.0-alpha.30
  - @geekmidas/telescope@10.0.0-alpha.30
  - @geekmidas/testkit@10.0.0-alpha.30

## 10.0.0-alpha.29

### Patch Changes

- [#92](https://github.com/geekmidas/toolbox/pull/92) [`cf82cef`](https://github.com/geekmidas/toolbox/commit/cf82cefb1aa19cc551c61e58a5c4d8ed608c85b3) Thanks [@geekmidas](https://github.com/geekmidas)! - A publisher derived from a topic or queue is an edge to it

  `.publisher(users.publisher)` took a plain service, so the endpoint, cron or
  function it was given to recorded no edge to the `users` topic — unlike
  `.database()` or `.dependsOn()`. The app's environment is composed from its
  edges, so kitchen-sink's API container was generated without
  `USERS_PUBLISHER_CONNECTION_STRING` while its handlers publish to `users`.

  `Topic#publisher` and `Queue#publisher` are marked with the construct they
  stand for (`derivedFrom`), and every publishing builder's `.publisher()`
  records that id (`edgesWith`), the way `.database()` does. A subscriber's
  `.publisher()` is a binding, not a dependency, and records nothing.

- [#92](https://github.com/geekmidas/toolbox/pull/92) [`a8632d3`](https://github.com/geekmidas/toolbox/commit/a8632d33f5e3acd8e84a5714602da5e6b85c9094) Thanks [@geekmidas](https://github.com/geekmidas)! - A feature test's database client is built with the construct's own Kysely config

  `featureTest` handed endpoints, and the test's `db`, a Kysely it built itself —
  with a dialect and nothing else. A database declared with
  `plugins: [new CamelCasePlugin()]` ran without it under test, so a test wrote
  `createdAt` to a `created_at` column and failed on code production ran fine
  (or passed on code it would not).

  `KyselyDatabase` exposes `clientConfig` — the Kysely options it was declared
  with, less `schema`/`roles`/`version` — and `connect()` builds from it.
  `openBoundTransaction(url, config)` and `TransactionRegistry.get(key, url,
config)` take it, and `featureTest` passes it for every test transaction.

- Updated dependencies [[`a8632d3`](https://github.com/geekmidas/toolbox/commit/a8632d33f5e3acd8e84a5714602da5e6b85c9094)]:
  - @geekmidas/testkit@10.0.0-alpha.29
  - @geekmidas/audit@10.0.0-alpha.29
  - @geekmidas/auth@10.0.0-alpha.29
  - @geekmidas/cache@10.0.0-alpha.29
  - @geekmidas/db@10.0.0-alpha.29
  - @geekmidas/emailkit@10.0.0-alpha.29
  - @geekmidas/envkit@10.0.0-alpha.29
  - @geekmidas/errors@10.0.0-alpha.29
  - @geekmidas/events@10.0.0-alpha.29
  - @geekmidas/logger@10.0.0-alpha.29
  - @geekmidas/manifest@10.0.0-alpha.29
  - @geekmidas/rate-limit@10.0.0-alpha.29
  - @geekmidas/schema@10.0.0-alpha.29
  - @geekmidas/services@10.0.0-alpha.29
  - @geekmidas/storage@10.0.0-alpha.29
  - @geekmidas/telescope@10.0.0-alpha.29

## 10.0.0-alpha.28

### Patch Changes

- [#91](https://github.com/geekmidas/toolbox/pull/91) [`376b2ce`](https://github.com/geekmidas/toolbox/commit/376b2ce470ee919e2f30a0eebd9ba229d37112af) Thanks [@geekmidas](https://github.com/geekmidas)! - An app's compose environment is its edges, not the whole workspace

  `docker-compose.constructs.yml` gave every app every key the workspace
  resolved — a web app got the database's owner URL and the auth server's
  signing secret, the API got the auth server's database. Each app's service now
  holds what its own declaration provides and requires, and what each construct
  it has an edge to provides: a site also gets the public variants its bundle
  inlines, and the generated API server the edges of the workers whose crons it
  runs.

  Found with it, in `@geekmidas/constructs`:

  - `api.database(db)` (and a function's or cron's `.database(db)`) wired the
    database's service but never recorded the edge, so nothing composed from the
    edges — a container's environment, a deploy's grants — knew the endpoint
    reached a database. It is recorded like any `.dependsOn()`.
  - `BetterAuth` had no way to declare what its `options` use — the mailer a
    magic link goes through, usually — so that edge was invisible, and `options`
    imported and registered the construct by hand. Its config takes
    `dependsOn: [...]` now: each construct is an edge on the server's handler,
    and `options` receives a client for each in `services`, typed as an
    endpoint's are — `options: async ({ services }) => …services.mail…`.

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.28
  - @geekmidas/auth@10.0.0-alpha.28
  - @geekmidas/cache@10.0.0-alpha.28
  - @geekmidas/db@10.0.0-alpha.28
  - @geekmidas/emailkit@10.0.0-alpha.28
  - @geekmidas/envkit@10.0.0-alpha.28
  - @geekmidas/errors@10.0.0-alpha.28
  - @geekmidas/events@10.0.0-alpha.28
  - @geekmidas/logger@10.0.0-alpha.28
  - @geekmidas/manifest@10.0.0-alpha.28
  - @geekmidas/rate-limit@10.0.0-alpha.28
  - @geekmidas/schema@10.0.0-alpha.28
  - @geekmidas/services@10.0.0-alpha.28
  - @geekmidas/storage@10.0.0-alpha.28
  - @geekmidas/telescope@10.0.0-alpha.28
  - @geekmidas/testkit@10.0.0-alpha.28

## 10.0.0-alpha.27

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.27
  - @geekmidas/auth@10.0.0-alpha.27
  - @geekmidas/cache@10.0.0-alpha.27
  - @geekmidas/db@10.0.0-alpha.27
  - @geekmidas/emailkit@10.0.0-alpha.27
  - @geekmidas/envkit@10.0.0-alpha.27
  - @geekmidas/errors@10.0.0-alpha.27
  - @geekmidas/events@10.0.0-alpha.27
  - @geekmidas/logger@10.0.0-alpha.27
  - @geekmidas/manifest@10.0.0-alpha.27
  - @geekmidas/rate-limit@10.0.0-alpha.27
  - @geekmidas/schema@10.0.0-alpha.27
  - @geekmidas/services@10.0.0-alpha.27
  - @geekmidas/storage@10.0.0-alpha.27
  - @geekmidas/telescope@10.0.0-alpha.27
  - @geekmidas/testkit@10.0.0-alpha.27

## 10.0.0-alpha.26

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.26
  - @geekmidas/auth@10.0.0-alpha.26
  - @geekmidas/cache@10.0.0-alpha.26
  - @geekmidas/db@10.0.0-alpha.26
  - @geekmidas/emailkit@10.0.0-alpha.26
  - @geekmidas/envkit@10.0.0-alpha.26
  - @geekmidas/errors@10.0.0-alpha.26
  - @geekmidas/events@10.0.0-alpha.26
  - @geekmidas/logger@10.0.0-alpha.26
  - @geekmidas/manifest@10.0.0-alpha.26
  - @geekmidas/rate-limit@10.0.0-alpha.26
  - @geekmidas/schema@10.0.0-alpha.26
  - @geekmidas/services@10.0.0-alpha.26
  - @geekmidas/storage@10.0.0-alpha.26
  - @geekmidas/telescope@10.0.0-alpha.26
  - @geekmidas/testkit@10.0.0-alpha.26

## 10.0.0-alpha.25

### Patch Changes

- [#86](https://github.com/geekmidas/toolbox/pull/86) [`6b4e1b9`](https://github.com/geekmidas/toolbox/commit/6b4e1b9190eef542099952d80e9b9001a8939621) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm dev` runs the build's own pipeline, and starts an auth server

  `gkm dev` had its own copy of the steps from constructs to a server entry, and
  each time `gkm build` learned something about constructs, dev did not. An auth
  app (`BetterAuth`, whose routes are a wildcard no glob finds) crashed on start
  with `Cannot find module '.gkm/server/app.js'`. Dev now calls the same
  `buildApp` the build does, so the two generate the same entry.

  Whether a surface serves itself is now asked of the construct (it has a
  `server()`), not inferred from a glob that found nothing.

  Also fixed on the way, each found by running `gkm dev` against a real app:

  - The generated `subscribers.ts` and `queues.ts` imported `@geekmidas/events`
    even when the app declared no Topic or Queue, so any app without that package
    installed crashed in dev.
  - Restarting or stopping the dev server ran `kill -9` on every process with a
    socket on its port — the browser, the web app's server — not only the one
    listening on it.
  - `gkm dev` at a workspace root ran turbo with no filter, so turbo also ran the
    root package's own `dev` — `gkm dev` again — and every app started twice,
    fighting over its port. Dev now names each app's package, as `gkm build` does.
  - Every app in a workspace asked for port 3000, because the CLI turned a
    missing `--port` into 3000 before the workspace's port was consulted.
  - A `Worker`'s crons never scheduled on a server. They are now scheduled
    through the events broker — the app's one pg-boss, as the broker's role, in
    its schema — rather than a second pg-boss on the worker's database as the
    runtime role, which could neither create a schema nor use the broker's.
    Reconcile resolves the broker's connection strings for a declared worker on
    pg-boss even when no queue or topic is declared.
  - From an app with its own tsconfig — a Vite or Next frontend — every `gkm`
    command failed to load another app's constructs through the root tsconfig's
    path aliases. The hook that resolves them was installed with
    `module.register()`, and tsx 4.23's in-thread resolver threw before it was
    asked; it is now installed with `module.registerHooks()` when Node has it.

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.25
  - @geekmidas/auth@10.0.0-alpha.25
  - @geekmidas/cache@10.0.0-alpha.25
  - @geekmidas/db@10.0.0-alpha.25
  - @geekmidas/emailkit@10.0.0-alpha.25
  - @geekmidas/envkit@10.0.0-alpha.25
  - @geekmidas/errors@10.0.0-alpha.25
  - @geekmidas/events@10.0.0-alpha.25
  - @geekmidas/logger@10.0.0-alpha.25
  - @geekmidas/manifest@10.0.0-alpha.25
  - @geekmidas/rate-limit@10.0.0-alpha.25
  - @geekmidas/schema@10.0.0-alpha.25
  - @geekmidas/services@10.0.0-alpha.25
  - @geekmidas/storage@10.0.0-alpha.25
  - @geekmidas/telescope@10.0.0-alpha.25
  - @geekmidas/testkit@10.0.0-alpha.25

## 10.0.0-alpha.24

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.24
  - @geekmidas/auth@10.0.0-alpha.24
  - @geekmidas/cache@10.0.0-alpha.24
  - @geekmidas/db@10.0.0-alpha.24
  - @geekmidas/emailkit@10.0.0-alpha.24
  - @geekmidas/envkit@10.0.0-alpha.24
  - @geekmidas/errors@10.0.0-alpha.24
  - @geekmidas/events@10.0.0-alpha.24
  - @geekmidas/logger@10.0.0-alpha.24
  - @geekmidas/manifest@10.0.0-alpha.24
  - @geekmidas/rate-limit@10.0.0-alpha.24
  - @geekmidas/schema@10.0.0-alpha.24
  - @geekmidas/services@10.0.0-alpha.24
  - @geekmidas/storage@10.0.0-alpha.24
  - @geekmidas/telescope@10.0.0-alpha.24
  - @geekmidas/testkit@10.0.0-alpha.24

## 10.0.0-alpha.23

### Patch Changes

- [#83](https://github.com/geekmidas/toolbox/pull/83) [`31a4ed5`](https://github.com/geekmidas/toolbox/commit/31a4ed57b5c962bc5b961e734b20249b3c64f3d6) Thanks [@geekmidas](https://github.com/geekmidas)! - `BetterAuth.migrations()` no longer logs a schema mismatch before migrating

  It built a full better-auth server just to read its options back, and
  better-auth checks its schema when a server starts — so every migration against
  a fresh database began with `ERROR [Better Auth]: Database schema mismatch —
Missing tables user, session, account, verification`, about the very tables it
  was about to create. The options are now assembled once and handed to the server
  and to the migration builder alike, so migrating starts no server.

- [#84](https://github.com/geekmidas/toolbox/pull/84) [`7c7e0ef`](https://github.com/geekmidas/toolbox/commit/7c7e0efac3b655a20c9eb8f3a4ff4e3e9e4deea9) Thanks [@geekmidas](https://github.com/geekmidas)! - The generated test harness imports the app's modules itself

  `featureTest` imported each construct and endpoint by path. From a published
  `@geekmidas/constructs` — inside `node_modules` — Vitest leaves that dynamic
  import to Node, which knows nothing of the app's tsconfig paths, so the first
  endpoint importing `~/router.ts` failed with `Cannot find package '~'`. (In this
  repo the packages are linked sources, which Vite processes, so it never showed.)

  The generated `index.ts` now imports every module the manifest records,
  statically, from inside the app, and hands them to `featureTest` as `modules`
  keyed by the recorded path — resolving the way the app's own code does. A
  module not handed over is still imported by path.

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.23
  - @geekmidas/auth@10.0.0-alpha.23
  - @geekmidas/cache@10.0.0-alpha.23
  - @geekmidas/db@10.0.0-alpha.23
  - @geekmidas/emailkit@10.0.0-alpha.23
  - @geekmidas/envkit@10.0.0-alpha.23
  - @geekmidas/errors@10.0.0-alpha.23
  - @geekmidas/events@10.0.0-alpha.23
  - @geekmidas/logger@10.0.0-alpha.23
  - @geekmidas/manifest@10.0.0-alpha.23
  - @geekmidas/rate-limit@10.0.0-alpha.23
  - @geekmidas/schema@10.0.0-alpha.23
  - @geekmidas/services@10.0.0-alpha.23
  - @geekmidas/storage@10.0.0-alpha.23
  - @geekmidas/telescope@10.0.0-alpha.23
  - @geekmidas/testkit@10.0.0-alpha.23

## 10.0.0-alpha.22

### Minor Changes

- [#82](https://github.com/geekmidas/toolbox/pull/82) [`ba670bf`](https://github.com/geekmidas/toolbox/commit/ba670bfde5db17f89a4f59d73ca63a09ef449a0c) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm test` writes a test manifest, and the feature-test kit is built from it

  `gkm test` already discovered an app's constructs and resolved its test stage —
  then threw both away and left a test to declare them again, environment keys
  included. It now writes `.gkm/test/` into each app:

  - `manifest.json` — every construct and endpoint's source (file and export) and
    the test stage's environment, keyed as the constructs derive their keys;
  - `clients/<surface>.ts` — each surface's typed client, from the generator
    `gkm build` uses;
  - `index.ts` — a `Browser` with a typed client per surface and a better-auth
    client per auth server (server plugins paired with their client plugins), the
    drivers the server entry registers, and the configured `it`, with `db` typed
    by the schema of the database the endpoints name.

  An app maps `"#test": "./.gkm/test/index.ts"`, and a test is `import { it }
from '#test'` — no construct, environment key or client written by hand.
  `gkm test --prepare` writes it and stops, for a typecheck that runs before the
  suite.

  `featureTest` reads the manifest (`GKM_TEST_MANIFEST`), imports the app's own
  construct and endpoint instances from their sources, serves each auth server's
  whole origin, and gains `published(topic | queue)` and `subscriber(s)` /
  `queue(q)` — handlers run on their own with the test's services and
  transactions. Its `modules`/`env` options are gone. `BetterAuth.pluginIds()`
  reports the plugins a server runs.

  The generated `createApi` for a surface with authorizers accepts a `fetch`, and
  `createAuthAwareFetcher`'s type now includes the method calls it already had.

  kitchen-sink's suite runs on this, in CI, through `gkm test`: it had run
  nothing since its tests moved (a stale `include`), and its constructs glob
  missed its endpoints and queues.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.22
  - @geekmidas/auth@10.0.0-alpha.22
  - @geekmidas/cache@10.0.0-alpha.22
  - @geekmidas/db@10.0.0-alpha.22
  - @geekmidas/emailkit@10.0.0-alpha.22
  - @geekmidas/envkit@10.0.0-alpha.22
  - @geekmidas/errors@10.0.0-alpha.22
  - @geekmidas/events@10.0.0-alpha.22
  - @geekmidas/logger@10.0.0-alpha.22
  - @geekmidas/manifest@10.0.0-alpha.22
  - @geekmidas/rate-limit@10.0.0-alpha.22
  - @geekmidas/schema@10.0.0-alpha.22
  - @geekmidas/services@10.0.0-alpha.22
  - @geekmidas/storage@10.0.0-alpha.22
  - @geekmidas/telescope@10.0.0-alpha.22
  - @geekmidas/testkit@10.0.0-alpha.22

## 10.0.0-alpha.21

### Minor Changes

- [#81](https://github.com/geekmidas/toolbox/pull/81) [`d505053`](https://github.com/geekmidas/toolbox/commit/d505053ef116d609a8fac6dec85dfcb091d6ac5e) Thanks [@geekmidas](https://github.com/geekmidas)! - `featureTest`: drive an app the way it runs deployed

  `@geekmidas/constructs/testing` gains `featureTest`: a browser signs in and calls
  the API, the API asks the auth server who is calling, each over its URL, and
  every database is in its own transaction, rolled back after the test.

  - Each surface's endpoints and each `BetterAuth` server are served in-process
    through MSW, from the real handler, for the test a request was made for —
    found from the `x-test-context-id` header, including on a request the code
    under test made while handling another.
  - 🐛 Each database construct — the app's and each schema tenant — resolves, inside
    a test, to that test's own transaction on its own connection.
  - Fixtures: `browser` (already the global `fetch`), `db`, `mailbox(address)`.
  - A request belonging to no running test is refused (`UnknownTestContext`).

  `gkm test` and `gkm dev` publish `<ID>_INBOX_URL` beside an `Email` construct's
  URL: Mailpit's inbox, where the mail it sent is read back. Local only.

  `@geekmidas/testkit` is an optional peer of `@geekmidas/constructs`, needed by
  `./testing` alone.

  Part 3b of #77.

### Patch Changes

- Updated dependencies [[`1e2bc9b`](https://github.com/geekmidas/toolbox/commit/1e2bc9b18a36f31fa5658c5695ee3e11264e2709)]:
  - @geekmidas/testkit@10.0.0-alpha.21
  - @geekmidas/audit@10.0.0-alpha.21
  - @geekmidas/auth@10.0.0-alpha.21
  - @geekmidas/cache@10.0.0-alpha.21
  - @geekmidas/db@10.0.0-alpha.21
  - @geekmidas/emailkit@10.0.0-alpha.21
  - @geekmidas/envkit@10.0.0-alpha.21
  - @geekmidas/errors@10.0.0-alpha.21
  - @geekmidas/events@10.0.0-alpha.21
  - @geekmidas/logger@10.0.0-alpha.21
  - @geekmidas/manifest@10.0.0-alpha.21
  - @geekmidas/rate-limit@10.0.0-alpha.21
  - @geekmidas/schema@10.0.0-alpha.21
  - @geekmidas/services@10.0.0-alpha.21
  - @geekmidas/storage@10.0.0-alpha.21
  - @geekmidas/telescope@10.0.0-alpha.21

## 10.0.0-alpha.20

### Minor Changes

- [#79](https://github.com/geekmidas/toolbox/pull/79) [`59e3fab`](https://github.com/geekmidas/toolbox/commit/59e3fabaec37ac7ffd9c26c2927daf0cc8f406c8) Thanks [@geekmidas](https://github.com/geekmidas)! - `session({ auth })`: the surface's authenticator is where a session is read

  `api.auth(auth)` declared an edge and nothing more — every project then
  re-implemented reading the session with a hand-written service. Now a session
  callback receives `auth`, the construct named in `.auth()`, bound to the request:

  ```ts
  export const sessionRouter = router.session(async ({ auth }) => {
    const session = await auth.getSession();
    if (!session) throw new UnauthorizedError("No active session");
    return session;
  });
  ```

  Handlers still get whatever `.session()` returned. Only a `.session()` branch
  asks the authenticator anything, so public routes pay nothing.

  - `RestApi.auth()` takes an `Authenticator` — a construct with
    `verify(headers, envParser) → session | null` — and keeps it.
  - `BetterAuth` implements it: `verify` asks the auth server for the session at
    the URL the `.auth()` edge injects, forwarding only `cookie` and
    `authorization`. A failing server throws `SessionCheckFailed` rather than
    reading as signed out. `AuthSession` is better-auth's session type.
  - `auth.getSession()` on a surface with no `.auth()` throws `NoAuthenticator`.

  Part 2 of #77.

### Patch Changes

- [#78](https://github.com/geekmidas/toolbox/pull/78) [`6ee966c`](https://github.com/geekmidas/toolbox/commit/6ee966c1ea27d25720ac6767c9f2e7ffe63b3f7f) Thanks [@geekmidas](https://github.com/geekmidas)! - Typed method calls: `api.post('/users', { body })`

  Every client — `createTypedFetcher`, `createAuthAwareFetcher`, and so the
  generated `createApi` — now answers by method as well as by
  `api('POST /users', …)`: `api.get`, `post`, `put`, `patch`, `delete`, `options`.
  The route autocompletes per method (only routes with a `POST` appear in
  `api.post`), the second argument has only the keys the endpoint declares, and it
  is required exactly when something in it is.

  Three typing fixes came out of testing it, and apply to `api('…')` too:

  - **Routes declared with `:param` were uncallable.** `InferOpenApi` keyed them by
    the declared form (`/users/:id`) instead of the served one (`/users/{id}`), so
    no path parameter was inferred and the documented `api('GET /users/{id}')` did
    not typecheck against an endpoint declared that way. Paths are now keyed with
    `ConvertRouteParams`, which `@geekmidas/constructs/endpoints` now exports.
  - **A GET accepted any body.** An absent body is `requestBody?: never`, which
    matched `{ content?: … }` with the body inferred as `unknown`.
  - **A required query was optional.** `query` was always optional and never made
    the argument required; now a query with a required key is required, and so is
    the argument.

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.20
  - @geekmidas/auth@10.0.0-alpha.20
  - @geekmidas/cache@10.0.0-alpha.20
  - @geekmidas/db@10.0.0-alpha.20
  - @geekmidas/emailkit@10.0.0-alpha.20
  - @geekmidas/envkit@10.0.0-alpha.20
  - @geekmidas/errors@10.0.0-alpha.20
  - @geekmidas/events@10.0.0-alpha.20
  - @geekmidas/logger@10.0.0-alpha.20
  - @geekmidas/manifest@10.0.0-alpha.20
  - @geekmidas/rate-limit@10.0.0-alpha.20
  - @geekmidas/schema@10.0.0-alpha.20
  - @geekmidas/services@10.0.0-alpha.20
  - @geekmidas/storage@10.0.0-alpha.20
  - @geekmidas/telescope@10.0.0-alpha.20

## 10.0.0-alpha.19

### Minor Changes

- [#76](https://github.com/geekmidas/toolbox/pull/76) [`8533bac`](https://github.com/geekmidas/toolbox/commit/8533baca5b4771281cdb017e44719d925bdcd883) Thanks [@geekmidas](https://github.com/geekmidas)! - Branch from the surface: `api.database(db)`; `api.endpoints` is gone

  `api.get()` was already sugar for `api.endpoints.get()`, but a group had to
  reach through the factory — `api.endpoints.database(database)`. The branching
  methods now live on the surface like the verbs do: `api.database()`,
  `api.session()`, `api.auditor()`, `api.actor()`, `api.publisher()`,
  `api.authorizer()`, `api.authorize()`, `api.rls()` and `api.route()`. Each
  returns a new factory and leaves the surface untouched, so a route built
  straight from `api` gets none of what a group opted into. The factory itself is
  private.

  Two methods deliberately stay off the surface. `dependsOn` is per endpoint —
  `api.post('/x').dependsOn([uploads])`. `services` is replaced by `dependsOn` on
  constructs. `logger` is the surface's config (`new RestApi(id, { logger })`),
  and `api.logger` is that logger.

  **Migrating:** `api.endpoints.database(db)` → `api.database(db)`;
  `api.endpoints.get(…)` → `api.get(…)`; `api.endpoints.dependsOn([x]).get(p)` →
  `api.get(p).dependsOn([x])`.

  The scaffold's `AGENTS.md` now shows what the scaffold generates: handlers
  read `db` (not `services.database`), the router is imported from
  `~/router.ts`, and a single endpoint can name its own database with
  `.database(other)`.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.19
  - @geekmidas/auth@10.0.0-alpha.19
  - @geekmidas/cache@10.0.0-alpha.19
  - @geekmidas/db@10.0.0-alpha.19
  - @geekmidas/emailkit@10.0.0-alpha.19
  - @geekmidas/envkit@10.0.0-alpha.19
  - @geekmidas/errors@10.0.0-alpha.19
  - @geekmidas/events@10.0.0-alpha.19
  - @geekmidas/logger@10.0.0-alpha.19
  - @geekmidas/manifest@10.0.0-alpha.19
  - @geekmidas/rate-limit@10.0.0-alpha.19
  - @geekmidas/schema@10.0.0-alpha.19
  - @geekmidas/services@10.0.0-alpha.19
  - @geekmidas/storage@10.0.0-alpha.19
  - @geekmidas/telescope@10.0.0-alpha.19

## 10.0.0-alpha.18

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.18
  - @geekmidas/auth@10.0.0-alpha.18
  - @geekmidas/cache@10.0.0-alpha.18
  - @geekmidas/db@10.0.0-alpha.18
  - @geekmidas/emailkit@10.0.0-alpha.18
  - @geekmidas/envkit@10.0.0-alpha.18
  - @geekmidas/errors@10.0.0-alpha.18
  - @geekmidas/events@10.0.0-alpha.18
  - @geekmidas/logger@10.0.0-alpha.18
  - @geekmidas/manifest@10.0.0-alpha.18
  - @geekmidas/rate-limit@10.0.0-alpha.18
  - @geekmidas/schema@10.0.0-alpha.18
  - @geekmidas/services@10.0.0-alpha.18
  - @geekmidas/storage@10.0.0-alpha.18
  - @geekmidas/telescope@10.0.0-alpha.18

## 10.0.0-alpha.17

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.17
  - @geekmidas/auth@10.0.0-alpha.17
  - @geekmidas/cache@10.0.0-alpha.17
  - @geekmidas/db@10.0.0-alpha.17
  - @geekmidas/emailkit@10.0.0-alpha.17
  - @geekmidas/envkit@10.0.0-alpha.17
  - @geekmidas/errors@10.0.0-alpha.17
  - @geekmidas/events@10.0.0-alpha.17
  - @geekmidas/logger@10.0.0-alpha.17
  - @geekmidas/manifest@10.0.0-alpha.17
  - @geekmidas/rate-limit@10.0.0-alpha.17
  - @geekmidas/schema@10.0.0-alpha.17
  - @geekmidas/services@10.0.0-alpha.17
  - @geekmidas/storage@10.0.0-alpha.17
  - @geekmidas/telescope@10.0.0-alpha.17

## 10.0.0-alpha.16

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.16
  - @geekmidas/auth@10.0.0-alpha.16
  - @geekmidas/cache@10.0.0-alpha.16
  - @geekmidas/db@10.0.0-alpha.16
  - @geekmidas/emailkit@10.0.0-alpha.16
  - @geekmidas/envkit@10.0.0-alpha.16
  - @geekmidas/errors@10.0.0-alpha.16
  - @geekmidas/events@10.0.0-alpha.16
  - @geekmidas/logger@10.0.0-alpha.16
  - @geekmidas/manifest@10.0.0-alpha.16
  - @geekmidas/rate-limit@10.0.0-alpha.16
  - @geekmidas/schema@10.0.0-alpha.16
  - @geekmidas/services@10.0.0-alpha.16
  - @geekmidas/storage@10.0.0-alpha.16
  - @geekmidas/telescope@10.0.0-alpha.16

## 10.0.0-alpha.15

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.15
  - @geekmidas/auth@10.0.0-alpha.15
  - @geekmidas/cache@10.0.0-alpha.15
  - @geekmidas/db@10.0.0-alpha.15
  - @geekmidas/emailkit@10.0.0-alpha.15
  - @geekmidas/envkit@10.0.0-alpha.15
  - @geekmidas/errors@10.0.0-alpha.15
  - @geekmidas/events@10.0.0-alpha.15
  - @geekmidas/logger@10.0.0-alpha.15
  - @geekmidas/manifest@10.0.0-alpha.15
  - @geekmidas/rate-limit@10.0.0-alpha.15
  - @geekmidas/schema@10.0.0-alpha.15
  - @geekmidas/services@10.0.0-alpha.15
  - @geekmidas/storage@10.0.0-alpha.15
  - @geekmidas/telescope@10.0.0-alpha.15

## 10.0.0-alpha.14

### Patch Changes

- [#65](https://github.com/geekmidas/toolbox/pull/65) [`9602a19`](https://github.com/geekmidas/toolbox/commit/9602a19a9b4fb9cecd2641d108976f73272df55e) Thanks [@geekmidas](https://github.com/geekmidas)! - The OpenAPI document validates, and says who may call what

  Checked against kitchen-sink with Redocly, swagger-parser and openapi-typescript:

  - **A registered schema kept its definition.** A schema with `.meta({ id })`
    came out as `User: { $ref: '#/components/schemas/User' }` — a pointer to
    itself, so the document had no `User` and validators refused it. Zod 4.6
    already refers a registered schema to its `$defs` entry; that reference is no
    longer written over the definition.
  - **OpenAPI 3.1.0**, not 3.0.0: the schemas are JSON Schema 2020-12
    (`type: ['string', 'null']`, `const`), which is 3.1's dialect. The
    per-schema `$schema` markers are dropped.
  - 🔒 **Security is documented.** An endpoint behind an authorizer gets a
    `security` requirement and its scheme in `components.securitySchemes`;
    before, every endpoint read as public. `RestApi`'s `authorizers: ['iam']`
    now resolves built-in names to their scheme, as the factory's own
    `.authorizers()` did.
  - **The success status is the one the endpoint answers with**: `.status(201)`
    is documented as `201`, not `200`.

- Updated dependencies [[`ce969d3`](https://github.com/geekmidas/toolbox/commit/ce969d39a79811f36622f07a2f797cc493a87d1b), [`9602a19`](https://github.com/geekmidas/toolbox/commit/9602a19a9b4fb9cecd2641d108976f73272df55e)]:
  - @geekmidas/events@10.0.0-alpha.14
  - @geekmidas/schema@10.0.0-alpha.14
  - @geekmidas/audit@10.0.0-alpha.14
  - @geekmidas/auth@10.0.0-alpha.14
  - @geekmidas/cache@10.0.0-alpha.14
  - @geekmidas/db@10.0.0-alpha.14
  - @geekmidas/emailkit@10.0.0-alpha.14
  - @geekmidas/envkit@10.0.0-alpha.14
  - @geekmidas/errors@10.0.0-alpha.14
  - @geekmidas/logger@10.0.0-alpha.14
  - @geekmidas/manifest@10.0.0-alpha.14
  - @geekmidas/rate-limit@10.0.0-alpha.14
  - @geekmidas/services@10.0.0-alpha.14
  - @geekmidas/storage@10.0.0-alpha.14
  - @geekmidas/telescope@10.0.0-alpha.14

## 10.0.0-alpha.13

### Patch Changes

- Updated dependencies [[`07d1827`](https://github.com/geekmidas/toolbox/commit/07d1827bb0a2a76d04a0fc25a7517df282004137)]:
  - @geekmidas/db@10.0.0-alpha.13
  - @geekmidas/telescope@10.0.0-alpha.13
  - @geekmidas/audit@10.0.0-alpha.13
  - @geekmidas/auth@10.0.0-alpha.13
  - @geekmidas/cache@10.0.0-alpha.13
  - @geekmidas/emailkit@10.0.0-alpha.13
  - @geekmidas/envkit@10.0.0-alpha.13
  - @geekmidas/errors@10.0.0-alpha.13
  - @geekmidas/events@10.0.0-alpha.13
  - @geekmidas/logger@10.0.0-alpha.13
  - @geekmidas/manifest@10.0.0-alpha.13
  - @geekmidas/rate-limit@10.0.0-alpha.13
  - @geekmidas/schema@10.0.0-alpha.13
  - @geekmidas/services@10.0.0-alpha.13
  - @geekmidas/storage@10.0.0-alpha.13

## 10.0.0-alpha.12

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.12
  - @geekmidas/auth@10.0.0-alpha.12
  - @geekmidas/cache@10.0.0-alpha.12
  - @geekmidas/db@10.0.0-alpha.12
  - @geekmidas/emailkit@10.0.0-alpha.12
  - @geekmidas/envkit@10.0.0-alpha.12
  - @geekmidas/errors@10.0.0-alpha.12
  - @geekmidas/events@10.0.0-alpha.12
  - @geekmidas/logger@10.0.0-alpha.12
  - @geekmidas/manifest@10.0.0-alpha.12
  - @geekmidas/rate-limit@10.0.0-alpha.12
  - @geekmidas/schema@10.0.0-alpha.12
  - @geekmidas/services@10.0.0-alpha.12
  - @geekmidas/storage@10.0.0-alpha.12
  - @geekmidas/telescope@10.0.0-alpha.12

## 10.0.0-alpha.11

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.11
  - @geekmidas/auth@10.0.0-alpha.11
  - @geekmidas/cache@10.0.0-alpha.11
  - @geekmidas/db@10.0.0-alpha.11
  - @geekmidas/emailkit@10.0.0-alpha.11
  - @geekmidas/envkit@10.0.0-alpha.11
  - @geekmidas/errors@10.0.0-alpha.11
  - @geekmidas/events@10.0.0-alpha.11
  - @geekmidas/logger@10.0.0-alpha.11
  - @geekmidas/manifest@10.0.0-alpha.11
  - @geekmidas/rate-limit@10.0.0-alpha.11
  - @geekmidas/schema@10.0.0-alpha.11
  - @geekmidas/services@10.0.0-alpha.11
  - @geekmidas/storage@10.0.0-alpha.11
  - @geekmidas/telescope@10.0.0-alpha.11

## 10.0.0-alpha.10

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.10
  - @geekmidas/auth@10.0.0-alpha.10
  - @geekmidas/cache@10.0.0-alpha.10
  - @geekmidas/db@10.0.0-alpha.10
  - @geekmidas/emailkit@10.0.0-alpha.10
  - @geekmidas/envkit@10.0.0-alpha.10
  - @geekmidas/errors@10.0.0-alpha.10
  - @geekmidas/events@10.0.0-alpha.10
  - @geekmidas/logger@10.0.0-alpha.10
  - @geekmidas/manifest@10.0.0-alpha.10
  - @geekmidas/rate-limit@10.0.0-alpha.10
  - @geekmidas/schema@10.0.0-alpha.10
  - @geekmidas/services@10.0.0-alpha.10
  - @geekmidas/storage@10.0.0-alpha.10
  - @geekmidas/telescope@10.0.0-alpha.10

## 10.0.0-alpha.9

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.9
  - @geekmidas/auth@10.0.0-alpha.9
  - @geekmidas/cache@10.0.0-alpha.9
  - @geekmidas/db@10.0.0-alpha.9
  - @geekmidas/emailkit@10.0.0-alpha.9
  - @geekmidas/envkit@10.0.0-alpha.9
  - @geekmidas/errors@10.0.0-alpha.9
  - @geekmidas/events@10.0.0-alpha.9
  - @geekmidas/logger@10.0.0-alpha.9
  - @geekmidas/manifest@10.0.0-alpha.9
  - @geekmidas/rate-limit@10.0.0-alpha.9
  - @geekmidas/schema@10.0.0-alpha.9
  - @geekmidas/services@10.0.0-alpha.9
  - @geekmidas/storage@10.0.0-alpha.9
  - @geekmidas/telescope@10.0.0-alpha.9

## 10.0.0-alpha.8

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.8
  - @geekmidas/auth@10.0.0-alpha.8
  - @geekmidas/cache@10.0.0-alpha.8
  - @geekmidas/db@10.0.0-alpha.8
  - @geekmidas/emailkit@10.0.0-alpha.8
  - @geekmidas/envkit@10.0.0-alpha.8
  - @geekmidas/errors@10.0.0-alpha.8
  - @geekmidas/events@10.0.0-alpha.8
  - @geekmidas/logger@10.0.0-alpha.8
  - @geekmidas/manifest@10.0.0-alpha.8
  - @geekmidas/rate-limit@10.0.0-alpha.8
  - @geekmidas/schema@10.0.0-alpha.8
  - @geekmidas/services@10.0.0-alpha.8
  - @geekmidas/storage@10.0.0-alpha.8
  - @geekmidas/telescope@10.0.0-alpha.8

## 10.0.0-alpha.7

### Patch Changes

- [#39](https://github.com/geekmidas/toolbox/pull/39) [`960425f`](https://github.com/geekmidas/toolbox/commit/960425f73bc99ab0304c8ef2d22c7e98ca8313a4) Thanks [@geekmidas](https://github.com/geekmidas)! - A surface has no `app`, and `gkm init --template fullstack` builds

  `RestApi` and `BetterAuth` no longer take an `app` block, and the manifest's
  `rest-api` declaration loses it too. The one thing the block carried that the id
  does not — whether the surface streams into a Telescope — is `telescope: true`
  on the declaration itself.

  `RestApi`, `BetterAuth` and `StaticSite` take a required `path`: the app that
  serves them, relative to the workspace root (`'apps/api'`, or `'.'` in a
  single-app project). It was inferred from the id — `apps/<kebab-id>` if that
  directory existed, the root otherwise — so an app's home was whatever happened
  to be on disk. `BetterAuth`'s `basePath` is unchanged and still means the URL
  its routes are mounted at. `path` does not change discovery.

  Constructs, and the endpoints built from them, are loaded from the workspace's
  `constructs` glob. `gkm init` writes one that reaches every app laid out the
  way it was told — `'./apps/*/src/endpoints/**/*.ts'` for the default layout —
  rather than naming the API's directory. An endpoint belongs to the surface it
  was built from, not to the directory its file is in: each app's build now keeps only the endpoints
  built from the surface that app serves. Before this, every build in a workspace
  guessed the same surface and kept every endpoint the glob found — so an auth
  server's build would have served the API's routes.

  Every module's path aliases resolve through the tsconfig beside it. tsx applies
  the tsconfig of the directory a command ran from to the whole process, so a
  glob that reaches every app resolved `~/router.ts` in `apps/api` through
  `apps/web`'s `~` — silently, to the wrong file — when the command ran there.

  The fullstack scaffold did not build. What it gets now:

  - **The root `constructs/` folder's dependencies at the root**, where it
    resolves them: `@geekmidas/constructs` and the peers each declared construct
    needs. The root tsconfig allows the `.ts` imports they use.
  - **An API tsconfig that maps `@<name>/constructs/*`**. Only the `--monorepo`
    copy did; in the fullstack one it fell through to `packages/*/src`.
  - **An auth app built by `gkm`**, since its entry is generated from the
    `BetterAuth` construct — not `tsc` over a `src/` that no longer exists.
  - **Third-party ranges inside the packages' peer ranges**, kept in one place:
    Kysely 0.29, Hono 4.13, Better Auth 1.7 on the server and every client, pino
    10, Zod 4.6, kysely-ctl 0.21.
  - **A client the site can import**: `./client` points at the per-surface
    `.gkm/openapi/api.ts`, and the API depends on what that file imports.
  - 💄 **UI barrel imports that resolve** to `<name>/index.tsx`.
  - **A Next.js site that typechecks**: no project `references` to packages that
    are not `composite`, which made its `tsc --noEmit` fail with TS6306.
  - **A Biome config Biome 2 accepts**: `assist` and `files.includes` rather than
    the 1.x `organizeImports` and `files.ignore`, and Tailwind directives parsed.
  - ✅ **Tests that run**: the root Vitest config uses projects, so the API's own
    `globalSetup` runs; the API ships the `users` migration its endpoints and
    that setup expect; the example test asks for testkit's `trx` fixture, and
    hands testkit a connection function.
  - **No `NODE_ENV` among the development secrets.** `gkm exec` injects secrets
    over the environment, so every `gkm exec -- next build` was a development
    build, which Next refuses to prerender.

  `gkm build` in a workspace no longer runs an OpenAPI pass after every app has
  built: each surface's own build already writes its client before anything
  depending on it builds.

  `gkm init shop--monorepo` — a missing space — is refused with the command that
  was meant, instead of scoping every package and physical name under it.

  The release workflow syncs the scaffold's pinned versions after `changeset
version` bumps them, and rebuilds the CLI before publishing; `alpha.6`
  scaffolded `alpha.5`.

- Updated dependencies [[`960425f`](https://github.com/geekmidas/toolbox/commit/960425f73bc99ab0304c8ef2d22c7e98ca8313a4)]:
  - @geekmidas/manifest@10.0.0-alpha.7
  - @geekmidas/audit@10.0.0-alpha.7
  - @geekmidas/auth@10.0.0-alpha.7
  - @geekmidas/cache@10.0.0-alpha.7
  - @geekmidas/db@10.0.0-alpha.7
  - @geekmidas/emailkit@10.0.0-alpha.7
  - @geekmidas/envkit@10.0.0-alpha.7
  - @geekmidas/errors@10.0.0-alpha.7
  - @geekmidas/events@10.0.0-alpha.7
  - @geekmidas/logger@10.0.0-alpha.7
  - @geekmidas/rate-limit@10.0.0-alpha.7
  - @geekmidas/schema@10.0.0-alpha.7
  - @geekmidas/services@10.0.0-alpha.7
  - @geekmidas/storage@10.0.0-alpha.7
  - @geekmidas/telescope@10.0.0-alpha.7

## 10.0.0-alpha.6

### Major Changes

- [#37](https://github.com/geekmidas/toolbox/pull/37) [`0e99180`](https://github.com/geekmidas/toolbox/commit/0e991805d82c0affae5f12d6d7d31eddd82533fc) Thanks [@geekmidas](https://github.com/geekmidas)! - `c`, `s` and `f` are gone

  The free-standing builders produced a construct with no owner, and an unowned
  construct no longer builds: it has nothing to take a logger or an environment
  parser from, and nothing says which process runs it. Keeping them exported
  meant shipping an API whose only outcome was a build error.

  Everything runnable now comes from the process that runs it, and comes from it
  _directly_ — there is no `crons`, `subscribers` or `functions` namespace to
  reach through:

  ```ts
  export const worker = new Worker('Jobs', { logger }).database(database);

  export const cleanup = worker.cron('rate(1 day)').handle(…);
  export const onUserCreated = worker.topic(users).subscribe(['user.created']).handle(…);
  export const reindex = worker.input(schema).handle(…);
  ```

  The namespaces named a collection in order to reach one member of it, and only
  crons had sugar past them — `worker.cron(schedule)` existed while
  `worker.functions.input(…)` did not. Which kind is being built is decided by
  what is called first: a schedule makes a cron, a topic makes a subscriber, and
  anything else makes a function.

  A worker is not a container — it names which process runs a runnable and what
  logger it runs with — so declaring one costs nothing, and declaring several is
  several groupings rather than several deployments.

  Migration is mechanical: declare a `Worker`, then replace `c` with
  `worker.crons`, `s` with `worker.subscribers` and `f` with `worker.functions`.
  The `.logger(…)` call each of them used to need goes away, because the worker
  carries it.

### Minor Changes

- [#35](https://github.com/geekmidas/toolbox/pull/35) [`26fc832`](https://github.com/geekmidas/toolbox/commit/26fc832910fef9ed6adabfeb76cfb3712219f6e2) Thanks [@geekmidas](https://github.com/geekmidas)! - Crons run on a server target

  A cron used to run on AWS Lambda and nowhere else. `CronGenerator` returned an
  empty array for every other provider, and `.gkm/server/` held `endpoints.ts`,
  `queues.ts` and `subscribers.ts` but no crons — so a scheduled job on a server
  deploy built, deployed, and never fired.

  It now generates `crons.ts` exporting `setupCrons`, which the generated entry
  calls beside `setupSubscribers` and `setupQueues`. Same shape, same place: the
  process that serves the endpoints schedules the crons.

  **The schedule lives in Postgres**, in the database the worker names:

  ```ts
  export const jobs = new Worker("Jobs", { logger }).database(database);
  ```

  pg-boss holds it there, so a deployment running four replicas fires each job
  once — which is what a timer in every process gets wrong and never reports.

  Declared rather than discovered, and no connection string appears anywhere. The
  construct that owns the database is the only thing that knows its key; it is
  resolved through service discovery like any other dependency. Inferring the
  store from whatever database an app happened to declare would work until it
  declared a second, and then move the schedules without saying so.

  **A known limitation of workers.** A worker with crons and no `.database(…)`
  schedules nothing on a server target and reports why at startup. On AWS the
  question does not arise — a cron is an EventBridge rule. The store could as
  well be a cache or something the deploy target provisions; Postgres is what
  exists today.

  `toCronExpression` converts a `ScheduleExpression` to standard cron.
  `cron(…)` unwraps; `rate(n unit)` converts when it divides its unit evenly.
  When it does not — `rate(7 hours)`, whose `*/7` fires at 0, 7, 14, 21 and then
  restarts three hours later — it throws rather than rounding. A job at the wrong
  hour is harder to notice than one that refused to build.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.6
  - @geekmidas/auth@10.0.0-alpha.6
  - @geekmidas/cache@10.0.0-alpha.6
  - @geekmidas/db@10.0.0-alpha.6
  - @geekmidas/emailkit@10.0.0-alpha.6
  - @geekmidas/envkit@10.0.0-alpha.6
  - @geekmidas/errors@10.0.0-alpha.6
  - @geekmidas/events@10.0.0-alpha.6
  - @geekmidas/logger@10.0.0-alpha.6
  - @geekmidas/manifest@10.0.0-alpha.6
  - @geekmidas/rate-limit@10.0.0-alpha.6
  - @geekmidas/schema@10.0.0-alpha.6
  - @geekmidas/services@10.0.0-alpha.6
  - @geekmidas/storage@10.0.0-alpha.6
  - @geekmidas/telescope@10.0.0-alpha.6

## 10.0.0-alpha.5

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.5
  - @geekmidas/auth@10.0.0-alpha.5
  - @geekmidas/cache@10.0.0-alpha.5
  - @geekmidas/db@10.0.0-alpha.5
  - @geekmidas/emailkit@10.0.0-alpha.5
  - @geekmidas/envkit@10.0.0-alpha.5
  - @geekmidas/errors@10.0.0-alpha.5
  - @geekmidas/events@10.0.0-alpha.5
  - @geekmidas/logger@10.0.0-alpha.5
  - @geekmidas/manifest@10.0.0-alpha.5
  - @geekmidas/rate-limit@10.0.0-alpha.5
  - @geekmidas/schema@10.0.0-alpha.5
  - @geekmidas/services@10.0.0-alpha.5
  - @geekmidas/storage@10.0.0-alpha.5
  - @geekmidas/telescope@10.0.0-alpha.5

## 10.0.0-alpha.4

### Patch Changes

- Updated dependencies [[`dce9588`](https://github.com/geekmidas/toolbox/commit/dce958803067a24ec3c9ecbba2c76fd00d971904)]:
  - @geekmidas/telescope@10.0.0-alpha.4
  - @geekmidas/schema@10.0.0-alpha.4
  - @geekmidas/audit@10.0.0-alpha.4
  - @geekmidas/auth@10.0.0-alpha.4
  - @geekmidas/cache@10.0.0-alpha.4
  - @geekmidas/db@10.0.0-alpha.4
  - @geekmidas/emailkit@10.0.0-alpha.4
  - @geekmidas/envkit@10.0.0-alpha.4
  - @geekmidas/errors@10.0.0-alpha.4
  - @geekmidas/events@10.0.0-alpha.4
  - @geekmidas/logger@10.0.0-alpha.4
  - @geekmidas/manifest@10.0.0-alpha.4
  - @geekmidas/rate-limit@10.0.0-alpha.4
  - @geekmidas/services@10.0.0-alpha.4
  - @geekmidas/storage@10.0.0-alpha.4

## 10.0.0-alpha.3

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.3
  - @geekmidas/auth@10.0.0-alpha.3
  - @geekmidas/cache@10.0.0-alpha.3
  - @geekmidas/db@10.0.0-alpha.3
  - @geekmidas/emailkit@10.0.0-alpha.3
  - @geekmidas/envkit@10.0.0-alpha.3
  - @geekmidas/errors@10.0.0-alpha.3
  - @geekmidas/events@10.0.0-alpha.3
  - @geekmidas/logger@10.0.0-alpha.3
  - @geekmidas/manifest@10.0.0-alpha.3
  - @geekmidas/rate-limit@10.0.0-alpha.3
  - @geekmidas/schema@10.0.0-alpha.3
  - @geekmidas/services@10.0.0-alpha.3
  - @geekmidas/storage@10.0.0-alpha.3
  - @geekmidas/telescope@10.0.0-alpha.3

## 10.0.0-alpha.2

### Patch Changes

- [#29](https://github.com/geekmidas/toolbox/pull/29) [`3426eae`](https://github.com/geekmidas/toolbox/commit/3426eaec72e0837a33dae873d7fe36282445158b) Thanks [@geekmidas](https://github.com/geekmidas)! - The published package could not be installed

  `10.0.0-alpha.1` crashed on `gkm init`. Three packaging faults, each of which
  made `@geekmidas/constructs` unloadable for anyone who was not inside this
  repository — where pnpm's workspace links hid all of them.

  **Statically imported packages were declared optional peers.** `queue/Queue.ts`
  imports `Publisher` from `@geekmidas/events` as a value, and `envkit`,
  `errors`, `logger`, `manifest`, `schema` and `services` are imported by entries
  that always load. All were `peerDependenciesMeta.optional`, so a consumer's
  install fetched none of them. Installing the tarball on its own produced a
  package where _no entry point loaded at all_ — `gkm init` only reached
  `@geekmidas/events` because the CLI happened to depend on the rest directly.
  They are dependencies now, which is what a static import means.

  **`@geekmidas/telescope` was a required peer of a type-only import.**
  `rest-api.ts` does `import type { Telescope }`, which has no runtime, yet the
  peer was non-optional and exactly pinned — so every install warned it was
  missing and pnpm reported `Conflicting peer dependencies` against the CLI's own
  range. Marked optional.

  **Declaring a cron required AWS Lambda middleware.** `crons/index.ts`
  re-exported `AWSScheduledFunction`, so importing the barrel to declare a cron
  pulled in `@middy/core`. The adaptor was already exported from
  `@geekmidas/constructs/aws`, the entry that admits it needs Lambda; the
  redundant re-export is gone and `CronGenerator` emits the `/aws` specifier.

  Verified by packing the tarballs, installing them into an empty project the way
  a consumer does, and running `gkm init --monorepo` to completion.

- Updated dependencies [[`96ec6a7`](https://github.com/geekmidas/toolbox/commit/96ec6a73efbfaaf5f17f378ac3647d3c970297a9), [`05ce914`](https://github.com/geekmidas/toolbox/commit/05ce91446ba29d5158a2a5c010f7bf9c00f761eb)]:
  - @geekmidas/telescope@10.0.0-alpha.2
  - @geekmidas/logger@10.0.0-alpha.2
  - @geekmidas/audit@10.0.0-alpha.2
  - @geekmidas/auth@10.0.0-alpha.2
  - @geekmidas/cache@10.0.0-alpha.2
  - @geekmidas/db@10.0.0-alpha.2
  - @geekmidas/emailkit@10.0.0-alpha.2
  - @geekmidas/envkit@10.0.0-alpha.2
  - @geekmidas/errors@10.0.0-alpha.2
  - @geekmidas/events@10.0.0-alpha.2
  - @geekmidas/manifest@10.0.0-alpha.2
  - @geekmidas/rate-limit@10.0.0-alpha.2
  - @geekmidas/schema@10.0.0-alpha.2
  - @geekmidas/services@10.0.0-alpha.2
  - @geekmidas/storage@10.0.0-alpha.2

## 10.0.0-alpha.1

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.1
  - @geekmidas/auth@10.0.0-alpha.1
  - @geekmidas/cache@10.0.0-alpha.1
  - @geekmidas/db@10.0.0-alpha.1
  - @geekmidas/emailkit@10.0.0-alpha.1
  - @geekmidas/envkit@10.0.0-alpha.1
  - @geekmidas/errors@10.0.0-alpha.1
  - @geekmidas/events@10.0.0-alpha.1
  - @geekmidas/logger@10.0.0-alpha.1
  - @geekmidas/manifest@10.0.0-alpha.1
  - @geekmidas/rate-limit@10.0.0-alpha.1
  - @geekmidas/schema@10.0.0-alpha.1
  - @geekmidas/services@10.0.0-alpha.1
  - @geekmidas/storage@10.0.0-alpha.1
  - @geekmidas/telescope@10.0.0-alpha.1

## 10.0.0-alpha.0

### Major Changes

- [#23](https://github.com/geekmidas/toolbox/pull/23) [`25f346f`](https://github.com/geekmidas/toolbox/commit/25f346fb240b2a51996f6f67bbbe39baff32569d) Thanks [@geekmidas](https://github.com/geekmidas)! - v10: the manifest is the single source of truth

  `gkm.config.ts` used to restate what the constructs already declared — the
  apps, their paths, their routes, the containers they wanted, the origins they
  trusted. Every one of those was a second place to be wrong. In v10 the config
  carries a name, where to find the constructs, the services and the deploy
  target; everything else is read from the manifest.

  **The surface is the factory.** `e` is gone. An endpoint is built from the
  surface that will serve it — `api.post('/users').handle(...)` — so the logger,
  the env parser and the authorizers come from the `RestApi` rather than being
  threaded in per endpoint. `Endpoint` carries the surface it belongs to, and
  that is how the build knows which process an endpoint runs in.

  **Apps come from the manifest.** `apps` is no longer a config block. A
  declaration carries an `AppSpec` (`path`, and a `code` glob when the surface is
  built from files), and the CLI derives the workspace from that. A `RestApi`
  that declares its own routes — an auth server mounting a wildcard, where no
  glob has anything to find — now has its entry generated from the declaration
  itself.

  **Every surface gets its own deployment.** An api, an auth server and a studio
  are three containers, not one with three route prefixes. Sharing is something a
  declaration asks for, never a default. Which site holds the base domain is
  declared, and a construct is named by the same rule on every provider.

  **Derived rather than configured:** CORS origins from the auth construct's
  trusted origins, Studio from the declared database, containers from what the
  manifest says exists. Telescope's tables moved into a schema and dropped their
  prefix.

  **Fixed in the same release:** all four auth middlewares found a cookie by
  searching the `Cookie` header for `name=`, so `evil_auth_token=…;
auth_token=…` yielded the attacker's value; `@geekmidas/client` and
  `@geekmidas/ui` published exports that resolved to nothing; the MinIO image
  moved off Docker Hub and an unpinned `latest` took the dev stack with it.

  Upgrading is not mechanical. The config shrinks, `e` disappears, and anything
  that assumed one container per workspace now gets one per surface.

### Patch Changes

- Updated dependencies [[`25f346f`](https://github.com/geekmidas/toolbox/commit/25f346fb240b2a51996f6f67bbbe39baff32569d)]:
  - @geekmidas/audit@10.0.0-alpha.0
  - @geekmidas/auth@10.0.0-alpha.0
  - @geekmidas/cache@10.0.0-alpha.0
  - @geekmidas/db@10.0.0-alpha.0
  - @geekmidas/emailkit@10.0.0-alpha.0
  - @geekmidas/envkit@10.0.0-alpha.0
  - @geekmidas/errors@10.0.0-alpha.0
  - @geekmidas/events@10.0.0-alpha.0
  - @geekmidas/logger@10.0.0-alpha.0
  - @geekmidas/manifest@10.0.0-alpha.0
  - @geekmidas/rate-limit@10.0.0-alpha.0
  - @geekmidas/schema@10.0.0-alpha.0
  - @geekmidas/services@10.0.0-alpha.0
  - @geekmidas/storage@10.0.0-alpha.0
  - @geekmidas/telescope@10.0.0-alpha.0

## 9.0.2

### Patch Changes

- [#12](https://github.com/geekmidas/toolbox/pull/12) [`d53863a`](https://github.com/geekmidas/toolbox/commit/d53863a84db2e4ab5420e08f79128b637043fc42) Thanks [@geekmidas](https://github.com/geekmidas)! - Align every published package on a single version and keep them in step.

  All packages now share one version, enforced by a changesets `fixed` group. The
  baseline is 9.0.1 — @geekmidas/client's published version — so nothing moves
  backwards; this release takes the whole set to 9.0.2 together.

  Independent versions made "which version of the docs applies to me"
  unanswerable: a reader on constructs@7 and cli@2 was on no version at all. One
  number per release makes versioned documentation possible, and lets 9 freeze as
  the current paradigm while the constructs rework is developed against it.

  Every release now publishes every package, and a major anywhere is a major
  everywhere. Peer ranges get simpler in return.

- Updated dependencies [[`d53863a`](https://github.com/geekmidas/toolbox/commit/d53863a84db2e4ab5420e08f79128b637043fc42)]:
  - @geekmidas/audit@9.0.2
  - @geekmidas/cache@9.0.2
  - @geekmidas/db@9.0.2
  - @geekmidas/envkit@9.0.2
  - @geekmidas/errors@9.0.2
  - @geekmidas/events@9.0.2
  - @geekmidas/logger@9.0.2
  - @geekmidas/rate-limit@9.0.2
  - @geekmidas/schema@9.0.2
  - @geekmidas/services@9.0.2

## 7.0.1

### Patch Changes

- 🐛 [#11](https://github.com/geekmidas/toolbox/pull/11) [`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309) Thanks [@geekmidas](https://github.com/geekmidas)! - Patch release across all packages to realign published versions with the
  registry. The previous release only published the four packages that had
  version bumps; the remaining packages failed with "cannot publish over the
  previously published versions" because their versions were unchanged.
- Updated dependencies [[`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309)]:
  - @geekmidas/audit@2.2.1
  - @geekmidas/cache@1.1.2
  - @geekmidas/db@1.1.1
  - @geekmidas/envkit@1.1.1
  - @geekmidas/errors@1.0.2
  - @geekmidas/events@1.1.6
  - @geekmidas/logger@1.0.3
  - @geekmidas/rate-limit@4.0.1
  - @geekmidas/schema@1.0.4
  - @geekmidas/services@2.0.1

## 7.0.0

### Patch Changes

- Updated dependencies [[`ae678fe`](https://github.com/geekmidas/toolbox/commit/ae678fe6fbc89307d052335468f1b955b306a604)]:
  - @geekmidas/audit@2.2.0

## 6.0.0

### Patch Changes

- Updated dependencies [[`e31a60a`](https://github.com/geekmidas/toolbox/commit/e31a60a971366180a0e7bec6e7da56d8f36aa21f)]:
  - @geekmidas/db@1.1.0
  - @geekmidas/audit@2.1.0

## 5.0.0

### Minor Changes

- [#8](https://github.com/geekmidas/toolbox/pull/8) [`b004fd8`](https://github.com/geekmidas/toolbox/commit/b004fd8ee74b5f20a047260b16669d16d8fc03b4) Thanks [@geekmidas](https://github.com/geekmidas)! - feat: queue workers (`q`) — producer, runtime adaptors, and `gkm` discovery

  Adds end-to-end support for point-to-point queues, alongside subscribers (`s`):

  **`@geekmidas/constructs/queue`** — the `q` builder:

  ```ts
  import { q } from '@geekmidas/constructs/queue';

  export const orders = q
    .queue('orders')
    .services([db])              // array; sniffed for required env vars
    .message(z.object({ orderId: z.string() }))
    .handle(async ({ messages, services }) => { … }); // the single consumer
  ```

  Unlike `s` (topic fan-out, filtered by `subscribedEvents`), a queue drains
  _every_ message of its one typed `message`.

  - **Producer side** — `orders.publisher`, a ready-to-inject `Service` typed to
    the queue's message. Drop it into any `.services([...])` and call
    `services.ordersPublisher.publish([{ type: 'orders', payload }])`. It reads
    `<NAME>_PUBLISHER_CONNECTION_STRING` and picks its transport from the URL
    protocol — `pgboss://` locally, `sqs://` deployed — so the same code targets
    Postgres in dev and SQS in prod. The env requirement is sniffed into the
    manifest, so infra links exactly that queue with least privilege.
  - **Runtime adaptors** — `AWSLambdaQueue` (`@geekmidas/constructs/aws`, SQS
    event-source with partial-batch failures) and `TestQueueAdaptor`
    (`@geekmidas/constructs/testing`).

  **`@geekmidas/cli`** — `gkm build`/`gkm dev` discover `q` definitions:

  - ✨ New `queues: './src/queues/**/*.ts'` config glob.
  - Server / `gkm dev`: an in-process pg-boss poller (`setupQueues()`) runs
    alongside the Hono server — each queue subscribes by its name on the shared
    `EVENT_SUBSCRIBER_CONNECTION_STRING`. Queues are background workers, not HTTP
    routes.
  - AWS: one `AWSLambdaQueue` handler per queue.
  - Queues are recorded in the manifest's `queues` field (`QueueInfo`).

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`0dad77e`](https://github.com/geekmidas/toolbox/commit/0dad77e574000e4018033b956ed4bb95935911a5) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(topic): add the `t` topic construct + derived publisher (closes the topic/queue asymmetry)

  Topics now have the same app-driven story queues already had — declare the topic
  in the app, get a typed publisher for free, and let `gkm build` capture it. This
  removes the need to hand-write a publisher `Service` (e.g. `EventsService`) to
  fan events out.

  **`@geekmidas/constructs/topic`** — the `t` builder:

  ```ts
  import { t } from "@geekmidas/constructs/topic";

  export const userTopic = t.topic("users").events({
    "user.created": z.object({ userId: z.string(), email: z.string() }),
    "user.updated": z.object({
      userId: z.string(),
      changes: z.array(z.string()),
    }),
  });
  ```

  - A `Topic` is a _resource_ construct (`ConstructType.Topic`) — fan-out, owned by
    no single handler. It declares the event contract and derives a publisher.
  - **`userTopic.publisher`** — a derived `Service` typed to the union of the topic's
    events, reading `<NAME>_PUBLISHER_CONNECTION_STRING` (transport by protocol:
    `sns://` deployed, `pgboss://` local). Replaces hand-written publisher services.
    Inject via `.publisher(userTopic.publisher)` (declarative `.event(...)`) or
    `.services([userTopic.publisher])`.
  - **`s.topic(userTopic)`** — binds a subscriber to a topic: supplies the
    subscribable event types/payloads _and_ records the binding for the manifest.
    A consumer doesn't publish, so this requires **no** publisher connection string
    (least privilege) — unlike typing via `.publisher(...)`.

  **`@geekmidas/manifest`** — new `TopicInfo` + `manifest.topics`; `SubscriberInfo`
  gains `topic` (the bound topic name).

  **`@geekmidas/cli`** — `TopicGenerator` discovers `t` topics into `manifest.topics`
  (a topic has no handler to generate); new `topics` config glob; wired through
  `gkm build`/`gkm dev` and both manifest writers.

  Hand-written publisher services still work; `t` is the encouraged path.

### Patch Changes

- Updated dependencies [[`7323f34`](https://github.com/geekmidas/toolbox/commit/7323f34176d63170dd53450889ac0b5959420c3c), [`79e2929`](https://github.com/geekmidas/toolbox/commit/79e292978d3dbc8927e25814bdb051d1c380600a), [`03b08fe`](https://github.com/geekmidas/toolbox/commit/03b08feba2e735539c43f95b77792c18a627b07d)]:
  - @geekmidas/envkit@1.1.0
  - @geekmidas/events@1.1.5
  - @geekmidas/services@2.0.0
  - @geekmidas/rate-limit@4.0.0

## 4.0.1

### Patch Changes

- [#7](https://github.com/geekmidas/toolbox/pull/7) [`e0d06b3`](https://github.com/geekmidas/toolbox/commit/e0d06b38dfd275758f7955f5754900ab78779302) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(constructs): allow endpoint handlers to return the output schema's input type

  Endpoint handlers previously had to return the output schema's _parsed_ type
  (`InferStandardSchema`). When an output schema coerces its value (e.g. a `Date`
  serialized to an ISO `string`, or an applied default), that forced handlers to
  pre-coerce values themselves even though the schema would do it on the way out.

  A new `InferStandardSchemaInput` type is added to `@geekmidas/schema`, exposing a
  Standard Schema's _input_ type (`StandardSchemaV1.InferInput`). `Endpoint`'s
  handler return type now uses it, so handlers may return the looser pre-coercion
  input while consumers (`EndpointOutput` and the generated client) still see the
  narrower parsed output type.

- Updated dependencies [[`e0d06b3`](https://github.com/geekmidas/toolbox/commit/e0d06b38dfd275758f7955f5754900ab78779302)]:
  - @geekmidas/schema@1.0.3

## 4.0.0

### Minor Changes

- [#5](https://github.com/geekmidas/toolbox/pull/5) [`811d740`](https://github.com/geekmidas/toolbox/commit/811d740ae3875d59ad1b0dc50261266963c8cb76) Thanks [@geekmidas](https://github.com/geekmidas)! - Move the tRPC and Middy service integrations from `@geekmidas/constructs` to `@geekmidas/services`, where they belong — they depend only on `@geekmidas/services`, not on any construct.

  - ✨ **`@geekmidas/constructs`:** the `@geekmidas/constructs/trpc` and `@geekmidas/constructs/middy` entry points are removed (they were only just added). Import from `@geekmidas/services/trpc` and `@geekmidas/services/middy` instead. (`@trpc/server` is no longer a peer dependency of `@geekmidas/constructs`.)
  - ✨ **`@geekmidas/services`:** adds `/trpc` (`createServicesMiddleware`, `createRequestContextMiddleware`) and `/middy` (`requestContext`, `addServices`, `withServices`, `EventServices`) exports.

  The Middy middlewares were also tightened:

  - `requestContext` / `withServices` now require an explicit `logger` (no `ConsoleLogger` default) and are generic over `TLogger extends Logger`, so a custom logger type is preserved.
  - `addServices` / `withServices` now require an `envParser` (no implicit `process.env` default).
  - 🐛 Resolved services are attached to `event.services` (matching the `Function`/`Cron` constructs).

### Patch Changes

- Updated dependencies [[`811d740`](https://github.com/geekmidas/toolbox/commit/811d740ae3875d59ad1b0dc50261266963c8cb76)]:
  - @geekmidas/services@1.1.0
  - @geekmidas/rate-limit@3.0.0

## 3.1.0

### Minor Changes

- ✨ [#4](https://github.com/geekmidas/toolbox/pull/4) [`07093f5`](https://github.com/geekmidas/toolbox/commit/07093f5f911bf1ee48e53275da3cce398cc78ff6) Thanks [@geekmidas](https://github.com/geekmidas)! - Add `@geekmidas/constructs/middy` — Middy middlewares that bring request context and service discovery to standalone Lambda handlers:

  - `requestContext(options?)` establishes a request context so `serviceContext.getLogger()` / `getRequestId()` / `getRequestStartTime()` work inside the handler and any service it calls.
  - 🐛 `addServices([...], options?)` resolves services via `ServiceDiscovery` and attaches the typed record to `event.services` (pair with `requestContext`, or use `withServices`, if your services read `serviceContext`).
  - `withServices([...], options?)` bundles both in a single `.use(...)`.

  Also exports an `EventServices<T>` helper type for typing the handler's event.

### Patch Changes

- ✨ [#4](https://github.com/geekmidas/toolbox/pull/4) [`a20be2f`](https://github.com/geekmidas/toolbox/commit/a20be2faa4795600358904b751fa947d3cbb4c45) Thanks [@geekmidas](https://github.com/geekmidas)! - Add and export `AWSScheduledFunction` from `@geekmidas/constructs/crons` (and `/aws`). The CLI's cron handler generator already imported this adaptor, but it was never implemented, so generated cron handlers failed to load. `AWSScheduledFunction` wraps a `Cron` (which extends `Function`) and reuses the Lambda function execution pipeline, including the `runWithRequestContext` wrapper that powers request-scoped logging.

## 3.0.14

### Patch Changes

- 🐛 [#3](https://github.com/geekmidas/toolbox/pull/3) [`42fda53`](https://github.com/geekmidas/toolbox/commit/42fda532bdf4489a3352f6a684f5f30beafccedd) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix stale logger from service initialization

- Updated dependencies [[`42fda53`](https://github.com/geekmidas/toolbox/commit/42fda532bdf4489a3352f6a684f5f30beafccedd)]:
  - @geekmidas/services@1.0.4

## 3.0.13

### Patch Changes

- ✨ [`351f73b`](https://github.com/geekmidas/toolbox/commit/351f73b032bc0742b7f611a9fbcdfc85bbfd69a8) Thanks [@geekmidas](https://github.com/geekmidas)! - Update request context and add support for trpc

- Updated dependencies [[`351f73b`](https://github.com/geekmidas/toolbox/commit/351f73b032bc0742b7f611a9fbcdfc85bbfd69a8)]:
  - @geekmidas/services@1.0.3

## 3.0.12

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

- Updated dependencies [[`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651)]:
  - @geekmidas/audit@2.0.1
  - @geekmidas/cache@1.1.1
  - @geekmidas/db@1.0.2
  - @geekmidas/envkit@1.0.7
  - @geekmidas/errors@1.0.1
  - @geekmidas/events@1.1.3
  - @geekmidas/logger@1.0.2
  - @geekmidas/rate-limit@2.0.1
  - @geekmidas/schema@1.0.2
  - @geekmidas/services@1.0.2

## 3.0.11

### Patch Changes

- [`fb1e721`](https://github.com/geekmidas/toolbox/commit/fb1e721ec38c1b328d41466564c6fa1c9305e80b) Thanks [@geekmidas](https://github.com/geekmidas)! - Return 403 Forbidden instead of 401 Unauthorized when an endpoint's `.authorize()` returns false. Authorization runs after `getSession()`, so by the time it rejects, the caller is already identified — 403 is the correct semantic. Callers that want 401 for missing authentication should throw `UnauthorizedError` from `getSession()` (or `.authorize()`) directly.

## 3.0.10

### Patch Changes

- 🐛 [`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix schema, openapi generation and events testkit

- Updated dependencies [[`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553)]:
  - @geekmidas/events@1.1.2
  - @geekmidas/schema@1.0.1

## 3.0.9

### Patch Changes

- ✨ [`363c67f`](https://github.com/geekmidas/toolbox/commit/363c67fb3c3406bac6823326ab80ba55bff29e31) Thanks [@geekmidas](https://github.com/geekmidas)! - Add dynamic return types

## 3.0.8

### Patch Changes

- ✨ [`0830c6e`](https://github.com/geekmidas/toolbox/commit/0830c6e0d60842526788e0e1f0e78827514ea7b3) Thanks [@geekmidas](https://github.com/geekmidas)! - Add optional sniff support

- Updated dependencies [[`0830c6e`](https://github.com/geekmidas/toolbox/commit/0830c6e0d60842526788e0e1f0e78827514ea7b3)]:
  - @geekmidas/logger@1.0.1

## 3.0.7

### Patch Changes

- ✨ [`79e17a8`](https://github.com/geekmidas/toolbox/commit/79e17a84e630f102023005994d9d45b37f7d9d8f) Thanks [@geekmidas](https://github.com/geekmidas)! - Add msw support for construct testing for ui

## 3.0.6

### Patch Changes

- ✨ [`3941ae6`](https://github.com/geekmidas/toolbox/commit/3941ae6c9027fddb32999b9f98af813a12867877) Thanks [@geekmidas](https://github.com/geekmidas)! - Add db to authorizer

## 3.0.5

### Patch Changes

- [`fba83f3`](https://github.com/geekmidas/toolbox/commit/fba83f3ceee1d058874e62b31e38a9da205a6742) Thanks [@geekmidas](https://github.com/geekmidas)! - Release constructs

## 3.0.4

### Patch Changes

- ✨ [`f005956`](https://github.com/geekmidas/toolbox/commit/f005956573aac6bcdfcc95d2a31c17cf5b9688d4) Thanks [@geekmidas](https://github.com/geekmidas)! - Add params to authorize and decode content type on routes

## 3.0.3

### Patch Changes

- [`a39b41f`](https://github.com/geekmidas/toolbox/commit/a39b41fae9c6cfbde8e6d78bf5a11fbb9e59f67d) Thanks [@geekmidas](https://github.com/geekmidas)! - Use qs to process query params instead of custom solution

## 3.0.2

### Patch Changes

- 🐛 [`317e53e`](https://github.com/geekmidas/toolbox/commit/317e53e91c07bbc23dad3ae81faf573be91cb992) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix v2 cookie loading

## 3.0.1

### Patch Changes

- ✨ [`bfc5a4f`](https://github.com/geekmidas/toolbox/commit/bfc5a4f656445bb389b0532e9d3385d2e66a28fe) Thanks [@geekmidas](https://github.com/geekmidas)! - Add function context and suport for partitions

## 3.0.0

### Patch Changes

- Updated dependencies [[`be4f7a9`](https://github.com/geekmidas/toolbox/commit/be4f7a9bd5de7f08adbca582916d6902e0c24de2)]:
  - @geekmidas/cache@1.1.0
  - @geekmidas/audit@2.0.0
  - @geekmidas/rate-limit@2.0.0

## 2.0.0

### Patch Changes

- ✨ [`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661) Thanks [@geekmidas](https://github.com/geekmidas)! - Add pg-boss event publisher/subscriber, CLI setup and upgrade commands, and secrets sync via AWS SSM

  - ✨ **@geekmidas/events**: Add pg-boss backend for event publishing and subscribing with connection string support
  - ✨ **@geekmidas/cli**: Add `gkm setup` command for dev environment initialization, `gkm upgrade` command with workspace detection, and secrets push/pull via AWS SSM Parameter Store
  - 🐛 **@geekmidas/testkit**: Fix database creation race condition in PostgresMigrator
  - ✨ **@geekmidas/constructs**: Add integration tests for pg-boss with HonoEndpoint

- Updated dependencies [[`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661)]:
  - @geekmidas/events@1.1.0

## 1.1.1

### Patch Changes

- 🔥 [`9ac81f2`](https://github.com/geekmidas/toolbox/commit/9ac81f25fbf3676e39580c916dc0085358af99cb) Thanks [@geekmidas](https://github.com/geekmidas)! - Remove subscriber adaptor from root exports

## 1.1.0

### Minor Changes

- ⚡️ [`73511d9`](https://github.com/geekmidas/toolbox/commit/73511d912062eb0776935168c9f72d42c7c854a6) Thanks [@geekmidas](https://github.com/geekmidas)! - Improve dev script experience and export function tester

## 1.0.5

### Patch Changes

- ⬆️ [`53c39a0`](https://github.com/geekmidas/toolbox/commit/53c39a0ed9244be6ca2ff6ec8e39138a0fc88692) Thanks [@geekmidas](https://github.com/geekmidas)! - Update RLS types

## 1.0.4

### Patch Changes

- 🐛 [`05a6302`](https://github.com/geekmidas/toolbox/commit/05a6302a37ef2285aaf07ee46eeb9135ed658a68) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix lambda function generator to use correct adaptor import

## 1.0.3

### Patch Changes

- 🐛 [`8bdda11`](https://github.com/geekmidas/toolbox/commit/8bdda11f5c0f7c2eaea605befb0eca38ecc56e44) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix iam resolution for authorizers and fixed exported types for envkit

- Updated dependencies [[`8bdda11`](https://github.com/geekmidas/toolbox/commit/8bdda11f5c0f7c2eaea605befb0eca38ecc56e44)]:
  - @geekmidas/envkit@1.0.1

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release

### Patch Changes

- Updated dependencies [[`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8)]:
  - @geekmidas/audit@1.0.0
  - @geekmidas/cache@1.0.0
  - @geekmidas/db@1.0.0
  - @geekmidas/envkit@1.0.0
  - @geekmidas/errors@1.0.0
  - @geekmidas/events@1.0.0
  - @geekmidas/logger@1.0.0
  - @geekmidas/rate-limit@1.0.0
  - @geekmidas/schema@1.0.0
  - @geekmidas/services@1.0.0
