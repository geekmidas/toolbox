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

::: tip Where to go next
- [Deploy targets](./deploy-targets.md): `dokploy`, `compose` and `sst`, and how to choose
- [Running in production](./production.md): secrets, state, health checks, telemetry, rollback
- [Deploying from a program](./deploy-api.md): `deploy()`, its events, and `gkm deploy --json`
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
    // Each deployed stage's base domain — read by every target, not only
    // Dokploy. The root site answers on it; every other surface on
    // `{subdomain}.{domain}`.
    domains: {
      production: 'myapp.com',
      staging: 'staging.myapp.com',
    },
    // Whose deploy this is, on a server other workspaces share (optional).
    namespace: 'myorg',
    // Where every target pushes and pulls the apps' images.
    registry: 'ghcr.io/myorg',
    dokploy: {
      endpoint: 'https://dokploy.myserver.com',
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

## What each kind becomes

![Eight construct kinds and what each resolves to on local, Dokploy and AWS](/architecture/kind-per-target.png)

*Click to zoom.* The declaration does not change between targets; what gets built
from it does. Two cells are red because they have no Dokploy provisioner yet — a
file server's edge rule, and email.

## Build Targets

`gkm build` builds for where the project deploys. `deploy: { default: 'sst' }`
in `gkm.config.ts` builds for AWS; `dokploy` — the default when nothing is
declared — builds a server. `--provider aws|server` overrides it, which is how a
Dockerfile builds a server whatever the project deploys to.

Either way the manifest is written at the workspace root —
`.gkm/manifest/aws.ts` or `.gkm/manifest/server.ts` — with every handler path
relative to the root, since `sst.config.ts` runs there.

### Server

Generates a standalone Node.js server application using Hono.

```bash
gkm build --provider server --production
```

**Output:** `<app>/.gkm/server/`
- `app.ts` - Hono application entry point
- `dist/` - Production bundle (with `--production`)

A `--production` build bundles and minifies the server into a single file,
serves a health check at `/health`, shuts down gracefully, and leaves out the
dev tools (Telescope, the database API) and the OpenAPI spec. It serves HTTP
only: a `Worker`'s queue consumers, crons and topic subscribers are left out, and
the build says what it left out (`Serving Api only: leaving out 1 cron, …`).
Publishing is unchanged. Each `Worker` gets an entry of its own beside it,
`dist/worker-<worker>.mjs`, which runs that worker's crons, consumers and
subscribers and serves only `/health`; see [Workers](./production.md#workers).

### AWS

One Lambda per construct.

```bash
gkm build                  # with deploy: { default: 'sst' }
```

**Output:** `<app>/.gkm/aws/`
- `routes/` - one handler per endpoint (API Gateway v2)
- `functions/`, `crons/`, `queues/`, `subscribers/`

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

Deploy state records what a stage's deploys created (project, environment,
application and domain ids, database credentials, generated secrets, each app's
releases) so the next deploy finds them again. `state.provider` picks where it
lives:

```typescript
state: { provider: 'local' }                                        // default: .gkm/deploy-<stage>.json
state: { provider: 'ssm', region: 'us-east-1' }                     // /gkm/<workspace>/<stage>/state
state: { provider: 's3', bucket: 'my-app-deploy-state', region: 'us-east-1' }
```

Every deploy takes the stage's lock (`StateLocked` for a second run; release a
crashed run's lock with `gkm state:unlock --stage <stage>`), writes
conditionally, and journals each resource as it creates it. Use SSM or S3 as
soon as more than one machine deploys a stage.

See [Deploy state](./state.md) for the providers, locks, the journal,
`state:*` commands and the v1 to v2 migration.

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

### Guided secrets

`gkm secrets:add` builds the keys a stage must be given, one at a time, for
every app in the workspace at once. Run it from the workspace root:

```bash
gkm secrets:add --stage production
```

It offers exactly the keys a deploy would refuse the stage without — the same
list behind `ExternalServicesNotConfigured` — each once, with the construct
that reads it, its kind, the apps that read it, and whether it is set:

| Kind | Keys | Built from |
| --- | --- | --- |
| Bucket | `<ID>_URL` | AWS S3 (bucket, region), Cloudflare R2 (account id or endpoint, bucket), MinIO or any S3-compatible store (endpoint, bucket, path-style), or a pasted `s3://` URL. Then, optionally, a key for that bucket alone, written into the URL percent-encoded — or the stage's shared `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`. Neither is required. |
| Email | `<ID>_URL`, `<ID>_FROM` | SMTP host, port (587 by default), user, password and TLS mode, as `smtp://` (STARTTLS) or `smtps://` (TLS on connect); then the address it sends from. |
| File server | `<ID>_URL` | Its public `https://` address. |
| External API, `Credential` | `<ID>_CREDENTIALS` | The construct's own schema: one prompt per field of a zod object (hidden for a field named like a secret, key, token or password), or the JSON itself for any other schema. |

A deployed stage on a server target is asked for all of them; the local stage
only for third parties' credentials, since it runs Mailpit and MinIO itself.
Nothing derived is ever offered: database URLs, generated secrets and the seed
are the deploy's to make.

Missing keys start selected; a set key asks before it is replaced. Every value
is checked before it is kept — an address must be one, a URL must be
`http(s)://` — and credentials are checked against the construct's schema,
showing each issue's path (`SHIPPING_CREDENTIALS.apiKey: …`) and asking again
until it passes. Everything is saved through the stage's own store, as
`gkm secrets:set` would, and no value is ever printed.

Without a terminal, list what the stage lacks as JSON, and set each key with
`gkm secrets:set`:

```bash
gkm secrets:add --stage production --missing --json
```

```json
[
  { "key": "MAIL_URL", "kind": "email", "construct": "Mail", "apps": ["api", "auth"], "set": false },
  { "key": "SHIPPING_CREDENTIALS", "kind": "external-api", "construct": "Shipping", "apps": ["api"], "set": false }
]
```

A third party's credentials are checked against their schema wherever they
are set. `gkm secrets:set SHIPPING_CREDENTIALS '…'` refuses a value the
`ExternalApi`'s schema refuses, with `CredentialsInvalid`, and saves nothing;
a deploy (`dokploy`, `compose`) refuses a stage holding one before it builds
anything. Neither message carries the value.

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
3. Passed to `docker build` as a BuildKit secret (`--secret id=gkm_credentials`), read by the Dockerfile with `RUN --mount=type=secret,id=gkm_credentials` — never as build args, which `ps`, shell history and `docker history` keep. The file is owner-only and removed after the build.
4. Master key injected as `GKM_MASTER_KEY` in the container's runtime environment — never printed. Output names it by fingerprint (the first 8 hex characters of its SHA-256), so you can tell which key a build used.
5. Decrypted at runtime by the application

`gkm build --stage <stage>` on its own writes the key to `.gkm/server/master.key` (mode `0600`, kept out of the Docker build context) and prints only its path and fingerprint. Set `GKM_MASTER_KEY` from that file when you run the image yourself:

```bash
docker run -e GKM_MASTER_KEY="$(cat .gkm/server/master.key)" my-api:latest
```

---

## Deploy targets

`gkm deploy` deploys a stage through a *target*: `deploy.default`, or
`--target <name>` for one run. `dokploy`, `compose` and `sst` ship with the CLI;
any other target is a package the project installs and names under
`deploy.targets`.

```bash
gkm deploy --stage production                   # deploy.default (dokploy when unset)
gkm deploy --stage production --target compose
```

See [Deploy targets](./deploy-targets.md) for choosing one, `deploy.targets`
and how a name resolves, and [Writing a target](./writing-a-target.md) for
`defineTarget`.

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

# See what it would create or reuse, and change nothing
gkm deploy --stage production --dry-run

# Events as JSON lines on stdout, for CI or another program
gkm deploy --stage production --json
```

At a terminal, `gkm deploy` asks for a Dokploy login (and stores it) or a
registry login when nothing else supplies one. With `--json`, or without a
terminal, it never asks: a missing credential stops the deploy with
`MissingCredential`, naming what was missing and how to supply it, and the
command exits 1.

`--dry-run` takes no lock, writes no state, generates no secrets, makes only
read calls to Dokploy, and builds and pushes nothing. It lists what a deploy
would create (`+`) and what it would reuse (`=`).

### Deploying from a program

`gkm deploy` is a thin wrapper around `deploy()` from `@geekmidas/cli/deploy`,
which never prompts, prints or exits the process, and reports progress as
events. See [Deploying from a program](./deploy-api.md).

The project's own code (its config, its constructs, each app's entry, its
migrations) runs in a [sandbox](./sandbox.md) with an allowlisted environment.
Credentials never enter it.

![Local and deployed side by side, converging on one unchanged call site](/architecture/local-and-deployed.png)

*Click to zoom.* Locally Caddy is the edge because nothing else is; on Dokploy
Traefik already is one. Only the URL differs — the call site does not.

### Identity: namespace, project, stage

A deploy names and claims everything it makes by its **identity**:

- `namespace` — `deploy.namespace` in `gkm.config.ts`; defaults to the
  kebab-cased workspace name
- `project` — the workspace name, lowercased
- `stage` — `--stage`

Its key, `<namespace>/<project>`, is the same from every stage, because one
Dokploy project holds every stage as an environment. Two workspaces called
`shop` deploying to one server stay apart as long as their namespaces differ:

| | `namespace: 'acme'` | `namespace: 'globex'` |
|---|---|---|
| Dokploy project | `acme-shop` | `globex-shop` |
| application | `production-acme-shop-api` | `production-globex-shop-api` |
| image | `ghcr.io/x/acme/shop-api:<tag>` | `ghcr.io/x/globex/shop-api:<tag>` |

In the default namespace nothing is added: the project is `shop` and the
application `production-shop-api`, the names a workspace was already deployed
under.

**A project is claimed, not matched.** The project's description carries
`gkm:<namespace>/<project>`. A deploy uses, in order: the project its stage
state names; a project with its name and its marker; a new one, marked. A
project with the same name in any case but no marker — or someone else's — is
never adopted: the deploy stops with `ProjectNotOwned` before building anything.
Set `deploy.namespace`, or add the marker to the project's description in
Dokploy if it really is yours.

**The registry is the one you configured.** `deploy.registry` is where
images are pushed (a deploy without one stops with `RegistryNotConfigured`).
Dokploy's registry for it is, in order: `deploy.dokploy.registryId`, the one
the stage's state recorded, and the one Dokploy holds for that registry's host
and path — never simply the first one listed. Its id is kept in the stage's
state, along with each app's image ref and the digest the push resolved to.

::: tip Upgrading an existing deployment
A stage deployed before identities has state holding its project id. That id is
trusted, and the next deploy writes the marker into the project's description,
so the project stays found even if the state is later lost. Images move to
`<registry>/<namespace>/<project>-<app>`; nothing else is renamed.
:::

### What a deploy does

The unit list comes from the **manifest**, not from config: one `rest-api` is one
server, one `site` is one site. An app you never listed in config still deploys
if something declared it.

**Provision what the manifest declares**
- a Postgres per declared database, and the role DDL for it — a runtime role, an
  owner, and a reader where anything reads through one
- each declared bucket and `Email` from the stage's secrets (`<ID>_URL`,
  `<ID>_FROM`; a bucket's key in its URL or the shared S3 key pair, both
  optional) — a stage missing any fails `validate` with
  `ExternalServicesNotConfigured`. Only with `--allow-dev-services minio`
  is a bucket a MinIO compose stack, and only with `mailpit` is mail a
  Mailpit one ([Mail and object storage](./deploy-targets.md#mail-and-object-storage))
- pg-boss as a schema tenant of the database that already exists, when a queue
  or topic is carried by it — the only broker a Dokploy deploy provisions today
  (SNS on Dokploy would deliver to the server's push route, but is not
  provisioned yet)
- every URL the app needs, resolved and encrypted into the build

**Apply the stage's migrations**, before any app is released. They run in the
deploy's [sandbox](./sandbox.md), against the database's owner URL handed over
as a secret file, through a port the deploy publishes for the purpose and closes
again. A failed migration stops the run (`DeployMigrationsFailed`) before
anything is released.

**Deploy the backends**
- build each image and push it to the registry
- create the application, its domain, and its Let's Encrypt certificate
- wait for Dokploy's deployment to finish (`DeploymentFailed`,
  `DeploymentTimedOut`), then check the app's health: `healthyAfter`
  consecutive 2xx answers from `https://<host>/health`
- every backend is released and healthy before any site is; a backend that
  fails stops the run with `BackendDeployFailed`

**Then the frontends**
- built with the backend URLs already known, so `VITE_*` / `NEXT_PUBLIC_*` are
  real values at build time rather than placeholders
- every site is attempted; if any fails, the run fails with
  `FrontendDeployFailed` once they all have

**Then DNS**, through the configured provider, and **verify**: each site
answering at `/`.

**Rollback.** When `release` or `verify` fails, the apps that failed are pointed
back at the image they ran before and redeployed. `--atomic` rolls back every
app the run released instead, for apps that must move together. Each app's
releases are kept in the stage's state (`releases`: current, previous and a
history of 10). `gkm deploy:rollback --stage <stage> --app <app>` (or
`--atomic`) does the same by hand, for a release that passed its checks and
turned out wrong anyway. A rollback restores images only: migrations are
forward-only.

