# Upgrading to 10.0.0-alpha

This guide is for a project on `@geekmidas/*` 9.x, or on an earlier
10.0.0-alpha, moving to the current alpha on `main`. Every `@geekmidas`
package shares one version, so move them together:

```bash
gkm upgrade --all
```

`gkm upgrade` follows the release line a project is on (`alpha` for a
`10.0.0-alpha.x` project), never goes backwards, and with `--all` also raises
third-party packages to the floor of the peer ranges the new version declares.

## How this list was compiled

From every changeset released on the `10.0.0-alpha` line (`.changeset/*.md`,
kept while the repository is in pre-release mode) and the `10.0.0-alpha.*`
sections of each `packages/*/CHANGELOG.md`, de-duplicated by pull request.
Only about a dozen entries carry the `:boom:` marker; the rest of what is listed
here is a removal, a rename, a moved import path, a changed default or a changed
config shape that the changeset described without marking it. Where a later
alpha changed something again, only the state on `main` is described.

Each entry says what changed and what to do. Error class names are given so a
failure you hit can be found here by name.

What is deprecated but still works (`gkm deploy --provider dokploy`, the old
deploy wrappers and engine paths) is listed separately, with its removal date,
in [Deprecated deploy APIs](/guide/deploy-deprecations).

::: tip The short version
v10 makes the constructs the single source of truth. `gkm.config.ts` shrinks to
a name, the stages, a `constructs` glob, secrets and deploy settings; endpoints
are built from the `RestApi` that serves them; background work belongs to a
`Worker`; topics and queues are constructs; and `gkm deploy` deploys through a
[deploy target](/guide/deploy-targets).
:::

## Summary

