# @geekmidas/cli

A powerful CLI tool for building and managing TypeScript-based backend APIs with serverless deployment support. Generate AWS Lambda handlers, OpenAPI documentation, and server applications from your endpoint definitions.

## Features

- **Project Scaffolding**: Interactive `init` command to bootstrap new projects with templates
- **Multi-Provider Support**: Generate handlers for AWS Lambda (API Gateway v1/v2) and server applications
- **Development Server**: Hot-reload development server with file watching
- **Telescope Integration**: Laravel-style debugging dashboard for inspecting requests, logs, and exceptions
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

  // Optional: Telescope debugging dashboard (enabled by default in dev)
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
import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

export const getUsers = e
  .get('/users')
  .output(z.array(z.object({ id: z.string(), name: z.string() })))
  .handle(async () => {
    return [{ id: '1', name: 'John Doe' }];
  });

export const createUser = e
  .post('/users')
  .body(z.object({ name: z.string() }))
  .output(z.object({ id: z.string(), name: z.string() }))
  .handle(async ({ body }) => {
    return { id: '2', name: body.name };
  });
```

### 5. Create Subscribers (Optional)

Create event subscribers in `src/subscribers/`:

```typescript
// src/subscribers/userSubscriber.ts
import { SubscriberBuilder } from '@geekmidas/constructs/subscribers';
import type { Service } from '@geekmidas/services';
import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import type { EnvironmentParser } from '@geekmidas/envkit';

// Define event types
type UserEvents =
  | PublishableMessage<'user.created', { userId: string; email: string }>
  | PublishableMessage<'user.updated', { userId: string }>;

// Create event publisher service
const userEventPublisher = {
  serviceName: 'userEventPublisher' as const,
  async register(envParser: EnvironmentParser<{}>) {
    const config = envParser.create((get) => ({
      publisherUrl: get('EVENT_PUBLISHER_URL').string()
    })).parse();

    const { Publisher } = await import('@geekmidas/events');
    return Publisher.fromConnectionString<UserEvents>(config.publisherUrl);
  }
} satisfies Service<'userEventPublisher', EventPublisher<UserEvents>>;

// Create subscriber
export const userCreatedSubscriber = new SubscriberBuilder()
  .publisher(userEventPublisher)
  .subscribe(['user.created'])
  .handle(async ({ events, logger }) => {
    for (const event of events) {
      logger.info({ userId: event.payload.userId }, 'Processing user.created event');
      // Process event...
    }
  });
```

### 6. Build Handlers

```bash
# Generate AWS Lambda handlers
npx gkm build --provider aws-apigatewayv1

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
3. **Telescope** - Include debugging dashboard (default: yes)
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

**Options:**
- `--provider <provider>`: Target provider (default: `aws-apigatewayv1`)
  - `aws-apigatewayv1`: AWS API Gateway v1 Lambda handlers
  - `aws-apigatewayv2`: AWS API Gateway v2 Lambda handlers
  - `server`: Server application with Hono
- `--production`: Generate production-optimized bundle (server provider only)

**Example:**
```bash
# Generate AWS Lambda handlers
gkm build --provider aws-apigatewayv1

# Generate server application
gkm build --provider server

# Generate production bundle for Docker
gkm build --provider server --production
```

**Production Builds:**

When using `--production` with the server provider, the CLI generates an optimized bundle at `.gkm/server/dist/server.mjs`. This bundle:
- Is minified and tree-shaken for smaller size
- Includes all dependencies (single-file deployment)
- Can be used with `gkm docker --slim` for minimal Docker images

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
- `--build`: Build Docker image after generating files
- `--push`: Push image to registry after building
- `--tag <tag>`: Image tag (default: `latest`)
- `--registry <url>`: Container registry URL
- `--slim`: Use slim Dockerfile (requires pre-built bundle from `gkm build --production`)
- `--turbo`: Enable turbo prune for monorepo optimization
- `--turbo-package <name>`: Package name for turbo prune (defaults to package.json name)

**Generated Files:**
- `.gkm/docker/Dockerfile` - Multi-stage or slim Dockerfile
- `.gkm/docker/docker-compose.yml` - Docker Compose configuration
- `.gkm/docker/docker-entrypoint.sh` - Entrypoint script
- `.dockerignore` - Docker ignore file (project root)

