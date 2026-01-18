# Deployment Guide

This guide covers deploying @geekmidas workspace applications to various targets with the CLI's sophisticated deployment system.

## Overview

The CLI provides a complete deployment pipeline for monorepo workspaces:
- **Environment Sniffing** - Automatic detection of required environment variables
- **State Management** - Track deployments across local and remote storage
- **DNS Automation** - Automatic DNS configuration with multiple providers
- **Secrets Management** - Encrypted secrets injection during builds
- **Multi-App Orchestration** - Coordinated deployment of workspace apps

## Quick Start

```typescript
// gkm.config.ts
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
    },
    auth: {
      type: 'auth',
      path: 'apps/auth',
      port: 3001,
      provider: 'better-auth',
      entry: './src/index.ts',
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
    db: true,
    cache: true,
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
    },
  },

  state: {
    provider: 'ssm',
    region: 'us-east-1',
  },
});
```

```bash
# Deploy to production
gkm deploy --stage production
```

---

## Build Providers

### Server Provider

Generates a standalone Node.js server application using Hono.

```bash
gkm build --provider server
```

**Output:** `.gkm/server/`
- `app.ts` - Hono application entry point
- `dist/` - Production bundle (when bundling enabled)

**Production Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `bundle` | `true` | Bundle server into single file |
| `minify` | `true` | Minify bundled output |
| `healthCheck` | `'/health'` | Health check endpoint path |
| `gracefulShutdown` | `true` | Enable graceful shutdown handling |
| `external` | `[]` | Packages to exclude from bundling |
| `openapi` | `false` | Include OpenAPI spec in production |

```typescript
// gkm.config.ts
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  apps: {
    api: {
      path: 'apps/api',
      type: 'backend',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env',
      logger: './src/config/logger',
      providers: {
        server: {
          enableOpenApi: true,
          production: {
            bundle: true,
            minify: true,
            healthCheck: '/health',
            external: ['@prisma/client'],
          },
        },
      },
    },
  },
});
```

### AWS Lambda Provider

Generates handlers compatible with AWS API Gateway.

```bash
# API Gateway v2 (HTTP API)
gkm build --provider aws-apigatewayv2

# API Gateway v1 (REST API)
gkm build --provider aws-apigatewayv1

# Direct Lambda (functions, crons)
gkm build --provider aws-lambda
```

**Output:** `.gkm/aws-apigatewayv2/`
- `routes/` - Per-endpoint handlers
- `manifest.json` - Route manifest for IaC

**With SST:**
```typescript
// sst.config.ts
import { manifest } from './.gkm/manifest.json';

export default {
  stacks(app) {
    app.stack(({ stack }) => {
      manifest.routes.forEach((route) => {
        new Function(stack, route.name, {
          handler: route.handler,
          environment: route.environment,
        });
      });
    });
  },
};
```

## Docker Deployment

### Generate Docker Files

```bash
gkm docker --compose --services postgres,redis
```

**Generated Files:**
- `Dockerfile` - Multi-stage production build
- `docker-compose.yml` - Development environment

### Dockerfile Structure

```dockerfile
# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm gkm build --provider server

# Production stage
FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.gkm/server/dist ./
EXPOSE 3000
CMD ["node", "app.js"]
```

### Build and Run

```bash
# Build image
docker build -t my-api .

# Run container
docker run -p 3000:3000 \
  -e DATABASE_URL="postgres://..." \
  -e JWT_SECRET="..." \
  my-api
```

## Dokploy Deployment

[Dokploy](https://dokploy.com) is a self-hosted deployment platform.

### Initialize Project

```bash
# Login to Dokploy instance
gkm login --provider dokploy

# Initialize deployment
gkm deploy:init --stage production
```

### Configure Secrets

```bash
# Set required environment variables
gkm secrets:set --stage production --key DATABASE_URL --value "postgres://..."
gkm secrets:set --stage production --key JWT_SECRET --value "your-secret"

# Or import from file
gkm secrets:import --stage production --file .env.production
```

### Deploy

```bash
# Deploy to production
gkm deploy --stage production

# Preview changes first
gkm deploy --stage production --dry-run
```

### Manage Deployments

```bash
# List deployments
gkm deploy:list --stage production

# View logs
gkm deploy:logs --stage production

# Rollback
gkm deploy:rollback --stage production
```

## Environment Management

### Stages

The CLI supports multiple deployment stages:

- `development` - Local development
- `staging` - Pre-production testing
- `production` - Live environment

### Secrets Management

```bash
# Initialize secrets for a stage
gkm secrets:init --stage production

# View current secrets (masked)
gkm secrets:show --stage production

# Rotate service passwords
gkm secrets:rotate --stage production --service postgres
```

**Secrets Storage:**
- Local: Encrypted in `.gkm/secrets/`
- Remote: AWS SSM Parameter Store or Dokploy

### State Management

Track deployment state across environments:

```bash
# Sync local state with remote
gkm state:pull --stage production

# Push local changes
gkm state:push --stage production

# Compare states
gkm state:diff --stage production
```

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm gkm build --provider server

      - name: Deploy to Dokploy
        env:
          DOKPLOY_TOKEN: ${{ secrets.DOKPLOY_TOKEN }}
        run: |
          pnpm gkm login --provider dokploy --token $DOKPLOY_TOKEN
          pnpm gkm deploy --stage production
```

### AWS Deployment

```yaml
# .github/workflows/aws-deploy.yml
name: AWS Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm gkm build --provider aws-apigatewayv2

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: us-east-1

      - run: npx sst deploy --stage production
```

## Health Checks

Configure health check endpoints:

```typescript
// gkm.config.ts
export default defineConfig({
  providers: {
    server: {
      production: {
        healthCheck: '/health',
      },
    },
  },
});
```

Or create a custom health endpoint:

```typescript
// src/endpoints/health.ts
import { e } from '@geekmidas/constructs/endpoints';

export const healthCheck = e
  .get('/health')
  .authorizer('none')
  .handle(async ({ services }) => {
    // Check dependencies
    const dbHealthy = await services.database.ping();
    const cacheHealthy = await services.cache.ping();

    return {
      status: dbHealthy && cacheHealthy ? 'healthy' : 'degraded',
      checks: {
        database: dbHealthy,
        cache: cacheHealthy,
      },
    };
  });
```

## Production Checklist

Before deploying to production:

- [ ] All tests passing (`pnpm test:once`)
- [ ] Type checks passing (`pnpm ts:check`)
- [ ] Linting passing (`pnpm lint`)
- [ ] Environment variables configured
- [ ] Secrets set for production stage
- [ ] Health check endpoint configured
- [ ] Logging configured for production
- [ ] Error tracking enabled (Sentry, etc.)
- [ ] Rate limiting configured
- [ ] CORS configured appropriately
- [ ] Database migrations applied
