# Getting Started

## Prerequisites

- Node.js >= 22.0.0
- pnpm >= 10.13.1
- Docker (for local services — PostgreSQL, Redis, MinIO, etc.)

## Install the CLI

```bash
pnpm add -g @geekmidas/cli
```

## Create a New Project

```bash
gkm init my-project
```

### Interactive Setup

The init command walks you through project setup:

```
? Template:
  ❯ API        — Single backend API with endpoints
    Fullstack  — Monorepo with API + Next.js + shared models

? Services (space to select):
  ◉ PostgreSQL
  ◉ Redis
  ◉ Mailpit
  ◉ MinIO

? Event backend:
  ❯ pg-boss   — PostgreSQL job queue (no extra container)
    SNS/SQS   — AWS via LocalStack
    RabbitMQ  — AMQP broker
    None

? Deployment target:
  ❯ Dokploy
    Configure later
```

### Quick Start (non-interactive)

```bash
# All defaults: fullstack template, all services, pgboss, dokploy
gkm init my-saas --template fullstack --yes

# API-only
gkm init my-api --template api --yes
```

### Templates

| Template | Description |
|----------|-------------|
| `api` | Single backend API with endpoints, auth, database |
| `fullstack` | Monorepo — API + Better Auth + Next.js + shared models |
| `worker` | Background job processing with events, crons, subscribers |
| `serverless` | AWS Lambda handlers |
| `minimal` | Health endpoint only |

::: info
The interactive prompt shows **API** and **Fullstack** by default. Use `--template` to select others:
```bash
gkm init my-worker --template worker --yes
```
:::

---

## End-to-End: From Init to Running App

This section walks through everything after `gkm init` — how credentials work, how services start, and how your app receives injected environment variables.

### 1. What `gkm init` Creates

After init, your project has encrypted secrets already bootstrapped for the `development` stage:

```
my-project/
├── .gkm/
│   └── secrets/
│       └── development.json   # encrypted credentials (safe to commit)
├── gkm.config.ts              # workspace / app config
├── docker-compose.yml         # local services
└── ...
```

The key for decrypting `development.json` is stored separately at:

```
~/.gkm/my-project/development.key
```

This key **never** enters source control. The encrypted secrets file can be committed freely.

### 2. What Gets Seeded Automatically

`gkm init` generates and encrypts sane development defaults including:

| Secret | Value |
|--------|-------|
| `DATABASE_URL` | `postgres://...@localhost:5432/my-project` |
| `REDIS_URL` | `redis://localhost:6379` |
| `STORAGE_ACCESS_KEY_ID` | derived from MinIO default user |
| `STORAGE_SECRET_ACCESS_KEY` | derived from MinIO default password |
| `EVENT_PUBLISHER_CONNECTION_STRING` | pgboss connection string |
| `EVENT_SUBSCRIBER_CONNECTION_STRING` | pgboss connection string |
| `JWT_SECRET` | randomly generated |
| `NODE_ENV` | `development` |

You can view them any time:

```bash
gkm secrets:show --stage development
```

### 3. Reconcile Services (First Run)

Run `gkm setup` once after init (and after changing `services` in the config). It:
- Starts Docker services with credentials injected from your stage secrets — each project gets its own isolated containers, so multiple projects can run concurrently without port or credential collisions
- Creates the database, roles, and schemas
- Sets up pgboss if `events: 'pgboss'`
- Validates that all required secrets exist

```bash
gkm setup
```

### 4. Start the Dev Server

```bash
gkm dev
```

`gkm dev` decrypts your stage secrets and **injects them as environment variables** before starting each app and its Docker services. Your code accesses them via `process.env` — no `.env` files needed. Because secrets are injected dynamically, multiple projects can run simultaneously without collisions.

```
[api]  Decrypting secrets (development)...
[api]  Starting on http://localhost:3000
[api]  Telescope: http://localhost:3000/__telescope
[auth] Starting on http://localhost:3002
[web]  Waiting for api, auth...
[web]  Starting on http://localhost:3001
```

::: tip Multiple projects
`gkm dev` and `gkm test` each spin up Docker services with project-scoped credentials. Running `gkm dev` in two different projects starts two independent PostgreSQL (and Redis, MinIO, etc.) containers — no manual port mapping needed.
:::

### 5. How Credential Injection Works

`gkm dev` (and `gkm exec`) use a preload script to inject secrets **before** your app code runs. The flow is:

```
~/.gkm/my-project/development.key
         │
         ▼ decrypt
.gkm/secrets/development.json
         │
         ▼ AES-256-GCM
globalThis.__gkm_credentials__  (set by preload)
         │
         ▼ read by
@geekmidas/envkit Credentials
         │
         ▼ merged into
EnvironmentParser.parse()
```

In your app code:

