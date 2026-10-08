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
and the MinIO and RabbitMQ consoles as links you can open — and, under it,
how to sign in to each:

```
🔑 Logins (again any time: gkm dev:credentials)
   Postgres       postgres://shop_admin:Xq…@localhost:28001/postgres
                  user shop_admin, password Xq…
   MinIO console  http://localhost:28004
                  user minio, password 7d… — S3 API on http://localhost:28003
   Mailpit inbox  http://localhost:28007
                  no login
```

#### Local logins are generated, per machine

No container runs with a fixed, shared login. The first time `gkm dev`,
`gkm test` or `gkm setup` needs them, gkm generates them — random, and in the
shape each service accepts — and keeps them for every later run:

| Service | User | Password, token or key |
|---|---|---|
| Postgres | `<workspace>_admin` (e.g. `shop_admin`) | 256 random bits |
| MinIO | `minio` | 32 letters and digits (MinIO takes 8–40) |
| Redis | — | 256 random bits, its `requirepass` |
| Cache HTTP proxy | — | 256 random bits, its bearer token |
| RabbitMQ | `rabbitmq` | 256 random bits |
| AWS emulator | the fixed `LSIA…` key id | a 40-character secret key |
| OpenObserve (`gkm compose` locally) | `admin@gkm.localhost` | meets its complexity rule |

They are kept encrypted with the local stage's key in the CLI's home —
`~/.gkm/local/<namespace>/<project>.json`, or under `GKM_HOME` — not in the
checkout, because every checkout of a project shares its containers: two
worktrees each with their own password would lock each other out. A random
seed is kept with them and salts each database role's password, as a deployed
stage's seed does. `gkm compose --stage <local>` runs its containers with the
same logins.

To see them without starting anything:

```bash
gkm dev:credentials          # each service's address and login
gkm dev:credentials --json   # the same, for a script
```

It reads the logins and the ports in `.gkm/ports.json`. The discovery
endpoint (`/__gkm`) lists apps and the constructs they declare, never these
logins.

**Upgrading.** A volume an older gkm made was initialised with its old fixed
login. On the first run after upgrading, reconcile notices — it signs in with
the old login — and moves the service onto the generated one, keeping its
data: Postgres gets the new superuser and the old one stops logging in;
MinIO reads its root login on every start, so recreating its container is
enough; RabbitMQ's user is updated with `rabbitmqctl`. Where Postgres takes
neither login — another tool changed it — the password is reset from inside
the container. Where a service cannot be moved (your `docker-compose.yml` pins
`MINIO_ROOT_USER`, say), it keeps the login it has and gkm prints a line
saying how to reset it. Nothing is deleted.

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
| a `Telemetry` given to a surface or worker | `openobserve`, the local collector and its UI |

There is no `services` block and no flag that starts a container. The containers
are written to the generated `docker-compose.constructs.yml`; an image pin, or a
service no construct implies, goes in your own `docker-compose.yml`, merged over
it. Reconcile then creates what the URLs name — databases, roles, buckets — and
persists the ports it assigned to `.gkm/ports.json`, so external tools keep
working across restarts.

### Telemetry, locally

When any surface or worker is given a [`Telemetry` construct](./telemetry.md),
reconcile adds OpenObserve to the services, prints where it is, and lists its
login — `admin@gkm.localhost` with a password generated for this machine —
with the other local logins:

```
🐳 Services
   …
   openobserve    http://localhost:28011
🔑 Logins (again any time: gkm dev:credentials)
   …
   OpenObserve    http://localhost:28011
                  user admin@gkm.localhost, password … — when running: gkm dev
```