**Dockerfile Types:**

| Type | Flag | Description |
|------|------|-------------|
| Multi-stage | (default) | Builds from source inside Docker, most reproducible |
| Turbo | `--turbo` | Optimized for monorepos with turbo prune |
| Slim | `--slim` | Uses pre-built bundle, requires prior `gkm build --production` |

**Example:**
```bash
# Generate multi-stage Dockerfile (default, recommended)
gkm docker

# Generate and build image
gkm docker --build --tag v1.0.0

# Build and push to registry
gkm docker --build --push --registry ghcr.io/myorg --tag v1.0.0

# Use turbo prune for monorepo
gkm docker --turbo --turbo-package my-api

# Use slim Dockerfile (after running gkm build --production)
gkm build --provider server --production
gkm docker --slim
```

**Package Manager Support:**

The CLI auto-detects your package manager from lockfiles and generates optimized Dockerfiles:
- **pnpm**: Uses `pnpm fetch` for better layer caching
- **npm**: Uses `npm ci` with cache mounts
- **yarn**: Uses `yarn install --frozen-lockfile`
- **bun**: Uses `bun install --frozen-lockfile`

**Configuration:**

Configure Docker settings in `gkm.config.ts`:

```typescript
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
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
    // Docker Compose services
    compose: {
      services: {
        postgres: { image: 'postgis/postgis:16-3.4-alpine' },  // Custom image
        redis: true,                                            // Default version
        rabbitmq: { version: '3.12-management-alpine' },        // Custom version
      },
    },
  },
});
```

**Docker Compose Services:**

Services can be configured with custom versions, custom images, or use defaults:

```typescript
// Object format (recommended)
services: {
  postgres: { version: '15-alpine' },              // Custom version
  redis: true,                                      // Default: redis:7-alpine
  rabbitmq: { version: '3.12-management-alpine' },
}

// Custom images (e.g., PostGIS, Redis Stack)
services: {
  postgres: { image: 'postgis/postgis:16-3.4-alpine' },  // Full image reference
  redis: { image: 'redis/redis-stack:latest' },
}

// Legacy array format - uses default versions
services: ['postgres', 'redis', 'rabbitmq']
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
| `postgres` | `postgres:16-alpine` | `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| `redis` | `redis:7-alpine` | `REDIS_URL` |
| `rabbitmq` | `rabbitmq:3-management-alpine` | `RABBITMQ_URL`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD` |

### `gkm dev`

Start a development server with hot-reload and optional Telescope debugging dashboard.

```bash
gkm dev [options]
```

**Options:**
- `--port <port>`: Server port (default: `3000`)

**Features:**
- Hot-reload on file changes (endpoints, functions, crons, subscribers)
- Automatic port switching if requested port is in use
- Telescope debugging dashboard (enabled by default)
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
- Secure passwords for postgres, redis, rabbitmq (based on `docker.compose.services` config)
- Connection URLs (`DATABASE_URL`, `REDIS_URL`, `RABBITMQ_URL`)
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

Authenticate with a deployment service. Credentials are stored in `~/.gkm/credentials.json`.

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
gkm deploy --provider dokploy --stage production
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

Deploy application to a provider. Builds for production, injects encrypted secrets, and deploys.

```bash
gkm deploy --provider <provider> --stage <stage> [options]
```

**Options:**
- `--provider <provider>`: Deploy provider (`docker`, `dokploy`, `aws-lambda`)
- `--stage <stage>`: Deployment stage
- `--tag <tag>`: Image tag (default: `stage-timestamp`)
- `--skip-push`: Skip pushing image to registry
- `--skip-build`: Skip build step (use existing build)

**Examples:**
```bash
# Docker: build and push image
gkm deploy --provider docker --stage production

# Dokploy: build, push, and trigger deployment
DOKPLOY_API_TOKEN=xxx gkm deploy --provider dokploy --stage production

