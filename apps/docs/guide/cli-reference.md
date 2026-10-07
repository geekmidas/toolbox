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
  stages: { local: 'dev', deployed: ['prod'] },
  // Constructs — one glob, every kind. What reconcile reads to derive this
  // app's containers, databases, roles, and buckets.
  constructs: 'src/constructs/**/*.ts',

  // Required
  routes: 'src/endpoints/**/*.ts',
  envParser: './src/config/env',
  logger: './src/config/logger',

  // Function globs. A resource has no kind to be listed under, which is why
  // `constructs` above is separate from these.
  functions: 'src/functions/**/*.ts',
  crons: 'src/crons/**/*.ts',
  subscribers: 'src/subscribers/**/*.ts',

  // No `services` block: whether a cache exists is declaring one, where it
  // lives follows the deploy target, and an image pin is your own
  // docker-compose.yml, merged over the generated one.

  // Development tools
  telescope: {
    enabled: true,
    path: '/__telescope',
  },

  // Server hooks
  hooks: {
    server: './src/config/hooks',
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
  --fake                 Call each ExternalApi's fake (test/fakes/<id>.ts)
                         instead of the provider
```

**Features:**
- Hot-reload on file changes
- Telescope's JSON API at `/__telescope/api`
- The declared database, read-only, as JSON at `/__gkm/db` (see [Development Tools](/guide/dev-server#development-tools))
- OpenAPI docs at `/__docs`
- A discovery endpoint on `127.0.0.1:4983` listing every running app and its data APIs, with a printed connect URL (see [Discovery Endpoint](/guide/dev-server#discovery-endpoint))
- Automatic endpoint discovery
- Dynamic Docker service port resolution (avoids conflicts between projects)

#### Dynamic Docker Port Resolution

When running `gkm dev`, the CLI automatically manages Docker service ports so multiple projects can run simultaneously without port conflicts.

**How it works:**

1. The CLI parses your project's `docker-compose.yml` to discover all services with port mappings that use env var interpolation (e.g., `${POSTGRES_HOST_PORT:-5432}:5432`)
2. For each service, it resolves ports using a 3-tier strategy:
   - **Running container** — if the project's own Docker container is already using a port, reuse it
   - **Saved state** — if a port was resolved in a previous session, reuse it from `.gkm/ports.json`
   - **Find available** — if the default port is occupied by another process, find the next available port
3. Resolved ports are passed as environment variables to `docker compose up` and injected into your app's env (URLs are rewritten automatically)

**Example output:**

```
✅ POSTGRES_HOST_PORT: using default port 5432
⚡ REDIS_HOST_PORT: port 6379 occupied, using port 6380
💾 MAILPIT_SMTP_PORT: using saved port 1026
```

**Adding custom services:**

Any service you add to `docker-compose.yml` that uses the `${ENV_VAR:-default}:container` port pattern will be automatically picked up:

```yaml
services:
  pgadmin:
    image: dpage/pgadmin4
    ports:
      - '${PGADMIN_HOST_PORT:-5050}:80'
  minio:
    image: minio/minio
    ports:
      - '${MINIO_API_PORT:-9000}:9000'
      - '${MINIO_CONSOLE_PORT:-9001}:9001'
```

Fixed port mappings (e.g., `'8080:80'`) are intentionally skipped — only env var interpolated ports get dynamic resolution.

**Port persistence:**

Resolved ports are saved to `.gkm/ports.json` so that external tools (like pgAdmin, database GUIs, etc.) keep working across restarts. The `.gkm/` directory is automatically gitignored.

### `gkm setup`

Reconcile only — derive the containers, databases, roles, schemas, and buckets
the declared constructs name, and stop there.

```bash
gkm setup                      # reconcile the local stage (stages.local)
gkm setup --stage staging      # another stage
gkm setup --skip-docker        # secrets and validation only
gkm setup --force              # regenerate secrets even if they exist
```

`gkm dev` and `gkm test` call the same function before they start anything, so
this is only needed when you want the infrastructure without the server — after
a clone, or after adding a construct.

### `gkm build`

Build for where the project deploys: `deploy: { default: 'sst' }` builds for
AWS, one Lambda per construct; `dokploy` — the default when nothing is
declared — builds a server.

```bash
gkm build [options]

Options:
  --provider <string>    Override the deploy target: aws or server
  --production           Build for production (no dev tools, bundled output)
  --enable-openapi       Generate OpenAPI documentation (server builds)
  --stage <stage>        Inject encrypted secrets for a deployment stage
```

A Dockerfile builds a server whatever the project deploys to:
`gkm build --provider server --production`.

**Output Structure:**
```
<root>/
├── .gkm/manifest/
│   └── aws.ts               # or server.ts — paths relative to the root
└── apps/api/.gkm/
    ├── server/
    │   ├── app.ts           # Hono app entry point
    │   ├── endpoints.ts     # All endpoint exports
    │   └── dist/            # Production bundle
    └── aws/
        ├── routes/*.ts      # Per-endpoint handlers (API Gateway v2)
        ├── functions/*.ts
        ├── crons/*.ts
        ├── queues/*.ts
        └── subscribers/*.ts
```

The manifest is written at the workspace root because `sst.config.ts` runs
there, so every handler path in it is relative to the root
(`apps/api/.gkm/aws/routes/getUser.handler`). `gkm init` adds a root
tsconfig alias for it, `@<project>/manifest`.

### `gkm openapi`

Write each `RestApi` surface's typed client to `.gkm/client/<surface>.ts` at
the workspace root. `gkm build` and `gkm dev` do the same as part of their run.
See [Typed API Client](./openapi-typescript.md).

```bash
gkm openapi [options]

Options:
  --app <name>   Generate for one backend app only
```

### `gkm init`

Scaffold a new project with templates.

```bash
gkm init <project-name> [options]

Options:
  --template, -t <name>  Template: minimal, api, serverless, worker, fullstack
  --yes, -y              Skip prompts and use defaults
  --deploy <target>      dokploy, sst or none
  --region <region>      AWS region for --deploy sst (e.g. eu-west-1)
  --stages <names>       Deployed stages, comma-separated (e.g. staging,prod)
  --protected-stage <n>  Which deployed stage is production
  --local-stage <name>   What gkm dev / exec / test run as (e.g. dev)
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

**Credentials Injection:**

The `exec` command decrypts secrets and injects them via `globalThis.__gkm_credentials__` (using a Node.js preload script) and `process.env`. This ensures credentials are available in both CJS and ESM module copies — important for tools like `kysely-ctl` that may load modules via a different module system.

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
// constructs/api.ts
export const api = new RestApi('Api', { path: 'apps/api', defaultAuthorizer: 'none', logger });

// constructs/site.ts — the edge is what carries the URL into the build
export const web = new StaticSite('Web', { path: 'apps/web' }).dependsOn([api, auth]);
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

Deploy a stage through its target.

```bash
gkm deploy --stage <stage> [options]

Options:
  --stage <name>         Deployment stage (required; one of stages.deployed, or
                         the local stage through compose)
  --target <name>        Deploy target: dokploy, compose, sst, or a name in
                         deploy.targets (default: deploy.default)
  --tag <tag>            Image tag (default: stage-timestamp; compose: the
                         commit). Through compose, a given tag is pulled
  --json                 Write events as JSON lines on stdout; never prompts
  --dry-run              Show what would be created or reused; change nothing
  --atomic               If the release fails, roll back every app it released,
                         not only the failed ones
  --allow-dev-services <list>
                         Server targets only (dokploy, compose): run MinIO
                         and/or Mailpit (minio,mailpit) for the buckets and mail
                         a deployed stage's secrets don't configure. Not
                         production-grade: Mailpit delivers no mail
  --provider <name>      Deprecated: `dokploy` means --target dokploy;
                         docker and aws-lambda are removed
  --skip-push, --skip-build
                         Deprecated and ignored
```

At a terminal, a missing Dokploy or registry login is asked for and stored.
With `--json`, or without a terminal, nothing prompts: a missing credential
fails the run with `MissingCredential`. Exit code 0 when the deploy finished,
1 when anything stopped it.

On a server target (`dokploy`, `compose`), a deployed stage's mail and object
storage come from its secrets: each `Email`'s `<ID>_URL` and `<ID>_FROM`, each
bucket's `<ID>_URL`, and each file server's `<ID>_URL`. A bucket's credentials
are optional: a key in its URL (`s3://KEY:SECRET@bucket?…`) wins, and the
shared `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, when set, serves every
bucket whose URL has none. A stage missing any fails before anything is built,
provisioned or written, with `ExternalServicesNotConfigured` listing every
missing key and the `gkm secrets:set` line for each. `--allow-dev-services`
runs MinIO and/or Mailpit in their place, with a warning (and a
`dev-service.used` event) every run; keys the stage set still win. An unknown
value fails with `UnknownDevService`; on `sst` the flag fails with
`DevServicesNeedServerTarget`.

See [Deploy targets](./deploy-targets.md) for targets and `deploy.targets`,
[Deploying from a program](./deploy-api.md) for `deploy()` and the events
`--json` writes, and [Deprecated deploy APIs](./deploy-deprecations.md) for
when `--provider` and the ignored flags go.

### `gkm deploy:rollback`

Put a Dokploy stage's app back on the release before the one it runs. For a
release that passed its checks and turned out wrong anyway; a release that fails
its checks is rolled back by `gkm deploy` itself.

```bash
gkm deploy:rollback --stage production --app api   # one app
gkm deploy:rollback --stage production --atomic    # every app with an earlier release
```

It holds the stage's lock, restores images only (migrations are
forward-only), and fails with `RollbackNeedsApp` when neither `--app` nor
`--atomic` is given, or `NothingToRollBack` when the app has no earlier release.

### `gkm deploy:github`

Lets GitHub Actions deploy a stage with no long-lived AWS keys. A stage usually
lives in its own AWS account, so it runs once per stage, with that account's
profile:

```bash
gkm deploy:github --stage staging --profile acme-dev
gkm deploy:github --stage prod    --profile acme-prod
gkm deploy:github --stage prod    --profile acme-prod --dry-run
```

In the stage's account it creates GitHub's OIDC provider if missing, and the
role `<project>-github-<stage>`, which only this repository's `<stage>`
environment can assume — a staging job cannot use the production role. On
GitHub (through `gh`, so be logged in) it creates the `<stage>` environment and
sets `AWS_ROLE_ARN`, which the generated deploy workflow reads. With
`secrets.store` set to SSM it pushes the stage's local secrets to SSM in the
same account, with the same profile, and hands GitHub no key; with the `'file'`
store it sets `GKM_SECRETS_KEY` (from `~/.gkm/keys/<namespace>/<project>/<stage>.key`).
Re-running it converges.

| Option | |
|---|---|
| `--stage` | a stage in `stages.deployed` |
| `--profile` | the AWS profile for the stage's account — keys, assume-role or SSO, whatever `~/.aws/config` says. Only that profile: exported `AWS_*` variables are not consulted |
| `--policy-arn` | what the role may do; defaults to `AdministratorAccess`, which is what SST needs to create stacks |
| `--repo` | `owner/name`; defaults to the repository `gh` sees |

The profile needs rights to manage IAM in that account; if it lacks them, AWS's
error names the action. An expired SSO login says to run
`aws sso login --profile <name>`.

### `gkm compose`

Run the workspace's APIs and sites for a stage as one Docker Compose stack
behind Caddy, over HTTPS. See [Deploy with Docker Compose](./compose.md).

```bash
gkm compose [options]

Options:
  --stage <stage>  Stage to run (required)
  --tag <tag>      Run the images CI pushed at this tag (sites: <tag>-<stage>);
                   every image is checked in the registry first, nothing is built
  --build          Build images from this checkout, tagged with the commit
  --pull           Pull images (at --tag, or latest) rather than build them
  --dry-run        Write the files and print the plan; start nothing
  --down           Stop the stage's stack (its volumes are kept)
  --allow-dev-services <list>
                   Deployed stage: run MinIO and/or Mailpit (minio,mailpit)
                   for the buckets and mail its secrets don't configure. The
                   local stage always runs both

The same as `gkm deploy --target compose --stage <stage>`, plus --build, --pull
and --down.

Environment:
  GKM_COMPOSE_HTTPS_PORT  Where the edge publishes HTTPS (default 443)
  GKM_COMPOSE_HTTP_PORT   Where the edge publishes HTTP (default 80)

Stage secrets passed to every backend (never a site):
  OTEL_EXPORTER_OTLP_*    The exporter's ENDPOINT, HEADERS, PROTOCOL, TIMEOUT
                          and COMPRESSION, for all signals or one (_LOGS_, …)
  OTEL_TRACES_SAMPLER, OTEL_TRACES_SAMPLER_ARG, OTEL_RESOURCE_ATTRIBUTES,
  OTEL_SERVICE_NAME       (defaults to the app's name)
```

`deploy.compose.logs` runs OpenObserve in the stack and points every backend
at it, on a loopback port reached through an SSH tunnel — see
[Logs](./compose.md#logs). A `docker-compose.<stage>.yml` at the workspace
root is merged over the generated stack. `gkm deploy --target dokploy` passes
the same `OTEL_*` keys to its backends.

### `gkm docker`

Generate Docker files.

```bash
gkm docker [options]

Options:
  --build                Build the image after generating files
  --push                 Push the image to the registry after building
  --tag <tag>            Image tag (default: latest)
  --registry <registry>  Container registry URL
```

Every image is built inside Docker from a `turbo prune`d slice of the build
root — the directory holding the lockfile at or above the workspace — so
nothing is built on the host first. Build from the build root:
`docker build -f <workspace>/.gkm/docker/Dockerfile.<app> .`

Writes the Dockerfiles under `.gkm/docker/`, and `docker-compose.constructs.yml`
at the project root: the containers the constructs imply, with each app behind
the `apps` profile. Your own `docker-compose.yml` is merged over it. Run
everything with `gkm setup`, then
`docker compose -f docker-compose.constructs.yml --profile apps up --build`.

### `gkm upgrade`

Moves a project to the current `@geekmidas` release on the line it is already
on.

```bash
gkm upgrade             # @geekmidas/cli only
gkm upgrade --all       # every @geekmidas package, and their third-party peers
gkm upgrade --dry-run   # show the changes, write nothing
gkm upgrade --tag alpha # follow a different npm dist-tag
```

- **The line you are on.** A project on `10.0.0-alpha.6` follows npm's `alpha`
  tag, not `latest` (which is 9.x while 10 is in prerelease). It never moves a
  project backwards: asking for a line behind what is installed is refused.
- **One version.** Every `@geekmidas` package shares a version, so `--all`
  moves them all to it, keeping each range's `^`, `~` or `>=`.
- **CLI first.** Without `--all` only `@geekmidas/cli` moves; then run the new
  CLI's `gkm upgrade --all`, since it knows what the new versions need.
- **Third-party peers.** With `--all`, packages the project already lists —
  `kysely`, `hono`, `better-auth` — are raised to the floor of the peer range
  the new version declares. Nothing is added, and nothing is lowered.
- **Where versions live.** `package.json` files across the workspace, and
  pnpm `catalog:` / `catalogs:` entries in `pnpm-workspace.yaml`.
  `workspace:` references are left alone, and a hand-written range like
  `>=8 <10` is reported rather than rewritten.

It then runs one install. Code changes a release needs — a renamed config key,
a retired API — are in the changelog, not applied by the command.

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

#### Guided secrets

```bash
# Build each key the stage must be given, for every app, interactively
gkm secrets:add --stage production

# Only the keys the stage has not set
gkm secrets:add --stage production --missing

# The same list as JSON, asking nothing — for a script or CI
gkm secrets:add --stage production --missing --json
```

`secrets:add` offers the keys a deploy would refuse the stage without: each
bucket's, mail server's and file server's on a deployed stage, and every
external API's and `Credential`'s `<ID>_CREDENTIALS` on any stage. It builds
each by kind — a bucket from its provider, mail from its SMTP server,
credentials field by field from the construct's schema — checks it, and saves
it through the stage's store. `--json` prints `key`, `kind`, `construct`,
`apps` and `set` for each. Without a terminal and without `--json` it fails
with `SecretsAddNeedsTerminal`. See
[Guided secrets](./deployment.md#guided-secrets).

`secrets:set` checks a `<ID>_CREDENTIALS` value against its construct's schema
before saving it, and fails with `CredentialsInvalid` — listing each issue's
path, never the value — without saving anything.

An `Encryption` construct's keyring on a server stage is rotated and retired on
its own, because retiring a key is a decision made against stored data:

```bash
# Add a new current key; older keys still decrypt what they wrote
gkm encryption:rotate Pii --stage production

# Remove a key once every value has been reencrypted off it
gkm encryption:retire Pii k1 --stage production
```

Neither runs on the local stage (its keyring is derived) or on AWS (KMS rotates
the key itself).

Every `secrets:*` command reads and writes the stage's own store: for a
deployed stage kept in SSM, `secrets:set` writes to SSM and `secrets:show`
reads from it, with the default AWS credentials (`AWS_PROFILE`, or a deploy
job's role). See
[the secrets store](./dev-server.md#deployed-stages-the-secrets-store).

### State Management

```bash
# Show the stage's state: ids, releases, pending resources (secrets masked)
gkm state:show --stage production
gkm state:show --stage production --json

# Copy the remote stage to .gkm/, or the local stage to the remote
gkm state:pull --stage production
gkm state:push --stage production

# Compare local vs remote
gkm state:diff --stage production

# Release the lock of a deploy that was killed
gkm state:unlock --stage production
```

`pull`, `push` and `diff` need a remote provider (SSM or S3). See
[Deploy state](./state.md).

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
| `GKM_DISCOVERY_PORT` | The discovery endpoint's port (overrides `dev.discoveryPort`; `0` serves on a free port of its own) |
| `GKM_DEV_REGISTRY` | Where `gkm dev` sessions register (default `~/.gkm/dev`) |
| `GKM_HOME` | The CLI's home: stage keys and stored logins (default `~/.gkm`) |
| `DOKPLOY_API_TOKEN`, `DOKPLOY_ENDPOINT` | Dokploy credentials for `gkm deploy` |
| `DOCKER_REGISTRY_USERNAME`, `DOCKER_REGISTRY_PASSWORD` | A registry login for Dokploy to pull with |
| `AWS_PROFILE`, or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | AWS credentials for the `sst` target (the profile wins when both are set) |
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