Each process with an edge to the construct is handed `OTEL_*` pointing at it,
named for its app, keeping every trace (`OTEL_TRACES_SAMPLER_ARG=1`); a process
without the edge, and every site, gets none. `deploy.telemetry` is not read
here. The dev server's entry starts the same OpenTelemetry SDK and mounts the
same request middleware the production server does — from the same generated
`telemetry.ts` — so what you see locally is what a deployed stage sends: a
span per request, its log lines in its trace, its queries, and the queue jobs
it enqueued. The [discovery endpoint](#discovery-endpoint) lists the UI as
`telemetry: { url, email }`, never the password.

`gkm test` starts no collector and hands out no key: tests export nothing.

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
2. Parse `gkm.config.ts` for routes, envParser, logger, telescope, hooks
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
3. Starts the containers the constructs imply, creating each database's roles from the stage's credential

### What's Gitignored

The generated `.gitignore` excludes these files:

| File | Why Gitignored | Impact When Missing |
|------|----------------|---------------------|
| `.gkm/` | Contains build artifacts, port state, dev secrets | Recreated by `gkm setup` |
| `.env` | Local environment overrides | Not required — secrets handle this |
| `node_modules/` | Dependencies | Restored by `pnpm install` |

### What's Not in the Repo

| File | Location | Why Not Committed |
|------|----------|-------------------|
| Decryption key | `~/.gkm/keys/{namespace}/{project}/development.key` (`$GKM_HOME/keys/…` when `GKM_HOME` is set) | Security — stored in the user's home directory |

### Deployed Stages: the Secrets Store

The local stage's secrets belong to the machine running `gkm dev`. A
**deployed** stage's secrets have to be reachable from wherever it is deployed
from — a teammate's laptop, or a CI runner — and `.gkm/` is not committed, so
they live in a **store**, set with `secrets.store` in `gkm.config.ts`:

```ts
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'my-app',  // Scopes the parameter or secret name
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
| `'file'` (default) | the encrypted `.gkm/secrets/<stage>.json` on this machine, with its key in `~/.gkm/keys/` (or `$GKM_HOME/keys/`). It cannot serve a deploy from CI while `.gkm/` is gitignored |
| `{ provider: 'ssm', region }` | one `SecureString` parameter per stage, `/gkm/<name>/<stage>/secrets`, in the AWS account of the active credentials — so with staging and production in different accounts, each stage's secrets sit beside its infrastructure. Up to 8 KB |
| `{ provider: 'secrets-manager', region, kmsKeyId? }` | one Secrets Manager secret per stage, `gkm/<name>/<stage>/secrets` (the same path with no leading `/`), in the account of the active credentials, encrypted with `aws/secretsmanager` or the `kmsKeyId` given. Up to 64 KB |
| `{ provider: store }` | any object with a `name`, `read(stage)` and `write(stage, secrets)` |

`gkm init --deploy sst` writes the SSM store with the region you picked. A
provider name that is not one of these (`'secretsmanager'`, say) fails the
config with `UnknownSecretsStoreProvider`; it is never read as the file. For
choosing between the two AWS stores, and the IAM each needs, see
[The secrets store on AWS](./deployment.md#the-secrets-store-on-aws).

**Every command reads and writes the stage's store directly.** `gkm
secrets:set KEY … --stage prod` writes to the store; `gkm deploy`, `gkm build`,
`gkm setup` and `gkm exec --stage prod` read from it. There is no copy on this
machine to keep in step, and nothing to push before a deploy. The local stage
is always the file, whatever `store` says.

Both AWS stores use the default AWS credential chain: `AWS_PROFILE` on a
laptop — `AWS_PROFILE=acme-prod gkm secrets:set … --stage prod` — and the
stage's OIDC role in a deploy job. A command given `--profile` (such as
`gkm deploy:github`) uses that profile alone, never `AWS_*` from the
environment. The permissions each store needs are listed under
[IAM](./deployment.md#iam-for-the-secrets-store).

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
# Original developer exports the key location — {namespace} is
# deploy.namespace, else the kebab-cased workspace name; {project} is the
# workspace name, lowercased:
# ~/.gkm/keys/{namespace}/{project}/development.key

# New team member places the key file:
mkdir -p -m 700 ~/.gkm/keys/{namespace}/{project}
cp /path/to/shared/development.key ~/.gkm/keys/{namespace}/{project}/development.key
chmod 600 ~/.gkm/keys/{namespace}/{project}/development.key

# Then run setup to start services:
gkm setup
```

**Import from JSON**

```bash
# Export secrets from one machine
gkm secrets:show --stage dev --reveal > secrets-export.json

# Import on another machine
gkm secrets:import secrets-export.json --stage dev
gkm setup --skip-docker  # resolve secrets only; start services later
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

### No Per-App Secret Mapping

Stored secrets are injected as stored. A database's URL is its construct's
key (`DATABASE_URL` for `new KyselyDatabase('Database')`, `AUTH_DB_URL` for
`database.schema('AuthDb')`), derived by reconcile — it is never a stored
`<APP>_DATABASE_URL` renamed onto `DATABASE_URL`, and a derived address always
wins over a stored one in `gkm dev` and `gkm test`.

## Development Tools

`gkm dev` serves these alongside the app. They are headless — JSON for
whatever tool you point at them; toolbox ships no dashboard.

| Tool | URL | Description |
|------|-----|-------------|
| Telescope | `http://localhost:3000/__telescope/api/*` | Requests, exceptions, logs and metrics |
| Database API | `http://localhost:3000/__gkm/db` | The declared database's schemas, tables and rows, read-only |
| OpenAPI | `http://localhost:3000/__docs` | Auto-generated API documentation |

### Database API

When the app declares a database, `gkm dev` mounts
[`@geekmidas/db/introspect`](/packages/db#database-introspection) at
`/__gkm/db`, reading through the same client the handlers use. It is never part
of `gkm build`, since it answers anyone who can reach the port.

```bash
curl localhost:3000/__gkm/db/schemas
curl localhost:3000/__gkm/db/tables
curl localhost:3000/__gkm/db/tables/users
curl 'localhost:3000/__gkm/db/tables/users/rows?pageSize=20&sort=created_at:desc&filter[email][ilike]=%25@example.com'
```

The app needs `@geekmidas/db` installed, which a project scaffolded with a
database already has.

## Discovery Endpoint

Each app's tools are on its own port, so a tool would have to be told every
port. Instead, `gkm dev` serves one endpoint on a fixed loopback port —
`127.0.0.1:4983` — that lists everything running with `gkm dev` on the machine,
and prints a connect URL for it:

```
🧭 Discovery: http://127.0.0.1:4983/__gkm?token=Qm9i…
```

| Route | What it answers |
|-------|-----------------|
| `GET /__gkm` | Every running workspace: name, stage, construct manifest, its local telemetry UI (`telemetry: { url, email }`, or `null`), and each app with its port, URL, status and data APIs |
| `GET /__gkm/events` | Server-sent events: a `snapshot`, then `workspace.started`/`stopped` and `app.started`/`stopped`/`reloaded`/`status` |
| `GET /__gkm/workspaces/<id>/apps/<app>/<path>` | That app's data API at `<path>` — Telescope's `/__telescope/api/*`, `/__gkm/db/*`, `/__docs` — so a client needs one origin |

```bash
TOKEN=…  # from the connect URL
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4983/__gkm
curl -N "http://127.0.0.1:4983/__gkm/events?token=$TOKEN"
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:4983/__gkm/workspaces/shop-1a2b3c4d/apps/api/__gkm/db/tables
```

The response types (`DiscoveryResponse`, `DiscoveredWorkspace`,
`DiscoveredApp`, `DiscoveryEvent`) are exported from `@geekmidas/cli/config`.
Each data API comes with its `url` on the app and its `proxy` path here.

The events are server-sent events rather than a WebSocket: the stream only
ever flows one way, `EventSource` reconnects on its own — to whichever
`gkm dev` hosts the endpoint by then — and, unlike a WebSocket handshake, a
cross-origin `EventSource` is subject to CORS like every other request here.

### Several `gkm dev`s at once

Every `gkm dev` — a workspace's, each app's under it, another project's —
registers what it runs in `~/.gkm/dev/sessions/` and removes it when it stops.
The first to bind the port serves the endpoint, reading that registry; the
others keep trying, so when it exits the next one takes over within a second.
A session killed outright is recognised by its pid and dropped. The token is
shared through the registry (`~/.gkm/dev/token`, readable only by you), so a
connect URL keeps working across a handover, and a new one is made once every
session has stopped.

### Configuration

```ts
// gkm.config.ts
export default defineWorkspace({
  dev: {
    // Browser origins that may read this workspace through discovery.
    allowedOrigins: ['https://console.example.com'],
    // 4983 by default; GKM_DISCOVERY_PORT overrides it.
    discoveryPort: 4983,
  },
  // …
});
```

### Security

Any web page you visit can send requests to a loopback port, so the endpoint
does not trust being on loopback:

- **Loopback only.** It binds `127.0.0.1`, never `0.0.0.0`.
- **Token on every request.** As `Authorization: Bearer <token>` or
  `?token=<token>` (for `EventSource`, which cannot set headers). A preflight is
  the one exception — browsers send it without credentials.
- **Origin allowlist, empty by default.** A request carrying an `Origin` is
  refused unless a running workspace lists it in `dev.allowedOrigins`; CORS
  headers are sent only to listed origins, and an origin sees only the
  workspaces that listed it. A request with no `Origin` — curl, a local
  process — still needs the token.
- **`Host` check.** Only `127.0.0.1:<port>` and `localhost:<port>` are
  answered, which defeats DNS rebinding: a page on `attacker.example` whose DNS
  is switched to `127.0.0.1` still sends `Host: attacker.example`.
- **Read-only.** `GET` and `HEAD` only, and the forwarder reaches an app's data
  APIs and nothing else of it — not its endpoints, not cookies, not the token.

### Calling it from a web page

A page served from a public origin (say `https://console.example.com`) can call
the endpoint once that origin is in `dev.allowedOrigins` and it has the token.
Browsers treat a public page reaching loopback specially:

- **Chrome** (and other Chromium browsers) gate it behind **Local Network
  Access**: the first such request shows the user a permission prompt for the
  site, and the request fails if it is denied. The page should be served over
  HTTPS; `http://127.0.0.1` itself counts as a secure context, so it is not
  blocked as mixed content. The endpoint also answers the older Private Network
  Access preflight (`Access-Control-Allow-Private-Network: true`) for listed
  origins.
- **Firefox** — *as best known, verify on your version*: treats `localhost` and
  `127.0.0.1` as secure contexts, so an HTTPS page may fetch them; it has been
  rolling out its own local network access restrictions, which may add a prompt
  like Chrome's.
- **Safari** — *as best known, verify on your version*: has blocked requests
  from HTTPS pages to `http://127.0.0.1` as mixed content in some versions, and
  has no permission prompt; a console that must support Safari may need to run
  as a local page or desktop app instead.

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

The key at `~/.gkm/keys/{namespace}/{project}/development.key` is missing (the error names the exact path). Either:
- Run `gkm setup` (generates fresh secrets with a new key)
- Get the key file from a team member
- Regenerate: `gkm setup --force`

### Docker PostgreSQL auth failure

Another container is probably on the port, or the volume was created by a different project. Reconcile creates each role from the stage's credential; if the volume holds stale roles:
```bash
docker compose down -v   # Remove volumes (destructive!)
gkm setup               # Starts services and recreates the roles
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