# Custom tag
gkm deploy --provider docker --stage production --tag v1.0.0
```

**Workflow:**
1. **Sniffs environment variables** - Automatically detects which env vars each app needs
2. Builds production bundle with `gkm build --provider server --production --stage <stage>`
3. Encrypts secrets from `.gkm/secrets/<stage>.json` into the bundle
4. Generates Docker files with `gkm docker`
5. Builds and pushes Docker image
6. (Dokploy) Triggers deployment via API with `GKM_MASTER_KEY`

**Environment Variable Detection:**

The deploy command automatically detects required environment variables for each app using different strategies based on app configuration:

| App Type | Detection Strategy |
|----------|-------------------|
| Frontend apps | Returns empty (no server secrets) |
| Apps with `requiredEnv` | Uses explicit list from config |
| Entry-based apps | Imports entry file in subprocess to capture `config.parse()` calls |
| Route-based apps | Loads routes and calls `getEnvironment()` on each construct |
| Apps with `envParser` only | Runs SnifferEnvironmentParser to detect usage |

For route-based apps, the sniffer loads each endpoint/function/cron/subscriber and collects environment variables from:
- All services attached to the construct (via `service.register()`)
- Publisher service (if any)
- Auditor storage service (if any)
- Database service (if any)

This allows the CLI to validate that all required secrets are configured before deployment, preventing runtime errors from missing environment variables.

**Configuration:**

```typescript
// gkm.config.ts
export default defineConfig({
  routes: 'src/endpoints/**/*.ts',
  envParser: './src/env.ts',
  logger: './src/logger.ts',

  docker: {
    registry: 'ghcr.io/myorg',
    imageName: 'my-api',
  },

  // For Dokploy deployments
  providers: {
    dokploy: {
      endpoint: 'https://dokploy.example.com',
      projectId: 'proj_xxx',
      applicationId: 'app_xxx',
    },
  },
});
```

**Environment Variables:**
- `DOKPLOY_API_TOKEN`: API token for Dokploy (not needed if logged in via `gkm login`)
- `GKM_MASTER_KEY`: Automatically set by Dokploy, or manually for Docker deployments

### `gkm deploy:init`

Initialize a new Dokploy deployment by creating a project and application via the Dokploy API. Automatically updates `gkm.config.ts` with the configuration.

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
4. Updates `gkm.config.ts` with the Dokploy configuration
5. Shows next steps for secrets and deployment

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
- An ephemeral master key is generated per build
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
interface GkmConfig {
  routes: string | string[];     // Glob patterns for endpoint files
  envParser: string;             // Path to environment parser
  logger: string;                // Path to logger configuration
  functions?: string | string[]; // Glob patterns for function files
  crons?: string | string[];     // Glob patterns for cron files
  subscribers?: string | string[];// Glob patterns for subscriber files
  runtime?: 'node' | 'bun';      // Runtime environment (default: 'node')
  telescope?: boolean | TelescopeConfig; // Telescope debugging config
}

interface TelescopeConfig {
  enabled?: boolean;       // Enable/disable (default: true in dev)
  path?: string;           // Dashboard path (default: '/__telescope')
  ignore?: string[];       // URL patterns to ignore
  recordBody?: boolean;    // Record request/response bodies (default: true)
  maxEntries?: number;     // Max entries to keep (default: 1000)
  websocket?: boolean;     // Enable real-time updates (default: true)
}
```

### Configuration Options

#### `routes`

Glob pattern(s) to discover endpoint files. Can be a single pattern or array of patterns.

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

Configuration for the Telescope debugging dashboard. Telescope is enabled by default when using `gkm dev`.

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
| `path` | `string` | `/__telescope` | Dashboard URL path |
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
  apps: {
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',
      telescope: {
        enabled: true,
        path: '/__telescope',
      },
      openapi: {
        enabled: true,
      },
    },
    auth: {
      type: 'backend',
      path: 'apps/auth',
      port: 3002,
      entry: './src/index.ts',  // Entry-based app (no routes)
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',
    },
    web: {
      type: 'frontend',
      framework: 'nextjs',
      path: 'apps/web',
      port: 3001,
      dependencies: ['api', 'auth'],
      client: {
        output: './src/api',
      },
    },
  },
  shared: {
    packages: ['packages/*'],
    models: {
      path: 'packages/models',
      schema: 'zod',
    },
  },
  services: {
    db: true,
    cache: true,
    mail: true,
  },
  deploy: {
    default: 'dokploy',
  },
});
```

### App Types

#### Routes-Based Backend Apps

Standard API apps using endpoint discovery:

```typescript
api: {
  type: 'backend',
  path: 'apps/api',
  port: 3000,
  routes: './src/endpoints/**/*.ts',  // Glob pattern for endpoints
  envParser: './src/config/env#envParser',
  logger: './src/config/logger#logger',
}
```

These apps use `gkm build --provider server` internally to generate a Hono server from discovered endpoints.

#### Entry-Based Backend Apps

Apps with a custom entry point (like authentication services using better-auth):

```typescript
auth: {
  type: 'backend',
  path: 'apps/auth',
  port: 3002,
  entry: './src/index.ts',  // Direct entry point
  envParser: './src/config/env#envParser',
  logger: './src/config/logger#logger',
}
```

Entry-based apps are bundled directly with esbuild into a standalone file. All dependencies are bundled, producing a single `index.mjs` file that runs without `node_modules`.

Example entry point for an auth service:

```typescript
// apps/auth/src/index.ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { auth } from './auth.js';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

