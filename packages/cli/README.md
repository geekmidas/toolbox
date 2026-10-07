# @geekmidas/cli

A powerful CLI tool for building and managing TypeScript-based backend APIs with serverless deployment support. Generate AWS Lambda handlers, OpenAPI documentation, and server applications from your endpoint definitions.

## Features

- **Project Scaffolding**: Interactive `init` command to bootstrap new projects with templates
- **Multi-Provider Support**: Generate handlers for AWS Lambda (API Gateway v1/v2) and server applications
- **Development Server**: Hot-reload development server with file watching
- **Telescope Integration**: Laravel-style recording of requests, logs and exceptions, served as JSON
- **OpenAPI Generation**: Auto-generate OpenAPI 3.0 specifications from your endpoints
- **Docker Support**: Generate optimized Dockerfiles with multi-stage builds, turbo prune for monorepos
- **Secrets Management**: Secure credential generation, encryption, and stage-based secrets storage
- **Deploy Commands**: One-command deployment to Docker registries and Dokploy with encrypted secrets
- **Authentication**: Store credentials locally for seamless deployment without environment variables
- **Type-Safe Configuration**: Configuration with TypeScript support and validation
- **Endpoint Auto-Discovery**: Automatically find and load endpoints from your codebase
- **Flexible Routing**: Support for glob patterns to discover route files
- **Environment Integration**: Seamless integration with @geekmidas/envkit for configuration
- **Logger Integration**: Built-in logging configuration and integration
- **Monorepo Support**: Optional pnpm workspace monorepo setup with shared packages

## Installation

```bash
npm install @geekmidas/cli
```

### Global Installation

```bash
npm install -g @geekmidas/cli
```

## Quick Start

### Option 1: Use `gkm init` (Recommended)

The fastest way to get started is with the interactive `init` command:

```bash
npx @geekmidas/cli init my-api
```

This will guide you through setting up a new project with your preferred options.

### Option 2: Manual Setup

### 1. Create Configuration

Create a `gkm.config.ts` file in your project root:

```typescript
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  stages: { local: 'dev', deployed: ['prod'] },
  // Glob pattern to find endpoint files
  routes: 'src/routes/**/*.ts',

  // Optional: Functions
  functions: 'src/functions/**/*.ts',

  // Optional: Cron jobs
  crons: 'src/crons/**/*.ts',

  // Optional: Event subscribers
  subscribers: 'src/subscribers/**/*.ts',

  // Environment parser configuration
  envParser: './src/env.ts#envParser',

  // Logger configuration
  logger: './src/logger.ts#logger',

  // Optional: Telescope request recording (enabled by default in dev)
  telescope: {
    enabled: true,
    path: '/__telescope',
  },
});
```

### 2. Set Up Environment Parser

Create `src/env.ts`:

```typescript
import { EnvironmentParser } from '@geekmidas/envkit';

export const envParser = new EnvironmentParser(process.env)
  .create((get) => ({
    database: {
      url: get('DATABASE_URL').string().url(),
    },
    api: {
      port: get('PORT').string().transform(Number).default('3000'),
    },
    aws: {
      region: get('AWS_REGION').string().default('us-east-1'),
    },
  }))
  .parse();
```

### 3. Set Up Logger

Create `src/logger.ts`:

```typescript
import { ConsoleLogger } from '@geekmidas/logger/console';

export const logger = new ConsoleLogger({
  level: process.env.LOG_LEVEL || 'info',
  pretty: process.env.NODE_ENV !== 'production',
});
```

### 4. Create Endpoints

Create endpoint files in `src/routes/`:

```typescript
// src/routes/users.ts
import { api } from '../constructs/api';
import { z } from 'zod';

export const getUsers = api
  .get('/users')
  .output(z.array(z.object({ id: z.string(), name: z.string() })))
  .handle(async () => {
    return [{ id: '1', name: 'John Doe' }];
  });

export const createUser = api
  .post('/users')
  .body(z.object({ name: z.string() }))
  .output(z.object({ id: z.string(), name: z.string() }))
  .handle(async ({ body }) => {
    return { id: '2', name: body.name };
  });
```

### 5. Create Subscribers (Optional)

Declare the topic once, and a worker to run what has no port; a subscriber is
built from the worker and binds to the topic:

```typescript
// src/constructs/topics.ts
import { Topic } from '@geekmidas/constructs/topic';
import { z } from 'zod';

export const users = new Topic('Users', {
  events: {
    'user.created': z.object({ userId: z.string(), email: z.email() }),
    'user.updated': z.object({ userId: z.string() }),
  },
});

// src/constructs/worker.ts
import { Worker } from '@geekmidas/constructs/worker';

export const worker = new Worker('Jobs', { logger });

// src/subscribers/userSubscriber.ts
import { users } from '../constructs/topics';
import { worker } from '../constructs/worker';

export const userCreatedSubscriber = worker
  .topic(users)
  .subscribe(['user.created'])
  .handle(async ({ events, logger }) => {
    for (const event of events) {
      logger.info({ userId: event.payload.userId }, 'Processing user.created event');
      // Process event...
    }
  });
```

An endpoint publishes to the topic with `.event(users, { type: 'user.created',
payload: (user) => ({ userId: user.id, email: user.email }) })`. Declaring the
topic is what puts a broker in the local plan and resolves
`USERS_PUBLISHER_CONNECTION_STRING` for whatever publishes to it.

### 6. Build Handlers

```bash
# Build for where gkm.config.ts deploys (AWS for `deploy: { default: 'sst' }`)
npx gkm build

# Generate server application
npx gkm build --provider server

# Generate OpenAPI TypeScript module
npx gkm openapi --output src/api.ts
```

## CLI Commands

### `gkm init`

Scaffold a new project with interactive prompts.

```bash
gkm init [name] [options]
```

**Arguments:**
- `[name]`: Project name (optional, will prompt if not provided)

**Options:**
- `--template <template>`: Project template (`minimal`, `api`, `serverless`, `worker`)
- `--skip-install`: Skip dependency installation
- `-y, --yes`: Skip prompts, use defaults
- `--monorepo`: Setup as monorepo structure
- `--api-path <path>`: API app path in monorepo (default: `apps/api`)

**Interactive Prompts:**

When run without `--yes`, the command will ask:

1. **Project name** - Name for your project directory
2. **Template** - Choose from available templates:
   - `minimal` - Basic health endpoint
   - `api` - Full API with auth, database, services
   - `serverless` - AWS Lambda handlers
   - `worker` - Background job processing
3. **Telescope** - Include request, exception and log recording (default: yes)
4. **Database** - Include Kysely database support (default: yes)
5. **Logger** - Choose logger implementation:
   - `pino` - Fast JSON logger for production (recommended)
   - `console` - Simple console logger for development
6. **Routes structure** - Choose file organization:
   - `centralized-endpoints` - `src/endpoints/**/*.ts`
   - `centralized-routes` - `src/routes/**/*.ts`
   - `domain-based` - `src/**/routes/*.ts`
7. **Monorepo** - Setup as pnpm workspace monorepo (default: no)
8. **API path** - If monorepo, where to place the API app

**Examples:**

