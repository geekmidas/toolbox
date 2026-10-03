# Deployment Guide

This guide covers deploying @geekmidas workspace applications to various targets with the CLI's sophisticated deployment system.

## Overview

The CLI provides a complete deployment pipeline for monorepo workspaces:
- **The manifest** - what `gkm build` writes, and the seam every target reads
- **Environment Sniffing** - detection of required environment variables for the code a construct cannot describe
- **State Management** - Track deployments across local and remote storage
- **DNS Automation** - Automatic DNS configuration with multiple providers
- **Secrets Management** - Encrypted secrets injection during builds
- **Multi-App Orchestration** - Coordinated deployment of workspace apps

## The manifest is the seam

`gkm build` writes a **manifest**: every construct an app declared, and every
edge between them. Deploying is a target reading that manifest.

```
src/constructs/*.ts        the declarations
        │
        ▼  gkm build
   the manifest            what exists, and what depends on what
        │
        ├──▶ --target=server / Dokploy   containers and URLs
        └──▶ --target=aws                RDS, S3, SNS, SQS, Lambda, …
```

The manifest records **what is depended on**, never what that implies. Turning
an edge into an IAM policy, a security group, or a link is the target adapter's
business — which is why the same declaration deploys to a container host and to
AWS without naming either.

::: warning What is not built yet
The AWS target provisions twelve of the thirteen declaration kinds; `rest-api`
is outstanding. Its decisions are unit-tested as pure functions, but **a stack
has never come up end to end**. The server/Dokploy path below is the one in use
today.
:::

## Quick Start

```typescript
// gkm.config.ts
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'my-saas',
  stages: { local: 'dev', deployed: ['prod'] },

  // Where the constructs live. The apps come from them: a `StaticSite` is an
  // app, and so is every `RestApi`. Each one is its own deploy unit — one
  // container, one domain, and nothing to opt into.
  constructs: './constructs/**/*.ts',

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
gkm deploy --provider dokploy --stage production
```

---

## What each kind becomes

![Eight construct kinds and what each resolves to on local, Dokploy and AWS](/architecture/kind-per-target.png)

*Click to zoom.* The declaration does not change between targets; what gets built
from it does. Two cells are red because they have no Dokploy provisioner yet — a
file server's edge rule, and email.

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
  name: 'my-saas',
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: './constructs/**/*.ts',

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

**1. Declared constructs**

A declaration is what publishes a URL, under the key it owns:

```typescript
new KyselyDatabase<Database, 'Orders'>('Orders');  // → ORDERS_URL, ORDERS_OWNER_URL
new ObjectStorage('Uploads');                      // → UPLOADS_URL
new Cache('Sessions');                             // → SESSIONS_URL
new Email('Mail');                                 // → MAIL_URL, MAIL_FROM
```

Which backend a cache or a broker resolves to is the deploy target's answer,
not config: on a server the cache is a table in the database and events use
pg-boss; on AWS the cache is Upstash and events use SNS and SQS. Each still
generates its own URLs — a declared topic or queue its own
`<ID>_PUBLISHER_CONNECTION_STRING`, which its producers and its consumers both
read, plus `EVENT_PUBLISHER_CONNECTION_STRING` on pg-boss for the crons to
schedule through. On the AWS target `gkm dev` creates each topic and queue on
the local emulator, the way it creates MinIO buckets.

**2. Secrets Store**

Secrets from `.gkm/secrets/dev.json` are injected:

```bash
# Set a development secret
gkm secrets:set STRIPE_KEY sk_test_xxx --stage dev
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

**Generated secrets** are created once per stage and kept in its secrets store,
so every later deploy reads the same values:

- **Each `secret` construct's value**, such as an auth server's signing secret.
  It's random rather than derived, and `gkm secrets:set AUTH_SECRET … --stage
  production` replaces it with your own.
- **The stage's seed**, which salts every password the Dokploy target derives:
  each database's master and roles, and each bucket's root user. Nothing in
  the repo is enough to compute one.

The first deploy of a stage generates both and writes them to the store; it
prints `🔑 Generated for "production" (ssm): AUTH_SECRET, seed`.

**Custom secrets** are injected from the secrets store:

```bash
# Set production secrets
gkm secrets:set STRIPE_KEY sk_live_xxx --stage production
gkm secrets:set SENDGRID_API_KEY SG.xxx --stage production
```

---

## Environment Sniffing

Sniffing is what covers the code a construct cannot describe.

A declared construct needs none of it: the build knows `UPLOADS_URL` exists
because `ObjectStorage` declared it, and knows which handler needs it because
the handler named that construct in `.dependsOn()`. Sniffing is the fallback for
hand-written services and entry files, where the only way to learn which keys
are touched is to run the code and watch.

That difference is worth knowing when a variable goes missing: a construct's key
is a fact in the manifest, while a sniffed key is an observation, and an
observation can be wrong if the service throws before it reads.

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
| `DATABASE_URL` | Generated per-app credentials (the hand-written path — a declared database publishes `<NAME>_URL` instead) |
| `REDIS_URL` | Provisioned Redis service (a declared `Cache` publishes `<NAME>_URL` instead) |
| `BETTER_AUTH_URL` | Derived from app hostname |
| `BETTER_AUTH_SECRET` | Generated and persisted |
| `BETTER_AUTH_TRUSTED_ORIGINS` | All frontend URLs |

### Explicit Requirements

Override automatic detection:

```typescript
// gkm.config.ts
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'my-saas',
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: './constructs/**/*.ts',

  // A config entry of the same name as a derived app overrides one field
  // without restating the app. It is the exception, not the shape.
  apps: {
    api: { requiredEnv: ['STRIPE_SECRET_KEY', 'SENDGRID_API_KEY'] },
  },
});
```

`DATABASE_URL` is not in that list, and does not need to be: it comes from the
declared database, which is the construct that causes the Postgres to exist.

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
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: './constructs/**/*.ts',
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
  stages: { local: 'dev', deployed: ['prod'] },
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
  stages: { local: 'dev', deployed: ['prod'] },
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
  stages: { local: 'dev', deployed: ['prod'] },
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

# Skip building (use existing image)
gkm deploy --stage production --skip-build
```