How long each wait may take is `deploy.dokploy.verify`:

```typescript
deploy: {
  dokploy: {
    endpoint: 'https://dokploy.myserver.com',
    verify: {
      deploymentTimeoutMs: 10 * 60_000, // Dokploy's deployment (default 10 min)
      healthCheckPath: '/health',       // a backend's health route (default)
      healthyAfter: 3,                  // consecutive 2xx answers (default 3)
      intervalMs: 2_000,                // between checks (default 2 s)
      healthTimeoutMs: 5 * 60_000,      // to become healthy (default 5 min)
    },
  },
},
```

See [Running in production](./production.md) for health checks and rollback
across targets.

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
# = gkm deploy --stage staging
```

`gkm deploy` through the `sst` target runs, in the deploy's sandbox:

1. `gkm build --provider aws --stage <stage>` — with no AWS credentials, since
   the build runs the project's code and needs none;
2. `sst deploy --stage <stage>` — the one command handed AWS credentials, in
   its own environment;
3. a health check of each surface whose URL `run()` returns: an API's
   `/health`, a site's `/`. SST writes those outputs to `.sst/outputs.json`;
   a surface that never answers 2xx fails the deploy with `SurfacesUnhealthy`.

The AWS credentials come from the deploy's `CredentialProvider` (kind `aws`).
From the environment that is `AWS_PROFILE` when set — alone, over any exported
keys, so leftover staging keys cannot redirect a production deploy — otherwise
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`, which is what
the scaffolded workflow's `aws-actions/configure-aws-credentials` step exports.
Without either, the deploy stops with `MissingCredential` before anything runs.
SST keeps no previous release, so a failed verify is not rolled back: fix and
deploy again.