```bash
# Interactive mode
npx @geekmidas/cli init

# With project name
npx @geekmidas/cli init my-api

# Skip prompts with defaults
npx @geekmidas/cli init my-api --yes

# Specific template
npx @geekmidas/cli init my-api --template api

# Monorepo setup
npx @geekmidas/cli init my-project --monorepo --api-path apps/backend

# Skip dependency installation
npx @geekmidas/cli init my-api --skip-install
```

**Generated Structure (Minimal Template):**

```
my-api/
├── src/
│   ├── config/
│   │   ├── env.ts           # Environment configuration
│   │   └── logger.ts        # Logger setup
│   └── endpoints/
│       └── health.ts        # Health check endpoint
├── .env                     # Environment variables
├── .env.example             # Example env file
├── .gitignore
├── gkm.config.ts            # CLI configuration
├── package.json
├── tsconfig.json
└── Dockerfile               # Docker configuration
```

**Generated Structure (Monorepo):**

```
my-project/
├── apps/
│   └── api/
│       ├── src/
│       │   ├── config/
│       │   └── endpoints/
│       ├── gkm.config.ts
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── models/              # Shared types/models
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── package.json             # Root workspace config
├── pnpm-workspace.yaml
├── tsconfig.json            # Base TypeScript config
└── turbo.json               # Turborepo config
```

### `gkm build`

Generate handlers from your endpoints.

```bash
gkm build [options]
```

By default it builds for where the project deploys: `deploy: { default: 'sst' }`
builds for AWS, one Lambda per construct; `dokploy` (the default when nothing
is declared) builds a server.

**Options:**
- `--provider <provider>`: Override the deploy target
  - `aws`: One Lambda handler per construct (API Gateway v2 for endpoints)
  - `server`: Server application with Hono
- `--production`: Generate production-optimized bundle (server provider only)

**Example:**
```bash
# Build for where gkm.config.ts deploys
gkm build

# Generate server application
gkm build --provider server

# Generate production bundle for Docker
gkm build --provider server --production
```

**Production Builds:**

When using `--production` with the server provider, the CLI generates an optimized bundle at `.gkm/server/dist/server.mjs`. This bundle:
- Is minified and tree-shaken for smaller size
- Includes all dependencies (single-file deployment)
- Is what `gkm docker`'s images run — built inside the image, never copied in from the host

### `gkm openapi`

Generate OpenAPI TypeScript module from your endpoints. This is the recommended approach as it provides full type safety and a ready-to-use API client.

```bash
gkm openapi [options]
```

**Options:**
- `--output <path>`: Output file path (default: `openapi.ts`)
- `--json`: Generate legacy JSON format instead of TypeScript module

**Example:**
```bash
# Generate TypeScript module (recommended)
gkm openapi --output src/api.ts

# Generate legacy JSON format
gkm openapi --output docs/api.json --json
```

#### Generated TypeScript Module

The generated TypeScript module includes:

```typescript
// src/api.ts (auto-generated)

// Security schemes defined in your endpoints
export const securitySchemes = {
  jwt: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
} as const;

export type SecuritySchemeId = 'jwt' | 'apiKey';

// Endpoint-to-auth mapping
export const endpointAuth = {
  'GET /users': 'jwt',
  'POST /users': 'jwt',
  'GET /health': null,
} as const;

// TypeScript interfaces for request/response types
export interface GetUsersOutput {
  id: string;
  name: string;
}

// OpenAPI paths interface
export interface paths {
  '/users': {
    get: {
      responses: {
        200: { content: { 'application/json': GetUsersOutput[] } };
      };
    };
  };
}

// Ready-to-use API client factory
export function createApi(options: CreateApiOptions) {
  // ... implementation
}
```

#### Using the Generated Client

```typescript
import { createApi } from './api';

const api = createApi({
  baseURL: 'https://api.example.com',
  authStrategies: {
    jwt: {
      type: 'bearer',
      tokenProvider: async () => localStorage.getItem('token'),
    },
  },
});

// Imperative fetching
const users = await api('GET /users');

// React Query hooks
const { data } = api.useQuery('GET /users');
const mutation = api.useMutation('POST /users');
```

### `gkm docker`

Generate Docker configuration files for containerized deployment.

```bash
gkm docker [options]
```

**Options:**
- `--build`: Build each app's image after generating files
- `--push`: Push the images to the registry after building
- `--tag <tag>`: Image tag (default: `latest`)
- `--registry <url>`: Container registry URL

**Generated Files:**
- `.gkm/docker/Dockerfile.<app>` - one per app (`Dockerfile` for an app at the root)
- `docker-compose.constructs.yml` - the containers the constructs imply, and the apps (project root)
- `.dockerignore` - at the build root, created or completed

**How an image is built:**

