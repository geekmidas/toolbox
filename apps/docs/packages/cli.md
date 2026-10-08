# @geekmidas/cli

Command-line tools for building and deploying API applications.

## Installation

```bash
npm install -g @geekmidas/cli
# or
pnpm add -g @geekmidas/cli
```

## Features

- **Reconcile** — derive local containers, databases, roles, and buckets from the constructs an app declares
- **Project scaffolding** with interactive prompts
- Build AWS Lambda handlers from endpoint definitions
- Generate OpenAPI specifications
- Create React Query hooks from API definitions
- Multi-provider support (API Gateway v1/v2, Hono server)
- Development server with hot reload and Telescope integration

## Commands

### Init

Scaffold a new project with interactive prompts.

```bash
# Interactive mode
gkm init

# With project name
gkm init my-api

# Non-interactive with defaults
gkm init my-api --yes

# Monorepo setup
gkm init my-project --monorepo --api-path apps/api
```

**Interactive Prompts:**

```
? Project name: › my-api
? Template: › (Use arrow keys)
    Minimal - Basic health endpoint
  ❯ API - Full API with auth, database, services
    Serverless - AWS Lambda handlers
    Worker - Background job processing

? Include Telescope (request, exception and log recording)? › Yes
? Include database support (Kysely)? › Yes
? Logger: ›
  ❯ Pino - Fast JSON logger for production (recommended)
    Console - Simple console logger for development
? Routes structure: ›
  ❯ Centralized (endpoints) - src/endpoints/**/*.ts
    Centralized (routes) - src/routes/**/*.ts
    Domain-based - src/**/routes/*.ts
? Setup as monorepo? › No
```

**Options:**

| Option | Description |
|--------|-------------|
| `--template <name>` | Project template (minimal, api, serverless, worker) |
| `--skip-install` | Skip dependency installation |
| `-y, --yes` | Skip prompts, use defaults |
| `--monorepo` | Setup as monorepo with pnpm workspaces |
| `--api-path <path>` | API app path for monorepo (default: apps/api) |

**Templates:**

| Template | Description | Key Features |
|----------|-------------|--------------|
| `minimal` | Basic health endpoint | Hono, envkit, logger |
| `api` | Full API with auth, database | + auth, db, cache, services |
| `serverless` | AWS Lambda handlers | + cloud, Lambda adapters |
| `worker` | Background job processing | + events, subscribers, crons |

**Routes Structures:**

| Structure | Glob Pattern | Example |
|-----------|--------------|---------|
| Centralized (endpoints) | `src/endpoints/**/*.ts` | `src/endpoints/users/list.ts` |
| Centralized (routes) | `src/routes/**/*.ts` | `src/routes/users/list.ts` |
| Domain-based | `src/**/routes/*.ts` | `src/users/routes/list.ts` |

**Generated Files (Standalone):**

```
my-api/
├── src/
│   ├── config/
│   │   ├── env.ts
│   │   ├── logger.ts
│   │   └── telescope.ts (if enabled)
│   └── endpoints/          # or routes/, or domain-based
│       └── health.ts
├── .gkm/
│   └── secrets/
│       └── development.json (encrypted)
├── .gitignore
├── biome.json
├── gkm.config.ts
├── package.json
├── tsconfig.json
└── turbo.json
```

**Generated Files (Monorepo):**

```
my-project/
├── apps/
│   └── api/
│       ├── src/
│       │   ├── config/
│       │   └── endpoints/    # or routes/, or domain-based
│       │       └── health.ts
│       ├── gkm.config.ts
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── models/
│       ├── src/
│       │   └── index.ts (shared Zod schemas)
│       ├── package.json
│       └── tsconfig.json
├── .gkm/
│   └── secrets/
│       └── development.json (encrypted)
├── biome.json
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── turbo.json
```

**Secrets Storage:**

Secrets are stored encrypted at `.gkm/secrets/{stage}.json` with decryption keys at `~/.gkm/keys/{namespace}/{project}/{stage}.key` (`$GKM_HOME/keys/…` when `GKM_HOME` is set). This separates secrets from the codebase while keeping them accessible locally.

### Build

Generate Lambda handlers or server applications from endpoint definitions.
`gkm build` builds for where the project deploys: `deploy: { default: 'sst' }`
builds for AWS, one Lambda per construct; `dokploy` — the default when nothing
is declared — builds a server. `--provider` overrides it.

