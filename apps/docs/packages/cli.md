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
├── .env
├── .env.example
├── .env.development
├── .env.test
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
│       ├── .env
│       ├── gkm.config.ts
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── models/
│       ├── src/
│       │   └── index.ts (shared Zod schemas)
│       ├── package.json
│       └── tsconfig.json
├── biome.json
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── turbo.json
```

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

**Generated Files:**

```
.gkm/docker/
├── Dockerfile           # Multi-stage (default) or slim build
├── docker-compose.yml   # With optional services
├── .dockerignore
└── docker-entrypoint.sh
```

**Dockerfile Types:**

| Type | Description | When Used |
|------|-------------|-----------|
| Multi-stage | Builds from source inside Docker | Default (recommended) |
| Slim | Copies pre-built bundle | `--slim` flag (requires prior build) |

**Container Best Practices:**

Both Dockerfile types include:
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
| `postgres` | PostgreSQL 16 | `DATABASE_URL` |
| `redis` | Redis 7 | `REDIS_URL` |
| `rabbitmq` | RabbitMQ 3 | `RABBITMQ_URL` |

**Example docker-compose.yml with services:**

```yaml
services:
  api:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  postgres:
    image: postgres:16-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready"]

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
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