Every image is built inside Docker — `docker build` on a clean checkout is all
it takes. The context is the build root (the directory holding the lockfile or
`pnpm-workspace.yaml`, at or above the workspace); `turbo prune` cuts the app's
slice of it; the image installs it, builds the workspace packages the app
depends on, and builds the app (`gkm build --provider server --production` for
a backend, the framework's build for a site). The runner holds `server.mjs`, a
Next.js standalone server, or a Vite site's files served by Caddy.

**Example:**
```bash
# Generate the Dockerfiles
gkm docker

# Generate and build the images
gkm docker --build --tag v1.0.0

# Build and push to registry
gkm docker --build --push --registry ghcr.io/myorg --tag v1.0.0
```

**Package Manager Support:**

The package manager is detected from the lockfile and pinned to the build
root's `packageManager` field; turbo is pinned to the version the build root
resolves. Dependencies install with a BuildKit cache mount for the package
manager's store.

**Configuration:**

Configure Docker settings in `gkm.config.ts`:

```typescript
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  stages: { local: 'dev', deployed: ['prod'] },
  routes: 'src/routes/**/*.ts',
  envParser: './src/env.ts',
  logger: './src/logger.ts',

  docker: {
    // Container registry
    registry: 'ghcr.io/myorg',
    // Image name (defaults to package.json name)
    imageName: 'my-api',
    // Base image (default: node:22-alpine)
    baseImage: 'node:22-alpine',
    // Port to expose (default: 3000)
    port: 3000,
  },
});
```

**Compose:** there is no `compose` option. `gkm docker` writes
`docker-compose.constructs.yml` at the project root from the declared
constructs; an image pin or an extra service goes in your own
`docker-compose.yml`, which is merged over it:

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgis/postgis:16-3.4-alpine
```

**Service Configuration Options:**

| Property | Description |
|----------|-------------|
| `true` | Use default image and version |
| `{ version: string }` | Use default image with custom version/tag |
| `{ image: string }` | Use completely custom image reference |

**Default Images:**

| Service | Default Image | Environment Variables |
|---------|---------------|----------------------|
| `postgres` | `postgres:18-alpine` | `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| `redis` | `redis:7-alpine` | `REDIS_URL` |
| `rabbitmq` | `rabbitmq:3-management-alpine` | `RABBITMQ_URL`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD` |

> **Note:** Use `gkm dev` or `gkm test` to start services. Running `docker compose up` directly will not inject your encrypted secrets or resolve dynamic ports — variables like `${POSTGRES_USER:-postgres}` will fall back to defaults that won't match your project credentials.

### `gkm dev`

Start a development server with hot-reload and optional Telescope recording.

```bash
gkm dev [options]
```

**Options:**
- `--port <port>`: Server port (default: `3000`)

**Features:**
- Hot-reload on file changes (endpoints, functions, crons, subscribers)
- Automatic port switching if requested port is in use
- Telescope JSON API at `/__telescope/api` (enabled by default)
- The declared database, read-only, as JSON at `/__gkm/db`
- Real-time WebSocket updates in Telescope

**Example:**
```bash
# Start development server on port 3000
gkm dev

# Start on custom port
gkm dev --port 8080
```

**Output:**
```
🚀 Starting development server...
Loading routes from: ./src/endpoints/**/*.ts
Loading subscribers from: ./src/subscribers/**/*.ts
Using envParser: ./src/config/env
🔭 Telescope enabled at /__telescope
Generated server with 5 endpoints

✨ Starting server on port 3000...
🔌 Telescope real-time updates enabled

🎉 Server running at http://localhost:3000
🔭 Telescope available at http://localhost:3000/__telescope
👀 Watching for changes in: src/endpoints/**/*.ts, src/subscribers/**/*.ts
```

When files change, the server automatically rebuilds and restarts:
```
📝 File changed: src/endpoints/users.ts
🔄 Rebuilding...
✅ Rebuild complete, restarting server...
```

### `gkm test`

Run tests with full environment injection — secrets, port mappings, and Docker services.

```bash
gkm test [options]
```

**Options:**
- `--stage <stage>`: Stage to load secrets from (default: `development`)
- `--run`: Run tests once without watch mode
- `--watch`: Enable watch mode
- `--coverage`: Generate coverage report
- `--ui`: Open Vitest UI
- `--auto-setup`: Generate a fresh stage (secrets + key) from `gkm.config.ts` when none exists — for CI (also via `GKM_AUTO_SETUP`)
- `--pattern <pattern>`: Pattern to filter tests

**What it does:**

1. Loads and decrypts secrets from the specified stage
2. Starts Docker Compose services (postgres, redis, etc.) with secrets injected
3. Resolves dynamic host ports and rewrites URLs (`@postgres:5432` → `@localhost:5434`)
4. Appends `_test` suffix to all `DATABASE_URL` values
5. Creates a credentials preload so `Credentials` from `@geekmidas/envkit` is populated
6. Spawns Vitest with the full environment

**Example:**
```bash
# Run tests in watch mode
gkm test

# Run tests once
gkm test --run

# Run with coverage
gkm test --coverage
```

> **Why not `docker compose up` directly?**
>
> `gkm dev` and `gkm test` decrypt your secrets and pass them as environment variables to `docker compose up`, ensuring credentials and ports are consistent. Running `docker compose up` directly skips this — variables like `${POSTGRES_USER:-postgres}` fall back to defaults that won't match your project credentials.

> **Running in CI:**
>
> A fresh CI checkout has no `.gkm/secrets/{stage}.json` and no encryption key (`.env` and `.gkm/` are typically gitignored), so there's nothing to decrypt. Pass `--auto-setup` (or set `GKM_AUTO_SETUP=1`) to regenerate the stage from the committed `gkm.config.ts`:
>
> ```yaml
> env:
>   GKM_AUTO_SETUP: '1'
> steps:
>   - run: gkm test --run
> ```
>
> When no secrets exist for the stage, `gkm test` generates fresh service credentials and a local key, then starts Docker with those values. This is safe for tests — the credentials are ephemeral local service passwords used to bring up the matching containers, so nothing real is committed. It's a no-op when secrets already exist and is scoped to `gkm test` only.

### `gkm secrets:init`

Initialize secrets for a deployment stage. Generates secure random passwords for configured Docker Compose services.

```bash
gkm secrets:init --stage <stage> [options]
```

**Options:**
- `--stage <stage>`: Stage name (e.g., `production`, `staging`)
- `--force`: Overwrite existing secrets

**Example:**
```bash
# Initialize production secrets
gkm secrets:init --stage production

# Overwrite existing secrets
gkm secrets:init --stage production --force
```

**Generated:**
- Custom secrets for the stage; the containers' credentials are provisioned by
  reconcile from the declared constructs, not stored here
- Stored in `.gkm/secrets/<stage>.json` (gitignored)

### `gkm secrets:set`

Set a custom secret for a stage.

```bash
gkm secrets:set <key> [value] --stage <stage>
```

**Arguments:**
- `<key>`: Secret key (e.g., `API_KEY`, `STRIPE_SECRET`)
- `[value]`: Secret value (optional - reads from stdin if omitted)

**Options:**
- `--stage <stage>`: Stage name

**Examples:**
```bash
# Direct value
gkm secrets:set API_KEY sk_live_xxx --stage production

# From stdin (pipe)
echo "sk_live_xxx" | gkm secrets:set API_KEY --stage production

# From file (for multiline secrets like private keys)
gkm secrets:set PRIVATE_KEY --stage production < private_key.pem

# From command output
openssl rand -base64 32 | gkm secrets:set JWT_SECRET --stage production
```

### `gkm secrets:import`

Import multiple secrets from a JSON file.

```bash
gkm secrets:import <file> --stage <stage> [options]
```

**Arguments:**
- `<file>`: Path to JSON file with key-value pairs

**Options:**
- `--stage <stage>`: Stage name
- `--no-merge`: Replace all custom secrets instead of merging

**JSON Format:**
```json
{
  "API_KEY": "sk_live_xxx",
  "STRIPE_WEBHOOK_SECRET": "whsec_xxx",
  "SENDGRID_API_KEY": "SG.xxx"
}
```

**Examples:**
```bash
# Import and merge with existing secrets (default)
gkm secrets:import secrets.json --stage production

# Replace all custom secrets
gkm secrets:import secrets.json --stage production --no-merge
```

### `gkm secrets:show`

Display secrets for a stage (passwords masked by default).

```bash
gkm secrets:show --stage <stage> [options]
```

**Options:**
- `--stage <stage>`: Stage name
- `--reveal`: Show actual secret values (not masked)

**Example:**
```bash
# Show masked secrets
gkm secrets:show --stage production

# Show actual values
gkm secrets:show --stage production --reveal
```

### `gkm secrets:rotate`

Rotate passwords for services.

```bash
gkm secrets:rotate --stage <stage> [options]
```

**Options:**
- `--stage <stage>`: Stage name
- `--service <service>`: Specific service to rotate (`postgres`, `redis`, `rabbitmq`)

**Examples:**
```bash
# Rotate all service passwords
gkm secrets:rotate --stage production

# Rotate only postgres password
gkm secrets:rotate --stage production --service postgres
```

## Authentication

Store credentials locally to avoid setting environment variables for every command.

### `gkm login`

Authenticate with a deployment service. Credentials are stored in `~/.gkm/credentials.json` (`$GKM_HOME/credentials.json` when `GKM_HOME` is set).

```bash
gkm login [options]
```

**Options:**
- `--service <service>`: Service to login to (`dokploy`) - default: `dokploy`
- `--token <token>`: API token (will prompt interactively if not provided)
- `--endpoint <url>`: Service endpoint URL (will prompt if not provided)

**Examples:**
```bash
# Interactive login (prompts for endpoint and token)
gkm login

# Non-interactive login
gkm login --endpoint https://dokploy.example.com --token your-api-token

# Login with just endpoint (prompts for token)
gkm login --endpoint https://dokploy.example.com
```

**After logging in:**
```bash
# These commands no longer need DOKPLOY_API_TOKEN
gkm deploy:list
gkm deploy:init --project my-project --app api
gkm deploy --stage production
```

### `gkm logout`

Remove stored credentials.

```bash
gkm logout [options]
```

**Options:**
- `--service <service>`: Service to logout from (`dokploy`, `all`) - default: `dokploy`

**Examples:**
```bash
# Logout from Dokploy
gkm logout

# Logout from all services
gkm logout --service all
```

### `gkm whoami`

Show current authentication status.

```bash
gkm whoami
```

**Example output:**
```
📋 Current credentials:

  Dokploy:
    Endpoint: https://dokploy.example.com
    Token: abc1...xyz9

  Credentials file: /Users/you/.gkm/credentials.json
```

## Deployment

### `gkm deploy`

Deploy a stage through its **target**: `deploy.default` in `gkm.config.ts`
(`dokploy` when unset), or `--target` for one run. `dokploy`, `compose` and
`sst` ship with the CLI; any other target is a package the project installs and
names in `deploy.targets`.

```bash
gkm deploy --stage <stage> [options]
```

**Options:**
- `--stage <stage>`: Deployment stage (required): one of `stages.deployed`, or the local stage through `compose`
- `--target <name>`: `dokploy`, `compose`, `sst`, or a name in `deploy.targets` (default: `deploy.default`)
- `--tag <tag>`: Image tag (default: `<stage>-<timestamp>`; compose: the commit). Through compose, a given tag is pulled
- `--json`: Write the deploy's events as JSON lines on stdout instead of progress; never prompts
- `--dry-run`: Show what would be created or reused, and change, build and push nothing
- `--atomic`: If the release fails, roll back every app it released, not only the ones that failed
- `--provider <provider>`: Deprecated. `dokploy` means `--target dokploy`; `docker` and `aws-lambda` fail with `ProviderRemoved`
- `--skip-push`, `--skip-build`: Deprecated and ignored

**Examples:**
```bash
# deploy.default (dokploy unless configured otherwise)
DOKPLOY_API_TOKEN=xxx gkm deploy --stage production

# Plan only
gkm deploy --stage production --dry-run

# One Docker Compose stack behind Caddy, on this machine, from images CI pushed
gkm deploy --target compose --stage production --tag v1.4.0

# AWS, with deploy: { default: 'sst' }: gkm build --provider aws, then sst deploy
AWS_PROFILE=acme-prod gkm deploy --stage production

# Events for another program
gkm deploy --stage production --json | jq -c 'select(.type == "app.deployed")'
```

**What every deploy does:** loads the config and discovers the constructs in a
sandbox, takes the stage's lock (a second run gets `StateLocked`; a crashed
run's lock is released with `gkm state:unlock`), checks every credential and
secret before anything changes, then runs the target's phases
(`provision`, `build`, `release`, `verify`) and reports each as events.

**Verified, or rolled back (Dokploy).** An app counts as released once Dokploy's deployment has finished and the app has answered its health route 2xx three times in a row (`/health` for a backend, `/` for a site; an app without a domain gets the deployment check only). Backends are released and checked before any site is released, and a failed backend stops the run. Whatever fails is pointed back at the image it ran before. Pending migrations are applied before any app is switched, in the deploy's sandbox, with each database URL handed over as a secret file. Tune the checks with `deploy.dokploy.verify: { deploymentTimeoutMs, healthCheckPath, healthyAfter, intervalMs, healthTimeoutMs }`.

At a terminal a missing Dokploy or registry login is asked for (and the Dokploy one stored). With `--json` or without a terminal nothing is asked: the deploy stops with `MissingCredential` and exits 1.

**From a program:** the same deploy is `deploy()` from `@geekmidas/cli/deploy` — explicit `cwd`, an injected `CredentialProvider`, a logger and an `AbortSignal`; it returns a run you iterate for JSON events, plus a `result` promise. It never prompts, prints or exits.

```typescript
import { deploy } from '@geekmidas/cli/deploy';

const run = deploy({ cwd: '/srv/shop', stage: 'production', signal });
for await (const event of run) console.log(event.type);
const result = await run.result;
```

The project's own code — loading `gkm.config.ts`, discovering constructs, sniffing each app's environment, running migrations — runs in a `Sandbox`, never in the host process and never with the deploy's credentials. The default `LocalSandbox` is a child process with an allowlisted environment and a timeout per step; a host building repositories it does not trust passes its own isolating one (`sandbox`), and a config holding live objects then fails with `ConfigObjectNotSerializable`.

**Writing a target:** `defineTarget` from `@geekmidas/cli/target`, with the package's runtime declared in its `package.json` (`"gkm": { "runtime": "server" }`).

**Environment Variables:**
- `DOKPLOY_API_TOKEN`: API token for Dokploy (not needed if logged in via `gkm login`)
- `DOKPLOY_ENDPOINT`: Dokploy URL, if neither the stored login nor `deploy.dokploy.endpoint` gives one
- `DOCKER_REGISTRY_USERNAME` / `DOCKER_REGISTRY_PASSWORD`: a registry login, used only when Dokploy has no registry for `deploy.registry` and one has to be created
- `AWS_PROFILE`, or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`: the `sst` target's AWS credentials, handed to `sst deploy` only (the profile wins when both are set)
- `GKM_HOME`: where stage keys and stored logins live (default `~/.gkm`)
- `GKM_MASTER_KEY`: set in each container's runtime environment by the deploy; for an image you run yourself, from `.gkm/server/master.key`, which `gkm build --stage` writes (the key is never printed; output shows its fingerprint)

**Guides:**
[Deploy targets](https://geekmidas.github.io/toolbox/next/guide/deploy-targets) ·
[Writing a target](https://geekmidas.github.io/toolbox/next/guide/writing-a-target) ·
[Deploying from a program](https://geekmidas.github.io/toolbox/next/guide/deploy-api) ·
[The sandbox](https://geekmidas.github.io/toolbox/next/guide/sandbox) ·
[Deploy state](https://geekmidas.github.io/toolbox/next/guide/state) ·
[Running in production](https://geekmidas.github.io/toolbox/next/guide/production) ·
[Upgrading to 10.0.0-alpha](https://geekmidas.github.io/toolbox/next/guide/upgrading) ·
[Deprecated deploy APIs](https://geekmidas.github.io/toolbox/next/guide/deploy-deprecations)

### `gkm deploy:rollback`

Put a stage's app back on the release before the one it runs (Dokploy). One app by default; `--atomic` rolls back every app that has an earlier release, for apps that only work together. It restores images only: migrations are forward-only.

```bash
gkm deploy:rollback --stage production --app api
gkm deploy:rollback --stage production --atomic
```

From a program: `rollbackStage({ cwd, stage, app })` from `@geekmidas/cli/deploy`.

### `gkm deploy:init`

Initialize a new Dokploy deployment by creating a project and application via the Dokploy API. Nothing is written to `gkm.config.ts`: the ids are rediscovered by name on each run and kept in the deploy state file.

```bash
gkm deploy:init --project <name> --app <name> [options]
```

**Options:**
- `--endpoint <url>`: Dokploy server URL (uses stored credentials if logged in)
- `--project <name>`: Project name (creates if not exists)
- `--app <name>`: Application name to create
- `--project-id <id>`: Use existing project ID instead of finding/creating
- `--registry-id <id>`: Configure a registry for the application

**Examples:**
```bash
# After gkm login (no endpoint needed)
gkm deploy:init --project my-project --app api

# With explicit endpoint (or if not logged in)
gkm deploy:init \
  --endpoint https://dokploy.example.com \
  --project my-project \
  --app api

# With registry configuration
gkm deploy:init \
  --project my-project \
  --app api \
  --registry-id reg_xyz789
```

**What it does:**
1. Searches for existing project by name, or creates a new one
2. Creates a new application in the project
3. Configures registry if `--registry-id` is provided
4. Shows next steps for secrets and deployment

### `gkm deploy:list`

List available Dokploy resources (projects and registries).

```bash
gkm deploy:list [options]
```

**Options:**
- `--endpoint <url>`: Dokploy server URL (uses stored credentials if logged in)
- `--projects`: List projects only
- `--registries`: List registries only

**Examples:**
```bash
# After gkm login (no endpoint needed)
gkm deploy:list
gkm deploy:list --projects
gkm deploy:list --registries

# With explicit endpoint
gkm deploy:list --endpoint https://dokploy.example.com
```

### `gkm state:*`

Deploy state records what a stage's deploys created, so the next deploy finds
it again. It lives where `state` in `gkm.config.ts` says: `.gkm/deploy-<stage>.json`
by default, or SSM (`{ provider: 'ssm', region }`) or S3
(`{ provider: 's3', bucket, region }`) for teams and CI. Every deploy holds the
stage's lock and writes conditionally.

```bash
gkm state:show   --stage production [--json]  # ids, releases, pending resources; secrets masked
gkm state:pull   --stage production           # remote → .gkm/
gkm state:push   --stage production           # .gkm/ → remote, under the remote lock
gkm state:diff   --stage production
gkm state:unlock --stage production           # release a crashed deploy's lock
```

See [Deploy state](https://geekmidas.github.io/toolbox/next/guide/state).

### Using Encrypted Credentials

After deploying with secrets, your application decrypts credentials at runtime:

```typescript
// src/env.ts
import { EnvironmentParser } from '@geekmidas/envkit';
import { Credentials } from '@geekmidas/envkit/credentials';

export const envParser = new EnvironmentParser({...process.env, ...Credentials})
  .create((get) => ({
    database: {
      url: get('DATABASE_URL').string(),
    },
    stripe: {
      key: get('STRIPE_KEY').string(),
    },
  }))
  .parse();
```

**How it works:**
- At build time, secrets are encrypted with AES-256-GCM and embedded in the bundle
- An ephemeral master key is generated per build and written to `.gkm/server/master.key` (mode `0600`); the build prints its path and fingerprint, never the key
- At runtime, `Credentials` decrypts using `GKM_MASTER_KEY` environment variable
- In development (no embedded secrets), `Credentials` returns `{}`

### Future Commands

The following commands are planned for future releases:

- `gkm cron`: Manage cron jobs
- `gkm function`: Manage serverless functions
- `gkm api`: Manage REST API endpoints

## Configuration

### Configuration File

The `gkm.config.ts` file defines how the CLI discovers and processes your endpoints:

```typescript
// Construct types accept a glob string or an array of them
type Routes = string | string[];

interface GkmConfig {
  routes: Routes;                // Glob patterns
  envParser: string;             // Path to environment parser
  logger: string;                // Path to logger configuration
  functions?: Routes;            // Glob patterns
  crons?: Routes;                // Glob patterns
  subscribers?: Routes;          // Glob patterns
  runtime?: 'node' | 'bun';     // Runtime environment (default: 'node')
  telescope?: boolean | TelescopeConfig; // Telescope debugging config
}

interface TelescopeConfig {
  enabled?: boolean;       // Enable/disable (default: true in dev)
  path?: string;           // Where the JSON API is mounted (default: '/__telescope')
  ignore?: string[];       // URL patterns to ignore
  recordBody?: boolean;    // Record request/response bodies (default: true)
  maxEntries?: number;     // Max entries to keep (default: 1000)
  websocket?: boolean;     // Enable real-time updates (default: true)
}
```

### Configuration Options

#### `routes`

Glob pattern(s) to discover endpoint files. Can be a single pattern or an array of patterns:

```typescript
// Single pattern
routes: 'src/routes/**/*.ts'

// Multiple patterns
routes: [
  'src/routes/**/*.ts',
  'src/api/**/*.ts',
  'src/handlers/**/*.ts'
]
```

#### `envParser`

Path to your environment parser configuration. Supports both default and named exports.

```typescript
// Default export
envParser: './src/env.ts'

// Named export
envParser: './src/env.ts#envParser'

// Renamed export
envParser: './src/config.ts#environmentConfig'
```

#### `logger`

Path to your logger configuration. Supports both default and named exports.

```typescript
// Default export
logger: './src/logger.ts'

// Named export
logger: './src/logger.ts#logger'

// Renamed export
logger: './src/utils.ts#appLogger'
```

#### `telescope`

Configuration for Telescope, which records requests, logs and exceptions and serves them as JSON. Telescope is enabled by default when using `gkm dev`.

```typescript
// Disable telescope
telescope: false

// Enable with defaults
telescope: true

// Custom configuration
telescope: {
  enabled: true,
  path: '/__telescope',
  ignore: ['/health', '/metrics'],
  recordBody: true,
  maxEntries: 1000,
  websocket: true,
}
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable Telescope |
| `path` | `string` | `/__telescope` | Where the JSON API is mounted |
| `ignore` | `string[]` | `[]` | URL patterns to exclude from recording |
| `recordBody` | `boolean` | `true` | Record request/response bodies |
| `maxEntries` | `number` | `1000` | Maximum entries per type to keep |
| `websocket` | `boolean` | `true` | Enable real-time WebSocket updates |

**Logger Integration:**

Telescope automatically captures logs when using `gkm dev`. To manually integrate with your logger:

```typescript
// Pino Transport
import pino from 'pino';
import { createPinoDestination } from '@geekmidas/telescope/logger/pino';

const logger = pino(
  { level: 'debug' },
  pino.multistream([
    { stream: process.stdout },
    { stream: createPinoDestination({ telescope }) }
  ])
);

// ConsoleLogger wrapper
import { createTelescopeLogger } from '@geekmidas/telescope/logger/console';
import { ConsoleLogger } from '@geekmidas/logger/console';

const logger = createTelescopeLogger(telescope, new ConsoleLogger());
```

See the [@geekmidas/telescope documentation](../telescope/README.md) for more details.

## Workspace Configuration

For fullstack monorepo projects with multiple apps, use `defineWorkspace` instead of `defineConfig`:

```typescript
// gkm.config.ts (at workspace root)
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'my-project',
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: './constructs/**/*.ts',
  shared: {
    packages: ['packages/*'],
    models: {
      path: 'packages/models',
      schema: 'zod',
    },
  },
  deploy: {
    default: 'dokploy',
  },
});
```

### Where Apps Come From

Each one is a construct that said it has a process of its own. The CLI reads
them out of the manifest; none of them is listed in config.

#### A Surface With Discovered Routes

```typescript
// constructs/api.ts
export const api = new RestApi('Api', { path: 'apps/api', defaultAuthorizer: 'none', logger });
```

`gkm build --provider server` generates a Hono server from the endpoints built
on that surface. Where they are is the conventional directories under
`apps/api`, which is what the id resolves to.

#### A Surface That Declares Its Own Routes

An auth server mounts a wildcard, so there is nothing for a glob to find:

```typescript
// constructs/auth.ts
export const auth = new BetterAuth('Auth', {
  path: 'apps/auth',
  database: authDb,
  basePath: '/api/auth',
});
```

The build generates the entry from the declaration — a file that imports the
construct and starts it. There is no hand-written `src/index.ts`, and no
`entry` field pointing at one.

It gets a container like every other surface, and nothing opts it in. Two
surfaces in one process share a filesystem, an environment and every credential
either was granted, so an auth server beside an API is one bug in the API away
from being read by it.

#### Frontends

```typescript
// constructs/site.ts
export const web = new StaticSite('Web', { path: 'apps/web' }).dependsOn([api, auth]);
export const admin = new StaticSite('Admin', { path: 'apps/admin', variant: 'next' }).dependsOn([api]);
```

`.dependsOn()` is the single fact behind four things that are hand-maintained
otherwise: the site's build-time `VITE_API_URL`, the API's CORS origins, the
auth server's trusted origins, and which generated client lands in which app.

### Workspace Docker Generation

When running `gkm docker` in a workspace, the CLI generates optimized Dockerfiles for each app:

```bash
gkm docker
```

**Generated files:**
- `.gkm/docker/Dockerfile.api` - Routes-based backend (uses `gkm build`)
- `.gkm/docker/Dockerfile.auth` - Entry-based backend (uses esbuild bundling)
- `.gkm/docker/Dockerfile.web` - Next.js standalone output
- `docker-compose.constructs.yml` - every container the constructs imply, and each app behind the `apps` profile (project root)
- `.dockerignore` - Optimized ignore patterns

**Dockerfile types by app:**

| App Type | Build Method | Output |
|----------|--------------|--------|
| `routes` backend | `gkm build --provider server` | `.gkm/server/dist/server.mjs` |
| `entry` backend | `esbuild --bundle --packages=bundle` | `dist/index.mjs` |
| `nextjs` frontend | `next build` (standalone) | `.next/standalone` |

**Entry-based bundling:**

Entry-based apps use esbuild with full dependency bundling:

```bash
npx esbuild ./src/index.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --format=esm \
  --outfile=dist/index.mjs \
  --packages=bundle \
  --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);'
```

The `--packages=bundle` flag bundles all dependencies (unlike tsdown's default behavior). The banner adds CommonJS compatibility for packages that use `require()` internally.

### Workspace Interface

```typescript
interface WorkspaceConfig {
  /** The scope every physical name is built from. */
  name: string;
  /** One glob, every kind. The apps come from what it finds. */
  constructs: string;
  shared?: {
    packages?: string[];
    models?: {
      path: string;
      schema: 'zod' | 'valibot';
    };
  };
  /**
   * Backend selection, and nothing else. Whether a Postgres exists comes from
   * declaring a database, so `db` and `storage` are ignored rather than obeyed.
   */
  services?: {
    cache?: 'db' | 'upstash' | 'elasticache';
    storage?: 'minio' | 's3' | 'r2';
    mail?: 'ses' | 'resend' | 'smtp';
    events?: 'pgboss' | 'sns' | 'rabbitmq';
  };
  deploy?: {
    default?: 'dokploy' | 'docker' | 'aws';
  };
  /**
   * Overrides for an app the manifest already derived, keyed by its name.
   * The exception, not the shape — a workspace normally has none.
   */
  apps?: Record<string, Partial<AppConfig>>;
}
```

What an app is comes from the declaration, not from here:

```typescript
/** How a site is built and run. A surface declares only its `path`. */
interface AppSpec {
  /** Required: where the app lives, relative to the workspace root. */
  path: string;
  /** Default: assigned in a stable order, so adding an app renumbers nothing. */
  port?: number;
  entry?: string;
  runtime?: 'node' | 'bun';
}
```

## Build Targets

### AWS

Generates one Lambda handler per construct. Endpoints get an API Gateway v2
(HTTP API) adapter.

```bash
gkm build                  # with deploy: { default: 'sst' }
gkm build --provider aws   # whatever the deploy target
```

**Generated Handler:**
```typescript
import { AmazonApiGatewayV2Endpoint } from '@geekmidas/constructs/aws';
import { myEndpoint } from '../../../src/routes/example.js';

const adapter = new AmazonApiGatewayV2Endpoint(myEndpoint);

export const handler = adapter.handler;
```

### Server

Generates a server application using Hono that can be deployed to any Node.js environment.

```bash
gkm build --provider server
```

**Generated Server:**
```typescript
import { HonoEndpoint } from '@geekmidas/constructs/endpoints';
import { ServiceDiscovery } from '@geekmidas/services';
import { Hono } from 'hono';
import { envParser } from '../src/env.js';
import { logger } from '../src/logger.js';
import { getUsers, createUser } from '../src/routes/users.js';

export function createApp(app?: Hono): Hono {
  const honoApp = app || new Hono();

  const endpoints = [getUsers, createUser];

  const serviceDiscovery = ServiceDiscovery.getInstance(
    logger,
    envParser
  );

  HonoEndpoint.addRoutes(endpoints, serviceDiscovery, honoApp);

  return honoApp;
}

export default createApp;
```

## Output Structure

Handlers are generated beside the app, in `<app>/.gkm/<target>`; the manifest
at the workspace root, where `sst.config.ts` runs:

```
<root>/
├── .gkm/manifest/
│   ├── aws.ts                   # AWS manifest with types
│   └── server.ts                # Server manifest with types
└── apps/api/.gkm/
    ├── aws/
    │   ├── routes/getUsers.ts   # One Lambda handler per endpoint
    │   ├── functions/
    │   ├── crons/
    │   ├── queues/
    │   └── subscribers/
    └── server/
        ├── app.ts               # Server application
        └── endpoints.ts         # Endpoint exports
```

### Build Manifest

The manifest is the application's, not an app's: the root `gkm build` builds
every backend and writes it once, to `.gkm/manifest/aws.ts` or
`.gkm/manifest/server.ts` at the workspace root. An app's own build writes no
manifest. Every handler path in it is relative to the workspace root. `gkm init`
adds a root tsconfig alias for the manifest, `@<project>/manifest`.

It exports two values — every declared construct keyed by id, and the backends
the build resolved — and the types derived from them:

```typescript
export const constructs = {
  Database: { id: 'Database', kind: 'database' },
  Api: {
    id: 'Api',
    kind: 'rest-api',
    path: 'apps/api',
    endpoints: [
      {
        id: 'ApiGET/users',
        method: 'GET',
        path: '/users',
        handler: 'apps/api/.gkm/aws/routes/getUsers.handler',
        dependencies: [{ target: 'Database', kind: 'database' }],
        authorizer: 'iam',
      },
    ],
  },
  ProcessData: {
    id: 'ProcessData',
    kind: 'function',
    handler: 'apps/api/.gkm/aws/functions/processData.handler',
    dependencies: [],
  },
  DailyCleanup: {
    id: 'DailyCleanup',
    kind: 'cron',
    handler: 'apps/api/.gkm/aws/crons/dailyCleanup.handler',
    schedule: 'rate(1 day)',
    dependencies: [{ target: 'Database', kind: 'database' }],
  },
  Emails: {
    id: 'Emails',
    kind: 'queue',
    // The queue's consumer is nested in it
    worker: {
      id: 'emails',
      handler: 'apps/api/.gkm/aws/queues/emails.handler',
      dependencies: [],
    },
  },
  Users: {
    id: 'Users',
    kind: 'topic',
    events: ['user.created'],
    // As are a topic's subscribers
    subscribers: [
      {
        id: 'onUser',
        handler: 'apps/api/.gkm/aws/subscribers/onUser.handler',
        events: ['user.created'],
        dependencies: [],
      },
    ],
  },
} as const satisfies ConstructManifest;

export const backends = { cache: 'upstash', email: 'ses' } as const;

// Derived types
export type Ids = IdsOf<typeof constructs>;
export type Construct<Id extends Ids> = DeclarationOf<typeof constructs, Id>;
export type Kind = Construct<Ids>['kind'];

// Useful union types
export type ProvidedKeys = AllProvidedKeys<typeof constructs>;
export type Surfaces = IdsOfKind<typeof constructs, 'rest-api'>;
export type CacheBackend = (typeof backends)['cache'];
export type EmailBackend = (typeof backends)['email'];
```

A `RestApi` carries its endpoints, each with its method, path, handler, the
dependencies it declared and its authorizer. On AWS the handler is the
endpoint's own Lambda (`apps/api/.gkm/aws/routes/<export>.handler`); in the
server manifest every endpoint's handler is the app entry
(`apps/api/.gkm/server/app.ts`). Functions and crons are top-level
declarations; a queue's worker and a topic's subscribers are nested in the
queue or topic.

#### Using the Manifest

On AWS, `fromManifest` from `@geekmidas/cloud/sst` provisions all of it —
resources, each API's endpoints, queue consumers, functions and crons:

```typescript
// sst.config.ts
const { App, fromManifest, Stack } = await import('@geekmidas/cloud/sst');
const { backends, constructs } = await import('./.gkm/manifest/aws.js');

fromManifest(new Stack(app, 'Shop'), constructs, { Database: { vpc } }, backends);
```

The types narrow to what was declared:

```typescript
import { constructs, type Construct, type Surfaces } from './.gkm/manifest/aws';

const api: Construct<'Api'> = constructs.Api;

for (const endpoint of api.endpoints) {
  console.log(`${endpoint.method} ${endpoint.path} -> ${endpoint.handler}`);
}

const surface: Surfaces = 'Api'; // any other id is a type error
```

## OpenAPI Generation

The CLI generates a TypeScript module with full type safety and a ready-to-use API client:

```bash
gkm openapi --output src/api.ts
```

**Generated TypeScript Module:**

The generated module exports:

| Export | Description |
|--------|-------------|
| `securitySchemes` | OpenAPI security scheme definitions |
| `SecuritySchemeId` | Union type of security scheme names |
| `endpointAuth` | Map of endpoints to their auth requirements |
| `paths` | TypeScript interface for OpenAPI paths |
| `createApi()` | Factory function to create typed API client |

**Example Generated Output:**

```typescript
// Security schemes from your endpoint authorizers
export const securitySchemes = {
  jwt: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  },
} as const;

export type SecuritySchemeId = 'jwt';

// Which endpoints require which auth
export const endpointAuth = {
  'GET /users': 'jwt',
  'POST /users': 'jwt',
  'GET /health': null,  // Public endpoint
} as const;

// Type-safe paths interface
export interface paths {
  '/users': {
    get: {
      responses: {
        200: { content: { 'application/json': GetUsersOutput[] } };
      };
    };
    post: {
      requestBody: { content: { 'application/json': CreateUserInput } };
      responses: {
        201: { content: { 'application/json': GetUsersOutput } };
      };
    };
  };
}

// Factory to create API client
export interface CreateApiOptions {
  baseURL: string;
  authStrategies: Record<SecuritySchemeId, AuthStrategy>;
  queryClient?: QueryClient;
}

export function createApi(options: CreateApiOptions) {
  // Returns callable fetcher with React Query hooks
}
```

### Legacy JSON Output

For compatibility with other tools, you can still generate JSON:

```bash
gkm openapi --output api-docs.json --json
```

## Deployment Examples

Deploying goes through `gkm deploy` and a target, rather than through a
hand-written server file or framework config:

```bash
# Dokploy (the default target)
gkm deploy --stage production

# One Docker Compose stack behind Caddy, on this machine
gkm compose --stage production --tag v1.4.0

# AWS through SST, with deploy: { default: 'sst' }
gkm deploy --stage production

# Only the Docker files, to build and run images yourself
gkm docker --build --tag v1.4.0
```

See [Deploy targets](https://geekmidas.github.io/toolbox/next/guide/deploy-targets) and the
[deployment guide](https://geekmidas.github.io/toolbox/next/guide/deployment).

## Advanced Usage

### Custom Environment Parser

Create complex environment configurations:

```typescript
// src/env.ts
import { EnvironmentParser } from '@geekmidas/envkit';

export const envParser = new EnvironmentParser(process.env)
  .create((get) => ({
    database: {
      url: get('DATABASE_URL').string().url(),
      ssl: get('DATABASE_SSL').string().transform(Boolean).default('false'),
      maxConnections: get('DB_MAX_CONNECTIONS')
        .string()
        .transform(Number)
        .default('10'),
    },
    
    redis: {
      url: get('REDIS_URL').string().url(),
      password: get('REDIS_PASSWORD').string().optional(),
    },
    
    aws: {
      region: get('AWS_REGION').string().default('us-east-1'),
      accessKeyId: get('AWS_ACCESS_KEY_ID').string().optional(),
      secretAccessKey: get('AWS_SECRET_ACCESS_KEY').string().optional(),
    },
    
    auth: {
      jwtSecret: get('JWT_SECRET').string(),
      jwtExpiry: get('JWT_EXPIRY').string().default('24h'),
    },
  }))
  .parse();
```

### Authentication Integration

Integrate `@geekmidas/auth` for JWT/OIDC authentication in your endpoints:

```typescript
// src/env.ts
import { EnvironmentParser } from '@geekmidas/envkit';

export const envParser = new EnvironmentParser(process.env)
  .create((get) => ({
    auth: {
      jwtSecret: get('JWT_SECRET').string(),
      jwtIssuer: get('JWT_ISSUER').string().optional(),
      jwtAudience: get('JWT_AUDIENCE').string().optional(),
    },
  }))
  .parse();
```

#### With Hono Middleware (Server Provider)

```typescript
// src/routes/protected.ts
import { api } from '../constructs/api';
import { JwtMiddleware } from '@geekmidas/auth/hono/jwt';
import { envParser } from '../env.js';

const jwt = new JwtMiddleware({
  config: {
    secret: envParser.auth.jwtSecret,
    issuer: envParser.auth.jwtIssuer,
    audience: envParser.auth.jwtAudience,
  },
});

// Apply middleware to Hono app
app.use('/api/*', jwt.handler());
app.use('/public/*', jwt.optional());
```

#### With Lambda Authorizers (AWS Provider)

```typescript
// src/authorizers/jwt.ts
import { JwtAuthorizer } from '@geekmidas/auth/lambda/jwt';
import { envParser } from '../env.js';

const authorizer = new JwtAuthorizer({
  config: {
    secret: envParser.auth.jwtSecret,
    issuer: envParser.auth.jwtIssuer,
  },
  getContext: (claims) => ({
    userId: claims.sub!,
  }),
});

export const handler = authorizer.requestHandler();
```

#### With OIDC (Auth0, Cognito, etc.)

```typescript
// src/env.ts
export const envParser = new EnvironmentParser(process.env)
  .create((get) => ({
    oidc: {
      issuer: get('OIDC_ISSUER').string().url(),
      audience: get('OIDC_AUDIENCE').string(),
    },
  }))
  .parse();

// src/authorizers/oidc.ts
import { OidcAuthorizer } from '@geekmidas/auth/lambda/oidc';
import { envParser } from '../env.js';

const authorizer = new OidcAuthorizer({
  config: {
    issuer: envParser.oidc.issuer,
    audience: envParser.oidc.audience,
  },
  getContext: (claims) => ({
    userId: claims.sub!,
    email: claims.email,
  }),
});

export const handler = authorizer.requestHandler();
```

### Custom Logger Configuration

Set up structured logging with different levels:

```typescript
// src/logger.ts
import { ConsoleLogger } from '@geekmidas/logger/console';

export const logger = new ConsoleLogger({
  level: process.env.LOG_LEVEL || 'info',
  pretty: process.env.NODE_ENV !== 'production',
  context: {
    service: 'my-api',
    version: process.env.npm_package_version,
  },
});

// Add custom log methods
logger.addMethod('audit', (message: string, data?: any) => {
  logger.info(message, { type: 'audit', ...data });
});
```

### Multiple Route Patterns

Configure multiple patterns for complex project structures:

```typescript
// gkm.config.ts
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  stages: { local: 'dev', deployed: ['prod'] },
  routes: [
    'src/routes/**/*.ts',
    'src/api/v1/**/*.ts',
    'src/api/v2/**/*.ts',
    'src/handlers/**/*.ts',
  ],
  envParser: './src/env.ts#envParser',
  logger: './src/logger.ts#logger',
});
```

## Error Handling

The CLI provides detailed error messages for common issues:

### Configuration Errors

```bash
# Missing config file
Error: gkm.config.ts not found. Please create a configuration file.

# Invalid config
Error: Failed to load gkm.config.ts: Invalid configuration
```

### Build Errors

```bash
# No endpoints found
No endpoints found to process

# Unknown deploy target
Unknown deploy target "fly". Use one of dokploy, compose, sst, or name the package that provides it in gkm.config.ts: deploy: { targets: { "fly": '<package>' } }.
```

### OpenAPI Errors

```bash
# Generation failure
Error: OpenAPI generation failed: Invalid endpoint schema
```

## Integration with Development Workflow

### Package.json Scripts

```json
{
  "scripts": {
    "dev": "gkm dev",
    "dev:port": "gkm dev --port 8080",
    "build": "gkm build",
    "build:lambda": "gkm build --provider aws",
    "build:server": "gkm build --provider server",
    "client": "gkm openapi"
  }
}
```

### CI/CD Pipeline

`gkm init` writes a GitHub Actions deploy workflow that runs
`gkm deploy --stage "$STAGE"` for each stage. Its credentials come from the
stage's GitHub environment: `AWS_ROLE_ARN` for SST (set by
`gkm deploy:github --stage <stage>`), or `DOKPLOY_API_TOKEN` and
`DOKPLOY_ENDPOINT` for Dokploy. In any CI job, `gkm deploy --json` writes the
deploy's events as JSON lines and never prompts. See
[Deploying from GitHub Actions](https://geekmidas.github.io/toolbox/next/guide/deployment#deploying-from-github-actions).

## Troubleshooting

### Common Issues

1. **Configuration not found**: Ensure `gkm.config.ts` is in your project root
2. **No endpoints found**: Check your glob patterns in the config
3. **Import errors**: Verify your environment parser and logger paths are correct
4. **TypeScript errors**: Ensure your endpoints are properly typed

### Working with Different Directories

When using the `--cwd` option to run the CLI from a different directory, TypeScript configuration (tsconfig.json) is resolved from the directory where the CLI is invoked, not from the target directory. This can cause issues with path resolution and type checking.

**Workarounds:**

1. **Run from the target directory** (recommended):
   ```bash
   cd /path/to/project && gkm build
   ```

2. **Use TS_NODE_PROJECT environment variable**:
   ```bash
   TS_NODE_PROJECT=/path/to/project/tsconfig.json gkm build --cwd /path/to/project
   ```

3. **Create a wrapper script**:
   ```bash
   #!/bin/bash
   # gkm-wrapper.sh
   cd "$1" && shift && gkm "$@"
   ```
   
   Then use:
   ```bash
   ./gkm-wrapper.sh /path/to/project build --provider server
   ```

4. **Use npx with explicit tsx configuration**:
   ```bash
   cd /path/to/project && npx tsx --tsconfig ./tsconfig.json node_modules/.bin/gkm build
   ```

### Debug Mode

Enable verbose logging by setting the environment variable:

```bash
DEBUG=gkm:* npx gkm build
```

## API Reference

### Types

```typescript
// Build targets
type Provider = 'aws' | 'server';

// Runtime options
type Runtime = 'node' | 'bun';

// Configuration interface
interface GkmConfig {
  routes: string | string[];
  envParser: string;
  logger: string;
  functions?: string | string[];
  crons?: string | string[];
  subscribers?: string | string[];
  runtime?: Runtime;
  telescope?: boolean | TelescopeConfig;
  docker?: DockerConfig;
}

// Docker configuration
interface DockerConfig {
  registry?: string;        // Container registry URL
  imageName?: string;       // Image name (defaults to package.json name)
  baseImage?: string;       // Base image (default: node:22-alpine)
  port?: number;            // Port to expose (default: 3000)
}

// Telescope configuration
interface TelescopeConfig {
  enabled?: boolean;
  path?: string;
  ignore?: string[];
  recordBody?: boolean;
  maxEntries?: number;
  websocket?: boolean;
}

// Build options
interface BuildOptions {
  provider?: Provider; // default: where gkm.config.ts deploys
}

// Dev options
interface DevOptions {
  port?: number;
  enableOpenApi?: boolean;
}

// Route information
interface RouteInfo {
  path: string;
  method: string;
  handler: string;
}
```

## Contributing

1. Follow the existing code style (2 spaces, single quotes, semicolons)
2. Add tests for new features
3. Update documentation for API changes
4. Use semantic commit messages
5. Ensure all commands work across different providers

## License

MIT License - see the LICENSE file for details.