```bash
# Build for where gkm.config.ts deploys
gkm build

# Build a server whatever the deploy target (what a Dockerfile runs)
gkm build --provider server

# Build for production (no dev tools, bundled)
gkm build --provider server --production
```

**Options:**

| Option | Description |
|--------|-------------|
| `--provider` | Override the deploy target (aws, server) |
| `--production` | Build for production (no dev tools, bundled output) |
| `--skip-bundle` | Skip bundling step in production build |
| `--enable-openapi` | Enable OpenAPI documentation generation |

**Production Build:**

When using `--production`, the build:
- Excludes Telescope
- Excludes the database API
- Excludes WebSocket setup
- Adds health check endpoints (`/health`, `/ready`)
- Adds graceful shutdown handling
- Bundles output to a single `.mjs` file using tsdown

```bash
# Production build outputs to:
# .gkm/server/app.ts        (production app)
# .gkm/server/server.ts     (entry point)
# .gkm/server/dist/server.mjs (bundled output)
```

**Output:**

Handlers are written beside the app — `<app>/.gkm/server/`, or for AWS
`<app>/.gkm/aws/routes/` (one API Gateway v2 handler per endpoint) plus
`functions/`, `crons/`, `queues/` and `subscribers/`. The manifest is the
application's, not an app's: the root `gkm build` builds every backend and
writes it once, at `.gkm/manifest/aws.ts` or `.gkm/manifest/server.ts`; an
app's own build writes none. Every handler path in it is relative to the root
(`apps/api/.gkm/aws/routes/getUser.handler`), because `sst.config.ts` runs
there. `gkm init` adds a root tsconfig alias for it, `@<project>/manifest`.

It exports every declared construct keyed by id, and the backends the build
resolved:

```typescript
export const constructs = {
  Api: {
    id: 'Api',
    kind: 'rest-api',
    path: 'apps/api',
    endpoints: [
      {
        id: 'ApiGET/users',
        method: 'GET',
        path: '/users',
        // On a server, every endpoint's handler is the app entry:
        // 'apps/api/.gkm/server/app.ts'
        handler: 'apps/api/.gkm/aws/routes/getUsers.handler',
        dependencies: [{ target: 'Database', kind: 'database' }],
        authorizer: 'iam',
      },
    ],
  },
  Cleanup: {
    id: 'Cleanup',
    kind: 'cron',
    handler: 'apps/api/.gkm/aws/crons/cleanup.handler',
    schedule: 'rate(1 day)',
    dependencies: [{ target: 'Database', kind: 'database' }],
  },
  // …every other construct: databases, buckets, queues (with their worker),
  // topics (with their subscribers), functions
} as const satisfies ConstructManifest;

export const backends = { cache: 'upstash', email: 'smtp' } as const;

export type Ids = IdsOf<typeof constructs>;
export type Construct<Id extends Ids> = DeclarationOf<typeof constructs, Id>;
export type Kind = Construct<Ids>['kind'];
export type ProvidedKeys = AllProvidedKeys<typeof constructs>;
export type Surfaces = IdsOfKind<typeof constructs, 'rest-api'>;
export type CacheBackend = (typeof backends)['cache'];
export type EmailBackend = (typeof backends)['email'];
```

### Docker

Generate Docker deployment files for production.

```bash
# One Dockerfile per app, each building the app inside Docker
gkm docker

# Generate and build the images
gkm docker --build

# Build and push to registry
gkm docker --build --push --registry ghcr.io/myorg --tag v1.0.0
```

**Options:**

| Option | Description |
|--------|-------------|
| `--build` | Build each image after generating files |
| `--push` | Push the images to the registry after building |
| `--tag <tag>` | Image tag (default: latest) |
| `--registry <url>` | Container registry URL |

**Generated Files:**

```
.gkm/docker/
└── Dockerfile.<app>     # one per app (Dockerfile for an app at the root)
<build root>/.dockerignore
docker-compose.constructs.yml
```

**How an image is built:**

Every image — from `gkm docker`, `gkm compose` and a Dokploy deploy alike —
is built inside Docker, and nothing is built on the host first: `docker build`
on a clean checkout is all it takes.

1. **The build root is the context.** It is the directory holding the lockfile
   or `pnpm-workspace.yaml`, at or above the gkm workspace: the workspace's own
   root in a project of its own, the monorepo's root for a workspace nested in
   one. Build from there: `docker build -f <path>/.gkm/docker/Dockerfile.api .`