```typescript
// apps/api/src/config/env.ts
import { EnvironmentParser } from '@geekmidas/envkit';
import { Credentials } from '@geekmidas/envkit/credentials';

export const envParser = new EnvironmentParser({
  ...process.env,
  ...Credentials,  // ← injected secrets merged here
});

export const config = envParser
  .create((get) => ({
    port: get('PORT').string().transform(Number).default(3000),
    databaseUrl: get('DATABASE_URL').string().url(),
    redisUrl: get('REDIS_URL').string(),
  }))
  .parse();
```

`Credentials` resolves (in priority order):
1. `globalThis.__gkm_credentials__` — set by `gkm dev`/`gkm exec` preload
2. Build-time decryption via `GKM_MASTER_KEY` — for CI/CD and Docker builds
3. Empty object — fallback when no credentials are available

::: warning
Never read secrets with `process.env` directly in production-critical paths. Always go through `EnvironmentParser` with `Credentials` merged in — this ensures the same code works in dev (preload injection) and production (build-time or runtime decryption).
:::

### 6. Running One-Off Commands with Secrets

Use `gkm exec` to run any command with secrets injected:

```bash
# Run a migration with DATABASE_URL injected
gkm exec -- pnpm db:migrate

# Run a script with all dev secrets
gkm exec -- node scripts/seed.ts

# Open a psql shell with DATABASE_URL injected
gkm exec -- psql $DATABASE_URL
```

### 7. Managing Secrets

```bash
# Add a new secret
gkm secrets:set STRIPE_KEY sk_test_xxx --stage development

# View all secrets (values masked)
gkm secrets:show --stage development

# Rotate the encryption key
gkm secrets:rotate --stage development

# Initialize a new stage (e.g., production)
gkm secrets:init --stage production
```

Production secrets use the same encrypted format but get a separate key at `~/.gkm/my-project/production.key`. In CI/CD, provide the key via `GKM_MASTER_KEY`.

---

## Workspace Configuration

The generated `gkm.config.ts` for the fullstack template:

```typescript
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'my-saas',

  apps: {
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',
      openapi: { enabled: true },
    },
    auth: {
      type: 'backend',
      path: 'apps/auth',
      port: 3002,
      entry: './src/index.ts',
      framework: 'better-auth',
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',
    },
    web: {
      type: 'frontend',
      framework: 'nextjs',
      path: 'apps/web',
      port: 3001,
      dependencies: ['api', 'auth'],
    },
  },

  shared: {
    packages: ['packages/*'],
    models: { path: 'packages/models', schema: 'zod' },
  },

  services: {
    db: true,       // postgres:18-alpine
    cache: true,    // redis:8-alpine
    mail: true,     // Mailpit in dev, SMTP in production
    storage: true,  // MinIO in dev, AWS S3 in production
    events: 'pgboss', // pgboss | sns | rabbitmq
  },

  secrets: { enabled: true },
});
```

### Services Reference

| Key | Dev container | Production |
|-----|---------------|------------|
| `db: true` | `postgres:18-alpine` | Provisioned PostgreSQL |
| `cache: true` | `redis:8-alpine` | Provisioned Redis |
| `mail: true` | Mailpit | SMTP provider |
| `storage: true` | MinIO | AWS S3 |
| `events: 'pgboss'` | Reuses PostgreSQL | Reuses PostgreSQL |
| `events: 'sns'` | LocalStack (SNS+SQS) | AWS SNS+SQS |
| `events: 'rabbitmq'` | RabbitMQ | Provisioned RabbitMQ |

---

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
    ];
  });
```

The endpoint is auto-discovered from the `routes` glob and available at `GET /users`.

## Inject Services into Endpoints

```typescript
// apps/api/src/services/database.ts
import type { Service } from '@geekmidas/services';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

export const databaseService = {
  serviceName: 'db' as const,
  async register(envParser) {
    const { databaseUrl } = envParser
      .create((get) => ({ databaseUrl: get('DATABASE_URL').string() }))
      .parse();
    return new Kysely({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl }) }),
    });
  },
} satisfies Service<'db', Kysely<Database>>;

// apps/api/src/endpoints/users.ts
export const listUsers = e
  .get('/users')
  .services([databaseService])
  .handle(async ({ services }) => {
    return await services.db.selectFrom('users').selectAll().execute();
  });
```

---

## Build for Production

```bash
# Build server application
gkm build --provider server --production

# Generate Docker files
gkm docker

# Deploy (Dokploy)
gkm deploy --stage production
```

---

## Next Steps

- [CLI Reference](/packages/cli) — All `gkm` commands
- [Workspaces](/guide/workspaces) — Multi-app monorepo configuration
- [Testing](/guide/testing) — Testing patterns
- [Deployment](/guide/deployment) — Production deployment