serve({ fetch: app.fetch, port: 3002 });
```

#### Frontend Apps

Next.js or other frontend frameworks:

```typescript
web: {
  type: 'frontend',
  framework: 'nextjs',
  path: 'apps/web',
  port: 3001,
  dependencies: ['api', 'auth'],  // Apps this depends on
  client: {
    output: './src/api',  // Where to generate API client
  },
}
```

### Workspace Docker Generation

When running `gkm docker` in a workspace, the CLI generates optimized Dockerfiles for each app:

```bash
gkm docker
```

**Generated files:**
- `.gkm/docker/Dockerfile.api` - Routes-based backend (uses `gkm build`)
- `.gkm/docker/Dockerfile.auth` - Entry-based backend (uses esbuild bundling)
- `.gkm/docker/Dockerfile.web` - Next.js standalone output
- `.gkm/docker/docker-compose.yml` - Full stack with all apps and services
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
  name: string;
  apps: Record<string, AppConfig>;
  shared?: {
    packages?: string[];
    models?: {
      path: string;
      schema: 'zod' | 'valibot';
    };
  };
  services?: {
    db?: boolean;
    cache?: boolean;
    mail?: boolean;
  };
  deploy?: {
    default?: 'dokploy' | 'docker';
  };
}

interface BackendAppConfig {
  type: 'backend';
  path: string;
  port: number;
  routes?: string;           // Glob pattern for routes-based apps
  entry?: string;            // Entry file for entry-based apps
  envParser: string;
  logger: string;
  telescope?: TelescopeConfig;
  openapi?: { enabled: boolean };
}

interface FrontendAppConfig {
  type: 'frontend';
  framework: 'nextjs';
  path: string;
  port: number;
  dependencies?: string[];   // Other apps this depends on
  client?: {
    output: string;          // Where to generate typed API client
  };
}

type AppConfig = BackendAppConfig | FrontendAppConfig;
```

## Providers

### AWS API Gateway v1

Generates Lambda handlers compatible with AWS API Gateway v1 (REST API).

```bash
gkm build --provider aws-apigatewayv1
```

**Generated Handler:**
```typescript
import { AmazonApiGatewayV1Endpoint } from '@geekmidas/constructs/aws';
import { myEndpoint } from '../src/routes/example.js';
import { envParser } from '../src/env.js';

const adapter = new AmazonApiGatewayV1Endpoint(envParser, myEndpoint);

export const handler = adapter.handler;
```

### AWS API Gateway v2

Generates Lambda handlers compatible with AWS API Gateway v2 (HTTP API).

```bash
gkm build --provider aws-apigatewayv2
```