2. **`turbo prune`** cuts the app's slice of it (a single-package project is
   copied whole), and the image installs the slice's dependencies.
3. **The workspace packages the app depends on are built** in the image, by
   turbo's `^build` — so each needs a `build` script of its own — and then the
   app: `gkm build --provider server --production` for a backend, the
   framework's build for a site. The root's own `build` script is never run: a
   root `build` of `gkm build` would build every app, and the slice holds one.
4. **The runner holds the result only**: `server.mjs` for a backend (plus any
   package the bundle leaves external), Next's standalone server, or a Vite
   site's files served by Caddy.

The package manager is pinned to the build root's `packageManager`, and turbo
to the version the build root resolves. The build root's `.dockerignore` is
created, or completed, so no context holds `node_modules`, `.git`, anything
built on the host, or a stack's env files under `.gkm/compose`. A Dokploy
deploy embeds a backend's encrypted credentials through the `gkm_credentials`
BuildKit secret, never a build arg. A `gkm compose` image embeds none: its
backends read their secrets at runtime from the stack's env files, so one image
runs on every stage.

**Container Best Practices:**

Every image:
- runs as a non-root user, with **tini** as the init process for a Node server
- has a health check: `/health` for a backend, `/` for a site
- is built from a minimal Alpine base image

A Vite site is served by Caddy: Vite's hashed `/assets/*` are cached for a year
(`immutable`), and `index.html` — with every client-side route that falls back
to it — is revalidated on each request (`no-cache`).

### Prepack

Generate Docker files for production deployment — the same files `gkm docker`
writes.

```bash
gkm prepack
gkm prepack --build --push --registry ghcr.io/myorg --tag v1.0.0
```

**Options:**

| Option | Description |
|--------|-------------|
| `--build` | Build each image after generating files |
| `--push` | Push the images to the registry after building |
| `--tag <tag>` | Image tag (default: latest) |
| `--registry <url>` | Container registry URL |

### OpenAPI

Generate OpenAPI specification from endpoint definitions.

```bash
gkm openapi --source "./src/endpoints/**/*.ts" --output api-docs.json
```

**Options:**

| Option | Description |
|--------|-------------|
| `--source` | Glob pattern for endpoint files |
| `--output` | Output file path |
| `--title` | API title |
| `--version` | API version |
| `--description` | API description |

### Dev Server

Start a development server with hot reload.

```bash
gkm dev --source "./src/endpoints/**/*.ts" --port 3000
```

**Options:**

| Option | Description |
|--------|-------------|
| `--source` | Glob pattern for endpoint files |
| `--port` | Server port (default: 3000) |
| `--no-subscribers` | Run no topic subscribers — nothing is subscribed, polled or pushed to. Queue consumers still run |

**Features:**
- Hot reload on file changes
- Telescope JSON API at `/__telescope/api`, and the declared database's read-only JSON API at `/__gkm/db`
- **Automatic OpenAPI generation** on startup and file changes (when enabled in config)
- **Dynamic Docker port resolution** — automatically avoids port conflicts between projects
- **Automatic subscriber startup** — discovers and starts topic subscribers and queue consumers

#### Subscribers and Queues

When running `gkm dev`, every topic subscriber and queue consumer the app's
workers declare is discovered and started on server startup, from generated
`setupSubscribers()` and `setupQueues()` functions. Fan-out is the default;
`gkm dev --no-subscribers` (which sets `GKM_SUBSCRIBERS=off`) runs no topic
subscribers, while queues still run.

There is no shared subscriber connection string. Each consumer reaches the
thing it consumes through that thing's own `<ID>_PUBLISHER_CONNECTION_STRING` —
a queue's consumer its queue's, a subscriber the string of the topic it is
bound to — the same string the producers publish on. The server that runs the
workers is handed every topic's and queue's string.

How a message arrives depends on the transport in that string:

| Consumer | Transport | Delivery |
|----------|-----------|----------|
| Queue | any | **Polled**, on the queue's own address — SQS cannot push |
| Topic subscriber | `sns://` | **Pushed** over HTTP by SNS |
| Topic subscriber | `pgboss://`, `rabbitmq://` | **Polled** |