![Local and deployed side by side, converging on one unchanged call site](/architecture/local-and-deployed.png)

*Click to zoom.* Locally Caddy is the edge because nothing else is; on Dokploy
Traefik already is one. Only the URL differs — the call site does not.

### What a deploy does

The unit list comes from the **manifest**, not from config: one `rest-api` is one
server, one `site` is one site. An app you never listed in config still deploys
if something declared it.

**Provision what the manifest declares**
- a Postgres per declared database, and the role DDL for it — a runtime role, an
  owner, and a reader where anything reads through one
- a MinIO compose stack per declared bucket
- pg-boss as a schema tenant of the database that already exists, when a queue
  or topic is carried by it — the only broker a Dokploy deploy provisions today
  (SNS on Dokploy would deliver to the server's push route, but is not
  provisioned yet)
- every URL the app needs, resolved and encrypted into the build

**Deploy the backends**
- build each image and push it to the registry
- create the application, its domain, and its Let's Encrypt certificate

**Then the frontends**
- built with the backend URLs already known, so `VITE_*` / `NEXT_PUBLIC_*` are
  real values at build time rather than placeholders

**Then DNS**, through the configured provider.

### Roles, not per-app users

Each **declared database** gets a role split — not each app:

```sql
CREATE ROLE "orders_production"        -- what handlers connect as
CREATE ROLE "orders_production_owner"  -- owns the schema, runs migrations
CREATE ROLE "orders_production_reader" -- only where something reads through one
ALTER ROLE "orders_production" SET search_path TO "app"
```

The application's own role holds no DDL rights, and the owner URL is never on a
manifest edge — a handler cannot reach for it. A schema tenant
(`database.schema('AuthDb')`) gets the same split inside the same cluster.

::: warning Not yet a privilege boundary
No target creates the per-schema role today: the tenant and its parent both
connect as the owner, which makes a tenant a `search_path` rather than an
isolation boundary. See the outstanding design notes.
:::

## AWS with SST

Pick **AWS (SST)** in `gkm init` (or `--deploy sst --region eu-west-1`) and the
scaffold gets an `sst.config.ts`, a `deploy:<stage>` script per deployed stage,
and the packages `@geekmidas/cloud/sst` needs.

```bash
pnpm run deploy:staging
# = gkm build --provider aws && sst deploy --stage staging
```

`gkm build --provider aws` writes `.gkm/manifest/aws.ts` — every construct the
app declares — and `sst.config.ts` hands it to `fromManifest`. So the config
lists no bucket, queue or IAM; what it holds is what a declaration cannot say:

```typescript
// sst.config.ts (generated)
const region = 'eu-west-1';
const PROTECTED: string[] = ['prod']; // from stages.protected

export default $config({
  app(input) {
    return {
      name: 'shop',
      removal: PROTECTED.includes(input?.stage) ? 'retain' : 'remove',
      protect: PROTECTED.includes(input?.stage),
      home: 'aws',
      providers: { aws: { region } },
    };
  },
  async run() {
    const { App, fromManifest, Stack } = await import('@geekmidas/cloud/sst');
    const { backends, constructs } = await import('./.gkm/manifest/aws.js');
    const vpc = new sst.aws.Vpc('Vpc', { nat: 'ec2' });
    // …
    return fromManifest(new Stack(app, 'Shop'), constructs, {
      Database: { vpc },                                      // RDS needs a network
      Mail: { from: process.env.MAIL_FROM as string },        // a verified SES sender
    }, backends);
  },
});
```

