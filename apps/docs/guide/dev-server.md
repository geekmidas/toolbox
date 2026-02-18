# Development Server

A complete guide to `gkm dev` — what it does, how it orchestrates a fullstack workspace, and how to get a cloned project running for new team members.

## Overview

`gkm dev` is the primary development command. It detects whether you're in a single-app project or a multi-app workspace and adjusts its behavior accordingly. For fullstack workspaces, it orchestrates Docker services, resolves ports, decrypts and injects secrets, starts all apps via Turbo, and watches for changes.

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

### 2. Detect Workspace Mode

The CLI loads `gkm.config.ts` and checks for an `apps` property. If found, it enters **workspace mode** — orchestrating multiple apps through Turbo. Otherwise, it runs as a single-app dev server.

### 3. Validate Apps

- **Port conflicts** — checks that no two apps share the same port. Errors immediately if conflicts found.
- **Frontend validation** — verifies Next.js apps have the expected setup (package.json, next.config.ts, etc.).

### 4. Copy API Clients

For each backend app that has generated an OpenAPI spec (`.gkm/openapi.ts`), the typed client is copied to dependent frontend apps. This enables type-safe API calls from the frontend.

### 5. Resolve Docker Service Ports

```
🔌 Resolving service ports...
   ✅ postgres:5432: using default port 5432
   ⚡ redis:6379: port 6379 occupied, using port 6380
   💾 mailpit:1025: using saved port 1026
```

The CLI parses `docker-compose.yml` for port mappings that use environment variable interpolation (e.g., `${POSTGRES_HOST_PORT:-5432}:5432`). For each service, ports are resolved with this priority:

1. **Running container** — if the project's Docker container is already running, reuse its port
2. **Saved state** — check `.gkm/ports.json` for a previously resolved port
3. **Find available** — if the default port is occupied, find the next available port (tries up to 10 ports)

Resolved ports are persisted to `.gkm/ports.json` so external tools (database GUIs, etc.) keep working across restarts.

### 6. Start Docker Services

```
🐳 Starting services: postgres, redis, mailpit
```

Runs `docker compose up -d` with the resolved port environment variables injected. Only services configured in the workspace config are started:

| Config | Service Started |
|--------|----------------|
| `services.db: true` | `postgres` |
| `services.cache: true` | `redis` |
| `services.mail: true` | `mailpit` |

If `docker-compose.yml` is missing, a warning is printed and services are skipped.

### 7. Load and Rewrite Secrets

```
🔐 Loading secrets from stage: development
   Loaded 15 secret(s)
```

Secrets are loaded from `.gkm/secrets/development.json` (tries `dev` stage first, then `development`). Connection URLs in the secrets are rewritten with the resolved Docker ports. For example, if PostgreSQL was assigned port 5433:

```
DATABASE_URL=postgresql://api:pass@localhost:5432/app_dev
→ DATABASE_URL=postgresql://api:pass@localhost:5433/app_dev
```

### 8. Generate Dependency URLs

```
📡 Dependency URLs:
   API_URL=http://localhost:3000
   NEXT_PUBLIC_API_URL=http://localhost:3000
   AUTH_URL=http://localhost:3002
   NEXT_PUBLIC_AUTH_URL=http://localhost:3002
```

For each app dependency defined in the workspace config, URL environment variables are generated. Frontend apps also get `NEXT_PUBLIC_` prefixed variants for client-side access.

### 9. Start All Apps via Turbo

```
🏃 Starting turbo run dev...

📋 Apps (in dependency order):
   🔧 api → http://localhost:3000
   🔧 auth → http://localhost:3002
   🌐 web → http://localhost:3001 (depends on: api, auth)
```

The CLI spawns `pnpm turbo run dev` with all secrets, dependency URLs, and port mappings injected into the environment. Apps are started in dependency order — backends first, then frontends.

Each app's `dev` script runs individually:
- **api** — `gkm dev` (discovers endpoints, starts Hono server with hot-reload)
- **auth** — `gkm dev --entry ./src/index.ts` (runs the Hono auth server with secret injection)
- **web** — `gkm exec -- next dev --turbopack` (runs Next.js with workspace env vars injected)

