# Development Server

A complete guide to `gkm dev` — what it does, how it orchestrates a fullstack workspace, and how to get a cloned project running for new team members.

## Overview

`gkm dev` is the primary development command. It detects whether you're in a single-app project or a multi-app workspace and adjusts its behavior accordingly. For fullstack workspaces, it orchestrates Docker services, resolves ports, decrypts and injects secrets, starts all apps via Turbo, and watches for changes.

## Two paths

`gkm dev` takes one of two paths, and which one depends on a single question:
**does any app configure a `constructs` glob?**

| | Declared | Hand-written |
|---|---|---|
| Trigger | at least one app sets `constructs:` | no app does |
| Where containers come from | the manifest — a declared `KyselyDatabase` is why a Postgres exists | a `docker-compose.yml` you wrote |
| Where URLs come from | derived and injected (`ORDERS_URL`, `UPLOADS_URL`) | secrets, rewritten with resolved ports |
| Compose file | generated at `docker-compose.constructs.yml`, with your `docker-compose.yml` merged over it | yours, at the project root |

Steps 5 through 8 below describe the **hand-written** path. On the declared
path, all four collapse into one reconcile pass:

```
🐳 Services: postgres, minio
   postgres: postgresql://…@localhost:5432/orders
   minio: http://localhost:9000
```

Reconcile computes the desired state, compares it against what is running, and
applies the difference — allocating ports, writing compose, starting containers,
and creating the databases, roles, schemas, and buckets the declarations name.
It is safe on every start: the converged case costs one hash and one health
check, and its blast radius is this project's containers and `.gkm/`.