**Pushed (SNS).** Each subscriber gets a route on the server,
`POST /__gkm/subscribers/<exportName>`. Once the server is listening, the route
is subscribed to the topic with a filter policy on the `type` message attribute
listing the events from `.subscribe([...])` — SNS does the fan-out, one
subscription per subscriber. The route runs the subscriber through the same
`AWSLambdaSubscriber` adaptor a Lambda subscription does, handed the
notification as an SNS Lambda event. Subscription confirmations are confirmed
automatically, and every message's signature is verified against a certificate
served over https from `sns.<region>.amazonaws.com` — except against an
emulator, which signs nothing (decided by the `endpoint` in the connection
string, never by the request). Startup converges: a subscription stuck pending
confirmation is replaced, and a confirmed one whose event list changed has its
filter updated.

`GKM_SUBSCRIBER_PUSH_URL` is the public base URL SNS pushes to. Against the
local emulator it defaults to `http://host.docker.internal:<port>`; anywhere
else it must be set, or the subscriber is not subscribed.

**Polled (pg-boss).** A topic's messages are published as the pg-boss event
`<topic>/<type>`, and each subscriber drains a queue of its own,
`<topic>/<subscriberExportName>`, bound to the events it names. Every
subscriber sees every message; replicas of one subscriber share its queue and
compete. A queue stays a work queue named by the queue.

A failure is retried on every path: a pushed subscriber that throws answers
500, which makes SNS retry, and a polled subscriber or a queue consumer that
throws leaves the message with the transport for another attempt.

::: tip
Deployed on AWS Lambda nothing changes: SNS invokes each subscriber's function,
and a queue's consumer is its SQS event source. The push route is how a
server-hosted worker consumes an SNS topic. Tests (`gkm test`, `featureTest`)
record publishes rather than deliver them.
:::

### Test

Run tests with secrets loaded from the specified stage.

```bash
# Run tests with development secrets
gkm test

# Run tests once (no watch mode)
gkm test --run

# Run tests with coverage
gkm test --coverage

# Run tests with specific stage secrets
gkm test --stage staging

# Filter tests by pattern
gkm test users.spec.ts

# Self-provision the stage when none exists (CI)
gkm test --run --auto-setup
```

**Options:**

| Option | Description |
|--------|-------------|
| `--stage <stage>` | Stage to load secrets from (default: development) |
| `--run` | Run tests once without watch mode |
| `--watch` | Enable watch mode |
| `--coverage` | Generate coverage report |
| `--ui` | Open Vitest UI |
| `--auto-setup` | Generate a fresh stage (secrets + key) from `gkm.config.ts` when none exists (also via `GKM_AUTO_SETUP`) |
| `[pattern]` | Pattern to filter tests |

The test command decrypts secrets from `.gkm/secrets/{stage}.json` and injects them as environment variables before running Vitest.

#### Running in CI

A fresh CI checkout has no `.gkm/secrets/{stage}.json` and no encryption key (both `.env` and `.gkm/` are typically gitignored), so `gkm test` has nothing to decrypt. Pass `--auto-setup` (or set `GKM_AUTO_SETUP=1`) to regenerate the stage from the committed `gkm.config.ts`:

```yaml
# GitHub Actions
env:
  GKM_AUTO_SETUP: '1'
steps:
  - run: gkm test --run
```

When no secrets exist for the stage, `gkm test` generates fresh service credentials and a local encryption key, then starts Docker with those values before running Vitest. This is safe for tests because the credentials are ephemeral local service passwords used to bring up the matching containers — nothing real is committed. The behavior is a no-op when secrets already exist and is scoped to `gkm test` only.

### Secrets Management

Manage encrypted secrets for different deployment stages.

```bash
# Initialize secrets for a stage
gkm secrets:init --stage production

# View secrets (masked)
gkm secrets:show --stage dev

# View actual values
gkm secrets:show --stage dev --reveal

# Set a custom secret
gkm secrets:set API_KEY sk-1234567890 --stage production

# Rotate service passwords
gkm secrets:rotate --stage production
gkm secrets:rotate --stage production --service postgres

# Import secrets from JSON
gkm secrets:import secrets.json --stage production
```

**Commands:**

| Command | Description |
|---------|-------------|
| `secrets:init` | Initialize secrets for a stage |
| `secrets:show` | Display secrets for a stage |
| `secrets:set` | Set a custom secret |
| `secrets:rotate` | Rotate service passwords |
| `secrets:import` | Import secrets from JSON file |

**Encryption:**

Secrets are encrypted using AES-256-GCM:
- Encrypted data stored at `.gkm/secrets/{stage}.json`
- Decryption keys stored at `~/.gkm/keys/{namespace}/{project}/{stage}.key`, keyed by the workspace's deploy identity rather than its folder
- Keys are never committed to version control