| Package | Breaking changes |
| --- | --- |
| [`@geekmidas/cli` — `gkm.config.ts`](#cli-config) | 10 |
| [`@geekmidas/cli` — commands](#cli-commands) | 5 |
| [`@geekmidas/cli` — generated files and builds](#cli-build) | 5 |
| [`@geekmidas/cli` — environment and secrets](#cli-env) | 4 |
| [`@geekmidas/cli` — deploy](#cli-deploy) | 7 |
| [`@geekmidas/constructs`](#constructs) | 10 |
| [`@geekmidas/client`](#client) | 1 |
| [`@geekmidas/cloud`](#cloud) | 3 |
| [`@geekmidas/manifest`](#manifest) | 2 |
| [`@geekmidas/db`](#db) | 1 |
| [`@geekmidas/events`](#events) | 3 |
| [`@geekmidas/logger`](#logger) | 2 |
| [`@geekmidas/telescope`](#telescope) | 2 |
| [`@geekmidas/testkit`](#testkit) | 2 |
| [Removed packages: `ui`, `studio`](#removed-packages) | 1 |
| [Third-party majors](#third-party) | 1 |
| **Total** | **59** |

## `@geekmidas/cli` — `gkm.config.ts` {#cli-config}

The config schema is strict: a key it no longer has fails to load instead of
being ignored.

### 1. Apps come from the constructs

`gkm.config.ts` no longer describes each app — its routes, env parser, logger,
port and dependencies. An app exists because a construct says it does: a
`RestApi`, a `BetterAuth` or a `StaticSite` with a `path`. The logger and the
env parser are the `RestApi`'s config. `apps` survives only as an escape hatch
for a process no construct describes.

::: code-group

```ts [before]
export default defineWorkspace({
  name: 'shop',
  apps: {
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env',
      logger: './src/config/logger',
    },
    web: { type: 'frontend', path: 'apps/web', port: 3001, dependencies: ['api'] },
  },
});
```

```ts [after]
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'shop',
  stages: { local: 'development', deployed: ['production'] },
  constructs: ['./constructs/**/*.ts', './apps/*/src/endpoints/**/*.ts'],
  secrets: { enabled: true },
});

// constructs/api.ts
export const api = new RestApi('Api', { path: 'apps/api', logger });
// constructs/web.ts
export const web = new StaticSite('Web', { path: 'apps/web' }).dependsOn([api]);
```

:::

### 2. Every workspace declares a `constructs` glob

A workspace without one fails with `WorkspaceDeclaresNoConstructs`. It is a glob
or a list of globs; the `{ paths, partition }` object form is gone. The paths
that read ports from a hand-written `docker-compose.yml` or built
`http://localhost:<port>` URLs from an `apps` block are removed with it.

### 3. `stages` is required

```ts
stages: {
  local: 'development',          // what dev, exec, setup and test run as
  deployed: ['staging', 'production'],
  protected: ['production'],     // optional, a subset of deployed
},
```

`gkm deploy --stage` refuses a stage that is not in `deployed`
(`UndeclaredStage`), `test` is reserved for `gkm test`, and the local stage can
never also be deployed. To keep existing local secrets, name the local stage
after the file they are in: `local: 'development'` for
`.gkm/secrets/development.json`.

### 4. The `services` block is removed

Whether a database, cache, bucket or broker exists is a declared construct;
which backend serves it follows the deploy target (pg-boss and a Postgres
cache table on a server, SNS/SQS and Upstash on AWS). Delete `services` from
`gkm.config.ts`, `docker.compose` from any app config, and `trustLocalCa`
(trusting the local CA is per machine: `gkm trust`).

Compose is two files now: `docker-compose.constructs.yml` is generated and
gitignored, and the project's own `docker-compose.yml` is merged over it. Move
image pins and extra services there, and add
`docker-compose.constructs.yml` to `.gitignore`.

```ts
// before
services: { db: true, cache: true, events: 'pgboss', mail: true },
// after: nothing — declare the constructs instead
```

### 5. The `providers` block is removed

`providers.server` (`port`, `production`, `enableOpenApi`), `providers.dokploy`
and the `aws-apigatewayv1`, `aws-apigatewayv2` and `aws-lambda` providers are
gone. A bare `gkm build` builds for `deploy.default`; `--provider aws|server`
remains as an override. `gkm deploy:init` no longer writes a `providers.dokploy`
block (it was never read).

```ts
// before
providers: { aws: { apiGateway: { v2: true } }, server: { port: 3000 } },
// after
deploy: { default: 'sst' }, // or 'dokploy' / 'compose'
```

### 6. The `studio` option is removed

Studio is no longer published (see [removed packages](#removed-packages)).
Delete `studio` from the config; `StudioConfig` is gone. `gkm dev` serves the
declared database as a read-only JSON API at `/__gkm/db` instead of mounting
Studio at `/__studio`.

### 7. `deploy.dokploy.domains` is `deploy.domains`

A stage's base domain is read by every target. A stage with none fails with
`NoDomainForStage`.

```ts
// before
deploy: { dokploy: { endpoint, registry, domains: { production: 'shop.com' } } },
// after
deploy: {
  domains: { production: 'shop.com' },
  dokploy: { endpoint: 'https://dokploy.example.com' },
},
```

Each `RestApi`, `BetterAuth` and `StaticSite` can now set a `subdomain`
(default: its id, kebab-cased).

### 8. `deploy.dokploy.registry` is `deploy.registry`

Every target pushes and pulls through one registry. A config still setting
`deploy.dokploy.registry` fails with `DokployRegistryMoved`, which names the
value. `deploy.dokploy.registryId` stays where it is. A Dokploy deploy without a
registry fails with `RegistryNotConfigured`.

```ts
deploy: {
  registry: 'ghcr.io/acme',
  dokploy: { endpoint: 'https://dokploy.example.com' },
},
```

### 9. Deployed stages keep their secrets in `secrets.store`

`.gkm/` is gitignored, so the encrypted file was never on a CI runner.
`secrets.store` says where a deployed stage's secrets live; the local stage
always stays in the file. `state: { provider: 'ssm' }` no longer carries
secrets.

```ts
secrets: {
  enabled: true,
  store: { provider: 'ssm', region: 'eu-west-1' }, // or 'file' (default)
},
```

A custom store is `{ provider: store }` where `store` implements
`SecretsStore`: `{ name, read(stage), write(stage, secrets) }` (it was
`pull`/`push`). `SsmSecretsStore` is now `AwsSecretsStore`; the file store is
`FileSecretsStore`. The free functions `readStageSecrets`, `writeStageSecrets`,
`setCustomSecret`, `secretsExist` and `getSecretsPath` are gone. To move a stage
whose secrets were only on one machine, set `secrets.store`, then
`gkm secrets:import <file> --stage <stage>` or `gkm secrets:set`.

### 10. `deploy.compose.logs` is a `Telemetry` construct and `deploy.telemetry` {#telemetry}

What a process emits is now declared — a [`Telemetry` construct](/guide/telemetry)
given to each surface and worker, like its logger — and where it goes is the
stage's, in `deploy.telemetry`. `deploy.compose.logs` is gone, and
`deploy.compose` refuses it.

```ts
// before — gkm.config.ts
deploy: {
  compose: { logs: { retentionDays: 14, public: { allow: ['203.0.113.7'] } } },
}
```

```ts
// after — constructs/telemetry.ts
import { Telemetry } from '@geekmidas/constructs/telemetry';

export const telemetry = new Telemetry('Telemetry', { ignorePaths: ['/ready'] });

// constructs/api.ts, constructs/worker.ts — and BetterAuth's config
new RestApi('Api', { path: 'apps/api', defaultAuthorizer: 'none', logger, telemetry });
new Worker('Jobs', { logger, telemetry });

// gkm.config.ts — the options move under the self-hosted provider
deploy: {
  telemetry: {
    production: {
      provider: 'self-hosted',
      retentionDays: 14,
      public: { allow: ['203.0.113.7'] },
    },
  },
}
```

`'self-hosted'` alone is enough where the defaults do, and on `gkm compose` a
stage that names nothing runs it anyway. The local stage ignores
`deploy.telemetry`; its port moves with `GKM_COMPOSE_LOGS_PORT`.

- **The stage's `OTEL_*` secrets are no longer forwarded** to every backend,
  and `LogsEndpointConflict` is gone. Name the provider instead:
  `{ provider: 'otlp', endpoint: 'https://otlp.example.com', headers: { … } }`.
  On Dokploy, which runs no collector, a stage that uses telemetry must do so
  (or say `false`) — otherwise `TelemetryProviderRequired`.
- **Only processes with the edge export**, and their builds need
  `@geekmidas/telescope` and its `@opentelemetry/*` peers: without them,
  `gkm build` and `gkm dev` fail with `TelemetryPackagesMissing` and the
  `pnpm --dir <app> add …` to run. A server without the edge loads nothing,
  even with `OTEL_EXPORTER_OTLP_ENDPOINT` set.

## `@geekmidas/cli` — commands {#cli-commands}

### 11. `gkm generate:react-query` is removed

So is the `@geekmidas/cli/openapi-react-query` export and the
`openapi-typescript` dependency. Each surface's typed client, with React Query
hooks, is written by `gkm build`, `gkm dev` and `gkm openapi` (see
[entry 16](#typed-client-location)).

### 12. `gkm secrets:push` and `gkm secrets:pull` are removed

Every command reads and writes the store of the stage it acts on, so there is
nothing to move between them. Write a deployed stage's values with
`gkm secrets:set <KEY> '<value>' --stage <stage>`. The generated SST workflow
has no pull step and `gkm deploy:github` no longer pushes.

### 13. `gkm build --providers` and the legacy providers are removed

```bash
# before
gkm build --providers aws-apigatewayv2,aws-lambda
# after
gkm build                   # follows deploy.default
gkm build --provider server # override, e.g. inside a Dockerfile
```

### 14. `gkm deploy --provider` is `gkm deploy --target`

`--provider dokploy` still works with a deprecation warning. `--provider docker`
and `--provider aws-lambda` fail with `ProviderRemoved`, which points to
`gkm docker`/`gkm compose` and to SST. `--target` takes `dokploy`, `compose`,
`sst`, or a name from `deploy.targets`; without it, `deploy.default` is used.
See [Deploy targets](/guide/deploy-targets). `--provider` itself is removed in
the alpha after next; see [Deprecated deploy APIs](/guide/deploy-deprecations).

```bash
# before
gkm deploy --provider dokploy --stage production
# after
gkm deploy --stage production                 # deploy.default
gkm deploy --target dokploy --stage production
```

### 15. An app is found by its configured path

`gkm dev`, `test` and `exec` run the app whose `path` holds the current
directory; a directory no app lives in fails with `NotInAnApp`, and at the
workspace root `gkm dev` hands the workspace to turbo. The `package.json` name
is never consulted: `getAppNameFromCwd` and `getAppNameFromPackageJson` are
removed. `gkm docker` names its default image after the config's `name`.

## `@geekmidas/cli` — generated files and builds {#cli-build}

### 16. Each API's typed client lives at the root {#typed-client-location}

The client is the application's: it is written to the workspace root's
`.gkm/client/<surface>.ts` (it was `.gkm/openapi/` inside the API app) and
imported as `@<name>/client/<surface>`. The API package no longer has a
`./client` export.

```ts
// before
import { createApi } from '@shop/api/client';
// after
import { createApi } from '@shop/client/api';
```

In each frontend's `tsconfig.json`, map
`"@shop/client/*": ["../../.gkm/client/*"]`, and add `@geekmidas/client` and
`@tanstack/react-query` to the root `package.json`.

### 17. The manifest is the declarations, written once by the root {#manifest-exports}

`.gkm/manifest/<target>.ts` exports `constructs` and `backends` and nothing
else. The `manifest = { routes, functions, crons, … }` table, its derived types
(`Route`, `Cron`, `RoutePartition`, …) and partitioned manifests are gone. A
root `gkm build` writes the one manifest; an app's own build writes only its
handlers. `@geekmidas/cli/reconcile` drops `writeManifestModule` and
`MANIFEST_PATH`. Import the new exports in `sst.config.ts`:

```ts
const { backends, constructs } = await import('./.gkm/manifest/aws.js');
```

### 18. A `RestApi`'s production server serves HTTP only

`gkm build --production` (what `gkm docker`'s images run) no longer wires queue
consumers, crons or topic subscribers into an API's server: they belong to a
`Worker`, and the build says what it left out. Publishing is unchanged and
`gkm dev` still runs everything in one process. Each `Worker` is its own
entry, image and service on a server target; see
[Workers](/guide/production#workers).

### 19. The master key is never printed, and credentials reach `docker build` as a secret

Output names the master key by fingerprint (the first 8 hex characters of its
SHA-256). If you copied `GKM_MASTER_KEY` from `gkm build --stage` output, read
it from `.gkm/server/master.key` instead. Encrypted credentials reach the image
build as a BuildKit secret (`--secret id=gkm_credentials`) rather than the
`GKM_ENCRYPTED_CREDENTIALS` / `GKM_CREDENTIALS_IV` build args. Regenerate your
Dockerfiles with `gkm docker`.

### 20. A database construct's folder holds `migrations/` and `seeds/`

Each database construct (and schema tenant) has `db/<construct>/migrations/` and
`db/<construct>/seeds/`, applied by `gkm migrate` and `gkm seed` as the
construct's owner role. Move every file in `db/<construct>/` into
`db/<construct>/migrations/`; history is recorded by name, so nothing re-runs. A
file left at the old level fails with `MigrationsOutsideFolder`, another folder
with `UnknownDatabaseFolder`. The scaffold's `kysely.config.ts`,
`test/globalSetup.ts` and `kysely-ctl` are replaced by the CLI's Vitest setup:

```ts
// vitest.config.ts (root)
export default defineConfig({
  test: { globalSetup: ['@geekmidas/cli/vitest'] },
});
```

## `@geekmidas/cli` — environment and secrets {#cli-env}

### 21. `<ID>_CREDENTIAL` is `<ID>_CREDENTIALS`

A `Credential` or `ExternalApi` construct provides `<ID>_CREDENTIALS`, one JSON
value. Rename the secret on every stage:

```bash
gkm secrets:set STRIPE_CREDENTIALS '{"secretKey":"…"}' --stage production
```

A Dokploy stage missing it fails `gkm deploy` with `MissingSuppliedSecret`.

### 22. `EVENT_SUBSCRIBER_CONNECTION_STRING` is deleted

Each topic and queue provides `<ID>_PUBLISHER_CONNECTION_STRING`, read by its
producers and its consumers alike. Crons on a server schedule through
`EVENT_PUBLISHER_CONNECTION_STRING` (pg-boss and RabbitMQ only).

### 23. `RABBITMQ_URL` and its credentials are gone

`RABBITMQ_URL`, `RABBITMQ_USER`, `_PASSWORD`, `_HOST`, `_PORT` and `_VHOST`
are no longer generated. A topic's broker URL is its own key, e.g.
`USERS_PUBLISHER_CONNECTION_STRING` for a `Users` topic.

### 24. Dokploy secrets are random, not derived from the repository

An auth server's signing secret and every Dokploy database and bucket password
used to be a hash of the project name, stage and construct id. A stage's next
deploy generates a random signing secret and a per-stage seed, kept in its
secrets store: live sessions end once, database roles take new passwords, and a
bucket's root user is reset.

## `@geekmidas/cli` — deploy {#cli-deploy}

See [Deploy targets](/guide/deploy-targets), [State](/guide/state) and
[Production](/guide/production) for how the pieces fit together.

### 25. Dokploy deploys are identified by namespace, project and stage

A deploy claims its Dokploy project with a `gkm:<namespace>/<project>` marker in
the description, and never deploys into a same-named project without it
(`ProjectNotOwned`). An existing stage's project id in state is trusted and the
marker is written on its next deploy. Images are now
`<registry>/<namespace>/<project>-<app>:<tag>` (they were
`<registry>/<name>-<app>:<tag>`): registry permissions scoped to the old
repository names need the new path. `deploy.namespace` defaults to the
kebab-cased workspace name; set it when two workspaces of one name deploy to one
server.

### 26. Stage keys moved under `~/.gkm/keys/`

Keys move from `~/.gkm/<folder>/<stage>.key` to
`~/.gkm/keys/<namespace>/<project>/<stage>.key`. An existing key is copied the
first time it is read and the old file is kept. `GKM_HOME` moves the whole home
(keys and `credentials.json`). Changing `deploy.namespace` from one value to
another needs the key copied by hand; regenerate GitHub workflows so they write
the key to the new place.

### 27. Deploy state is version 2, locked and journalled

State is stored as schema version 2; a v1 state is migrated on first read and
the original kept beside it (`.gkm/deploy-<stage>.v1.json` locally). A deploy
holds the stage's lock for the whole run: a second run gets `StateLocked`, a
stale write `StateVersionConflict`, and a crashed run's lock is released with
`gkm state:unlock --stage <stage>`. `CachedStateProvider`,
`LocalStateProvider`, `SSMStateProvider`, `createStateProvider` and the
`StateStoreProvider` bridge are removed; a custom `StateProvider` in
`state.provider` still works but warns `StateStoreWithoutLocking`. S3 is a new
option: `state: { provider: 's3', bucket, region }`. See [State](/guide/state).

### 28. State records `releases`, not `images`

Each app's entry is `releases: { [app]: { current, previous, history } }`. An
app's first release after upgrading has nothing to roll back to.
`gkm deploy:rollback --stage <stage> --app <app>` puts one app back on its
previous release.

### 29. A Dokploy deploy waits, checks health, and fails on a failed site

Success is no longer recorded when Dokploy queues a deployment: each app is
released once its deployment finishes (`DeploymentFailed`,
`DeploymentTimedOut`) and, with a domain, once its health check answers 2xx
(`/health` for a backend, `/` for a site; `HealthCheckTimedOut`). A backend
that fails stops the run with `BackendDeployFailed`; a site that fails now
fails the run with `FrontendDeployFailed` instead of leaving it successful.
Failed apps are rolled back (`--atomic` rolls back every app the run released).
Pending migrations are applied before any app is switched
(`DeployMigrationsFailed`). Tune the checks with `deploy.dokploy.verify`:

```ts
deploy: {
  dokploy: {
    endpoint: 'https://dokploy.example.com',
    verify: { healthCheckPath: '/healthz', healthTimeoutMs: 300_000 },
  },
},
```

### 30. The project's own code runs in a sandbox, without the deploy's credentials

The config load, construct discovery, the env sniffer and the turbo build run in
a child process with an allowlisted environment (`PATH`, `HOME`, locale,
`NODE_ENV`, proxies and the like). `AWS_*`, `DOKPLOY_*`, `DOCKER_*`,
`NODE_AUTH_TOKEN`, `GITHUB_TOKEN` and `NODE_OPTIONS` are not passed on
(`TURBO_TOKEN` is, for a remote cache). A build step that read one of those from
the environment no longer sees it. Under an isolating sandbox, a live object in
the config (a custom state store, an inline target) fails with
`ConfigObjectNotSerializable`. A config that fails to load raises
`ConfigLoadFailed` (it was a plain `Error`). See [Sandbox](/guide/sandbox).

### 31. Programmatic deploys go through `deploy()`

`deploy()` from `@geekmidas/cli/deploy` never prompts, prints or exits; it
returns a run whose events you iterate and whose `result` you await. See
[The deploy API](/guide/deploy-api).

```ts
import { deploy } from '@geekmidas/cli/deploy';

const run = deploy({ cwd: '/path/to/project', stage: 'production' });
for await (const event of run) console.log(event.type);
const result = await run.result;
```

`gkm deploy` is a thin wrapper around it with the same human output, plus
`--json` (events as JSON lines) and `--dry-run`. The CLI's internal
`workspaceDeployCommand` and `deployCommand` are `@deprecated` wrappers kept for
one alpha; call `deploy()` instead. The old single-image `DeployResult` type is now
`DockerDeployResult`, and its `masterKey` is deprecated. All of these are removed
in the alpha after next: see [Deprecated deploy APIs](/guide/deploy-deprecations).
`DeployProviderUnsupported` is gone. Without a terminal, a missing Dokploy or
registry login is `MissingCredential` (the registry login can come from
`DOCKER_REGISTRY_USERNAME` / `DOCKER_REGISTRY_PASSWORD`).

## `@geekmidas/constructs` {#constructs}

### 32. `e` is gone: endpoints are built from a `RestApi`

The logger, env parser and authorizers come from the surface.

::: code-group

```ts [before]
import { e } from '@geekmidas/constructs/endpoints';

export const createUser = e
  .logger(logger)
  .post('/users')
  .body(schema)
  .handle(async ({ body }) => { … });
```

```ts [after]
// constructs/api.ts
import { RestApi } from '@geekmidas/constructs/rest-api';

export const api = new RestApi('Api', { path: 'apps/api', logger });

// endpoints/users.ts
export const createUser = api
  .post('/users')
  .body(schema)
  .handle(async ({ body }) => { … });
```

:::

### 33. `api.endpoints` is gone: branch from the surface

The branching methods live on the surface: `api.database()`, `api.session()`,
`api.auditor()`, `api.actor()`, `api.authorizer()`, `api.authorize()`,
`api.rls()` and `api.route()`. Each returns a new factory and leaves the
surface untouched. `dependsOn` is per endpoint.

```ts
// before
export const router = api.endpoints.database(database);
api.endpoints.dependsOn([uploads]).get('/files');
// after
export const router = api.database(database);
api.get('/files').dependsOn([uploads]);
```

### 34. `c`, `s` and `f` are gone: background work comes from a `Worker`

What is called first decides the kind: a schedule makes a cron, a topic a
subscriber, anything else a function. The worker carries the logger, and its
`.database()` is the default `db` of everything built from it.

::: code-group

```ts [before]
import { c } from '@geekmidas/constructs/crons';
import { s } from '@geekmidas/constructs/subscribers';

export const cleanup = c.logger(logger).schedule('rate(1 day)').handle(…);
export const onUser = s.logger(logger).subscribe(['user.created']).handle(…);
```

```ts [after]
import { Worker } from '@geekmidas/constructs/worker';

export const worker = new Worker('Jobs', { logger }).database(database);

export const cleanup = worker.cron('rate(1 day)').handle(…);
export const onUser = worker
  .topic(users)
  .subscribe(['user.created'])
  .handle(async ({ events }) => { … });
export const reindex = worker.input(schema).handle(…);
```

:::

### 35. Topics and queues are constructs; `.publisher()` is gone

`q`, `t`, `QueueBuilder`, `TopicBuilder`, `Topic.publisher`, `Queue.publisher`,
`derivedFrom` and `edgesWith` are deleted, and `.publisher(service)` is gone
from `RestApi`, endpoint, function, cron and subscriber builders and from
`Worker`. A construct publishes with `.event(topic, { type, payload, when? })`;
a queue is built from a worker, together with its one consumer.

::: code-group

```ts [before]
export const createUser = router
  .post('/users')
  .publisher(userEvents)
  .event({ type: 'user.created', payload: (u) => ({ userId: u.id }) })
  .handle(…);
```

```ts [after]
// constructs/topics.ts
import { Topic } from '@geekmidas/constructs/topic';

export const users = new Topic('Users', {
  events: { 'user.created': z.object({ userId: z.string() }) },
});

// endpoints/users.ts
export const createUser = router
  .post('/users')
  .event(users, {
    type: 'user.created',
    payload: (user) => ({ userId: user.id }),
  })
  .handle(…);

// queues/emails.ts — sent with .dependsOn([emails]) and
// services.emails.publish([{ type: 'Emails', payload }])
export const emails = worker
  .queue('Emails')
  .message(z.object({ to: z.email() }))
  .handle(async ({ messages }) => { … });
```

:::

`TestEndpointAdaptor`, `TestFunctionAdaptor` and the MSW adaptor lose their
`publisher` option: pass a recorder under the topic's name in `services`.

### 36. `RestApi`, `BetterAuth` and `StaticSite` take a required `path`; the `app` block is gone

`path` is the app that serves the surface, relative to the workspace root
(`'apps/api'`, or `'.'` in a single-app project). It used to be inferred from
the id. The `app` block is gone; the one thing it carried that the id does not
is `telescope: true` on the declaration.

```ts
// before
new RestApi('Api', { app: { telescope: true } });
// after
new RestApi('Api', { path: 'apps/api', telescope: true });
```

### 37. `SnsPushSubscriberAdaptor` moved to `/subscribers`

Every other export of `@geekmidas/constructs/aws` loads `@middy/core`.

```ts
// before
import { SnsPushSubscriberAdaptor } from '@geekmidas/constructs/aws';
// after
import { SnsPushSubscriberAdaptor } from '@geekmidas/constructs/subscribers';
```

### 38. `featureTest` hands databases and factories by name

`featureTest({ database })` is gone; nothing is inferred and nothing opens
before it is used. Factories live in `test/factories/<construct>.ts` at the
project root and export `createFactory(db)`.

```ts
// before
it('joins', async ({ db }) => {
  const factory = createFactory(db);
  await db.selectFrom('members').selectAll().execute();
});

// after
it('joins', async ({ db, factories }) => {
  const factory = await factories.get('database');
  const app = await db.get('database');
  await app.selectFrom('members').selectAll().execute();
});
```

`FeatureContext<Browser, unknown>` is `FeatureContext<Browser>`. A
hand-written magic-link helper can be replaced by `browser.signIn(email)`.

### 39. A mobile app adds Better Auth's `expo()` plugin itself

`@geekmidas/constructs` no longer depends on `@better-auth/expo`. An auth server
a `MobileApp` depends on refuses to start without the plugin
(`ExpoPluginRequired`). A mobile app's scheme is the same on every stage (it was
suffixed `-dev` locally); rebuild the app with the unsuffixed scheme.

```ts
import { expo } from '@better-auth/expo';

export const auth = new BetterAuth('Auth', {
  path: 'apps/auth',
  database: authDb,
  options: { plugins: [expo()] },
});
```

### 40. `.database(other)` on a worker-built construct replaces the worker's

A cron, queue or subscriber that calls `.database(other)` gets `other` as its
`db` and its manifest edge, replacing the worker's database rather than adding
to it.

### 41. Queries carry tags, and connections an `application_name`, by default

A query run inside an endpoint, subscriber, queue or cron ends in a
sqlcommenter comment (`/*operation='POST /orders',request_id='…'*/`), and every
connection sets `application_name` (`PGAPPNAME` or `?application_name=` in the
URL still win). Turn tags off per database:

```ts
new KyselyDatabase('Database', { queryTags: false });
```

## `@geekmidas/client` {#client}

### 42. Request types come from the schema's input

`requestBody` and `parameters.query` are typed from the schema's input, not its
output, so a `z.coerce.number()` query parameter accepts the string a URL
carries. A call that passed the parsed type still compiles where input and output
match; where they differ, pass what the endpoint accepts on the wire.

## `@geekmidas/cloud` {#cloud}

### 43. `fromManifest`'s overrides are typed and required

Overrides are `ManifestOverrides<typeof constructs, typeof backends>`: only the
manifest's ids are keys, each takes what its kind accepts, and what the synth
cannot guess (a database's `vpc`, mail's `from`) is required. `ComponentOverrides`
is removed and `overrides` is a required argument; pass `{}` when there is
nothing to say.

```ts
const { App, fromManifest, Stack } = await import('@geekmidas/cloud/sst');
const { backends, constructs } = await import('./.gkm/manifest/aws.js');

fromManifest(
  new Stack(app, 'Shop'),
  constructs,
  { Database: { vpc } },
  backends,
);
```

### 44. `Api.fromManifest`, `Function.fromManifest` and `Cron.fromManifest` are removed

They read the deleted manifest table. `fromManifest` now deploys every
surface's endpoints, each function and each cron.

### 45. Failures are named classes

Match on `DokployCallFailed` (with `path`, `status`, `statusText`, `detail`) and
`RoutesMissingEnvironment` rather than on message text.

## `@geekmidas/manifest` {#manifest}

### 46. `Manifest`, `ManifestField` and `flattenManifestField` are removed

The manifest is `constructs` and `backends`; see
[entry 17](#manifest-exports).

### 47. `appScheme` is removed

A mobile app's scheme is the same on every stage, and `schemeBase(project,
given?)` is that scheme.

## `@geekmidas/db` {#db}

### 48. `decodeCursor` throws `InvalidCursor`

Exported from `@geekmidas/db/pagination`, `/kysely/pagination` and
`/objection/pagination`. Match on the class instead of a plain `Error`'s
message.

## `@geekmidas/events` {#events}

### 49. Topics fan out on pg-boss

A topic's message is published as `<topic>/<type>`, and each subscriber drains
its own queue `<topic>/<subscriber>`, so every subscriber sees every message.
Subscribers used to compete for one queue per event type. Messages still
waiting in the old per-type queues are not drained after the upgrade.
`Publisher.fromConnectionString(url, { topic })` and
`Subscriber.fromConnection(connection, { topic, subscription })` take the new
options.

### 50. Failures are named classes

`UnsupportedEventTransport`, `SnsQueueMissing`, `SqsBatchPartlyFailed`,
`RabbitMQChannelUnavailable` and `PgBossNotStarted` replace plain `Error`s.

### 51. Brokers are drivers, registered by the entry point

`Publisher`, `Subscriber` and `EventConnectionFactory` no longer load a broker
by its scheme on their own: each broker is a driver on its own subpath, and a
process registers the ones it uses. Code `gkm` generates — `gkm dev`, `gkm
build`, `gkm test` and every Lambda handler — registers its target's broker for
you. A script that builds a publisher itself registers it once, before the
first call; without it the call throws `UnregisteredEventsScheme`, which names
the subpath and the call to add.

```ts
import { Publisher, registerEventsDriver } from '@geekmidas/events';
import { pgbossEventsDriver } from '@geekmidas/events/pgboss';

registerEventsDriver(pgbossEventsDriver);
const publisher = await Publisher.fromConnectionString(url);
```

## `@geekmidas/logger` {#logger}

### 52. `createLogger` redacts by default

`createLogger` from `@geekmidas/logger/pino` redacts `DEFAULT_REDACT_PATHS`
when `redact` is left out. Pass `redact: false` for the old behaviour.

```ts
import { createLogger } from '@geekmidas/logger/pino';

const logger = createLogger();                  // redacted
const raw = createLogger({ redact: false });    // as in 9.x
```

### 53. pino is an optional peer

`Logger` is a structural interface and `ConsoleLogger` needs no pino. Installing
`@geekmidas/logger` no longer installs pino or pino-pretty; a project importing
`@geekmidas/logger/pino` installs `pino` itself.

## `@geekmidas/telescope` {#telescope}

### 54. No dashboard: `createUI` is `createApi`

The embedded React UI is gone. `createApi` serves the same JSON routes under
`/api/*`; the mount point's root and the old dashboard routes now 404.

```ts
// before
import { createUI } from '@geekmidas/telescope/hono';
app.route('/__telescope', createUI(telescope));
// after
import { createApi } from '@geekmidas/telescope/hono';
app.route('/__telescope', createApi(telescope));
```

### 55. Tables moved into a schema and dropped their prefix

`telescope_requests`, `telescope_exceptions` and `telescope_logs` are
`requests`, `exceptions` and `logs` in a schema of their own. Pass
`schema` to the Kysely storage only when the connection's `search_path` is not
already pinned to it.

## `@geekmidas/testkit` {#testkit}

### 56. `faker.internet.email()` is lowercase

`email()` and `exampleEmail()` return lowercase addresses, as Better Auth stores
them. A test that compared a mixed-case address it generated needs updating.

### 57. Vitest 5 is required

`@geekmidas/testkit` and `@geekmidas/db` declare `vitest ~5.0.2`.

## Removed packages {#removed-packages}

### 58. `@geekmidas/ui` and `@geekmidas/studio` are no longer published

Their last versions are `9.0.2` (`latest`) and `10.0.0-alpha.55` (`alpha`); pin
those to keep using them. Studio's data layer lives on in
`@geekmidas/db/introspect`; for components, run `npx shadcn@latest add` in your
app. `gkm init` writes shadcn/ui components into the web app instead of a
`packages/ui` workspace package.

## Third-party majors {#third-party}

### 59. OpenTelemetry 2, Zod 4.6, Better Auth 1.7

Dependency ranges were realigned across the repository. The ones that change
code you may own:

- **OpenTelemetry 2.x** removed `addSpanProcessor` and
  `BasicTracerProvider.register()`; span processors are passed to the
  provider's constructor.
- **Zod 4.6** refers to a registered schema (`.meta({ id })`) by `$ref`, and
  generated OpenAPI documents are 3.1.0.
- **Better Auth 1.7** moved its adapter test harness to
  `@better-auth/test-utils/adapter`.

Scaffolds also moved to TypeScript 7, Vite 8 and React 19.3; an existing project
can stay where it is as long as it satisfies the packages' peer ranges.