The two inputs are the ones the synth refuses to guess: a database without a
VPC stops with `DatabaseNeedsVpc`, a mailer without a sender with
`EmailNeedsSender`. Replace the created VPC with `sst.aws.Vpc.get(…)` if the
account already has one. Protected stages keep their resources when the stack
is removed.

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

## Deploying from GitHub Actions

`gkm init` writes the workflows (see [GitHub Actions](./fullstack-init.md#github-actions)):
pull requests run CI, merged pull requests collect in a drafted release, and
`deploy.yml` deploys stages. It reads [`stages`](./workspaces.md#stages) from
`gkm.config.ts` when it runs, so nothing in it names a stage:

| Event | Deploys |
|---|---|
| merge to `main` | every deployed stage **not** in `protected` — e.g. `staging` |
| publishing the drafted release | the `protected` stages — e.g. `prod` |
| *Run workflow* | the one stage you type |

Each stage deploys in the GitHub **environment** of the same name. Put a
required reviewer on a protected one if a release should also need approval.

### One-time setup, per stage

A stage usually lives in its own AWS account, so each is set up with its own
profile:

```bash
# The stage's secrets, on this machine
gkm secrets:init --stage staging
gkm secrets:init --stage prod

# AWS (SST): OIDC role in the stage's account + the GitHub environment
gkm deploy:github --stage staging --profile acme-dev
gkm deploy:github --stage prod    --profile acme-prod
```

`.gkm/` is gitignored, so a checkout in CI does not have the stage's secrets.
On SST, `gkm init` sets `secrets.store` to SSM
(see [the secrets store](./dev-server.md#deployed-stages-the-secrets-store)):
each stage's secrets are one `SecureString` in its own account. `gkm
secrets:set` writes there, and the deploy reads there with the role the job
assumed — no key on GitHub, and no pull or push step:

```bash
AWS_PROFILE=acme-prod gkm secrets:set POLAR_CREDENTIALS '{…}' --stage prod
```

[`gkm deploy:github`](./cli-reference.md#gkm-deploy-github) creates GitHub's
OIDC provider in the account if missing and a role only this repository's
`<stage>` environment can assume, then sets the environment's `AWS_ROLE_ARN`.
With the SSM store there is nothing to hand over — the deploy reads the store
with the role; with the `'file'` store it sets `GKM_SECRETS_KEY` instead. No long-lived AWS
keys are stored anywhere.

For **Dokploy**, set the environment's values with `gh`. The workflow writes
`GKM_SECRETS_KEY` to the runner, but the encrypted file it decrypts is under
the gitignored `.gkm/` — set `secrets.store` to a store CI can reach (SSM, or a
custom one) before deploying a Dokploy stage from GitHub:

```bash
gh secret set GKM_SECRETS_KEY --env prod < ~/.gkm/<project>/prod.key
gh secret set DOKPLOY_API_TOKEN --env prod
gh variable set DOKPLOY_ENDPOINT --env prod --body https://dokploy.example.com
```

### What each environment needs

| Setting | Target | Set by |
|---|---|---|
| variable `AWS_ROLE_ARN` | SST | `gkm deploy:github` |
| the stage's secrets in SSM | SST | `gkm secrets:set … --stage <stage>` |
| secret `GKM_SECRETS_KEY` | Dokploy (`'file'` store) | `gh secret set` |
| secret `DOKPLOY_API_TOKEN`, variable `DOKPLOY_ENDPOINT` | Dokploy | `gh` |

Tests in CI need none of these: `gkm test` with `GKM_AUTO_SETUP=1` generates
throwaway secrets for the test stage.

---

## Production Checklist

Before deploying to production:

- [ ] All tests passing (`pnpm test:once`)
- [ ] Type checks passing (`pnpm ts:check`)
- [ ] Linting passing (`pnpm lint`)
- [ ] Secrets configured (`gkm secrets:show --stage <stage>`)
- [ ] Each deployed stage has its GitHub environment (`gkm deploy:github --stage <stage>`)
- [ ] DNS provider configured
- [ ] State provider configured (SSM for teams)
- [ ] Health check endpoint configured
- [ ] Database migrations ready
- [ ] Logging configured for production
- [ ] Error tracking enabled (Sentry, etc.)

---

## Troubleshooting

### Environment Variables Not Detected

If the sniffer misses variables:
1. Ensure all `get()` calls happen before `.parse()`
2. Use `requiredEnv` in config for dynamic variables
3. Check subprocess output with `--verbose` flag

### DNS Propagation Issues

```bash
# Check DNS resolution
dig api.myapp.com

# Force re-verification
gkm deploy --stage production --force-dns
```

### State Sync Issues

```bash
# Pull latest state from remote
gkm state:pull --stage production

# Compare local vs remote
gkm state:diff --stage production

# Force push local state
gkm state:push --stage production --force
```

### Database Connection Issues

Per-app credentials are stored in state. If connection fails:
1. Check `gkm state:show --stage production`
2. Verify credentials match Postgres users
3. Re-run deployment to recreate users if needed
