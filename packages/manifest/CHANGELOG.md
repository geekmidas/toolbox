# @geekmidas/manifest

## 10.0.0-alpha.95

## 10.0.0-alpha.94

## 10.0.0-alpha.93

## 10.0.0-alpha.92

## 10.0.0-alpha.91

## 10.0.0-alpha.90

## 10.0.0-alpha.89

## 10.0.0-alpha.88

## 10.0.0-alpha.87

## 10.0.0-alpha.86

## 10.0.0-alpha.85

### Minor Changes

- 🐛 [#214](https://github.com/geekmidas/toolbox/pull/214) [`46f3d3d`](https://github.com/geekmidas/toolbox/commit/46f3d3d57682cae53ce315598fb9eeb6c3df8f2a) Thanks [@geekmidas](https://github.com/geekmidas)! - :bug: An API's session check joins the request's trace, and queries carry their `traceparent`

  - ✨ **`@geekmidas/constructs`: the auth client's `getSession` is part of the caller's trace.** It writes the active trace context through the global propagator (unless a `fetch` instrumentation is listening, which writes the request's own CLIENT span — two `traceparent` headers would be read as none), and sends the client's address as **`x-gkm-client-ip`** instead of `x-forwarded-for`. A forwarding header made the auth server treat the call as outside traffic and start a new, linked trace; without one the call passes the internal-caller rule and the auth server's `get-session` span is the child of the API's call. **Visible change:** the auth server no longer receives `x-forwarded-for` from an API's session check.
  - ✨ **`@geekmidas/constructs`: `BetterAuth` reads `x-gkm-client-ip` first** — `advanced.ipAddress.ipAddressHeaders` is `['x-gkm-client-ip', ...]` followed by the app's own list, or `x-forwarded-for` — so `/get-session` is still rate-limited per client. Its server drops the header from any request that is not an internal caller's (no `Origin`, no forwarding header, a loopback or private peer), so it cannot be spoofed where no gkm edge stands in front. New export `withTrustedClientIp`.
  - **`@geekmidas/constructs`: query tags carry `traceparent`.** Inside a trace, each query's sqlcommenter tag ends in `traceparent='00-<trace id>-<span id>-<flags>'` — the query's own span — so `pg_stat_activity`, slow-query and `auto_explain` logs join to traces. Without an active span the tag is unchanged.
  - **`@geekmidas/cli`: every edge strips `x-gkm-client-ip`** — `request_header -x-gkm-client-ip` in each compose Caddy site block and each `gkm dev` edge site, and a `<project>-strip-gkm-headers` middleware first in every router of the shared Traefik edge.
  - **`@geekmidas/manifest`: `CLIENT_IP_HEADER`**, the reserved header's name, shared by the constructs and the edges.
  - **`@geekmidas/client`: the trace headers are left to a `fetch` instrumentation** when one is listening in the process (a server with OpenTelemetry's undici instrumentation), instead of being written twice.
  - **`@geekmidas/cli`: a local deploy lock is taken atomically with its holder written** (written to a temporary file, then linked into place), so a runner that loses a race is always told who holds the lock instead of `null`.

## 10.0.0-alpha.84

### Minor Changes

- ✨ [#212](https://github.com/geekmidas/toolbox/pull/212) [`cbfe22e`](https://github.com/geekmidas/toolbox/commit/cbfe22e6cfa354c649a583ac6cc16ef8c524aeba) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: **Telemetry is a construct.** `new Telemetry('Telemetry', { ignorePaths?, attributes? })`
  from `@geekmidas/constructs/telemetry` declares what an application emits —
  never where it goes. `RestApi`, `BetterAuth`, `Worker` and `StaticSite` take it
  in their config like `logger`, which records an edge to the node in the
  manifest (`telemetry: '<id>'`, read by `dependenciesOf`). An endpoint's
  `.telemetry({ ignore, attributes })` records no span for that route, or sets
  attributes on its request span. The Lambda adaptors' `Telemetry` hook
  interface is still exported from the package root.

  `@geekmidas/manifest` adds the `telemetry` kind and `TELEMETRY_KEYS` — the
  `OTEL_*` keys the node provides — with `PUBLIC.telemetry` empty, so none of
  them can reach a site's public values. `@geekmidas/cloud` provisions nothing
  for the node.

  **`deploy.telemetry` picks the provider and the sample rate, per stage**:
  `'self-hosted'`, `{ provider: 'self-hosted', port?, retentionDays?, public?, sampleRate? }`,
  `{ provider: 'otlp', endpoint, headers?, sampleRate? }`, or `false`. Each
  process with an edge — and no other — is handed `OTEL_EXPORTER_OTLP_ENDPOINT`,
  `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` (the app's name) and
  `OTEL_TRACES_SAMPLER=parentbased_traceidratio` with `OTEL_TRACES_SAMPLER_ARG`
  from the stage's rate (1 by default). `gkm compose` runs the self-hosted
  OpenObserve for a stage that names nothing; Dokploy and AWS have no collector,
  so a deployed stage there that uses telemetry names `otlp` or `false`, or the
  deploy fails at validate with `TelemetryProviderRequired`
  (`SelfHostedTelemetryUnavailable` for `'self-hosted'`).

  **The build follows the edge.** A process with the edge needs
  `@geekmidas/telescope` and its OpenTelemetry packages: without them
  `gkm build` and `gkm dev` fail with `TelemetryPackagesMissing`, naming the app
  and the `pnpm --dir <app> add …` to run. A process without the edge gets a stub
  that loads nothing, even with an endpoint set.

  **Local telemetry with no setup.** `gkm dev` adds OpenObserve to the dev
  services whenever a process uses the node, prints its URL and login, lists it
  on the discovery endpoint (without the password), and sends every trace there.
  Its server entry now starts the same SDK and request middleware as the
  production entry, from the same generated `telemetry.ts`. `gkm compose` on the
  local stage runs the same OpenObserve on loopback (`GKM_COMPOSE_LOGS_PORT`
  moves it); `gkm test` exports nothing. The local stage ignores
  `deploy.telemetry`.

  :boom: **Removed: `deploy.compose.logs`, the `OTEL_*` pass-through and
  `LogsEndpointConflict`.** A stage's own `OTEL_*` secrets are no longer
  forwarded to every backend, and `deploy.compose` now refuses `logs`. Move to a
  `Telemetry` construct given to each surface and worker, plus
  `deploy: { telemetry: { <stage>: 'self-hosted' } }` — `port`, `retentionDays`
  and `public` move under the provider — or `{ provider: 'otlp', endpoint, headers }`
  for a hosted backend. See the upgrade guide.

## 10.0.0-alpha.83

## 10.0.0-alpha.82

## 10.0.0-alpha.81

## 10.0.0-alpha.80

## 10.0.0-alpha.79

## 10.0.0-alpha.78

## 10.0.0-alpha.77

## 10.0.0-alpha.76

## 10.0.0-alpha.75

## 10.0.0-alpha.74

## 10.0.0-alpha.73

### Patch Changes

- [#196](https://github.com/geekmidas/toolbox/pull/196) [`5db7b84`](https://github.com/geekmidas/toolbox/commit/5db7b84aba6455989163abcd2c203b6dc28b7cb3) Thanks [@geekmidas](https://github.com/geekmidas)! - A Worker is its own deploy unit on a server target

  `gkm build --provider server --production` now writes an entry for each `Worker` that has crons, queue consumers or topic subscribers, in the app whose directory holds that work, and bundles it to `.gkm/server/dist/worker-<worker>.mjs`. It registers the drivers its target needs, starts every cron (through pg-boss), consumer and subscriber the worker owns, and serves only `GET /health` on `PORT`: `200` when every consumer started and every broker connection answers, `503` otherwise. On `SIGTERM` it stops pulling messages and scheduling crons, lets the handlers in flight finish, closes its broker connections and database pools, and exits `0` within `GKM_SHUTDOWN_TIMEOUT_MS` (default 8000), or `1` at the deadline.

  `gkm docker` writes a Dockerfile per worker (`.gkm/docker/Dockerfile.<worker>`), built inside Docker like a backend's, with credentials from the `gkm_credentials` BuildKit secret; the runner is the bundle on `node` with `tini` and a `HEALTHCHECK` on `/health`.

  `gkm compose` runs each worker as a service with no Caddy route and no published port, `restart: unless-stopped`, log rotation, its own `0600` env file holding exactly the keys its constructs read, and `depends_on` the stack's infrastructure; it starts after migrations, the plan lists it, and `verify` waits for its Docker health check. Dokploy deploys each worker as an application with no domain after the backends, checked by Dokploy's status and rolled back like any app. A worker with topic subscribers in a build whose broker is SNS fails with `WorkerSubscribersNeedPush`.

  The generated `queues.ts`, `subscribers.ts` and `crons.ts` no longer install their own `SIGTERM` handlers; they export `stopQueues`, `stopSubscribers` and `stopCrons`, and a status function each, for the entry that runs them. pg-boss connections name themselves to Postgres with `GKM_APP_NAME` when it is set.

## 10.0.0-alpha.72

## 10.0.0-alpha.71

## 10.0.0-alpha.70

## 10.0.0-alpha.69

## 10.0.0-alpha.68

## 10.0.0-alpha.67

## 10.0.0-alpha.66

## 10.0.0-alpha.65

## 10.0.0-alpha.64

## 10.0.0-alpha.63

## 10.0.0-alpha.62

## 10.0.0-alpha.61

## 10.0.0-alpha.60

## 10.0.0-alpha.59

## 10.0.0-alpha.58

## 10.0.0-alpha.57

## 10.0.0-alpha.56

## 10.0.0-alpha.55

## 10.0.0-alpha.54

## 10.0.0-alpha.53

## 10.0.0-alpha.52

## 10.0.0-alpha.51

### Minor Changes

- [#133](https://github.com/geekmidas/toolbox/pull/133) [`1aa7b43`](https://github.com/geekmidas/toolbox/commit/1aa7b434e28ef24e4bdf057847b510fa9cfa1fcf) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: `deploy.domains` for every target, a `subdomain` on each surface, and each `RestApi` on its own host
  - ✨ **`deploy.dokploy.domains` is now `deploy.domains`.** A stage's base domain is a fact about the deployment, not about Dokploy, so every target reads it. Move the block up one level: `deploy: { domains: { production: 'myapp.com' }, dokploy: { endpoint, registry } }`. A stage with no domain fails with `NoDomainForStage`, naming the stage and where to add it.
  - ✨ **`subdomain` on `RestApi`, `BetterAuth` and `StaticSite`.** A surface answers on `{subdomain}.{domain}` — `new RestApi('Api', { path: 'apps/api', subdomain: 'v1' })` is `v1.myapp.com` — and on the same label locally, `v1.shop.localhost`. Absent, the id kebab-cased, as before.
  - **Each `RestApi` on its own host.** A deploy handed every surface the first backend's address, so a workspace with two APIs pointed both at one. Each now gets its own app's URL.

## 10.0.0-alpha.50

## 10.0.0-alpha.49

## 10.0.0-alpha.48

## 10.0.0-alpha.47

### Minor Changes

- [#126](https://github.com/geekmidas/toolbox/pull/126) [`f1fc3e7`](https://github.com/geekmidas/toolbox/commit/f1fc3e7e9a8fdc995e3a4b957e29ce451f6fd959) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: `gkm dev` says where every service is, and an app can open Mailpit's inbox

  - **`gkm dev` lists every published port on every start**, labelled — `postgres`, `smtp`, `mailpit inbox`, `minio console`, … — with the pages as `http://` links. It used to print only on the start that changed a container, and only each container's primary port, so Mailpit's inbox was never shown at all. `gkm setup` lists the same when it converges.
  - **An `Email`'s inbox is a public role.** A `MobileApp` or `StaticSite` that `.dependsOn([mailer])` is built with `EXPO_PUBLIC_MAILER_INBOX_URL` (`VITE_`/`NEXT_PUBLIC_`) on a local stage — Mailpit's web inbox, so an "Open email app" button can open a sign-in link from the app. Deployed mail has no inbox and nothing sets it; the SMTP URL, which carries credentials, is never public. Closes #125.

- [#124](https://github.com/geekmidas/toolbox/pull/124) [`10ef53d`](https://github.com/geekmidas/toolbox/commit/10ef53d921d519afa62c773a6682581e19c06b1e) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: `Encryption` — a key that encrypts what the application stores

  `new Encryption('Pii')` gives a handler that `.dependsOn([pii])` `services.pii.encrypt`, `decrypt`, `index` (a blind index, so an encrypted column can still be looked up) and `reencrypt`. The app names no cipher: the construct provides one `PII_URL` whose scheme picks the backend.

  - **Locally and in tests**, an `aes256gcm://` keyring derived from the project and stage, like a secret — nothing to set.
  - **On a server stage**, a keyring generated into the stage's secrets on its first deploy and never replaced by a redeploy.
  - **On AWS**, envelope encryption under a KMS key that rotates yearly, and a KMS HMAC key for the index, each granted to exactly the functions that depend on the construct (`kms:GenerateDataKey`/`kms:Decrypt`, `kms:GenerateMac`). `@aws-sdk/client-kms` is an optional peer, loaded only for a `kms://` URL.

  Every ciphertext names the key that wrote it and is bound to its construct. `gkm encryption:rotate <Id> --stage <stage>` adds a key and keeps the old ones; after a `reencrypt` sweep, `gkm encryption:retire <Id> <key> --stage <stage>` removes one, and a value still under an old key warns the first time it is decrypted. The index key never rotates.

## 10.0.0-alpha.46

### Minor Changes

- [#122](https://github.com/geekmidas/toolbox/pull/122) [`31585c5`](https://github.com/geekmidas/toolbox/commit/31585c55f294520ce77483c653c543a835133d6e) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: `gkm build` builds for where the project deploys; the legacy providers are gone, and an SST deploy mounts its routes
  - **No legacy providers.** `aws-apigatewayv1`, `aws-apigatewayv2` and `aws-lambda` are gone, along with `--providers` and the `providers` block in `gkm.config.ts` (`providers.server.port`/`production`/`enableOpenApi` and `providers.dokploy` included). A bare `gkm build` follows `deploy.default`; `--provider aws|server` remains only as an override, which is what a Dockerfile's `gkm build --provider server` is.
  - 🐛 **`sst` is a deploy target.** `deploy: { default: 'sst' }` builds one Lambda per construct and resolves the AWS backends (cache, storage, events) everywhere, `gkm dev` included. Without it an SST project was normalised into a Dokploy one. `gkm init --deploy sst` writes it, and its deploy scripts are `gkm build && sst deploy --stage <stage>`.
  - **One manifest, the application's, written by the root.** A root `gkm build` builds every backend app in its own process, then writes one `.gkm/manifest/aws.ts` (or `server.ts`) from everything the workspace declares, with each app's routes folded into its own surface; turbo builds only the frontends. An app's own `gkm build` writes its handlers (`<app>/.gkm/aws/{routes,functions,crons,queues,subscribers}`) and no manifest. Handler paths are measured from the root, where `sst.config.ts` runs. A build clears what it superseded: the per-provider trees, an app-level manifest, and the other target's manifest. `gkm init` maps `@<name>/manifest` to it in the root tsconfig, and no longer exports a `./endpoints` the AWS build never writes.
  - **The manifest is the declarations, and nothing else.** `.gkm/manifest/<target>.ts` exports `constructs` and `backends`; the `export const manifest = { routes, functions, crons, … }` table and its derived types (`Route`, `Cron`, `RoutePartition`, …) are gone, as are partitioned manifests and the `{ paths, partition }` form of `constructs`, which only shaped them — `constructs` is a glob or a list of globs. Every endpoint is on its surface on both targets — its own Lambda on AWS, the app's entry on a server — functions and crons are declarations of their own, and a queue's worker and a topic's subscribers sit inside them. `@geekmidas/manifest` drops `Manifest`, `ManifestField` and `flattenManifestField`; `@geekmidas/cli/reconcile` drops `writeManifestModule` and `MANIFEST_PATH`.
  - 🔥 **`fromManifest` deploys functions and crons.** Each is a Lambda linked to its own edges, in the database's VPC when it reaches one; a function gets an IAM-authorized URL, a cron its schedule. `Api.fromManifest`, `Function.fromManifest` and `Cron.fromManifest`, which read the deleted table, are removed.
  - **`fromManifest` mounts each surface's endpoints.** An API Gateway used to deploy with no routes. Each endpoint is now its own Lambda, linked only to what it depends on, in the database's VPC when it reaches one (queue consumers too). `iam` is enforced by the gateway; every other authorizer runs in the handler.
  - **A `--production` server runs its background work.** Queues, crons and subscribers are wired into the production entry. They used to be left out unless `providers.server.production.subscribers` said `'include'`, so a Docker deploy never ran its worker.
  - **`gkm deploy:init` writes nothing into `gkm.config.ts`.** The `providers.dokploy` block it wrote was never read; the ids are rediscovered by name and kept in the state file.

## 10.0.0-alpha.45

## 10.0.0-alpha.44

## 10.0.0-alpha.43

## 10.0.0-alpha.42

## 10.0.0-alpha.41

## 10.0.0-alpha.40

## 10.0.0-alpha.39

### Patch Changes

- [#111](https://github.com/geekmidas/toolbox/pull/111) [`087444c`](https://github.com/geekmidas/toolbox/commit/087444c16591656ab7d85b7713939982231cb1f2) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: Queues and topics are constructs, and events name their topic (#110)
  - A queue is built from a worker, `worker.queue('Emails').message(schema).handle(…)`: the queue and its one consumer, one construct. `q` and the public `QueueBuilder` export are gone. A producer depends on it, `.dependsOn([emails])`, and sends through `services.emails`.
  - ✨ A topic is `new Topic('Users', { events })`. `t` and `TopicBuilder` are gone.
  - 🔥 `.publisher(service)` is gone everywhere: from `RestApi`, endpoint, function, cron and subscriber builders, and `Worker`. A construct publishes with `.event(users, { type, payload, when? })`, repeatable across topics; each event goes through its own topic's publisher, and the topic lands in `services` exactly as `.dependsOn([users])` would put it. `Topic.publisher`, `Queue.publisher`, `derivedFrom` and `edgesWith` are deleted.
  - `TestEndpointAdaptor` / `TestFunctionAdaptor` / the MSW adaptor lose their `publisher` option: pass a recorder under the topic's name in `services`.
  - Discovery records what a worker-owned queue's consumer depends on under the worker.
  - SST: `fromManifest` subscribes each queue's consumer Lambda (`Queue.consume`), and skips `worker`, `cron` and `function` declarations instead of throwing `UnknownDeclarationKind`.

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

## 10.0.0-alpha.37

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

## 10.0.0-alpha.34

## 10.0.0-alpha.33

## 10.0.0-alpha.32

### Patch Changes

- [#96](https://github.com/geekmidas/toolbox/pull/96) [`9b647d0`](https://github.com/geekmidas/toolbox/commit/9b647d09e28ba095178d33613ee4a9e91b8eb47d) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm seed`, `gkm dev --migrate`/`--seed`, and `db/<construct>/migrations/` + `seeds/`

  A database construct's folder now holds two folders, and nothing else:

  ```
  db/database/
    migrations/   # the schema's history, applied once each
    seeds/        # reference data the app needs, run on every pass
  ```

  **Moving an existing project:** move every file in `db/<construct>/` into
  `db/<construct>/migrations/`. History is recorded by name, not path, so nothing
  re-runs. A file left at the old level is refused with `MigrationsOutsideFolder`
  rather than silently never running, and any other folder beside the two with
  `UnknownDatabaseFolder`.

  - **Seeds are reference data:** a permission catalogue, roles and their grants,
    lookup tables. A `.ts` exporting `seed(db, { stage })`, or `.sql`, run in name order,
    each in its own transaction, as the construct's owner. There is no history:
    every seed runs every time, so a seed is an upsert and a changed one is
    applied by running it again. A failure rolls that seed back and throws
    `SeedFailed`; a script with no `seed` export throws `SeedHasNoSeed`.
  - **Seeds run on every stage, production included,** and each is handed the
    stage it is seeding, so one that belongs only somewhere decides for itself
    (`if (stage === 'production') return;`). `seedDatabases` and
    `migrateAndSeed` take the stage, so a deploy runs them the same way.
  - **Seeds always run after migrations.** `gkm seed [construct]` migrates, then
    seeds — for one construct, the database it lives in is migrated too.
    `gkm migrate` still only migrates.
  - **`gkm dev --migrate`** applies pending migrations before the apps start;
    **`gkm dev --seed`** migrates and seeds. Once, at startup, never on a save,
    and a failure stops `dev`. Without either, `dev` only reports what is pending.
  - ✅ **Tests migrate and seed:** `gkm test` and `@geekmidas/cli/vitest` do both,
    and a watch-mode rerun applies an edited seed.
  - `MigrationTarget` gains `migrations` and `seeds`; `databaseFolder()` and
    `seedFolder()` join `migrationFolder()`, which now names
    `db/<construct>/migrations`.
  - The scaffolded AGENTS.md says where reference data goes: a seed, written from
    the typed constant, never a migration.

## 10.0.0-alpha.31

## 10.0.0-alpha.30

### Patch Changes

- [#93](https://github.com/geekmidas/toolbox/pull/93) [`58eba5c`](https://github.com/geekmidas/toolbox/commit/58eba5cd5bc0e76565668bd9a48d836dd622ef98) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm migrate`, `gkm migration`, and a Vitest setup that migrates

  Every database construct — and every schema tenant — has its own migrations
  folder, named after it: `Database` is `db/database/`, `AuthDatabase` is
  `db/auth-database/`. Which constructs those are, in what order, from which
  folder, is `migrationTargets(manifest)` in `@geekmidas/manifest`, and nothing
  else decides it.

  - `gkm migrate [construct] [--stage test]` reconciles the stage (containers,
    roles, grants) and applies each folder as that construct's **owner** role —
    never the runtime one, never a fallback — parents before tenants. Each
    construct's history lives in its own schema. `.ts` files export `up`/`down`;
    `.sql` files run whole. Unordered migrations are allowed, so a branch merged
    late still applies. Deployed stages are refused: their deploy migrates them.
  - `gkm migration <construct> [name]` writes the next file, stamped
    `YYYYMMDDHHmmss` UTC: an empty `up`/`down` for a database, or — for a
    `BetterAuth` construct — the SQL its tenant is missing.
  - `globalSetup: ['@geekmidas/cli/vitest']` in the root Vitest config readies
    the test stage and migrates every construct before any test runs, however
    the suite starts: `gkm test`, plain `vitest`, an editor. `gkm test` does the
    same before starting Vitest; `gkm test --setup` does it and stops.
  - `gkm dev` reports pending migrations and applies none.
  - The scaffold writes its migration to `db/database/`, the root Vitest config
    carries the setup, and `kysely.config.ts`, `test/globalSetup.ts` and
    `kysely-ctl` are gone. AGENTS.md has a Migrations section.

## 10.0.0-alpha.29

## 10.0.0-alpha.28

## 10.0.0-alpha.27

## 10.0.0-alpha.26

## 10.0.0-alpha.25

## 10.0.0-alpha.24

## 10.0.0-alpha.23

## 10.0.0-alpha.22

## 10.0.0-alpha.21

## 10.0.0-alpha.20

## 10.0.0-alpha.19

## 10.0.0-alpha.18

## 10.0.0-alpha.17

## 10.0.0-alpha.16

## 10.0.0-alpha.15

## 10.0.0-alpha.14

## 10.0.0-alpha.13

## 10.0.0-alpha.12

## 10.0.0-alpha.11

## 10.0.0-alpha.10

## 10.0.0-alpha.9

## 10.0.0-alpha.8

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

## 10.0.0-alpha.6

## 10.0.0-alpha.5

## 10.0.0-alpha.4

## 10.0.0-alpha.3

## 10.0.0-alpha.2

## 10.0.0-alpha.1

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

## 0.1.1

### Patch Changes

- 🐛 [#11](https://github.com/geekmidas/toolbox/pull/11) [`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309) Thanks [@geekmidas](https://github.com/geekmidas)! - Patch release across all packages to realign published versions with the
  registry. The previous release only published the four packages that had
  version bumps; the remaining packages failed with "cannot publish over the
  previously published versions" because their versions were unchanged.

## 0.1.0

### Minor Changes

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`b42e96b`](https://github.com/geekmidas/toolbox/commit/b42e96b9dd28d8926a1253a97aa553bd0e08bf56) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(cloud): add `fromManifest` integrators backed by a shared `@geekmidas/manifest` package

  Introduces `@geekmidas/manifest` — a dependency-free package holding the
  deployment manifest types (`RouteInfo`/`FunctionInfo`/`CronInfo`/`SubscriberInfo`
  and their `*Manifest` containers) that `gkm build` emits. `@geekmidas/cli`
  re-exports these from the shared package (no behaviour change), so producer and
  consumers share one contract.

  `@geekmidas/cloud/sst` constructs gain static `fromManifest` factories that map
  a manifest straight into infrastructure:

  - `Api.fromManifest(stack, id, routesManifest, props)` — one route per
    `RouteInfo` (env vars, authorizer, timeout/memory mapped); supply
    `authorizers`/`links`/native args via `props`.
  - `Function.fromManifest(stack, functionsManifest, props)` — one `Function` per
    entry.
  - `Cron.fromManifest(stack, cronsManifest, { links, ... })` — one `Cron` per
    entry; each handler becomes a validated `Function` the cron triggers.

  `Api` routes also gain per-route `timeout`/`memory` passthrough.

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`03b08fe`](https://github.com/geekmidas/toolbox/commit/03b08feba2e735539c43f95b77792c18a627b07d) Thanks [@geekmidas](https://github.com/geekmidas)! - refactor(manifest): model the unified `gkm build` manifest and add `QueueInfo`

  `gkm build` emits a single TypeScript module per provider
  (`export const manifest = { routes, functions, crons, subscribers } as const`),
  not separate JSON files. `@geekmidas/manifest` now models that:

  - a unified `Manifest` type plus `ManifestField<T>` (a field is a flat
    `readonly T[]` or a partitioned `Record<string, readonly T[]>`) and a
    `flattenManifestField` helper;
  - the item types (`RouteInfo`/`FunctionInfo`/`CronInfo`/`SubscriberInfo`) gain a
    new `QueueInfo`, `SubscriberInfo.transport`, and readonly array fields so the
    `as const` manifest assigns cleanly;
  - 🔥 the per-unit `*Manifest` wrapper types are removed.

  `@geekmidas/cloud/sst`'s `Api`/`Function`/`Cron` `fromManifest` now take the
  manifest **field** (`Api.fromManifest(stack, id, manifest.routes, …)`) and
  flatten the flat-or-partitioned shape. `@geekmidas/cli` re-exports the updated
  types.

  Also fixes `@geekmidas/events` to externalise `pg-boss` (it was the one
  transport dep being bundled).

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