**Service Credentials:**

When services are configured, the following are auto-generated:
- PostgreSQL: `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, etc.
- Redis: `REDIS_URL`, `REDIS_PASSWORD`, etc.
- RabbitMQ: `RABBITMQ_URL`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`, etc.
- MinIO: `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_ENDPOINT`, etc.
- Mailpit: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM`

**Event Backend Credentials:**

When the project declares a topic or queue, additional credentials are generated for the target's broker:
- **pgboss**: `PGBOSS_DB_HOST`, `PGBOSS_DB_PORT`, `PGBOSS_DB_USER`, `PGBOSS_DB_PASSWORD`, `PGBOSS_DB_NAME`
- **sns**: `AWS_ACCESS_KEY_ID` (LSIA-prefixed), `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_ENDPOINT_URL`
- **rabbitmq**: Uses the RabbitMQ service credentials

Each topic and queue gets its own `<ID>_PUBLISHER_CONNECTION_STRING`, read by
its producers and its consumers. pg-boss and RabbitMQ also get
`EVENT_PUBLISHER_CONNECTION_STRING` — the one broker crons schedule through;
SNS has no single broker address, so it has none.

## Reconcile

`gkm dev`, `gkm test`, and `gkm setup` all call one convergent function.

It reads the `constructs` glob, inspects every export of every matching module,
and builds a manifest. From the manifest it computes the containers a stage
needs, compares that against what is running, and applies the difference:
allocating ports, writing `docker-compose.constructs.yml`, starting containers,
creating databases, roles, schemas, and buckets — and, on the `sns` backend,
each topic and queue on the AWS emulator, whose deterministic ARNs and queue
URLs are what the `sns://` / `sqs://` connection strings are composed from.

```bash
gkm setup    # reconcile only
gkm dev      # reconcile, then serve
gkm test     # reconcile the `test` stage, then run the suite
```

It is safe to run repeatedly because its blast radius is entirely local — this
project's containers and this project's `.gkm/`. It allocates ports, writes
compose, starts containers, and creates roles; it never seeds, resets, or drops.
Nothing it does can reach a cloud.

**One plan serves every stage.** `gkm dev` reconciles `development` and
`gkm test` reconciles `test`; they differ only in what the resources are called,
never in what infrastructure exists — so one container and one role pair serve
both, and two projects can run at once without colliding on a port.

::: info It only runs when there is something to read
Reconcile is reached when at least one app configures a `constructs` glob.
A project without one keeps the hand-written `docker-compose.yml` path.
:::

## Configuration File

Create a `gkm.config.ts` file in your project root:

```typescript
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  stages: { local: 'dev', deployed: ['prod'] },
  // Constructs — one glob, every kind.
  //
  // What reconcile reads to derive the containers this app needs: a declared
  // KyselyDatabase is why a Postgres exists, a declared ObjectStorage is why a
  // MinIO does. A glob per kind could never find them — a resource has no kind
  // to be listed under.
  constructs: './src/constructs/**/*.ts',

  // Route files (glob pattern or array of patterns)
  routes: './src/endpoints/**/*.ts',

  // Environment parser module (named export)
  envParser: './src/config/env#envParser',

  // Logger module (named export)
  logger: './src/config/logger#logger',

  // Telescope request recording (optional)
  telescope: {
    enabled: true,
    path: '/__telescope',
  },

  // OpenAPI generation (optional)
  openapi: {
    enabled: true,
    output: './src/api/openapi.ts',
    title: 'My API',
    version: '1.0.0',
    description: 'API for my application',
  },

  // Docker configuration (optional)
  docker: {
    registry: 'ghcr.io/myorg',
    imageName: 'my-api',
    baseImage: 'node:22-alpine',
    port: 3000,
    compose: {
      services: ['postgres', 'redis'], // Include in docker-compose
    },
  },
});
```

### OpenAPI Configuration

The `openapi` configuration controls automatic OpenAPI specification generation:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable/disable OpenAPI generation |
| `output` | `string` | `./src/api/openapi.ts` | Output file path |
| `json` | `boolean` | `false` | Generate JSON instead of TypeScript |
| `title` | `string` | `API Documentation` | API title |
| `version` | `string` | `1.0.0` | API version |
| `description` | `string` | Auto-generated | API description |

When enabled:
- OpenAPI spec is generated on `gkm dev` startup
- Spec is regenerated automatically when route files change
- TypeScript output includes typed paths and security schemes