See [Getting Started](/guide/getting-started) for the declaration side, and
[@geekmidas/cli](/packages/cli#reconcile) for what reconcile does in detail.

## Quick Reference

```bash
gkm dev [options]

Options:
  --port, -p <number>    Port number (default: 3000)
  --host <string>        Host to bind (default: localhost)
  --app <name>           Run a specific app from workspace
  --filter <pattern>     Filter apps by pattern (passed to turbo --filter)
  --entry <path>         Run a specific file with secret injection
  --watch                Watch for changes (default: true with --entry)
  --open                 Open browser automatically
```

## Workspace Startup Flow

When you run `gkm dev` from a fullstack workspace root, here's what happens step by step:

### 1. Load Environment

```
📦 Loaded env: .env
```

Loads `.env` from the project root using dotenv. This happens before any config is read so environment variables are available during config loading.

### 2. Load the Workspace

The CLI loads `gkm.config.ts` and discovers every construct its `constructs`
glob matches. The apps are read off that graph: each `RestApi`, auth server and
`StaticSite` with a `path` is an app, on a port the workspace assigns. A config
that declares no constructs is an error (`WorkspaceDeclaresNoConstructs`) —
there is no other source of apps, containers or URLs.

Run from the workspace root, `gkm dev` starts every app; run from an app's
directory — which is what turbo does — it starts that one.

### 3. Validate Apps

- **Port conflicts** — no two apps may share a port.
- **Ports** — every app's port is settled before anything starts, by asking
  what holds it. Each process gkm starts is tagged with the workspace and the
  app (`GKM_DEV_APP`), and whatever binds the port inherits the tag:
  - **held by this same app** — a dev server a previous run left behind — dev
    stops with `WorkspacePortsInUse`, naming the pid. Moving would start a second
    copy beside it.
  - **held by anything else** — another project's dev server on 3000 — the app
    moves to the next free port, says so (`↪️ api: 3000 is held by next-server
    (pid 81245), which is not this workspace's — using 3004`), and keeps it in
    `.gkm/app-ports.json`. Nothing else has to follow: the edge's URLs carry no
    app port, and every address an app or a phone is handed is derived from
    where it landed.

  `gkm exec` follows the same rule but never refuses, since the command it runs
  may bind nothing. Deploys never read `.gkm/app-ports.json`.
- **Frontend validation** — verifies Next.js apps have the expected setup
  (package.json, next.config.ts, etc.).

### 4. Reconcile

```
🐳 Services
   postgres       localhost:28001
   smtp           localhost:28006
   mailpit inbox  http://localhost:28007
   https edge     localhost:28010
```

Printed on every start, every published port with what it is for — the inbox
and the MinIO and RabbitMQ consoles as links you can open.

An app reaches the inbox over the same edge it reaches an API by: a
`MobileApp` or `StaticSite` that `.dependsOn([mailer])` is built with
`EXPO_PUBLIC_MAILER_INBOX_URL` (or `VITE_`/`NEXT_PUBLIC_`) on a local stage, so
an **Open email app** button can open the sign-in link the server just sent.
Deployed mail has no inbox, so the key is not set there — fall back to the
device's mail app:

```ts
const inbox = process.env.EXPO_PUBLIC_MAILER_INBOX_URL;
Linking.openURL(inbox ?? (Platform.OS === 'ios' ? 'message:' : 'mailto:'));
```

Like the API's URL, it is `localhost` on a phone until the app swaps in the
host Metro was served from.

**Which containers exist is derived, not configured.** A declared
`KyselyDatabase` is why a Postgres runs; a declared `ObjectStorage` is why MinIO
does; a declared cache runs whichever container its backend needs, and the
backend follows the deploy target — the Upstash-protocol proxy on AWS, and
nothing at all on a server, where it is a table in the database you already
declared.

| You declared | What starts |
|---|---|
| `new KyselyDatabase('…')` | `postgres` |
| `new ObjectStorage('…')` / `new FileServer('…')` | `minio`, and `caddy` for a file server |
| `new Cache('…')`, deploying to AWS | `redis` + the HTTP proxy |
| `new Cache('…')`, deploying to a server | nothing — it is a table |
| `new Email('…')` | `mailpit` |
| a topic or queue, deploying to AWS | the AWS emulator (SNS and SQS) |
| a topic, queue or worker, deploying to a server | nothing — pg-boss lives in Postgres |
| a `RestApi` or `StaticSite` | `caddy`, the edge each app answers behind |

There is no `services` block and no flag that starts a container. The containers
are written to the generated `docker-compose.constructs.yml`; an image pin, or a
service no construct implies, goes in your own `docker-compose.yml`, merged over
it. Reconcile then creates what the URLs name — databases, roles, buckets — and
persists the ports it assigned to `.gkm/ports.json`, so external tools keep
working across restarts.

### 5. Load Secrets and Resolve Addresses

```
shop: 2 app(s)
   api  https://api.shop.localhost:28006 -> http://localhost:3000
   web  https://shop.localhost:28006 -> http://localhost:3002
```

Secrets are loaded from the local stage's file — `.gkm/secrets/dev.json` for
`stages: { local: 'dev', … }` — and from no other stage. Every address reconcile
resolved is merged over them, and declared addresses win: a stale URL in a
secret cannot point an app at the wrong port.

Each app answers behind the edge on its own HTTPS host — the left of each line
above. That is the address the other apps receive (`API_URL`, and
`NEXT_PUBLIC_API_URL` / `VITE_API_URL` for a frontend) and the one their CORS
origins and cookie domain name. The right is the local port the edge forwards
to; nothing is handed out as `http://localhost:<port>`.

The site the base domain points at when deployed answers on the project's bare
host locally — `https://shop.localhost` — by the same rule: the only site, else
the site named `web`, else the one declaring `root: true`. Every other app is a
subdomain of it. A browser trusts these addresses once the edge's authority is
trusted on the machine: `gkm dev` asks once, or run `gkm trust`. On macOS that
is your login keychain, and macOS asks for your password (or Touch ID) once;
on Linux it is the system store, through `sudo`.

### 6. Start All Apps via Turbo

```
🏃 Starting turbo run dev...

📋 Apps (in dependency order):
   🔧 api → http://localhost:3000
   🔧 auth → http://localhost:3001
   🌐 web → http://localhost:3002 (depends on: api, auth)
```

The listed ports are where each app's own dev server listens — what the edge
forwards to. Turbo is filtered to each app's package, never the workspace root's
own `dev` script (which is `gkm dev`, and would start everything again).

Each app's `dev` script runs individually:
- **api** — `gkm dev` (builds the server with the same pipeline as `gkm build`, and starts it)
- **auth** — `gkm dev` (an auth server serves itself; the entry only starts it)
- **web** — `gkm exec -- next dev` (its port and every address injected; Next reads `PORT`, and a Vite config reads `Credentials.PORT` with `strictPort`)

### 7. Graceful Shutdown

On `Ctrl+C` (SIGINT/SIGTERM), turbo's process group is stopped and each app's
`gkm dev` stops its server. A server also exits on its own when the `gkm dev`
that started it is gone — even one killed outright — so it never keeps its port
for the next run to find taken.

## Single-App Mode

When running inside an app directory (e.g., `apps/api`) or in a project without workspace config, `gkm dev` runs in single-app mode:

1. Load `.env` and config env files
2. Parse `gkm.config.ts` for routes, envParser, logger, telescope, studio, hooks
3. Build server — compile endpoints, functions, crons, subscribers
4. Generate OpenAPI spec (if enabled)
5. Load and inject secrets from `.gkm/secrets/`
6. Start dev server with hot-reload
7. Watch source files — rebuild and restart on changes (debounced 300ms)

```
🚀 Starting development server...
Loading routes from: src/endpoints/**/*.ts
Using envParser: ./src/config/env
🔭 Telescope enabled at /__telescope
🗄️  Studio enabled at /__studio
📄 OpenAPI client generated: .gkm/client/api.ts
🔐 Loaded 12 secret(s)
Server running on http://localhost:3000
👀 Watching for changes in: src/endpoints/**/*.ts, src/config/env.ts, src/config/logger.ts
```

## Entry Mode

For non-gkm apps (like the better-auth service), `gkm dev --entry ./src/index.ts` runs a file directly with secret injection:

1. Load workspace config and secrets
2. Create a wrapper file at `.gkm/entry-wrapper.ts` that injects secrets into `process.env`
3. Spawn `tsx` to execute the wrapper
4. Watch for file changes and auto-restart

## Team Onboarding

When a new team member clones the repository and runs `gkm dev`, several things are missing that `gkm init` originally created. The `gkm setup` command handles all of this automatically.

### Quick Setup (Recommended)

```bash
git clone <repo-url>
cd my-app
pnpm install
gkm setup
gkm dev
```

`gkm setup` handles everything:
1. Detects your workspace configuration
2. Resolves secrets (pulls from SSM if configured, or generates fresh ones)
3. Writes `docker/.env` with matching database passwords
4. Starts Docker services (PostgreSQL, Redis, Mailpit)

### What's Gitignored

The generated `.gitignore` excludes these files:

| File | Why Gitignored | Impact When Missing |
|------|----------------|---------------------|
| `.gkm/` | Contains build artifacts, port state, dev secrets | Recreated by `gkm setup` |
| `docker/.env` | Contains database passwords for PostgreSQL init script | Recreated by `gkm setup` |
| `.env` | Local environment overrides | Not required — secrets handle this |
| `node_modules/` | Dependencies | Restored by `pnpm install` |

### What's Not in the Repo

| File | Location | Why Not Committed |
|------|----------|-------------------|
| Decryption key | `~/.gkm/{project-name}/development.key` | Security — stored in user's home directory |

### The `docker/.env` File

The `docker/.env` file is generated during `gkm init` (and by `gkm setup`) but is gitignored. It contains database passwords that the PostgreSQL init script (`docker/postgres/init.sh`) reads to create per-app database users.

**Format:**
```env
# docker/.env
API_DB_PASSWORD=<must match API_DB_PASSWORD from secrets>
AUTH_DB_PASSWORD=<must match AUTH_DB_PASSWORD from secrets>
```

`gkm setup` automatically extracts these passwords from your secrets and writes this file. You don't need to create it manually.

::: tip
If this file is missing when Docker starts PostgreSQL for the first time, the init script runs without passwords set, which means the `api` and `auth` database users are created with empty passwords. The `DATABASE_URL` in your secrets (which includes the password) will then fail to authenticate.

If this happens, remove the Docker volume and restart:
```bash
docker compose down -v   # removes volumes
gkm setup               # regenerates docker/.env and restarts services
```
:::

### Deployed Stages: the Secrets Store

The local stage's secrets belong to the machine running `gkm dev`. A
**deployed** stage's secrets have to be reachable from wherever it is deployed
from — a teammate's laptop, or a CI runner — and `.gkm/` is not committed, so
they live in a **store**, set with `secrets.store` in `gkm.config.ts`:

```ts
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'my-app',  // Scopes the SSM parameter path
  stages: { local: 'dev', deployed: ['staging', 'prod'] },
  constructs: './constructs/**/*.ts',

  secrets: {
    enabled: true,
    store: { provider: 'ssm', region: 'us-east-1' },
  },
});
```

| `store` | Where a deployed stage's secrets live |
|---|---|
| `'file'` (default) | the encrypted `.gkm/secrets/<stage>.json` on this machine, with its key in `~/.gkm/`. It cannot serve a deploy from CI while `.gkm/` is gitignored |
| `{ provider: 'ssm', region }` | one `SecureString` parameter per stage, `/gkm/<name>/<stage>/secrets`, in the AWS account of the active credentials — so with staging and production in different accounts, each stage's secrets sit beside its infrastructure |
| `{ provider: store }` | any object with a `name`, `read(stage)` and `write(stage, secrets)` |

`gkm init --deploy sst` writes the SSM store with the region you picked.

**Every command reads and writes the stage's store directly.** `gkm
secrets:set KEY … --stage prod` writes to SSM; `gkm deploy`, `gkm build`,
`gkm setup` and `gkm exec --stage prod` read from it. There is no copy on this
machine to keep in step, and nothing to push before a deploy. The local stage
is always the file, whatever `store` says.

The SSM store uses the default AWS credential chain: `AWS_PROFILE` on a
laptop — `AWS_PROFILE=acme-prod gkm secrets:set … --stage prod` — and the
stage's OIDC role in a deploy job. The credentials need `ssm:GetParameter` and `ssm:PutParameter` on
`arn:aws:ssm:*:*:parameter/gkm/*` in each stage's account.

#### Secret Resolution Priority

`gkm setup` reads the stage's store — the file for the local stage, `secrets.store` for a deployed one:
1. **The store has secrets** — use them, adding any key the workspace now derives (manually added secrets like `STRIPE_KEY` are kept)
2. **It has none** — generate fresh secrets and write them to that store
3. **It cannot be reached** — stop, rather than generate secrets nobody else can read

::: warning
Only `gkm setup --force` regenerates secrets from scratch, which could lose manually added secrets. The `--force` flag is explicitly opt-in.
:::

### Other Sharing Methods

**Share the decryption key** (the local stage)

```bash
# Original developer exports the key location:
# ~/.gkm/{project-name}/development.key

# New team member places the key file:
mkdir -p ~/.gkm/{project-name}
cp /path/to/shared/development.key ~/.gkm/{project-name}/development.key
chmod 600 ~/.gkm/{project-name}/development.key

# Then run setup to generate docker/.env and start services:
gkm setup
```

**Import from JSON**

```bash
# Export secrets from one machine
gkm secrets:show --stage dev --reveal > secrets-export.json

# Import on another machine
gkm secrets:import secrets-export.json --stage dev
gkm setup --skip-docker  # just write docker/.env, then start services manually
```

### Manual Secrets

When you add secrets manually with `gkm secrets:set`:

```bash
gkm secrets:set STRIPE_KEY sk_test_xxx --stage dev
```

These are preserved across `gkm setup` runs because setup reads the stage's
existing secrets first. For a deployed stage with a store, `secrets:set` writes
there, so a deploy from anywhere has them.

### Setup Command Reference

```bash
gkm setup [options]

Options:
  --stage <stage>    Stage name (default: development)
  --force            Regenerate secrets even if they exist
  --skip-docker      Skip starting Docker services
  -y, --yes          Skip prompts
```

## Dynamic Docker Port Resolution

Multiple projects can run simultaneously without port conflicts. The CLI auto-resolves ports for any Docker service that uses env var interpolation in its port mapping.

**How it works:**

```yaml
# docker-compose.yml
services:
  postgres:
    ports:
      - '${POSTGRES_HOST_PORT:-5432}:5432'  # Picked up automatically

  pgadmin:
    ports:
      - '8080:80'  # Fixed port — skipped by resolver
```

The pattern `${ENV_VAR:-default}:container` is detected automatically. Fixed port mappings are intentionally skipped.

**Adding custom services:**

Any new service you add to `docker-compose.yml` with the env var port pattern is automatically picked up:

```yaml
services:
  minio:
    image: minio/minio
    ports:
      - '${MINIO_API_PORT:-9000}:9000'
      - '${MINIO_CONSOLE_PORT:-9001}:9001'
```

**Port persistence:**

Resolved ports are saved to `.gkm/ports.json` so external tools keep working across dev server restarts. The `.gkm/` directory is gitignored.

## Environment Variable Loading Order

### Workspace Mode

```
1. .env                          (dotenv, if exists)
2. Encrypted secrets             (.gkm/secrets/{stage}.json, decrypted)
3. Declared addresses            (reconcile: containers, the edge, every app)
4. GKM_CONFIG_PATH set           (for child processes)
5. All injected into turbo env   (NODE_ENV=development)
```

### Single-App Mode

```
1. .env                          (dotenv, if exists)
2. config.env files              (additional env files from gkm.config.ts)
3. Encrypted secrets             (decrypted, written to .gkm/dev-secrets.json)
4. Server entry imports secrets  (Object.assign to process.env)
```

### Per-App Secret Mapping

In workspace mode, secrets use app-prefixed keys. When an individual app runs, its prefixed secrets are mapped to generic names:

```
Stored:    API_DATABASE_URL=postgresql://api:pass@localhost:5432/app
Injected:  DATABASE_URL=postgresql://api:pass@localhost:5432/app   (mapped)
           API_DATABASE_URL=postgresql://api:pass@localhost:5432/app (also available)
```

## Development Tools

When enabled, these dashboards are available during development:

| Tool | URL | Description |
|------|-----|-------------|
| Telescope | `http://localhost:3000/__telescope` | Request/exception monitoring, log aggregation |
| Studio | `http://localhost:3000/__studio` | Database browser with filtering and pagination |
| OpenAPI | `http://localhost:3000/__docs` | Auto-generated API documentation |

## Troubleshooting

### "Secrets enabled but no \"dev\" secrets found"

No encrypted secrets file exists for the local stage (`stages.local` in `gkm.config.ts`). Run:
```bash
gkm setup
```

Or if you only need secrets without Docker:
```bash
gkm secrets:init --stage dev
```

### "Decryption key not found for stage"

The key at `~/.gkm/{project-name}/development.key` is missing. Either:
- Run `gkm setup` (generates fresh secrets with a new key)
- Get the key file from a team member
- Regenerate: `gkm setup --force`

### Docker PostgreSQL auth failure

The `docker/.env` passwords don't match the secrets, or `docker/.env` was missing when PostgreSQL first initialized. Fix:
```bash
docker compose down -v   # Remove volumes (destructive!)
gkm setup               # Regenerates docker/.env and restarts services
```

### Port conflicts between projects

Ports are auto-resolved, but if you see unexpected behavior:
```bash
# Check current port assignments
cat .gkm/ports.json

# Delete to force re-resolution
rm .gkm/ports.json
gkm dev
```

### "Configuration file not found"

No `gkm.config.ts` in the current directory or workspace root. Make sure you're in the project root or an app directory within the workspace.

### Frontend validation failed

The web app is missing expected files. Check that `apps/web/package.json` and `apps/web/next.config.ts` exist.
