# @geekmidas/cli

Command-line tools for building and deploying API applications.

## Installation

```bash
npm install -g @geekmidas/cli
# or
pnpm add -g @geekmidas/cli
```

## Features

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

? Include Telescope (debugging dashboard)? › Yes
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
├── docker-compose.yml
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
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── turbo.json
```

**Secrets Storage:**

Secrets are stored encrypted at `.gkm/secrets/{stage}.json` with decryption keys at `~/.gkm/{project-name}/{stage}.key`. This separates secrets from the codebase while keeping them accessible locally.

### Build

Generate Lambda handlers or server applications from endpoint definitions.

```bash
# Build for AWS (uses config)
gkm build --provider aws

# Build server application
gkm build --provider server

# Build for production (no dev tools, bundled)
gkm build --provider server --production
```

**Options:**

| Option | Description |
|--------|-------------|
| `--provider` | Target provider (aws, server) |
| `--production` | Build for production (no dev tools, bundled output) |
| `--skip-bundle` | Skip bundling step in production build |
| `--enable-openapi` | Enable OpenAPI documentation generation |

**Production Build:**

When using `--production`, the build:
- Excludes Telescope debugging dashboard
- Excludes Studio database browser
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

### Docker

Generate Docker deployment files for production.

```bash
# Generate multi-stage Dockerfile (builds from source inside Docker)
gkm docker

# Generate and build Docker image
gkm docker --build

# Build and push to registry
gkm docker --build --push --registry ghcr.io/myorg --tag v1.0.0

# Use slim Dockerfile (requires pre-built bundle)
gkm build --provider server --production
gkm docker --slim
```

**Options:**

| Option | Description |
|--------|-------------|
| `--build` | Build Docker image after generating files |
| `--push` | Push image to registry after building |
| `--tag <tag>` | Image tag (default: latest) |
| `--registry <url>` | Container registry URL |
| `--slim` | Use slim Dockerfile (requires pre-built bundle) |
| `--turbo` | Use turbo prune for monorepo optimization |
| `--turbo-package <name>` | Package name for turbo prune |

**Generated Files:**

```
.gkm/docker/
├── Dockerfile           # Multi-stage (default), slim, or turbo build
├── docker-compose.yml   # With optional services
├── .dockerignore
└── docker-entrypoint.sh
```

**Dockerfile Types:**

| Type | Description | When Used |
|------|-------------|-----------|
| Multi-stage | Builds from source inside Docker | Default (recommended) |
| Slim | Copies pre-built bundle | `--slim` flag (requires prior build) |
| Turbo | Prunes monorepo before building | `--turbo` flag (for monorepos) |

**Build Speed Optimizations:**

The generated Dockerfiles are optimized for fast rebuilds:

1. **BuildKit cache mounts** - The pnpm store is cached between builds:
   ```dockerfile
   RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
       pnpm fetch
   ```

2. **pnpm fetch + offline install** - Dependencies are fetched first (cacheable), then installed offline:
   ```dockerfile
   COPY pnpm-lock.yaml ./
   RUN pnpm fetch
   COPY package.json ./
   RUN pnpm install --frozen-lockfile --offline
   ```

3. **Turbo prune for monorepos** - Only copies necessary packages:
   ```bash
   gkm docker --turbo --turbo-package my-api
   ```

**Rebuild Performance:**

| Scenario | Without Optimization | With Optimization |
|----------|---------------------|-------------------|
| Code change only | ~2-3 min | ~30s |
| New dependency | ~3-4 min | ~1 min |
| Fresh build | ~4-5 min | ~3-4 min |

**Container Best Practices:**

All Dockerfile types include:
- **tini** as the init process (handles SIGTERM propagation and zombie reaping)
- Non-root user (`hono`) for security
- Health check endpoint for container orchestration
- Minimal Alpine base image

### Prepack

Generate Docker files for production deployment.

```bash
# Generate multi-stage Dockerfile (recommended for CI/CD)
gkm prepack

# Generate and build Docker image
gkm prepack --build

