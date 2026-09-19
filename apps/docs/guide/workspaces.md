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
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  // The scope every physical name is built from: `Database` becomes
  // `production-my-monorepo-database` on Dokploy and on AWS alike.
  name: 'my-monorepo',

  // One glob, every kind. A database implies Postgres, a bucket implies MinIO,
  // mail implies Mailpit — none of it listed anywhere. It is also where the
  // apps come from: a `StaticSite` is an app, and so is a `RestApi` that named
  // one.
  constructs: './constructs/**/*.ts',

  deploy: {
    default: 'dokploy',
  },
});
```

That is a whole workspace config. There is no `services` block, because every
key in it has a default that follows the deploy target:

| | on `dokploy` / `docker` | on `aws` |
|---|---|---|
| `cache` | `db` — the connection pool is already open | `upstash` — reachable from a Lambda with no VPC |
| `storage` | `minio` | `s3` |
| `mail` | `ses` | `ses` |
| `events` | `pgboss` | `pgboss` |

Write one only to override:

```typescript
services: {
  cache: 'upstash',  // a real Redis even on Dokploy
  mail: 'resend',
}
```

`db` and `storage` are not selections at all — they are derived from the
declared `KyselyDatabase` and `ObjectStorage`, and ignored here, so the two
cannot disagree.

::: info There is no `apps` block
There used to be one, naming each app with its type, path, port, framework and
dependencies — every one of which was already declared. `StaticSite('Web', {
path: 'apps/web' })` and `apps.web = { type: 'web', path: 'apps/web', framework:
'vite', dependencies: ['api'] }` are the same sentence written twice, and only
one of the two was checked against anything. So the copy that could drift is
gone, and the apps are read off the graph:

```typescript
// constructs/api.ts — a backend app
export const api = new RestApi('Api', {
  defaultAuthorizer: 'none',
  logger,
});

// constructs/site.ts — two frontend apps, and the edges that order them
export const web = new StaticSite('Web').dependsOn([api, auth]);

export const admin = new StaticSite('Admin', { variant: 'next' })
  .dependsOn([api]);
```

No paths: `Web` means `apps/web` and `Admin` means `apps/admin`, which is what
the ids already said. Write one only when the layout differs.

`.dependsOn()` is where `dependencies: ['api']` went. It is the same fact, but
it is the one the build already needed — it derives the environment, the client
and the deploy order from it.

Every surface gets a container, and nobody asks for one. There is no
arrangement in which one runs inside another — two surfaces in a process share
a filesystem, an environment and every credential either was granted, so an
auth server beside an API is one bug in the API away from being read by it.
:::

::: info Apps that share a database
An app that shares a database with another declares a derived form of it —
`database.schema()` for its own schema and role, or `database.reader()` for
read-only access — rather than reaching for the same URL by string.
:::

::: tip
Use `defineWorkspace()` (not `defineConfig()`) for multi-app workspaces.
:::

### There Is One Config, at the Root

Apps in a workspace do not carry a `gkm.config.ts` of their own. Everything an
app used to state there it states in the declaration that makes it an app —
where its code lives, what it depends on, which logger and environment parser
it runs with:

```typescript
// constructs/api.ts
export const api = new RestApi('Api', {
  defaultAuthorizer: 'none',
  // The actual logger, not a path to one. It used to be
  // `logger: './src/config/logger'` in config, because the build wrote an
  // import into each generated handler. Endpoints built from the surface carry
  // it, so there is nothing to print and nothing to keep in step with a moved
  // file.
  logger,
  telescope,
});
```

A **standalone** single-app project — one app, no workspace — still uses
`defineConfig()`, which is the last place the older shape survives:

```typescript
// gkm.config.ts
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  constructs: './src/constructs/**/*.ts',
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env#envParser',
  logger: './src/config/logger',
});
```

::: warning These three are module paths, and the surface replaced them
`logger: './src/config/logger'` is a path the build prints into every generated
handler — checked by nothing, and wrong the moment the file moves. `logger` on
a `RestApi` is the logger itself.

`defineConfig` still requires all three. Prefer a workspace: `defineWorkspace`
takes the `constructs` glob alone, and everything else is read off what the
constructs declare.
:::

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

Each backend app exposes its generated OpenAPI client as a package entry point. Frontends import it directly — no copy step needed:

```typescript
// apps/web/src/lib/api.ts
import { createApi } from '@myapp/api/client';
```

The `./client` entry point is generated at build time into `.gkm/openapi.ts` and exposed via the backend app's `package.json` exports. TypeScript resolves it through the monorepo's package references.

To regenerate the client after endpoint changes:

```bash
gkm openapi   # regenerates .gkm/openapi.ts for all backend apps
gkm build     # also regenerates as part of the build
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
import { api } from '../constructs/api';

export const getUser = api
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
// constructs/site.ts
export const web = new StaticSite('Web', { path: 'apps/web' })
  .dependsOn([api]); // Explicit
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
