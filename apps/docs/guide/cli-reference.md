# CLI Reference

The `@geekmidas/cli` package provides the `gkm` command-line interface for building, development, and deployment.

## Installation

```bash
# Install globally
npm install -g @geekmidas/cli

# Or use via npx
npx @geekmidas/cli <command>

# Or add to project
pnpm add -D @geekmidas/cli
```

## Configuration

Create a `gkm.config.ts` file in your project root:

```typescript
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  // Required
  routes: 'src/endpoints/**/*.ts',
  envParser: './src/config/env',
  logger: './src/config/logger',

  // Optional construct patterns
  functions: 'src/functions/**/*.ts',
  crons: 'src/crons/**/*.ts',
  subscribers: 'src/subscribers/**/*.ts',

  // Development tools
  telescope: {
    enabled: true,
    path: '/__telescope',
  },
  studio: {
    enabled: true,
    path: '/__studio',
  },

  // Server hooks
  hooks: {
    server: './src/config/hooks',
  },

  // Build providers
  providers: {
    server: {
      enableOpenApi: true,
      production: {
        bundle: true,
        minify: true,
      },
    },
    aws: {
      apiGateway: { v2: true },
      lambda: { functions: true, crons: true },
    },
  },

  // Environment files
  env: ['.env', '.env.local'],
});
```

## Commands

### `gkm dev`

Start development server with hot-reload.

```bash
gkm dev [options]

Options:
  --port, -p <number>    Port number (default: 3000)
  --host <string>        Host to bind (default: localhost)
  --open                 Open browser automatically
```

**Features:**
- Hot-reload on file changes
- Telescope debugging dashboard at `/__telescope`
- Studio database browser at `/__studio`
- OpenAPI docs at `/__docs`
- Automatic endpoint discovery

### `gkm build`

Build for production deployment.

```bash
gkm build [options]

Options:
  --provider <string>    Build provider: server, aws-apigatewayv1, aws-apigatewayv2
  --minify               Minify output
  --sourcemap            Generate source maps
```

**Output Structure:**
```
.gkm/
├── server/
│   ├── app.ts           # Hono app entry point
│   ├── endpoints.ts     # All endpoint exports
│   └── dist/            # Production bundle
├── aws-apigatewayv2/
│   ├── routes/*.ts      # Per-endpoint handlers
│   └── manifest.json    # Route manifest
└── manifest.json        # Multi-provider summary
```

### `gkm openapi`

Generate OpenAPI specification from endpoints.

```bash
gkm openapi [options]

Options:
  --output, -o <path>    Output path (default: .gkm/openapi.ts)
  --title <string>       API title
  --version <string>     API version
```

### `gkm generate:react-query`

Generate React Query hooks from OpenAPI specification.

```bash
gkm generate:react-query [options]

Options:
  --input, -i <path>     Input OpenAPI file (default: .gkm/openapi.ts)
  --output, -o <path>    Output path for hooks
```

### `gkm init`

Scaffold a new project with templates.

```bash
gkm init <project-name> [options]

Options:
  --template, -t <name>  Template: minimal, api, serverless, worker, fullstack
  --yes, -y              Skip prompts and use defaults
```

**Templates:**
- `minimal` - Basic endpoint setup
- `api` - Full API with database
- `serverless` - AWS Lambda ready
- `worker` - Background job processing
- `fullstack` - API + Frontend (Next.js)

### `gkm exec`

Execute a command with workspace environment variables injected.

```bash
gkm exec [options] -- <command>

Options:
  --app, -a <name>       App context for env resolution (auto-detected from cwd)
  --stage, -s <name>     Stage for env resolution (default: development)
```

**Examples:**
```bash
# Run Next.js dev with injected env vars
gkm exec -- next dev --turbopack

# Run with specific app context
gkm exec --app web -- next build

# Run tests with production env vars
gkm exec --stage production -- vitest run
```