# Full deployment workflow
gkm prepack --build --push --registry ghcr.io/myorg --tag v1.0.0

# Local development: build locally first, then slim Dockerfile
gkm prepack --slim
```

**Options:**

| Option | Description |
|--------|-------------|
| `--build` | Build Docker image after generating files |
| `--push` | Push image to registry after building |
| `--tag <tag>` | Image tag (default: latest) |
| `--registry <url>` | Container registry URL |
| `--slim` | Build locally first, then use slim Dockerfile |
| `--skip-bundle` | Skip bundling step (only with --slim) |
| `--turbo` | Use turbo prune for monorepo optimization |
| `--turbo-package <name>` | Package name for turbo prune |

**Workflow Comparison:**

| Command | What it does |
|---------|--------------|
| `gkm prepack --build` | Generates multi-stage Dockerfile, builds inside Docker |
| `gkm prepack --slim --build` | Builds locally, then creates slim Docker image |

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

### Generate React Query

Generate React Query hooks from OpenAPI specification.

```bash
gkm generate:react-query --input api-docs.json --output ./src/api
```

**Options:**

| Option | Description |
|--------|-------------|
| `--input` | Path to OpenAPI spec file |
| `--output` | Output directory for generated hooks |

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

**Features:**
- Hot reload on file changes
- Telescope debugging dashboard integration
- **Automatic OpenAPI generation** on startup and file changes (when enabled in config)
- **Dynamic Docker port resolution** — automatically avoids port conflicts between projects
- **Automatic subscriber startup** — discovers and starts event subscribers in polling mode

#### Subscriber Polling

When running `gkm dev`, any event subscribers defined in your routes are automatically discovered and started in polling mode. The CLI generates a `setupSubscribers()` function that runs on server startup.

To enable subscriber polling, set the `EVENT_SUBSCRIBER_CONNECTION_STRING` environment variable:

```bash
# .env
EVENT_SUBSCRIBER_CONNECTION_STRING=pgboss://user:pass@localhost:5432/mydb
```

The appropriate subscriber backend is selected based on the connection string protocol:

| Protocol | Backend | Description |
|----------|---------|-------------|
| `pgboss://` | pg-boss | PostgreSQL-based job queue |
| `rabbitmq://` | RabbitMQ | AMQP message broker |
| `sqs://` | AWS SQS | Amazon Simple Queue Service |
| `sns://` | AWS SNS | Amazon Simple Notification Service |
| `basic://` | In-memory | For local testing only |

The dev server creates a single shared connection from the connection string, then registers each subscriber to poll for its declared event types. Events are processed one at a time per subscriber. Failed events are retried automatically by the backend.

::: tip
For AWS-based backends (SQS/SNS), production deployments should use Lambda with event source mappings for proper scaling and dead letter queues. For pg-boss and RabbitMQ, the polling approach used by `gkm dev` is also suitable for production via `gkm build --provider server`.
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
```

**Options:**

| Option | Description |
|--------|-------------|
| `--stage <stage>` | Stage to load secrets from (default: development) |
| `--run` | Run tests once without watch mode |
| `--watch` | Enable watch mode |
| `--coverage` | Generate coverage report |
| `--ui` | Open Vitest UI |
| `[pattern]` | Pattern to filter tests |

The test command decrypts secrets from `.gkm/secrets/{stage}.json` and injects them as environment variables before running Vitest.

### Secrets Management

Manage encrypted secrets for different deployment stages.

```bash
# Initialize secrets for a stage
gkm secrets:init --stage production

# View secrets (masked)
gkm secrets:show --stage development

# View actual values
gkm secrets:show --stage development --reveal

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
- Decryption keys stored at `~/.gkm/{project-name}/{stage}.key`
- Keys are never committed to version control

**Service Credentials:**

When services are configured, the following are auto-generated:
- PostgreSQL: `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, etc.
- Redis: `REDIS_URL`, `REDIS_PASSWORD`, etc.
- RabbitMQ: `RABBITMQ_URL`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`, etc.