**Simple boolean config:**

```typescript
export default defineConfig({
  stages: { local: 'dev', deployed: ['prod'] },
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env#envParser',
  logger: './src/config/logger#logger',
  openapi: true, // Uses defaults: output to ./src/api/openapi.ts
});
```

Then run commands without options:

```bash
gkm build
gkm openapi
gkm dev
```

### Production Configuration

A `--production` server build uses fixed settings: bundled and minified into a
single file, a health check at `/health`, graceful shutdown, no packages left
external, and no OpenAPI spec. The worker's queues, crons and subscribers run
in the same process.

**Production vs Development:**

| Feature | Development | Production |
|---------|-------------|------------|
| Telescope | ✓ | ✗ |
| Database API | ✓ | ✗ |
| WebSocket | ✓ | ✗ |
| Health Check | ✗ | ✓ |
| Graceful Shutdown | ✗ | ✓ |
| Bundled | ✗ | ✓ |

### One handler path

A production server registers each endpoint with the same adaptor `gkm dev`
and a feature test use, so what a handler is given — `auditor`, `db`,
`session`, `services` — and what it sends back — status, headers, cookies —
cannot differ between them. The adaptor reads each endpoint's features once,
when the route is registered, and skips what an endpoint does not use.

Production builds used to generate their own per-"tier" handlers instead.
Each was a hand copy of the adaptor, and each drifted from it: a session left
undefined, an `HttpError` answered 500, `auditor` hard-coded to `undefined`,
cookies a handler set never sent. They are gone.

### Docker Configuration

The `docker` configuration controls Docker file generation:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `registry` | `string` | `''` | Container registry URL |
| `imageName` | `string` | package name | Docker image name |
| `baseImage` | `string` | `node:22-alpine` | Base Docker image |
| `port` | `number` | `3000` | Container port |

There is no `compose` option. `gkm docker` writes `docker-compose.constructs.yml`
from the declared constructs — the same file `gkm dev` uses — and an image pin
or an extra service goes in your own `docker-compose.yml`, merged over it.

#### Dynamic Port Resolution

Generated `docker-compose.yml` files use env var interpolation for host ports (e.g., `${POSTGRES_HOST_PORT:-5432}:5432`). When you run `gkm dev`, these ports are automatically resolved to avoid conflicts with other projects running on the same machine.

**Resolution strategy (per service port):**

1. If the project's own Docker container is already running on a port, reuse it
2. If a port was previously resolved, reuse it from `.gkm/ports.json`
3. If the default port is occupied, find the next available port

**URL rewriting:** When a port is remapped (e.g., postgres on 5433 instead of 5432), the CLI automatically rewrites all related environment variables (`DATABASE_URL`, `REDIS_URL`, etc.) so your app connects to the correct port.

**Custom services:** You can add any service to `docker-compose.yml` using the `${ENV_VAR:-default}:container` pattern, and it will be automatically managed:

```yaml
services:
  pgadmin:
    image: dpage/pgadmin4
    ports:
      - '${PGADMIN_HOST_PORT:-5050}:80'
```

### Server Hooks

Server hooks allow you to customize the Hono application before and after gkm endpoints are registered. This is useful for adding custom routes, middleware, error handlers, and more.

**Configuration:**

```typescript
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  stages: { local: 'dev', deployed: ['prod'] },
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env#envParser',
  logger: './src/config/logger#logger',
  hooks: {
    server: './src/config/hooks', // Path to hooks module
  },
});
```

**Hooks Module:**

Create a hooks file that exports `beforeSetup` and/or `afterSetup` functions:

```typescript
// src/config/hooks.ts
import type { Hono } from 'hono';
import type { Logger } from '@geekmidas/logger';
import type { EnvironmentParser } from '@geekmidas/envkit';
import { cors } from 'hono/cors';

interface HookContext {
  envParser: EnvironmentParser<any>;
  logger: Logger;
}

/**
 * Called AFTER telescope middleware but BEFORE gkm endpoints.
 * Use this for global middleware and custom routes.
 */
export async function beforeSetup(app: Hono, ctx: HookContext) {
  // Add CORS middleware
  app.use('*', cors({
    origin: ['http://localhost:3000'],
    credentials: true,
  }));

  // Add custom health endpoint
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Add webhook endpoints
  app.post('/webhooks/:provider', async (c) => {
    const provider = c.req.param('provider');
    const body = await c.req.json();
    ctx.logger.info({ provider, body }, 'Received webhook');
    return c.json({ received: true, provider });
  });
}

/**
 * Called AFTER gkm endpoints are registered.
 * Use this for error handlers and fallback routes.
 */
export async function afterSetup(app: Hono, ctx: HookContext) {
  // Global error handler
  app.onError((err, c) => {
    ctx.logger.error({ err: err.message }, 'Unhandled error');
    return c.json({ error: 'Internal Server Error' }, 500);
  });

  // Custom 404 handler
  app.notFound((c) => {
    return c.json({
      error: 'Not Found',
      message: `Route ${c.req.method} ${c.req.path} not found`,
    }, 404);
  });
}
```

