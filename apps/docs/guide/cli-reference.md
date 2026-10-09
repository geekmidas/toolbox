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

### `gkm dev:credentials`

Print each local service's address and login — Postgres (as a connection
string), the MinIO console, Mailpit, Redis, the cache proxy, RabbitMQ, the AWS
emulator, and OpenObserve where the local compose stack runs it — without
starting anything. The logins are generated per machine the first time a
command needs them; see [Local logins](./dev-server.md#local-logins-are-generated-per-machine).

```bash
gkm dev:credentials [--json]
```

- `--json` — print `{ workspace, stage, services: [{ service, label, url, user?, password?, note? }] }`

It reads the stored logins and `.gkm/ports.json`; run `gkm dev` once first.

### `gkm setup`

Set this machine up for the workspace, once: the local stage's secrets and
containers. It derives the containers, databases, roles, schemas and buckets
the declared constructs name, and stops there.

```bash
gkm setup                      # set up the local stage (stages.local)
gkm setup --skip-docker        # secrets and validation only
gkm setup --force              # regenerate secrets even if they exist
```

- `--stage <stage>` — the stage to set up (default `stages.local`); never a
  deployed stage
- `--force` — regenerate secrets even if they exist
- `--skip-docker` — start no container
- `-y, --yes` — skip prompts

It creates nothing for a deployed stage — no bucket, IAM user, key or DNS
record, and no provider is called. `gkm setup --stage <deployed>` fails with
`SetupIsLocal`: the deploy creates what a deployed stage needs, every time it
runs — `gkm deploy --stage <stage>` (`gkm compose --stage <stage>` is the same
deploy), and its `--dry-run` prints what it would create. See
[Providers](./providers.md) and [Compose: DNS](./compose.md#dns).

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
  --deploy <target>      dokploy, compose, sst or none
  --region <region>      AWS region for --deploy sst (e.g. eu-west-1)
  --registry <registry>  Registry for --deploy compose (e.g. ghcr.io/acme)
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
  --allow-dev-services   Server targets only (dokploy, compose): run the dev
                         service — MinIO for a bucket, Mailpit for mail — for
                         every construct a deployed stage doesn't account for
                         (no key in its secrets, no provider). Not
                         production-grade: Mailpit delivers no mail
  --skip-dns             Compose: neither write the public hosts' DNS records
                         nor check they point at GKM_SERVER_IPV4 — a CDN or
                         proxy in front, or records written elsewhere
  --rotate-keys          Deployed stage: each provider issues its keys a
                         successor; this deploy releases on it, the next one
                         deletes the old key
  --retire-old-keys      Deployed stage: delete a rotated-out key now
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
bucket whose URL has none. A stage missing any fails before anything is built
or written, with `ExternalServicesNotConfigured` listing every missing key and
the `gkm secrets:set` line for each. Under a provider (`deploy.objects`) the
deploy creates the buckets and writes their keys first, so those keys are never
reported missing; a provider with no provisioning credentials stops the deploy
with `ProviderCredentialsMissing`, naming the environment it reads. A stage on
a provider is checked every deploy: the bucket must answer the key in the stage's secrets
(`ProvisionedBucketUnreachable`). `--allow-dev-services` runs MinIO and Mailpit
in place of whatever the stage does not account for, with a warning (and a
`dev-service.used` event) every run; keys the stage set and providers still
win. The flag takes no value (`AllowDevServicesTakesNoValue`); on `sst` it
fails with `DevServicesNeedServerTarget`.

A deployed stage's **resources** are created by the deploy, every run, before
its checks: each provider's buckets and keys ([Providers](./providers.md)),
and, on compose with a `dns` provider for the stage's domain, one record per
public host, read back from the provider ([Compose: DNS](./compose.md#dns)).
`--dry-run` prints both plans and writes nothing.

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
environment can assume — a staging job cannot use the production role. The
role trusts the exact OIDC subject GitHub sends for that environment, read
from the repository's settings: `repo:<owner>/<name>:environment:<stage>` by
default, `repo:<owner>@<ownerId>/<name>@<repoId>:environment:<stage>` on the
immutable subject, or a custom template built from claims known before the run
(one that includes `job_workflow_ref`, `ref`, `sha` or `run_id` is refused with
`OidcSubjectNotSupported`). If the settings cannot be read it assumes the
default and warns. The subject is printed as **Trusted by**, on `--dry-run`
too, and re-running rewrites an existing role's trust, printing old → new —
how a role that trusted the wrong format is repaired. See
[which subject the role trusts](./deployment.md#which-subject-the-role-trusts). On
GitHub (through `gh`, so be logged in) it creates the `<stage>` environment and
sets `AWS_ROLE_ARN`, which the generated deploy workflow reads. With
`secrets.store` set to S3, SSM or Secrets Manager the deploy job reads the stage's
secrets there with the role, and GitHub is handed no key; with the `'file'`
store it sets `GKM_SECRETS_KEY` (from `~/.gkm/keys/<namespace>/<project>/<stage>.key`).
Re-running it converges.

| Option | |
|---|---|
| `--stage` | a stage in `stages.deployed` |
| `--profile` | the AWS profile for the stage's account — keys, assume-role or SSO, whatever `~/.aws/config` says. Only that profile: exported `AWS_*` variables are not consulted |
| `--policy-arn` | what the role may do, in place of the default: `AdministratorAccess`, which SST needs to create stacks — or, for a stage only the `compose` target deploys, an inline policy allowing just the stage's secrets (and deploy state in AWS), plus, when the stage uses them, its `s3` provider's buckets and IAM users and its `route53` domain's records. See [what the role may do](./deployment.md#what-the-role-may-do) |
| `--repo` | `owner/name`; defaults to the repository `gh` sees |

The profile needs rights to manage IAM in that account; if it lacks them, AWS's
error names the action. An expired SSO login says to run
`aws sso login --profile <name>`.

### `gkm stages`

The workspace's stages, as `stages` in `gkm.config.ts` declares them — read
through the normal config loader (and sandbox), so nothing else has to parse
TypeScript to learn them:

```bash
gkm stages                 # a table: each stage and whether it is local, deployed, protected
gkm stages --json          # {"local":"dev","deployed":["staging","prod"],"protected":["prod"]}
gkm stages --github-output --event push
```

`--json` prints that one line on stdout and nothing else; `protected` is `[]`
when none is. A config without `stages` fails with `InvalidStages`.

`--github-output` is what the [stages action](./deployment.md#deploying-from-github-actions)
runs. It writes these outputs to the file `$GITHUB_OUTPUT` names, each a string
`fromJSON()` reads:

| Output | |
|---|---|
| `local`, `deployed`, `protected` | the stages, as JSON |
| `build` | the stages whose images this run builds and pushes |
| `deploy` | the stages this run deploys |
| `has-build`, `has-deploy` | `'true'` or `'false'` — a matrix over `[]` is an error on GitHub, so a job skips on these |
| `aws-region` | the region of an `s3`, `ssm` or `secrets-manager` `secrets.store` (an `s3` store's from the S3 state when it names none), else `''` |
| `resources` | the deployed stages with resources the deploy creates — a `deploy.<kind>.<stage>` provider, or a `dns` domain whose provider writes records — and secrets in an AWS store; a compose workflow creates them on the runner |

For each event:

| `--event` | `build` | `deploy` |
|---|---|---|
| `push` | every deployed stage | the deployed stages not protected |
| `release` | none | the protected stages |
| `workflow_dispatch` | none | `--stage`, which must be a deployed stage |
| anything else | none | none |

A `workflow_dispatch` with no `--stage` is `DispatchNamesNoStage`, and one
naming a stage that is not deployed is `UndeclaredStage`; either is printed as
an `::error::` annotation, and nothing is written.

| Option | |
|---|---|
| `--json` | print the stages as JSON |
| `--github-output` | write the outputs above to `$GITHUB_OUTPUT` (`GithubOutputNotSet` without it) |
| `--event` | the event to plan for; defaults to `$GITHUB_EVENT_NAME` |
| `--stage` | the stage a `workflow_dispatch` deploys |

### `gkm compose`

Run the workspace's APIs and sites for a stage as one Docker Compose stack
behind Caddy, over HTTPS — the local stage on this machine's Docker, a deployed
stage on its server's (`deploy.compose.server`), over SSH. See
[Deploy with Docker Compose](./compose.md).

```bash
gkm compose [options]

Options:
  --stage <stage>  Stage to run (required)
  --tag <tag>      Run the images CI pushed at this tag (sites: <tag>-<stage>);
                   every image is checked in the registry first, nothing is built
  --build          Build images from this checkout, tagged with the commit
  --pull           Pull images (at --tag, or latest) rather than build them
  --push           With --build: push every image to deploy.registry and
                   start nothing — no lock, provisioning, up or state (CI)
  --digests-file <path>
                   With --push: write each image as {"app": "<ref>@sha256:…"}.
                   With --tag: run each image at the digest the file names
  --dry-run        Write the files and print the plan; start nothing
  --down           Stop the stage's stack (its volumes are kept)
  --allow-dev-services
                   Deployed stage: run MinIO and Mailpit for every bucket and
                   mail it doesn't account for (no key in its secrets, no
                   provider). The local stage always runs both
  --skip-dns       Deployed stage: neither write the public hosts' DNS
                   records nor check they point at GKM_SERVER_IPV4 (a CDN or
                   proxy in front, or records written elsewhere)
  --rotate-keys    Deployed stage: issue each provisioned key a successor
  --retire-old-keys
                   Deployed stage: delete a rotated-out key now

The same as `gkm deploy --target compose --stage <stage>`, plus --build, --pull,
--push, --digests-file and --down.

Errors:
  ServerAddressMissing    a deployed stage with a domain and no GKM_SERVER_IPV4
                          in its secrets (gkm secrets:set GKM_SERVER_IPV4 '<ip>')
  ServerAddressInvalid    GKM_SERVER_IPV4/IPV6 that is not an address
  DnsCredentialMissing    a dns provider for the stage's domain and no token
                          (GODADDY_API_TOKEN, HOSTINGER_API_TOKEN) — before
                          anything runs
  DnsWildcardRefused      a wildcard public host; records are one per host
  DnsRecordsNotConfirmed  records the deploy wrote that the provider does not
                          return when read back
  HostNotPointingAtServer a public host, under no dns provider that writes, that
                          does not resolve to the server (fix: a dns provider,
                          or the records by hand; or --skip-dns)
  ProviderCredentialsMissing
                          a deploy.<kind>.<stage> provider with no credentials
                          to create its resources with
  ComposeServerMissing    a deployed stage with no deploy.compose.server entry,
                          or no host there and no GKM_SERVER_IPV4 to default to
  ComposeServerUnreachable
                          SSH to the stage's server, or Docker there, did not
                          answer (quotes ssh's stderr) — before anything changes
  ComposeTunnelFailed     the SSH tunnel to the stack's Postgres or MinIO did
                          not open (sshd's AllowTcpForwarding, or a key
                          installed with `restrict` and no `port-forwarding`)
  RegistryRequired        --push, --tag or --pull with no deploy.registry
                          (the image would be a Docker Hub name)
  ComposePushNeedsBuild   --push without --build, or with --pull
  ComposePinNeedsPull     --digests-file on a build that neither pushes nor pulls
  ImageDigestMissing, ImageDigestMismatch
                          a digests file with no entry for an app, or one for
                          another image or tag

Environment:
  GKM_COMPOSE_HTTPS_PORT  Where the edge publishes HTTPS (default 443)
  GKM_COMPOSE_HTTP_PORT   Where the edge publishes HTTP (default 80)
  GKM_COMPOSE_LOGS_PORT   Local stage: where OpenObserve is published on
                          127.0.0.1 (default 5080)
```

`gkm compose --stage <stage> --build --push --tag <tag>` is the CI half of a
release and `gkm compose --stage <stage> --tag <tag>` the server's — see
[Deploying from CI](./compose.md#deploying-from-ci).

When a process uses a [`Telemetry` construct](./telemetry.md), the stage's
`deploy.telemetry` decides where it goes; a stage that names nothing — and the
local stage, always — runs OpenObserve in the stack and points each process
with the edge at it, on a loopback port reached through an SSH tunnel — see
[Telemetry](./compose.md#telemetry). A `docker-compose.<stage>.yml` at the
workspace root is merged over the generated stack.

`deploy.compose.proxy` (`'caddy'`, the default, or `'traefik'`, for every
deployed stage or per stage) chooses what serves a deployed stage: the stack's
own Caddy, or the server's shared Traefik edge (compose project and network
`gkm-edge`, configured from `$GKM_HOME/edge`), which `gkm compose` starts when
needed and `--down` unregisters from. `deploy.compose.tls.<stage>` gives a
stage its own certificate in place of Let's Encrypt. See
[Proxy: Caddy or Traefik](./compose.md#proxy-caddy-or-traefik). `gkm deploy --target dokploy` runs
no collector: a stage there that uses telemetry names `{ provider: 'otlp' }` or
`false` in `deploy.telemetry`.

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
gkm secrets:set API_KEY 'secret' --stage production

# Remove a secret
gkm secrets:unset API_KEY --stage production

# Show secrets (masked)
gkm secrets:show --stage production

# Show secrets (revealed)
gkm secrets:show --stage production --reveal

# Rotate service passwords
gkm secrets:rotate --stage production --service postgres

# Import from JSON
gkm secrets:import secrets.json --stage production

# Copy a deployed stage to another store (s3, ssm, secrets-manager, file)
gkm secrets:migrate --stage production --to s3
```

#### `gkm secrets:migrate`

| Option | Description |
|---|---|
| `--stage <stage>` | A deployed stage (required) |
| `--to <provider>` | The store to copy to: `s3`, `ssm`, `secrets-manager` or `file` (required) |
| `--region <region>` | The target's AWS region. For `s3` it defaults to the S3 state's region, else the configured store's. For the others it defaults to the configured store's |
| `--profile <profile>` | The AWS profile for the stage's account, used for both stores |
| `--force` | Replace different secrets that the target already holds |

The command copies the stage (service passwords, URLs and custom keys) from the
store `secrets.store` names to the store `--to` names. It then reads the copy
back and compares every key and value. Finally, it tells you which
`secrets.store` to set, and prints the command that deletes the source copy,
such as `aws ssm delete-parameter --name /gkm/<project>/<stage>/secrets
--region <region>`, for you to run once deploys read the new store.

The command never deletes the source and doesn't edit `gkm.config.ts`. It's
safe to run again: if the target already holds the same secrets, it writes
nothing and checks them again.

It fails with:

| Error | When |
|---|---|
| `MigrateTargetIsSource` | the target is the configured store |
| `MigrateTargetHoldsStage` | the target holds different secrets, and `--force` wasn't passed |
| `MigratedSecretsDiffer` | the copy read back doesn't match |
| `NoSecretsToMigrate` | the source has no secrets |
| `UnknownSecretsStoreProvider` | `--to` isn't a store |
| `StageSecretsUnreadable` | there are no AWS credentials, or they've expired |

See [Switching stores](./deployment.md#switching-stores).

#### Guided secrets

```bash
# Walk each key the stage must be given, for every app: set it, skip it, or stop
gkm secrets:add --stage production

# Only the keys the stage has not set — picks up where a run left off
gkm secrets:add --stage production --missing

# The same list as JSON, asking nothing — for a script or CI
gkm secrets:add --stage production --missing --json
```

`secrets:add` offers the keys a deploy would refuse the stage without: each
bucket's, mail server's and file server's on a deployed stage, and every
external API's and `Credential`'s `<ID>_CREDENTIALS` on any stage. It walks
them one at a time, unset keys first, and at each asks **Set it now**,
**Skip** or **Stop here**. A key set is built by kind — a bucket from its
provider, mail from its service (Resend, Amazon SES, Postmark and Mailgun ask
only for their secrets) or any SMTP server, credentials field by field from
the construct's schema — checked, and saved through the stage's store at
once, so a stop or Ctrl-C keeps it. The run ends with what was saved, skipped
and still missing. A key a provider on the stage creates — a bucket under
`deploy.objects.<stage>`, written by `gkm deploy --stage <stage>` — is listed
rather than offered. `--json` prints `key`, `kind`, `construct`, `apps` and
`set` for each, and `provisioned: true` for a key a provider creates. Without a terminal and without `--json` it fails
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
deployed stage kept in S3, SSM or Secrets Manager, `secrets:set` writes there and
`secrets:show` reads from it, with the default AWS credentials (`AWS_PROFILE`, or a deploy
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

# Who wrote the stage's state, newest first, and what each app runs
gkm state:history --stage production
gkm state:history --stage production --json

# Release the lock of a deploy that was killed
gkm state:unlock --stage production
```

`pull`, `push` and `diff` need a remote provider (SSM or S3). See
[Deploy state](./state.md).

### Backups

A deployed compose stage with Postgres is backed up on schedule — see
[Backups](./compose.md#backups). With the stage account's credentials
(`--profile`, or the usual AWS variables):

```bash
# Every run, newest first: when, which databases, how big
gkm backup:list --stage production
gkm backup:list --stage production --json

# A backup now: the stack's backups container, through docker exec
gkm backup:now --stage production

# Restore — asks first, and takes a fresh backup before anything changes
gkm backup:restore --stage production --latest
gkm backup:restore --stage production --at 2026-10-10/02-00-00Z
gkm backup:restore --stage production --at 2026-10-10T12:00:00Z --database auth-database --yes
```

| Option | |
| --- | --- |
| `--at <time>` | A run's folder, or a time: the newest run at or before it |
| `--latest` | The newest run |
| `--database <name>` | One database, by its file name (`auth-database`); every one by default |
| `-y, --yes` | Restore without asking |
| `--profile <profile>` | AWS profile for the stage's account |

### Authentication

```bash
# Login to deployment service
gkm login --provider dokploy
gkm login --provider godaddy   # a Personal Access Token, scoped to domains.dns:update

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