The scaffold sets `deploy: { default: 'sst' }` in `gkm.config.ts`, so
`gkm build` builds for AWS and writes `.gkm/manifest/aws.ts` at the root —
every construct the app declares — and `sst.config.ts` hands it to
`fromManifest`. `gkm init` also adds a root tsconfig alias for it,
`@<project>/manifest`. So the config
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
    const provisioned = fromManifest(new Stack(app, 'Shop'), constructs, {
      Database: { vpc },                                      // RDS needs a network
      Mail: { from: process.env.MAIL_FROM as string },        // a verified SES sender
    }, backends);
    // Each surface's URL, for `gkm deploy` to health-check.
    return Object.fromEntries(
      Object.entries(constructs)
        .filter(([, c]) => c.kind === 'rest-api' || c.kind === 'site')
        .map(([id]) => [id, provisioned[id]!.provides().url]),
    );
  },
});
```

The two inputs are the ones the synth refuses to guess, and the overrides are
typed from the manifest, so leaving one out is a type error in
`sst.config.ts` rather than a failed deploy. Replace the created VPC with `sst.aws.Vpc.get(…)` if the
account already has one. Protected stages keep their resources when the stack
is removed.

Each `RestApi`'s endpoints are mounted on its API Gateway, one Lambda per
route. A Lambda is linked only to what its own endpoint depends on, and is
placed in the database's VPC when it reaches a database. An `iam` authorizer is
enforced by the gateway; any other is checked in the handler.

---

## Docker Deployment

`gkm docker` writes a multi-stage Dockerfile per app (and a `.dockerignore`)
without deploying anything. The `dokploy` and `compose` targets run the same
generator; use it directly to build images yourself.

```bash
gkm docker                                    # write the files
gkm docker --build --tag v1.4.0               # and build the image
gkm docker --build --push --tag v1.4.0 --registry ghcr.io/acme
gkm docker --turbo                            # use turbo prune in a monorepo
```

The image reads its stage's encrypted credentials through a BuildKit secret,
never a build argument, and needs `GKM_MASTER_KEY` at runtime. See
[Running in production: secrets](./production.md#secrets-and-the-master-key).

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
gh secret set GKM_SECRETS_KEY --env prod < ~/.gkm/keys/<namespace>/<project>/prod.key
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

- [ ] All tests passing (`pnpm test:once`), type checks and lint clean
- [ ] Secrets set for the stage (`gkm secrets:show --stage <stage>`), in a store CI can reach
- [ ] Each deployed stage has its GitHub environment (`gkm deploy:github --stage <stage>`)
- [ ] A remote state provider (SSM or S3) once more than one machine deploys
- [ ] DNS provider configured
- [ ] A dry run reviewed (`gkm deploy --stage <stage> --dry-run`)

[Running in production](./production.md) has the full checklist: the master
key, health checks, telemetry, graceful shutdown, rollback and database
connections.

---

## Troubleshooting

### Environment Variables Not Detected

If the sniffer misses variables:
1. Ensure all `get()` calls happen before `.parse()`
2. Use `requiredEnv` in config for dynamic variables
3. A sniff that hangs is stopped after 30 seconds and reported; an entry that
   starts a server at import time is the usual cause

### DNS Propagation Issues

```bash
# Check DNS resolution
dig api.myapp.com

# Re-deploying re-checks each hostname that has not been verified yet
gkm deploy --stage production
```

### State Sync Issues

```bash
# Pull latest state from remote
gkm state:pull --stage production

# Compare local vs remote
gkm state:diff --stage production

# Replace remote state with the local copy
gkm state:push --stage production

# Release the lock of a deploy that was killed
gkm state:unlock --stage production
```

### Database Connection Issues

Per-app credentials are stored in state. If connection fails:
1. Check `gkm state:show --stage production`
2. Verify credentials match Postgres users
3. Re-run deployment to recreate users if needed