**Execution Order:**

```
1. Create Hono app
2. Telescope middleware (captures all requests)
3. → beforeSetup() hook
4. Database API at /__gkm/db (if a database is declared)
5. gkm endpoints
6. → afterSetup() hook
```

**Common Use Cases:**

| Hook | Use Case |
|------|----------|
| `beforeSetup` | CORS middleware, request ID injection, custom routes, webhooks |
| `afterSetup` | Error handlers, 404 handlers, catch-all routes |

::: tip
Custom routes added in `beforeSetup` are automatically captured by Telescope since the telescope middleware runs first.
:::

## Workspace Commands

### Deploy

Deploy workspace apps to configured targets.

```bash
# Deploy all apps to production
gkm deploy --stage production

# Deploy specific app
gkm deploy --app api --stage production

# Dry run (preview changes)
gkm deploy --stage production --dry-run

# Skip build (use existing images)
gkm deploy --stage production --skip-build

# Force DNS re-verification
gkm deploy --stage production --force-dns
```

**Options:**

| Option | Description |
|--------|-------------|
| `--stage <stage>` | Deployment stage (required) |
| `--app <name>` | Deploy specific app only |
| `--dry-run` | Preview changes without deploying |
| `--skip-build` | Skip Docker build step |
| `--force-dns` | Force DNS re-verification |

### Login

Authenticate with deployment providers.

```bash
# Login to Dokploy
gkm login --provider dokploy

# Login to Hostinger DNS
gkm login --provider hostinger
```

**Providers:**

| Provider | Credentials |
|----------|-------------|
| `dokploy` | API endpoint + token |
| `hostinger` | API token from hPanel |

::: info Route53 Authentication
Route53 uses the AWS default credential chain. No login command is required. Configure credentials via:
- Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- Shared credentials file (`~/.aws/credentials`)
- AWS profile (set `profile` in DNS config)
- IAM role (EC2, ECS, Lambda)
:::

### State Commands

Manage deployment state across local and remote storage.

```bash
# Show current state
gkm state:show --stage production

# Pull remote state (and its resource records) to local
gkm state:pull --stage production

# Push local state to remote — refused while a deploy holds the stage's lock
gkm state:push --stage production

# Compare local vs remote, resource records included
gkm state:diff --stage production

# Release the lock of a deploy that was killed
gkm state:unlock --stage production
```

**State Contents:**

- Application IDs and service IDs
- Per-app database credentials
- Generated secrets (BETTER_AUTH_SECRET, etc.)
- DNS verification status
- Last deployment timestamp

## Workspace Configuration

For monorepo workspaces, use `defineWorkspace` instead of `defineConfig`:

```typescript
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'my-saas',
  stages: { local: 'dev', deployed: ['prod'] },

  constructs: './constructs/**/*.ts',


  deploy: {
    default: 'dokploy',
    // Each deployed stage's base domain — read by every target, not only
    // Dokploy. The root site answers on it; every other surface on
    // `{subdomain}.{domain}`.
    domains: {
      production: 'myapp.com',
      staging: 'staging.myapp.com',
    },
    // Where every target pushes and pulls the apps' images.
    registry: 'ghcr.io/myorg',
    dokploy: {
      endpoint: 'https://dokploy.myserver.com',
      projectId: 'proj_abc123',
    },
    dns: {
      provider: 'route53',
      domain: 'myapp.com',
      profile: 'production',  // Optional: AWS profile name
    },
  },

  state: {
    provider: 'ssm',
    region: 'us-east-1',
  },
});
```

### App Types

| Type | Description | Key Config |
|------|-------------|------------|
| `backend` | Every `RestApi` | `default`, `logger` |
| `web` | A `StaticSite` | `variant`, `.dependsOn([…])` |
| `mobile` | A `StaticSite` with an Expo variant | `variant: 'expo'` |