## Configuration File

Create a `gkm.config.ts` file in your project root:

```typescript
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  // Route files (glob pattern)
  routes: './src/endpoints/**/*.ts',

  // Environment parser module (named export)
  envParser: './src/config/env#envParser',

  // Logger module (named export)
  logger: './src/config/logger#logger',

  // Telescope debugging dashboard (optional)
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

  // Production build configuration (optional)
  providers: {
    server: {
      production: {
        bundle: true,           // Bundle to single file
        minify: true,           // Minify output
        healthCheck: '/health', // Health check endpoint
        gracefulShutdown: true, // Enable graceful shutdown
        external: [],           // Packages to exclude from bundle
        subscribers: 'exclude', // 'include' or 'exclude'
        openapi: false,         // Include OpenAPI in production
      },
    },
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

The `providers.server.production` configuration controls production build behavior:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `bundle` | `boolean` | `true` | Bundle output to single file |
| `minify` | `boolean` | `true` | Minify bundled output |
| `healthCheck` | `string` | `/health` | Health check endpoint path |
| `gracefulShutdown` | `boolean` | `true` | Enable graceful shutdown handling |
| `external` | `string[]` | `[]` | Packages to exclude from bundling |
| `subscribers` | `'include' \| 'exclude'` | `'exclude'` | Include subscribers in production |
| `openapi` | `boolean` | `false` | Include OpenAPI docs in production |

**Production vs Development:**

| Feature | Development | Production |
|---------|-------------|------------|
| Telescope | ✓ | ✗ |
| Studio | ✓ | ✗ |
| WebSocket | ✓ | ✗ |
| Health Check | ✗ | ✓ |
| Graceful Shutdown | ✗ | ✓ |
| Bundled | ✗ | ✓ |
| Optimized Handlers | ✗ | ✓ |

### Build-Time Optimization

Production builds automatically generate optimized endpoint handlers based on feature analysis. Endpoints are categorized into three tiers:

| Tier | Features | Performance |
|------|----------|-------------|
| **Minimal** | No auth, no services, no database | Near-raw-Hono (~1.2x overhead) |
| **Standard** | Auth and/or services | Optimized (~2-3x faster than runtime) |
| **Full** | Audits, RLS, rate-limiting | Uses HonoEndpoint.addRoutes |

**How it works:**

1. At build time, each endpoint is analyzed for its features
2. Optimized inline handlers are generated for minimal and standard tiers
3. Full-tier endpoints use runtime HonoEndpoint for transaction wrapping
4. Reusable validator middleware is shared across endpoints

**Generated File Structure:**

```
.gkm/server/endpoints/
├── validators.ts           # Shared validator middleware
├── minimal/
│   ├── index.ts            # setupMinimalEndpoints()
│   ├── ping.ts             # Individual endpoint
│   └── version.ts
├── standard/
│   ├── index.ts            # setupStandardEndpoints()
│   ├── getUsers.ts
│   └── createUser.ts
├── full/
│   ├── index.ts            # setupFullEndpoints()
│   └── deleteUser.ts       # Uses HonoEndpoint.addRoutes
└── index.ts                # Main entry point
```

**Performance Benefits:**

- **Minimal tier**: ~3x faster than runtime HonoEndpoint
- **Standard tier**: ~2x faster than runtime HonoEndpoint
- **Build output**: Typically 10-15KB bundled (vs 100KB+ with all dependencies)

**Endpoint Classification:**

```typescript
// Minimal tier - no auth, no services
const ping = e
  .get('/ping')
  .output(z.object({ message: z.string() }))
  .handle(async () => ({ message: 'pong' }));

// Standard tier - uses auth and/or services
const getUsers = router
  .get('/users')
  .services([DatabaseService])
  .handle(async ({ services }) => services.database.findAll());

// Full tier - uses declarative audits
const deleteUser = router
  .delete('/users/:id')
  .audit([{ type: 'user.deleted', payload: (r) => ({ userId: r.id }) }])
  .handle(async ({ params }) => { /* ... */ });
