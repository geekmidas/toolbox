# Workspaces Guide

This guide covers how to work with monorepo workspaces using the @geekmidas toolbox.

## Overview

The CLI supports workspace mode for monorepos, enabling:
- Unified development server orchestration across multiple apps
- Smart dependency-aware build ordering
- Shared configuration with app-specific overrides
- Automatic client regeneration when API changes

## Workspace Structure

A typical workspace layout:

```
my-monorepo/
├── apps/
│   ├── api/                 # Backend API
│   │   ├── src/
│   │   │   └── endpoints/
│   │   └── gkm.config.ts
│   ├── web/                 # Frontend (Next.js, etc.)
│   │   └── package.json
│   └── admin/               # Admin dashboard
│       └── package.json
├── packages/
│   ├── shared/              # Shared utilities
│   └── types/               # Shared TypeScript types
├── gkm.config.ts            # Root workspace config
├── pnpm-workspace.yaml
└── turbo.json
```

## Workspace Configuration

### Root Configuration

```typescript
// gkm.config.ts (root)
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  // Workspace mode configuration
  workspace: {
    // Apps to orchestrate
    apps: {
      api: {
        path: 'apps/api',
        type: 'backend',
        port: 3000,
      },
      web: {
        path: 'apps/web',
        type: 'frontend',
        port: 3001,
        dependsOn: ['api'], // Start after API is ready
      },
      admin: {
        path: 'apps/admin',
        type: 'frontend',
        port: 3002,
        dependsOn: ['api'],
      },
    },

    // Shared environment
    env: ['.env', '.env.local'],
  },
});
```

### App-Specific Configuration

Each app can have its own `gkm.config.ts`:

```typescript
// apps/api/gkm.config.ts
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env',
  logger: './src/config/logger',

  telescope: { enabled: true },
  studio: { enabled: true },

  providers: {
    server: { enableOpenApi: true },
  },
});
```

## Development Workflow

### Starting All Apps

```bash
# From workspace root
gkm dev

# Output:
# [api] Starting on http://localhost:3000
# [api] Telescope: http://localhost:3000/__telescope
# [web] Waiting for api...
# [api] Ready
# [web] Starting on http://localhost:3001
# [admin] Starting on http://localhost:3002
```

### Starting Specific Apps

```bash
# Start only API
gkm dev --app api

# Start API and web
gkm dev --app api --app web
```

### Build Order

The CLI automatically determines build order based on dependencies:

```bash
gkm build

# Builds in order:
# 1. api (no dependencies)
# 2. web (depends on api)
# 3. admin (depends on api)
```

## Frontend Integration

### Auto-Generated API Client

When your frontend depends on the API, the CLI can automatically regenerate the typed client when endpoints change:

```typescript
// gkm.config.ts (root)
export default defineConfig({
  workspace: {
    apps: {
      api: {
        path: 'apps/api',
        type: 'backend',
        port: 3000,
      },
      web: {
        path: 'apps/web',
        type: 'frontend',
        port: 3001,
        dependsOn: ['api'],
        // Auto-regenerate client when API changes
        client: {
          output: './src/api/client.ts',
          format: 'react-query',
        },
      },
    },
  },
});
```

### Manual Client Generation

```bash
# Generate OpenAPI spec from API
gkm openapi --app api

# Generate React Query hooks for web app
gkm generate:react-query \
  --input apps/api/.gkm/openapi.ts \
  --output apps/web/src/api/hooks.ts
```

## Shared Packages

### Creating Shared Code

```typescript
// packages/shared/src/index.ts
export * from './utils';
export * from './constants';
```

### Using in Apps

```typescript
// apps/api/src/endpoints/users.ts
import { formatDate } from '@myorg/shared';
import { e } from '@geekmidas/constructs/endpoints';

export const getUser = e
  .get('/users/:id')
  .handle(async ({ params }) => {
    const user = await db.users.find(params.id);
    return {
      ...user,
      createdAt: formatDate(user.createdAt),
    };
  });
```

## Environment Variables

### Workspace-Level Variables

```bash
# .env (root)
DATABASE_URL=postgres://localhost:5432/myapp
REDIS_URL=redis://localhost:6379
JWT_SECRET=development-secret
```

### App-Specific Variables

```bash
# apps/api/.env.local
PORT=3000
LOG_LEVEL=debug

# apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### Variable Resolution

The CLI resolves environment variables in order:
1. App-specific `.env.local`
2. App-specific `.env`
3. Root `.env.local`
4. Root `.env`
5. System environment

## Turbo Integration

The CLI integrates with Turbo for task orchestration:

```json
// turbo.json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".gkm/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    }
  }
}
```

### Running with Turbo

```bash
# Build all packages and apps
turbo run build

# Run tests across workspace
turbo run test

# Development (prefer gkm dev for orchestration)
gkm dev
```

## Docker Workspace Builds

### Multi-App Docker Compose

```bash
gkm docker --workspace --services postgres,redis
```

Generates:

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: myapp
    ports:
      - "5432:5432"

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    ports:
      - "3000:3000"
    depends_on:
      - postgres
      - redis
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/myapp
      REDIS_URL: redis://redis:6379

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports:
      - "3001:3001"
    depends_on:
      - api
    environment:
      API_URL: http://api:3000
```

### Individual App Dockerfiles

```dockerfile
# apps/api/Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/ ./packages/

# Install and build
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm turbo run build --filter=api

# Production
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/apps/api/.gkm/server/dist ./
EXPOSE 3000
CMD ["node", "app.js"]
```

## Deployment Strategies

### Deploy Individual Apps

```bash
# Deploy only API
gkm deploy --app api --stage production

# Deploy frontend
gkm deploy --app web --stage production
```

### Deploy All Apps

```bash
# Deploy entire workspace
gkm deploy --stage production
```

### Staged Rollout

```bash
# 1. Deploy API first
gkm deploy --app api --stage production

# 2. Verify API health
curl https://api.example.com/health

# 3. Deploy frontends
gkm deploy --app web --app admin --stage production
```

## Best Practices

### 1. Keep Shared Code Minimal

Only share code that's truly reused:
- Type definitions
- Utility functions
- Constants and configurations

### 2. Use Explicit Dependencies

Always declare dependencies between apps:

```typescript
workspace: {
  apps: {
    web: {
      dependsOn: ['api'], // Explicit
    },
  },
}
```

### 3. Isolate Environment Variables

Keep app-specific variables in app directories:

```
apps/api/.env.local    # API-specific
apps/web/.env.local    # Web-specific
.env                   # Shared infrastructure
```

### 4. Use Consistent Versioning

Keep package versions in sync:

```json
// package.json (root)
{
  "pnpm": {
    "overrides": {
      "zod": "^3.22.0",
      "hono": "^4.0.0"
    }
  }
}
```

### 5. Separate Build and Deploy

```bash
# CI: Build all, test all
turbo run build test

# CD: Deploy independently
gkm deploy --app api --stage production
gkm deploy --app web --stage production
```

## Troubleshooting

### Port Conflicts

```bash
# Check what's using a port
lsof -i :3000

# Use different ports
gkm dev --app api --port 3100
```

### Dependency Cycles

If you see "Circular dependency detected":

1. Review your `dependsOn` configuration
2. Extract shared code to a package instead
3. Use event-driven communication

### Stale Client Types

If frontend types are out of sync:

```bash
# Force regenerate
gkm openapi --app api
gkm generate:react-query --force
```

### Build Cache Issues

```bash
# Clear Turbo cache
turbo run build --force

# Clear gkm artifacts
rm -rf apps/*/.gkm
```