There is no `auth` type. An auth server is a `BetterAuth` construct, and it is
a backend like any other.

### Auth Server

[Better Auth](https://better-auth.com) is declared, not configured:

```typescript
// constructs/auth.ts
import { BetterAuth } from '@geekmidas/constructs/auth';
import { database } from './database';

// Its own schema and role in the declared Postgres, rather than a second
// DATABASE_URL nobody can trace to a container.
export const authDb = database.schema<Record<string, never>, 'AuthDb'>('AuthDb');

export const auth = new BetterAuth('Auth', {
  path: 'apps/auth',
  database: authDb,
  basePath: '/api/auth',
});
```

There is no `entry`: the build generates one from the declaration. The routes
are a wildcard, so no glob finds them — which is why the entry has to come from
the construct rather than from discovery.

`requiredEnv: ['DATABASE_URL', 'BETTER_AUTH_SECRET']` is gone too. The first
comes from the declared database and the second is generated and persisted in
state, both of which are below.

**Auto-injected variables during deployment:**

| Variable | Source |
|----------|--------|
| `BETTER_AUTH_URL` | Derived from app hostname |
| `BETTER_AUTH_SECRET` | Generated and persisted in state |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Comma-separated list of frontend URLs |

### Services Configuration

Two halves, and the split is the point: what **exists** is derived from the
constructs an app declares, and what a stage **selects** stays here.

| Key | Status | What it means |
|-----|--------|---------------|
| `db` | derived | Ignored. A declared `KyselyDatabase` is what starts a Postgres and publishes `<NAME>_URL`. |
| `storage` | derived | Ignored. A declared `ObjectStorage` is what starts a MinIO and publishes `<NAME>_URL`. |
| `mail` | selection | `true` (Mailpit locally) or `'ses' \| 'resend' \| 'smtp'` — who delivers it deployed. A declared `Email` is what starts a Mailpit. |
| `cache` | selection | `true`, an image pin, or `'upstash' \| 'elasticache' \| 'db'` — where the cache lives. |
| `events` | selection | `'pgboss' \| 'sns' \| 'rabbitmq'` — which broker carries events. |

Derived keys are **ignored rather than obeyed**, deliberately: a config and a
declaration that disagree is the failure this model exists to remove. Set the
image pin here if you need a specific version; declare the construct to have the
thing at all.

| Container | Default image | Comes from |
|-----------|---------------|------------|
| PostgreSQL | `postgres:18-alpine` (major from the declaration) | a declared database |
| MinIO | `minio/minio:latest` | a declared bucket |
| Mailpit | `axllent/mailpit` | a declared email sender |
| Redis | `redis:8-alpine` | `cache: 'elasticache'` |
| serverless-redis-http | `hiett/serverless-redis-http` | `cache: 'upstash'` (the default) |

### Events Configuration

| Backend | Key | Infrastructure | Environment Variables |
|---------|-----|---------------|----------------------|
| pg-boss | `events: 'pgboss'` | Reuses PostgreSQL (auto-enables `db`) | `<ID>_PUBLISHER_CONNECTION_STRING` per topic/queue, `EVENT_PUBLISHER_CONNECTION_STRING`, `PGBOSS_DB_*` |
| AWS SNS | `events: 'sns'` | AWS emulator container (floci); each topic and queue created on it | `<ID>_PUBLISHER_CONNECTION_STRING` per topic (`sns://`) and queue (`sqs://`) |
| RabbitMQ | `events: 'rabbitmq'` | RabbitMQ container | `<ID>_PUBLISHER_CONNECTION_STRING` per topic/queue, `EVENT_PUBLISHER_CONNECTION_STRING` |

::: tip
**pgboss** is recommended for most projects — it reuses your existing PostgreSQL database with a dedicated `pgboss` user and schema, so there's no extra infrastructure to manage. Use **sns** for AWS-native projects, or **rabbitmq** for high-throughput messaging.
:::

### State Providers

| Provider | Location | Use Case |
|----------|----------|----------|
| `local` (default) | `.gkm/deploy-{stage}.json` | Single developer |
| `ssm` | AWS Parameter Store | Teams, CI/CD |

### DNS Providers

| Provider | Setup |
|----------|-------|
| `route53` | AWS credential chain (or `profile` config) |
| `hostinger` | `gkm login --provider hostinger` |
| `cloudflare` | Coming soon |
| `manual` | Prints required records |