**Generated Handler:**
```typescript
import { AmazonApiGatewayV2Endpoint } from '@geekmidas/constructs/aws';
import { myEndpoint } from '../src/routes/example.js';
import { envParser } from '../src/env.js';

const adapter = new AmazonApiGatewayV2Endpoint(envParser, myEndpoint);

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

The CLI generates files in the `.gkm/<provider>` directory:

```
.gkm/
├── aws-apigatewayv1/
│   ├── getUsers.ts          # Individual Lambda handler
│   ├── createUser.ts        # Individual Lambda handler
├── server/
│   ├── app.ts               # Server application
│   ├── endpoints.ts         # Endpoint exports
├── manifest/
│   ├── aws.ts               # AWS manifest with types
│   └── server.ts            # Server manifest with types
└── openapi.json             # OpenAPI specification
```

### Build Manifest

The CLI generates TypeScript manifests with full type information in the `.gkm/manifest/` directory. These manifests export both the data and derived types for type-safe usage.

#### AWS Manifest (`.gkm/manifest/aws.ts`)

```typescript
export const manifest = {
  routes: [
    {
      path: '/users',
      method: 'GET',
      handler: '.gkm/aws-apigatewayv1/getUsers.handler',
      authorizer: 'jwt',
    },
    {
      path: '/users',
      method: 'POST',
      handler: '.gkm/aws-apigatewayv1/createUser.handler',
      authorizer: 'jwt',
    },
  ],
  functions: [
    {
      name: 'processData',
      handler: '.gkm/aws-lambda/functions/processData.handler',
      timeout: 60,
      memorySize: 256,
    },
  ],
  crons: [
    {
      name: 'dailyCleanup',
      handler: '.gkm/aws-lambda/crons/dailyCleanup.handler',
      schedule: 'rate(1 day)',
      timeout: 300,
      memorySize: 512,
    },
  ],
  subscribers: [],
} as const;

// Derived types
export type Route = (typeof manifest.routes)[number];
export type Function = (typeof manifest.functions)[number];
export type Cron = (typeof manifest.crons)[number];
export type Subscriber = (typeof manifest.subscribers)[number];

// Useful union types
export type Authorizer = Route['authorizer'];
export type HttpMethod = Route['method'];
export type RoutePath = Route['path'];
```

#### Server Manifest (`.gkm/manifest/server.ts`)

```typescript
export const manifest = {
  app: {
    handler: '.gkm/server/app.ts',
    endpoints: '.gkm/server/endpoints.ts',
  },
  routes: [
    { path: '/users', method: 'GET', authorizer: 'jwt' },
    { path: '/users', method: 'POST', authorizer: 'jwt' },
  ],
  subscribers: [
    { name: 'orderHandler', subscribedEvents: ['order.created'] },
  ],
} as const;

// Derived types
export type Route = (typeof manifest.routes)[number];
export type Subscriber = (typeof manifest.subscribers)[number];

// Useful union types
export type Authorizer = Route['authorizer'];
export type HttpMethod = Route['method'];
export type RoutePath = Route['path'];
```

#### Using Manifest Types

Import the manifest types for type-safe infrastructure configuration:

```typescript
import { manifest, type Route, type Authorizer } from './.gkm/manifest/aws';

// Type-safe route iteration
for (const route of manifest.routes) {
  console.log(`${route.method} ${route.path} -> ${route.handler}`);
}

// Use union types for validation
function isValidMethod(method: string): method is HttpMethod {
  return manifest.routes.some((r) => r.method === method);
}

// Access authorizer names
const authorizers = new Set(manifest.routes.map((r) => r.authorizer));
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

### AWS Lambda with Serverless Framework

```yaml
# serverless.yml
service: my-api

provider:
  name: aws
  runtime: nodejs18.x

functions:
  getUsers:
    handler: .gkm/aws-apigatewayv1/getUsers.handler
    events:
      - http:
          path: users
          method: get
  
  createUser:
    handler: .gkm/aws-apigatewayv1/createUser.handler
    events:
      - http:
          path: users
          method: post
```

### Server Deployment

```typescript
// server.ts
import { createApp } from './.gkm/server/app.js';

const app = createApp();

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
```

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "server.js"]
```

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
import { e } from '@geekmidas/constructs/endpoints';
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

# Invalid provider
Error: Unsupported provider: invalid-provider
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
    "build:lambda": "gkm build --provider aws-apigatewayv1",
    "build:server": "gkm build --provider server",
    "docs": "gkm openapi --output src/api.ts"
  }
}
```

### CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy API

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Build handlers
        run: npm run build:lambda
        
      - name: Deploy to AWS
        run: npx serverless deploy
```

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
// Provider options
type Provider = 'server' | 'aws-apigatewayv1' | 'aws-apigatewayv2';

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
  compose?: {
    services?: ComposeServicesConfig | ComposeServiceName[];
  };
}

// Service configuration for docker-compose
type ComposeServiceName = 'postgres' | 'redis' | 'rabbitmq';
type ComposeServicesConfig = {
  [K in ComposeServiceName]?: boolean | { version?: string };
};

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
  provider: Provider;
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