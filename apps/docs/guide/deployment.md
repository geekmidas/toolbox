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
```

---

## Environment Variables

The CLI handles environment variables differently in development and production.

### Development (`gkm dev`)

In development, environment variables come from multiple sources:

**1. Docker Compose Services**

When services are configured, connection URLs are auto-generated:

```typescript
services: {
  db: true,    // → DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
  cache: true, // → REDIS_URL=redis://localhost:6379
  mail: true,  // → SMTP_HOST=localhost, SMTP_PORT=1025
}
```

**2. Secrets Store**

Secrets from `.gkm/secrets/development.json` are injected:

```bash
# Set a development secret
gkm secrets:set STRIPE_KEY sk_test_xxx --stage development
```

**3. Per-App Mapping (Workspaces)**

For multi-app workspaces, app-prefixed secrets are mapped:

```
API_DATABASE_URL=...   → DATABASE_URL (for api app)
AUTH_DATABASE_URL=...  → DATABASE_URL (for auth app)
```

**4. .env Files**

Standard `.env` and `.env.local` files are loaded.

### Production (`gkm deploy`)

In production, the CLI auto-injects these variables:

| Variable | Source | Description |
|----------|--------|-------------|
| `PORT` | App config | From `port` in workspace config |
| `NODE_ENV` | Auto | Always `'production'` |
| `STAGE` | CLI flag | Deployment stage name |
| `DATABASE_URL` | Generated | Per-app credentials + Postgres service |
| `REDIS_URL` | Generated | Redis service connection |
| `BETTER_AUTH_URL` | Derived | `https://{app-hostname}` |
| `BETTER_AUTH_SECRET` | Generated | Random secret, persisted in state |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Derived | All frontend URLs (comma-separated) |

**Custom secrets** are injected from the secrets store:

```bash
# Set production secrets
gkm secrets:set STRIPE_KEY sk_live_xxx --stage production
gkm secrets:set SENDGRID_API_KEY SG.xxx --stage production
```

---

## Environment Sniffing

The CLI automatically detects required environment variables by analyzing your code.

### Detection Strategy (Priority Order)

1. **Explicit `requiredEnv`** - Direct list in app config takes priority
2. **Entry-based apps** - Imports entry file to capture `envParser.parse()` calls
3. **Route-based apps** - Calls `getEnvironment()` on endpoint constructs
4. **Frontend apps** - Returns empty array (no server secrets)

### How It Works

The sniffer runs your code in an isolated subprocess with a patched `EnvironmentParser` that records all accessed variables:

```typescript
// Your code
const config = new EnvironmentParser(process.env)
  .create((get) => ({
    database: get('DATABASE_URL').string(),  // Recorded!
    port: get('PORT').number(),              // Recorded!
  }))
  .parse();

// Sniffer detects: ['DATABASE_URL', 'PORT']
```

### Auto-Supported Variables

These variables are automatically resolved without manual configuration:

| Variable | Source |
|----------|--------|
| `PORT` | App config or default |
| `NODE_ENV` | Always `'production'` |
| `STAGE` | Deployment stage name |
| `DATABASE_URL` | Generated per-app credentials |
| `REDIS_URL` | Provisioned Redis service |
| `BETTER_AUTH_URL` | Derived from app hostname |
| `BETTER_AUTH_SECRET` | Generated and persisted |
| `BETTER_AUTH_TRUSTED_ORIGINS` | All frontend URLs |

### Explicit Requirements

Override automatic detection:

```typescript
// gkm.config.ts
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  apps: {
    api: {
      path: 'apps/api',
      type: 'backend',
      port: 3000,
      requiredEnv: ['DATABASE_URL', 'STRIPE_SECRET_KEY', 'SENDGRID_API_KEY'],
    },
  },
});
```

---

## State Providers

State providers track deployment resources (application IDs, service IDs, credentials) across deployments.

### LocalStateProvider (Default)

Stores state in the local filesystem.

- **Location:** `.gkm/deploy-{stage}.json`
- **Use case:** Single developer, local development

### SSMStateProvider

Stores state in AWS Systems Manager Parameter Store.

- **Location:** `/gkm/{workspaceName}/{stage}/state`
- **Encryption:** AWS-managed KMS key
- **Use case:** Teams, CI/CD pipelines

```typescript
// gkm.config.ts
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'my-app',  // Required for SSM provider
  apps: { /* ... */ },
  state: {
    provider: 'ssm',
    region: 'us-east-1',
  },
});
```

### CachedStateProvider

Wraps remote storage with local caching for faster reads.

```bash
# Sync remote state to local
gkm state:pull --stage production

# Push local changes to remote
gkm state:push --stage production

# Compare local vs remote
gkm state:diff --stage production
```

### State Contents

```typescript
interface DokployStageState {
  provider: 'dokploy';
  stage: string;
  environmentId: string;
  applications: Record<string, string>;     // appName -> applicationId
  services: {
    postgresId?: string;
    redisId?: string;
  };
  appCredentials?: Record<string, {
    dbUser: string;
    dbPassword: string;
  }>;
  generatedSecrets?: Record<string, Record<string, string>>;
  dnsVerified?: Record<string, {
    serverIp: string;
    verifiedAt: string;
  }>;
  lastDeployedAt: string;
}
```

---

## DNS Providers

Automatically configure DNS records for your deployed applications.

### Route53Provider

AWS Route 53 DNS management.