```

### Docker Configuration

The `docker` configuration controls Docker file generation:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `registry` | `string` | `''` | Container registry URL |
| `imageName` | `string` | package name | Docker image name |
| `baseImage` | `string` | `node:22-alpine` | Base Docker image |
| `port` | `number` | `3000` | Container port |
| `compose.services` | `string[]` | `[]` | Services for docker-compose |

**Available Compose Services:**

| Service | Description | Environment Variables |
|---------|-------------|-----------------------|
| `postgres` | PostgreSQL 17 | `DATABASE_URL` |
| `redis` | Redis 7 | `REDIS_URL` |
| `rabbitmq` | RabbitMQ 3 | `RABBITMQ_URL` |
| `mailpit` | Mailpit SMTP | `SMTP_HOST`, `SMTP_PORT` |

**Example docker-compose.yml with services:**

```yaml
services:
  postgres:
    image: postgres:17
    ports:
      - '${POSTGRES_HOST_PORT:-5432}:5432'
    healthcheck:
      test: ["CMD-SHELL", "pg_isready"]

  redis:
    image: redis:7
    ports:
      - '${REDIS_HOST_PORT:-6379}:6379'
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]

  mailpit:
    image: axllent/mailpit
    ports:
      - '${MAILPIT_SMTP_PORT:-1025}:1025'
      - '${MAILPIT_UI_PORT:-8025}:8025'
```

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
4. Studio UI (if enabled)
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

# Pull remote state to local
gkm state:pull --stage production

# Push local state to remote
gkm state:push --stage production

# Compare local vs remote
gkm state:diff --stage production

# Force push (overwrite remote)
gkm state:push --stage production --force
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

  apps: {
    api: {
      path: 'apps/api',
      type: 'backend',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env',
      logger: './src/config/logger',
      telescope: true,
    },
    auth: {
      path: 'apps/auth',
      type: 'backend',
      port: 3001,
      entry: './src/index.ts',
      framework: 'better-auth',
      requiredEnv: ['DATABASE_URL', 'BETTER_AUTH_SECRET'],
    },
    web: {
      type: 'frontend',
      path: 'apps/web',
      port: 3002,
      framework: 'nextjs',
      dependencies: ['api', 'auth'],
    },
  },

  services: {
    db: { version: '16-alpine' },
    cache: true,
    mail: true,
  },

  deploy: {
    default: 'dokploy',
    dokploy: {
      endpoint: 'https://dokploy.myserver.com',
      projectId: 'proj_abc123',
      registry: 'ghcr.io/myorg',
      domains: {
        production: 'myapp.com',
        staging: 'staging.myapp.com',
      },
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
| `backend` | API server with gkm routes | `routes`, `envParser`, `logger` |
| `backend` (entry) | Custom backend (Hono, Express) | `entry`, `framework`, `requiredEnv` |
| `auth` | Better Auth server | `provider`, `entry`, `requiredEnv` |
| `frontend` | Web application | `framework`, `dependencies` |

### Auth App Configuration

The `auth` type is specialized for [Better Auth](https://better-auth.com) servers:

```typescript
auth: {
  type: 'auth',
  path: 'apps/auth',
  port: 3001,
  provider: 'better-auth',
  entry: './src/index.ts',
  requiredEnv: ['DATABASE_URL', 'BETTER_AUTH_SECRET'],
}
```

**Auto-injected variables during deployment:**

| Variable | Source |
|----------|--------|
| `BETTER_AUTH_URL` | Derived from app hostname |
| `BETTER_AUTH_SECRET` | Generated and persisted in state |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Comma-separated list of frontend URLs |

### Services Configuration

| Service | Key | Default Image | Environment Variables |
|---------|-----|---------------|----------------------|
| PostgreSQL | `db` | `postgres:18-alpine` | `DATABASE_URL` |
| Redis | `cache` | `redis:8-alpine` | `REDIS_URL` |
| Mailpit | `mail` | `axllent/mailpit` | `SMTP_HOST`, `SMTP_PORT` |

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
