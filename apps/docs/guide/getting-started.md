# Getting Started

## Prerequisites

- Node.js >= 22.0.0
- pnpm >= 10.13.1

## Create a New Project

The fastest way to get started is using the CLI's init command:

```bash
# Install CLI globally
pnpm add -g @geekmidas/cli

# Create a new workspace
gkm init my-project
```

### Interactive Setup

The init command guides you through project setup:

```
? Template: › (Use arrow keys)
    Minimal - Basic health endpoint
  ❯ Fullstack - API + Web with database
    API - Backend API with auth and database
    Serverless - AWS Lambda handlers

? Include Telescope (debugging dashboard)? › Yes
? Include database support? › Yes
? Logger: › Pino (recommended)
```

### Templates

| Template | Description | Includes |
|----------|-------------|----------|
| `minimal` | Basic health endpoint | Hono, envkit, logger |
| `fullstack` | API + Next.js frontend | + Better Auth, db, cache, web app, shared models |
| `api` | Backend API | + db, cache, services, JWT auth utilities |
| `serverless` | AWS Lambda | + cloud, Lambda adapters |
| `worker` | Background job processing | + events, subscribers, crons |

::: info
The interactive prompt shows **API** and **Fullstack** by default. Use `--template` to select other templates directly:
```bash
gkm init my-worker --template worker --yes
```
:::

### Quick Start (Non-Interactive)

```bash
# Create fullstack workspace with defaults
gkm init my-saas --template fullstack --yes

# Create API-only project
gkm init my-api --template api --yes
```

## Project Structure

After initialization, your workspace looks like this (fullstack template):

```
my-project/
├── apps/
│   ├── api/                    # Backend API
│   │   ├── src/
│   │   │   ├── config/
│   │   │   │   ├── env.ts      # Environment parser
│   │   │   │   ├── logger.ts   # Logger setup
│   │   │   │   └── telescope.ts
│   │   │   └── endpoints/
│   │   │       └── health.ts   # Health check endpoint
│   │   └── gkm.config.ts       # App-level config (optional)
│   ├── auth/                   # Better Auth server (fullstack only)
│   │   └── src/
│   │       ├── auth.ts         # Better Auth instance
│   │       ├── index.ts        # Hono server entry
│   │       └── config/
│   │           ├── env.ts
│   │           └── logger.ts
│   └── web/                    # Next.js frontend (fullstack only)
│       └── ...
├── packages/
│   └── models/                 # Shared Zod schemas
├── gkm.config.ts               # Workspace configuration
├── docker-compose.yml          # Local services
├── pnpm-workspace.yaml
└── turbo.json
```

## Start Development

```bash
cd my-project

# Start all apps with hot reload
gkm dev

# Output:
# [api] Starting on http://localhost:3000
# [api] Telescope: http://localhost:3000/__telescope
# [web] Starting on http://localhost:3001
```

## Configuration

The generated `gkm.config.ts` defines your workspace (fullstack template):

```typescript
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'my-project',

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
});
```

### App Types

| Type | Description | Key Config |
|------|-------------|------------|
| `backend` | API with gkm endpoints | `routes`, `envParser`, `logger` |
| `auth` | Better Auth server (fullstack template) | `provider`, `entry`, `requiredEnv` |
| `frontend` | Web application | `framework`, `dependencies` |

### Auth App (Better Auth)

The fullstack template includes a [Better Auth](https://better-auth.com) server with magic link authentication:

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

The generated auth app uses magic link authentication:

```typescript
// apps/auth/src/auth.ts
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import pg from 'pg';

export const auth = betterAuth({
  database: new pg.Pool({ connectionString: process.env.DATABASE_URL }),
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(','),
  secret: process.env.BETTER_AUTH_SECRET,
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        // TODO: Implement email sending
        console.log('Magic link for', email, ':', url);
      },
    }),
  ],
});
```

```typescript
// apps/auth/src/index.ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { auth } from './auth.js';

const app = new Hono();
app.get('/health', (c) => c.json({ status: 'ok' }));
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

serve({ fetch: app.fetch, port: 3001 });
```

**Auto-Injected Environment Variables:**

| Variable | Description |
|----------|-------------|
| `BETTER_AUTH_URL` | Derived from app hostname |
| `BETTER_AUTH_SECRET` | Generated and persisted |
| `BETTER_AUTH_TRUSTED_ORIGINS` | All frontend URLs |

## Create Your First Endpoint

```typescript
// apps/api/src/endpoints/users.ts
import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

export const listUsers = e
  .get('/users')
  .output(z.array(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  })))
  .handle(async () => {
    return [
      { id: '1', name: 'Alice', email: 'alice@example.com' },
      { id: '2', name: 'Bob', email: 'bob@example.com' },
    ];
  });

export const createUser = e
  .post('/users')
  .body(z.object({
    name: z.string(),
    email: z.string().email(),
  }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }))
  .handle(async ({ body }) => {
    return { id: crypto.randomUUID(), ...body };
  });
```

The endpoint is automatically discovered and available at `http://localhost:3000/users`.

## Add Services

Inject database, cache, or custom services:

```typescript
// apps/api/src/services/database.ts
import type { Service } from '@geekmidas/services';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

export const databaseService = {
  serviceName: 'db' as const,
  async register(envParser) {
    const config = envParser.create((get) => ({
      url: get('DATABASE_URL').string(),
    })).parse();

    return new Kysely({
      dialect: new PostgresDialect({
        pool: new pg.Pool({ connectionString: config.url }),
      }),
    });
  },
} satisfies Service<'db', Kysely<Database>>;
```

```typescript
// apps/api/src/endpoints/users.ts
import { e } from '@geekmidas/constructs/endpoints';
import { databaseService } from '../services/database';

export const listUsers = e
  .get('/users')
  .services([databaseService])
  .handle(async ({ services }) => {
    return await services.db
      .selectFrom('users')
      .selectAll()
      .execute();
  });
```

## Environment Variables

Secrets are managed with encrypted storage:

```bash
# Initialize secrets for development
gkm secrets:init --stage development

# Set a secret
gkm secrets:set STRIPE_KEY sk_test_xxx --stage development

# View secrets (masked)
gkm secrets:show --stage development
```

## Build for Production

```bash
# Build server application
gkm build --provider server --production

# Generate Docker files
gkm docker

# Deploy to Dokploy
gkm deploy --stage production
```

## Next Steps

- [CLI Reference](/packages/cli) - All CLI commands
- [Workspaces](/guide/workspaces) - Multi-app configuration
- [Testing](/guide/testing) - Testing patterns
- [Deployment](/guide/deployment) - Production deployment