**Injected Environment Variables:**

The `exec` command injects environment variables based on the workspace config:

| Variable | Source |
|----------|--------|
| `NEXT_PUBLIC_API_URL` | URL of API app from workspace |
| `NEXT_PUBLIC_AUTH_URL` | URL of auth app from workspace |
| `API_URL` | Internal API URL |
| `AUTH_URL` | Internal auth URL |
| `DATABASE_URL` | From secrets (if configured) |
| Custom vars | From app's `env` config |

This is particularly useful for frontend apps that need to know the URLs of backend services:

```typescript
// gkm.config.ts
export default defineConfig({
  apps: {
    api: { type: 'backend', port: 3000, ... },
    auth: { type: 'auth', port: 3002, ... },
    web: { type: 'frontend', port: 3001, dependencies: ['api', 'auth'], ... },
  },
});
```

```json
// apps/web/package.json
{
  "scripts": {
    "dev": "gkm exec -- next dev --turbopack",
    "build": "gkm exec -- next build"
  }
}
```

### `gkm deploy`

Deploy to providers.

```bash
gkm deploy [options]

Options:
  --stage, -s <name>     Deployment stage (development, staging, production)
  --provider <name>      Deploy provider: docker, dokploy, aws-lambda
  --dry-run              Show what would be deployed
```

### `gkm docker`

Generate Docker files.

```bash
gkm docker [options]

Options:
  --compose              Generate docker-compose.yml
  --services <list>      Include services: postgres, redis, rabbitmq
```

### Secrets Management

```bash
# Initialize secrets for a stage
gkm secrets:init --stage production

# Set a secret
gkm secrets:set --stage production --key API_KEY --value "secret"

# Show secrets (masked)
gkm secrets:show --stage production

# Show secrets (revealed)
gkm secrets:show --stage production --reveal

# Rotate service passwords
gkm secrets:rotate --stage production --service postgres

# Import from JSON
gkm secrets:import --stage production --file secrets.json
```

### State Management

```bash
# Pull deployment state from remote
gkm state:pull --stage production

# Push state to remote
gkm state:push --stage production

# Show current state
gkm state:show --stage production

# Compare local vs remote
gkm state:diff --stage production
```

### Authentication

```bash
# Login to deployment service
gkm login --provider dokploy

# Show current auth status
gkm whoami

# Logout
gkm logout
```

## Server Hooks

Create custom middleware and routes with server hooks:

```typescript
// src/config/hooks.ts
import type { Hono } from 'hono';
import type { Logger } from '@geekmidas/logger';
import type { EnvironmentParser } from '@geekmidas/envkit';
import { cors } from 'hono/cors';

interface HookContext {
  envParser: EnvironmentParser;
  logger: Logger;
}

export function beforeSetup(app: Hono, ctx: HookContext) {
  // Called BEFORE gkm endpoints are registered
  app.use('*', cors());

  // Custom routes
  app.get('/custom/health', (c) => c.json({ status: 'ok' }));
}

export function afterSetup(app: Hono, ctx: HookContext) {
  // Called AFTER gkm endpoints are registered
  app.notFound((c) => c.json({ error: 'Not Found' }, 404));

  app.onError((err, c) => {
    ctx.logger.error({ error: err }, 'Unhandled error');
    return c.json({ error: 'Internal Server Error' }, 500);
  });
}
```

## Environment Variables

The CLI respects these environment variables:

| Variable | Description |
|----------|-------------|
| `GKM_CONFIG_PATH` | Custom config file path |
| `GKM_PORT` | Default port for dev server |
| `GKM_HOST` | Default host for dev server |
| `NODE_ENV` | Environment mode |

## Module Path Syntax

The CLI supports a special syntax for referencing exports:

```typescript
// Reference default export
envParser: './src/config/env'

// Reference named export
envParser: './src/config/env#envParser'

// Reference nested export
logger: './src/config/index#logger'
```