```typescript
// gkm.config.ts
export default defineWorkspace({
  deploy: {
    dns: {
      provider: 'route53',
      domain: 'myapp.com',        // Required - root domain
      region: 'us-east-1',        // Optional, uses AWS_REGION env var
      profile: 'production',      // Optional, AWS profile from ~/.aws/credentials
      hostedZoneId: 'Z123...',    // Optional, auto-detected from domain
      ttl: 300,                   // Optional, default 300
    },
  },
});
```

**Features:**
- Auto-detects hosted zone from domain name
- Batch processes records (up to 1000 per request)
- Idempotent - skips existing records with same value
- Supports: A, AAAA, CNAME, MX, TXT, SRV, CAA

**Authentication:** Uses AWS default credential chain (no login command required):
- Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- Shared credentials file (`~/.aws/credentials`)
- AWS profile via `profile` config option
- IAM role (EC2, ECS, Lambda)

### HostingerProvider

Hostinger DNS management.

```typescript
// gkm.config.ts
export default defineWorkspace({
  deploy: {
    dns: {
      provider: 'hostinger',
      domain: 'myapp.com',        // Required - root domain
      ttl: 300,                   // Optional, default 300
    },
  },
});
```

**Setup:**
1. Get API token from Hostinger hPanel profile
2. Store with `gkm login --provider hostinger`

### Manual DNS

For externally managed domains:

```typescript
// gkm.config.ts
export default defineWorkspace({
  deploy: {
    dns: {
      provider: 'manual',
      domain: 'myapp.com',        // Required - root domain
    },
  },
});
```

The CLI will display required DNS records for manual configuration.

### DNS Verification

After creating records, the CLI:
1. Waits for DNS propagation
2. Verifies records resolve to correct IP
3. Caches verification in state (skips on subsequent deploys)
4. Triggers SSL certificate generation via Dokploy

---

## Secrets Management

### Setting Secrets

```bash
# Initialize secrets for a stage
gkm secrets:init --stage production

# Set individual secrets
gkm secrets:set --stage production --key STRIPE_SECRET_KEY --value "sk_live_..."
gkm secrets:set --stage production --key SENDGRID_API_KEY --value "SG...."

# Import from JSON file
gkm secrets:import --stage production --file secrets.json
```

### Secret Types

**Custom Secrets** - User-provided key-value pairs:
```bash
gkm secrets:set --key API_KEY --value "secret"
```

**URL Secrets** - Connection strings:
```bash
gkm secrets:set --key DATABASE_URL --value "postgres://..."
gkm secrets:set --key REDIS_URL --value "redis://..."
```

**Service Secrets** - Auto-managed credentials:
- `POSTGRES_PASSWORD` - Generated when Postgres provisioned
- `REDIS_PASSWORD` - Generated when Redis provisioned

### Viewing Secrets

```bash
# Show secrets (masked)
gkm secrets:show --stage production

# Show secrets (revealed)
gkm secrets:show --stage production --reveal
```

### Rotation

```bash
# Rotate service passwords
gkm secrets:rotate --stage production --service postgres
gkm secrets:rotate --stage production --service redis
```

### Encryption & Injection

During deployment:
1. Secrets are filtered to only required variables per app
2. Encrypted with an ephemeral master key
3. Passed as Docker build args (`GKM_ENCRYPTED_CREDENTIALS`, `GKM_CREDENTIALS_IV`)
4. Master key injected as `GKM_MASTER_KEY` environment variable
5. Decrypted at runtime by the application

---

## Dokploy Deployment

[Dokploy](https://dokploy.com) is a self-hosted deployment platform.

### Initial Setup

```bash
# Login to Dokploy instance
gkm login --provider dokploy

# The CLI will prompt for:
# - Dokploy endpoint URL
# - API token
```

### Deploy Command

```bash
# Deploy to production
gkm deploy --stage production

# Preview what would be deployed
gkm deploy --stage production --dry-run

# Skip building (use existing image)
gkm deploy --stage production --skip-build
```

### Workspace Deployment Flow

For monorepos, the CLI orchestrates deployment in phases:

**Phase 1: Infrastructure**
- Provision PostgreSQL (if configured)
- Provision Redis (if configured)
- Create per-app database users with schema isolation

**Phase 2: Backend Apps**
- Build Docker images with encrypted secrets
- Deploy in dependency order
- Configure domains and SSL

**Phase 3: Frontend Apps**
- Generate public URLs from deployed backends
- Build with `NEXT_PUBLIC_*` environment variables
- Deploy and configure domains

**Phase 4: DNS & Verification**
- Create DNS records via configured provider
- Verify propagation
- Trigger SSL certificate generation

### Per-App Database Isolation

When PostgreSQL is provisioned:
- Each app gets its own database user
- `api` app uses the `public` schema (for shared migrations)
- Other apps get their own schema with `search_path` set

```sql
-- API app
CREATE USER "api" WITH PASSWORD '...';
GRANT ALL ON SCHEMA public TO "api";

-- Other apps
CREATE USER "worker" WITH PASSWORD '...';
CREATE SCHEMA "worker" AUTHORIZATION "worker";
ALTER USER "worker" SET search_path TO "worker";
```

---

## Docker Deployment

### Generate Docker Files

```bash
gkm docker --compose --services postgres,redis
```

### Dockerfile Generation

The CLI generates optimized multi-stage Dockerfiles:

```dockerfile
# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
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

### Build and Push

```bash
# Build image
gkm docker build --tag my-api:latest

# Push to registry
gkm docker push --tag my-api:latest
```

---

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