### 10. Watch for OpenAPI Changes

When a backend's `.gkm/openapi.ts` changes (regenerated on endpoint file changes), the updated typed client is automatically copied to dependent frontend apps. This keeps the frontend's API types in sync during development.

### 11. Graceful Shutdown

On `Ctrl+C` (SIGINT/SIGTERM):
1. Turbo process group is killed
2. OpenAPI file watcher is closed
3. 2-second grace period for cleanup
4. Process exits

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
📄 OpenAPI output: .gkm/openapi.ts
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

### Sharing Secrets via SSM

For teams that want to share the same development secrets, use AWS Systems Manager (SSM) Parameter Store. Secrets are stored as `SecureString` parameters encrypted with an AWS-managed KMS key.

#### 1. AWS Prerequisites

You need an AWS account with SSM access. Create an IAM policy with these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:PutParameter"
      ],
      "Resource": "arn:aws:ssm:*:*:parameter/gkm/*"
    }
  ]
}
```

Attach this policy to an IAM user or role. Then configure credentials on each developer's machine:

```bash
# Option A: AWS CLI profile (recommended)
aws configure --profile my-project
# Enter Access Key ID, Secret Access Key, region

# Option B: Environment variables
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-east-1
```

#### 2. Configure SSM in Your Workspace

Add the `state` field to `gkm.config.ts`:

```ts
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'my-app',  // Required — used in SSM parameter path
  apps: { /* ... */ },
  services: { /* ... */ },

  state: {
    provider: 'ssm',
    region: 'us-east-1',
    // profile: 'my-project',  // Optional — uses default credential chain if omitted
  },
});
```

| Field | Required | Description |
|-------|----------|-------------|
| `provider` | Yes | Must be `'ssm'` |
| `region` | Yes | AWS region where parameters are stored |
| `profile` | No | AWS CLI profile name (uses default credentials if omitted) |

Secrets are stored at the SSM parameter path: `/gkm/{workspace-name}/{stage}/secrets`

::: info
The same `state` config is also used for deployment state (`state:push/pull`). Both secrets and deployment state share the same AWS credentials and region but use different parameter paths.
:::

#### 3. Push/Pull Workflow

```bash
# Developer A: after init or adding secrets
gkm secrets:push --stage development

# Developer B: after cloning
pnpm install
gkm setup   # automatically pulls from SSM
```

You can also push/pull manually:

```bash
# Push local secrets to SSM
gkm secrets:push --stage development

# Pull secrets from SSM to local
gkm secrets:pull --stage development
```

#### Secret Resolution Priority

`gkm setup` resolves secrets with this priority:
1. **Local secrets exist** — use them (preserves manually added secrets like `STRIPE_KEY`)
2. **SSM configured and has secrets** — pull and use those
3. **Neither** — generate fresh secrets

::: warning
Only `gkm setup --force` regenerates secrets from scratch, which could lose manually added secrets. The `--force` flag is explicitly opt-in.
:::

### Other Sharing Methods

**Share the decryption key** (for teams without SSM)

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
gkm secrets:show --stage development --reveal > secrets-export.json

# Import on another machine
gkm secrets:import secrets-export.json --stage development
gkm setup --skip-docker  # just write docker/.env, then start services manually
```

### Manual Secrets

When you add secrets manually with `gkm secrets:set`:

```bash
gkm secrets:set STRIPE_KEY sk_test_xxx --stage development
```

These are preserved across `gkm setup` runs because setup checks for existing local secrets first.

To share manual secrets with the team:
```bash
gkm secrets:push --stage development   # Team can now pull it
```

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
3. URL rewriting                 (ports adjusted for Docker resolution)
4. Dependency URLs generated     ({APP}_URL, NEXT_PUBLIC_{APP}_URL)
5. GKM_CONFIG_PATH set           (for child processes)
6. All injected into turbo env   (NODE_ENV=development)
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

### "Secrets enabled but no dev/development secrets found"

No encrypted secrets file exists. Run:
```bash
gkm setup
```

Or if you only need secrets without Docker:
```bash
gkm secrets:init --stage development
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
