# Deploy with Docker Compose

`gkm compose` runs a workspace's APIs and sites for one stage as a single
Docker Compose stack on one machine, with [Caddy](https://caddyserver.com) in
front serving every app over HTTPS.

```bash
gkm compose --stage development         # the local stage, built from this checkout
gkm compose --stage production --tag v1.4.0   # the images CI pushed as v1.4.0
gkm compose --stage production --build --push --tag v1.4.0  # CI: build and push, start nothing
gkm compose --stage production --down    # stop it (volumes are kept)
gkm compose --stage preview --allow-dev-services minio,mailpit  # a demo, on dev services
```

`--stage` is required: a stack is always for a named stage, so a deployed
stage — and the external mail and storage it needs — is never reached by
leaving a flag off. `gkm compose` is the built-in `compose` deploy target with a few switches of
its own. The same stack comes up through `gkm deploy`, with the same phases,
events, lock and state:

```bash
gkm deploy --target compose --stage development          # the local stage
gkm deploy --target compose --stage production --tag v1.4.0
```

`compose` is the one built-in target that can also run the project's local
stage: the stack runs on the machine that deploys it. With `deploy.default:
'compose'`, `gkm deploy --stage production` needs no `--target`.

How it compares with `dokploy` and `sst` is in [Deploy targets](./deploy-targets.md).

It reads the same construct manifest as `gkm dev` and `gkm deploy`. Nothing is
configured for it: the apps, the databases they need, the keys each one reads,
and the hosts they answer on all come from what the workspace declares.

## What runs

- **Every `RestApi`** — one container each, an auth server included.
- **Every site** (`StaticSite`, Next.js, TanStack) — one container each.
- **Every `Worker`** with crons, queue consumers or topic subscribers — one
  container each, running them. It has no Caddy route and no published port,
  restarts `unless-stopped`, reads exactly the keys its constructs read from
  its own `0600` env file, and is checked by its Docker health check on
  `/health`. It starts once migrations have run, with the APIs. See
  [Workers](./production.md#workers).
- **The infrastructure those apps declared** — Postgres with a named volume,
  holding every declared database and pg-boss's schema.
- **Redis, when a cache is declared**, holding every cache — see
  [The cache](#the-cache).
- **Mail and object storage, on the local stage**: Mailpit, and MinIO with
  every declared bucket (and its file servers' open paths) created before any
  app starts. Nothing needs setting — no bucket URL, no mail server. A
  deployed stage brings its own; see
  [Mail and storage on a deployed stage](#mail-and-storage-on-a-deployed-stage).
- **OpenObserve, when asked for** (`deploy.compose.logs`), receiving every
  backend's logs and traces — see [Logs](#logs).
- **One Caddy**, one host per app — and one per file server over the stack's
  MinIO (`https://uploadsserver.<project>.localhost` locally), rewriting to its
  bucket the way `gkm dev`'s edge does.

The databases, roles and grants are created, and each database's migrations
(`db/<construct>/migrations`) applied, before any app starts — so an app never
boots against a schema that is not there yet.

A stack is a server target: whatever `deploy.default` says, its events go
through pg-boss beside the declared database, and every cache lives in the
stack's own Redis.

## Tags are the release

```bash
gkm compose --stage production --tag v1.4.0
```

With `--tag`, every app runs `<registry>/<namespace>/<project>-<app>:<tag>` —
the image CI pushed — and **nothing is built**. Before anything is pulled or the
running stack is touched, every app's image is looked up in the registry. If
any is missing the run stops with `ImageTagNotFound`, listing every missing
image, and nothing is started: a release is all of its images or none of them.
A missing image is never quietly built instead, because a build of whatever is
checked out is not the release the tag names. A registry that cannot be reached,
or that refuses this machine's credentials, is `RegistryUnreachable` — log in
with `docker login <registry>`.

Without `--tag`, the stack is built from this checkout and its images are
tagged with the commit (`git rev-parse --short HEAD`, with `-dirty` when the
tree has changes). `--build` and `--pull` override the default — build when no
tag is given, pull when one is. `--pull` without `--tag` pulls `latest`.

The registry is `deploy.registry` in `gkm.config.ts` — the same one every
target pushes to and pulls from. Without one an image name has no registry
prefix, and Docker resolves such a name to Docker Hub — so anything that
pushes or pulls (`--push`, `--tag`, `--pull`) fails at `validate` with
`RegistryRequired` before anything is built or asked of a registry. A build
here with no tag needs no registry.

Each run records, per app, the image ref, the tag it ran and the digest that
tag resolved to (for an image built here and never pushed, its image id) in the
stage's deploy state, under `images` — the same record a Dokploy deploy keeps —
so "what is this stage running" has an exact answer.

### A site's tag is `<tag>-<stage>`

A site's public URLs (`VITE_API_URL`, `NEXT_PUBLIC_AUTH_URL`) are inlined into
its bundle when it is built, so one site image serves one stage. A backend
reads its URLs at runtime, so one backend image serves every stage.

So for a release, `gkm compose --build --push` pushes:

| App | Image |
| --- | --- |
| an API | `ghcr.io/acme/shop/shop-api:v1.4.0` |
| a site, per stage | `ghcr.io/acme/shop/shop-web:v1.4.0-production`, `…:v1.4.0-staging` |

and `gkm compose --stage production --tag v1.4.0` pulls exactly those. A site
built by `gkm compose` without a tag is tagged `<commit>-<stage>` the same way.

## Deploying from CI

The release is built and pushed where the code is, and pulled where it runs:

```bash
# the runner: build every image and push it to deploy.registry; start nothing
gkm compose --stage production --build --push --tag $SHA --digests-file digests.json

# the server: pull exactly those images and run them
gkm compose --stage production --tag $SHA
```

`--build --push` builds every image the stack needs exactly as a deploy of the
stage would — each backend and worker at `<tag>`, each site at
`<tag>-<stage>` with the stage's public URLs — pushes each to
`deploy.registry`, and prints every pushed ref with the digest the registry
stored. Nothing else happens: no stage lock, no infrastructure, no
provisioning or migrations, no container started, no secret generated and
kept, nothing recorded in the stage's state. So the runner needs Docker, the
stage's secrets store (for a site's public URLs) and a `docker login` to the
registry — no Postgres, no server. `--push` without `--build`, or with
`--pull`, is `ComposePushNeedsBuild`.

`--digests-file <path>` writes each pushed image as JSON, `{ "api":
"<ref>@sha256:…" }`. Handed the same file, a pull runs each image at its digest
rather than its tag, so a tag moved after the push cannot change what is
released, and the stage's state records the pinned ref:

```bash
gkm compose --stage production --tag $SHA --digests-file digests.json
```

A file missing an app is `ImageDigestMissing`, and an entry for another image
or tag `ImageDigestMismatch` — both before the registry is asked.

### A GitHub Actions workflow

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      # The stage's secrets store: the site builds read its public URLs.
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.DEPLOY_ROLE_ARN }}
          aws-region: eu-west-1
      - run: >-
          pnpm exec gkm compose --stage production --build --push
          --tag ${{ github.sha }} --digests-file digests.json
      - uses: actions/upload-artifact@v4
        with:
          name: digests
          path: digests.json

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: digests
      - name: Pull and run on the server
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: deploy
          key: ${{ secrets.SERVER_SSH_KEY }}
          script: |
            cd /srv/shop && git fetch && git checkout ${{ github.sha }}
            pnpm install --frozen-lockfile
            pnpm exec gkm compose --stage production --tag ${{ github.sha }}
```

The server runs `gkm compose` itself, from a checkout at the same commit:
provisioning and migrations reach the stack's Postgres on its loopback port. It
needs a `docker login` to the registry (a read-only token is enough) and the
stage's secrets store. To pin by digest, copy `digests.json` to the server
(`scp`, or the action's own file upload) and add `--digests-file digests.json`.

## Building

Every image is built inside Docker, from the same Dockerfiles `gkm docker`
writes, and nothing is built on this machine first. Each prunes the build root
to its app's slice with `turbo prune`, installs it, builds the workspace
packages the app depends on, and then the app: a backend by `gkm build
--provider server --production` — one file, no dependencies, in a slim
runner — and a site by its framework, with its public URLs passed as **build
args**. A site's container gets no server environment and waits on no
database.

No image embeds anything of a stage. A backend or a worker reads every
secret at runtime from its own env file (mode `0600`, written by the deploy),
so the image built at a commit is the same for every stage: the image tested
on staging is the one production runs, and rotating a secret needs a restart,
not a rebuild. Only a site differs per stage, by its public URLs.

The generated Dockerfiles are written beside the stack, in
`.gkm/compose/<stage>/`. The build context is the build root — the directory
holding the lockfile or `pnpm-workspace.yaml`, at or above the workspace, so a
workspace nested in a monorepo is built from the monorepo's root — and its
`.dockerignore` is made to leave out `.gkm/compose`, so no stage's env file is
ever sent to a build.

## The files

Everything for a stage is in `.gkm/compose/<stage>/` (directory `0700`):

```
docker-compose.yml   the stack — compose project <scope>-<stage>
Caddyfile            one host per app
api.env              one env file per backend, mode 0600
auth.env
openobserve.env      with deploy.compose.logs: its root login, mode 0600
redis.env            with a cache: the Redis password, mode 0600
Dockerfile.api       when building
caddy-root.crt       the local stage's CA root
```

The compose project is named after the workspace's deploy identity and the
stage (`shop-production`, or `acme-shop-production` in a namespace), so two
stages, or two workspaces, can run side by side on one machine.

## Env files

Each backend's env file holds **only the keys that app reads** — what its
constructs provide and require, and what each construct it has an edge to
provides — resolved for the stage:

- its own public URL, `https://<host>`, which it builds links and cookies on;
- each surface it calls, **on the compose network** (`AUTH_URL=http://auth:3001`);
- connection strings to the stack's own Postgres, and each cache's URL on
  the stack's Redis;
- `PORT`, `STAGE` and `NODE_ENV=production`;
- its secrets and credentials, from the stage's secrets store;
- the stage's `OTEL_*` telemetry settings, or the stack's OpenObserve — see
  [Logs](#logs).

A secret an app does not read is never written to its file. Images stay
stage-agnostic: no secret is baked into one. Compose reads the files raw, so
nothing in a value is interpolated.

For a deployed stage, everything the stage generates once — its seed, each
`Secret`'s value, each encryption keyring, the Redis password — is generated on the first run and
written back to the stage's secrets store, exactly as `gkm deploy` does, and
every database password is derived from the seed. A credential or an external
API's credentials comes from the stage's secrets, and a missing one stops the
run naming the key:

```bash
gkm secrets:set SHIPPING_CREDENTIALS '{"apiKey":"…"}' --stage production
```

## HTTPS and Caddy

Each app answers on its own host:

| Stage | Hosts | Certificates |
| --- | --- | --- |
| local | `api.<project>.localhost`, `<project>.localhost` for the root site | Caddy's internal CA |
| deployed | the stage's domains, from `deploy.domains` — `api.example.com`, `example.com` | Let's Encrypt, automatically |

The hosts are the ones `gkm deploy` uses: an app's `subdomain` (or its name)
under the stage's base domain, and the root site on the base domain itself.
For a deployed stage, point those names at the machine and leave ports 80 and
443 open; Caddy obtains each certificate on first request.

Caddy forwards `Host` and `X-Forwarded-*` as it does by default, so an app sees
the address its caller used. Responses are never buffered (`flush_interval
-1`): server-sent events and streamed Next.js RSC payloads reach the client as
they are written.

The edge is published on 443 and 80. When those are taken — locally they often
are — move it:

```bash
GKM_COMPOSE_HTTPS_PORT=8443 GKM_COMPOSE_HTTP_PORT=8080 gkm compose --stage development
```

For the local stage the URLs then carry the port
(`https://api.shop.localhost:8443`), and the env files and site builds use them.
The local CA's root is copied to `.gkm/compose/<stage>/caddy-root.crt`; point
`NODE_EXTRA_CA_CERTS` at it, or trust it in a browser.

## The phases

| Phase | What it does |
| --- | --- |
| `validate` | the stack, worked out from the manifest; with `--push` or a tag, `deploy.registry` required; with a tag, every image looked up in the registry |
| `plan` (`--dry-run`) | the files written, and what a run would build, pull and start — nothing else |
| `provision` | the stage's generated secrets kept, the files written, the infrastructure started, its databases, roles, grants and migrations applied |
| `build` | every image built inside Docker — or, with a tag, pulled. With `--push`, each built image pushed, and the run ends here |
| `release` | `docker compose up --wait --remove-orphans`, and each app's image recorded |
| `verify` | each app asked through Caddy over HTTPS — an API at `/health`, a site at `/` — with the certificate verified |

`verify` goes through the edge by hostname, so it proves what `up --wait`
cannot: that Caddy routes each host and presents a certificate a client
accepts. On the local stage it trusts the copied `caddy-root.crt` and connects
to 127.0.0.1. Each app is asked for up to three minutes; one that never answers
fails the deploy with `ComposeAppsUnhealthy`, naming it and what it answered.
The target has no rollback: the previous images are still tagged, so deploying
the previous tag again is the way back.

The events are the ones every target reports: `artifact.built` per image (with
its digest), `resource.applied` per service, `app.deployed` per app and
`health.checked` per check — `gkm deploy --target compose --json` writes them.

## Mail and storage on a deployed stage

A deployed stage's mail and object storage are real services, from its
secrets — the stack runs no Mailpit or MinIO for it:

| Declared | Keys the stage sets |
|---|---|
| `Email('Mail')` | `MAIL_URL` (any SMTP server: `smtp://user:pass@host:587`) and `MAIL_FROM` |
| a bucket, `ObjectStorage('Uploads')` | `UPLOADS_URL` (`s3://bucket?region=…`, with `&endpoint=…` for R2 or any S3-compatible store). Its credentials are optional: a key for this bucket alone in the URL (`s3://KEY:SECRET@bucket?…`), or the shared `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` for every bucket whose URL has none |
| its file server, `UploadsServer` | `UPLOADS_SERVER_URL` — the public address its objects are served on |

Only the keys an app reads count. A stage missing any of them stops in
`validate` — before a file is written, a secret generated or a container
touched — with `ExternalServicesNotConfigured`, listing **every** missing key
across every app at once, each with the line that sets it:

```
ExternalServicesNotConfigured: The stage 'production' is deployed, and a deployed stage's mail and object storage are real services: gkm runs no Mailpit or MinIO for it. Set these 6 keys in the stage's secrets:

  gkm secrets:set MAIL_URL 'smtp://user:password@smtp.example.com:587' --stage production
      where 'Mail' sends mail — any SMTP server, read by api, auth
  gkm secrets:set MAIL_FROM 'noreply@example.com' --stage production
  …
For a stage that is not production — a preview, a demo — the dev services can run instead, with --allow-dev-services mailpit,minio. …
```

A third party's credentials (`<ID>_CREDENTIALS`) are checked as before, one at
a time, with `StageSecretMissing`.

A bucket's credentials are not checked. The URL's own key wins
(`s3://KEY:SECRET@bucket`, secret percent-encoded); a URL without one signs
with the shared pair, which every app that reads a bucket is handed when the
stage set it. Prefer a key per bucket, scoped to it, over one shared pair:

```bash
gkm secrets:set UPLOADS_URL 's3://AKIA…:…@acme-uploads?region=eu-west-1' --stage production
# or, for every bucket whose URL carries no key:
gkm secrets:set AWS_ACCESS_KEY_ID 'AKIA…' --stage production
gkm secrets:set AWS_SECRET_ACCESS_KEY '…' --stage production
```

### `--allow-dev-services`

For a stage that is not production — a preview box, a demo — the stack can run
the dev services anyway:

```bash
gkm compose --stage preview --allow-dev-services minio,mailpit
gkm deploy --target compose --stage preview --allow-dev-services minio
```

- **`minio`** runs MinIO in the stack for each bucket whose URL the stage did
  not set, creates the buckets from this machine on a loopback port, and hands
  the backends its URL and key pair. Its root credential is the stage's own
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` where set, and otherwise derived
  from the stage's seed, as its database passwords are. Each file server over
  it answers on `https://<id>.<stage domain>` through Caddy, unless its URL is
  set.
- **`mailpit`** runs Mailpit, unless the stage set `MAIL_URL`. `MAIL_FROM` is
  `noreply@<stage domain>` unless set. Mailpit catches every message and
  **delivers none** — nobody receives a sign-in link.

Keys the stage did set always win over the dev service. Every run that uses one
prints a warning saying which, and emits a `dev-service.used` event. An
unknown value fails with `UnknownDevService`.

## The cache

A workspace that declares a cache — `new Cache('Sessions')`, or
`database.cache('Sessions')` — gets a Redis in its stack, on every stage, and
**every** cache lives in it, a cache declared from a database included. No
cache table is created in Postgres. A cache can always be rebuilt, so unlike
Mailpit and MinIO this is a production service, not behind
`--allow-dev-services`:

```yaml
redis:
  image: redis:8-alpine          # reconcile's pin: gkm dev runs the same Redis
  restart: unless-stopped
  command: [sh, -c, 'exec docker-entrypoint.sh redis-server --requirepass "$$REDIS_PASSWORD" --maxmemory 256mb --maxmemory-policy allkeys-lru --appendonly yes']
  env_file: [{ path: ./redis.env, format: raw }]
  volumes: [redis-data:/data]
  healthcheck: { test: [CMD-SHELL, 'redis-cli ping | grep -q PONG'] }
  logging: { driver: json-file, options: { max-size: 10m, max-file: "3" } }
```

- **Internal only.** It is on the compose network and publishes no port; the
  apps reach it as `redis:6379`, and nothing on the host or the internet can.
- **Password protected.** On a deployed stage the password is generated on
  the first run and kept in the stage's secrets as `REDIS_PASSWORD`, like its
  seed, so every later run reads it back (`gkm secrets:show --stage production
  --reveal`). The local stage uses the fixed `geekmidas`, as its Postgres
  does. Set `REDIS_PASSWORD` yourself to choose it. It is in `redis.env`
  (`0600`) as `REDIS_PASSWORD` and `REDISCLI_AUTH`, so neither the compose
  file, the server's command line nor the health check holds it — and
  `docker compose exec redis redis-cli` is signed in.
- **Bounded.** `maxmemory 256mb` with `allkeys-lru`: a full cache evicts its
  least recently used keys rather than taking the box's memory. To change the
  limit, replace `command` in the project's `docker-compose.<stage>.yml`.
- **Persisted.** An append-only file on the `redis-data` volume, kept by
  `--down` as every volume is, so a restart starts warm.

Each backend and worker that reads a cache gets its URL in its env file —
`SESSIONS_URL=redis://:<password>@redis:6379/0` — and waits for Redis to be
healthy. Two caches get two logical databases (`/0`, `/1`, by id), so they
never read each other's keys. Each image is built with `gkm build … --cache
redis`, so its entry registers the Redis cache driver (`redis://` and
`rediss://`) instead of the Postgres one, and the project needs `ioredis`
installed — a build without it stops with `RedisClientMissing` before
anything is touched. Images pulled with `--tag` must have been built the same
way: from the Dockerfiles `gkm compose` writes, not `gkm docker`'s.

**A managed Redis instead.** Set the cache's URL in the stage's secrets and
it is used as given; a stack whose every cache is set that way runs no Redis
and generates no password:

```bash
gkm secrets:set SESSIONS_URL 'rediss://default:…@cache.example.com:6380' --stage production
```

This is the compose target's alone. `gkm dev`, `gkm test` and Dokploy keep the
target's default — a table in the declared database on a server target.

## Logs

Every backend's production server exports its traces and pino logs over
OTLP/HTTP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (see
[Telemetry](./production.md#telemetry)). The stack can run somewhere to send
them: [OpenObserve](https://openobserve.ai), opted into in `gkm.config.ts`:

```ts
deploy: {
  compose: {
    logs: true,
    // or:
    // logs: { port: 5080, retentionDays: 30 },
    // logs: { public: { allow: ['203.0.113.7', '10.0.0.0/8'] } },
  },
}
```

| Option | Default | |
| --- | --- | --- |
| `port` | `5080` | the port it is published on — on `127.0.0.1` only |
| `retentionDays` | `30` | days of data kept (OpenObserve's `ZO_COMPACT_DATA_RETENTION_DAYS`); at least 3, which is OpenObserve's own minimum |
| `public.allow` | — | serve it through Caddy instead, to these IPs and CIDRs only |

With it on, the stack adds:

- an `openobserve` service (`public.ecr.aws/zinclabs/openobserve`, a pinned
  version), its data in the `openobserve-data` volume — kept by
  `gkm compose --down`, as every volume is — with a health check and
  `restart: unless-stopped`. Its anonymous usage reporting is off;
- in every backend's env file, `OTEL_EXPORTER_OTLP_ENDPOINT=http://openobserve:5080/api/default`
  and `OTEL_EXPORTER_OTLP_HEADERS` signing in as its root user, and
  `OTEL_SERVICE_NAME` set to the app's name. Sites get none of it;
- a check of its health in `verify`, beside the apps, and a `logs.ready`
  event saying where it is.

Nothing waits on it: an app whose telemetry cannot be delivered still serves.

What arrives, each under its app's `service.name`: a SERVER span per request
(`GET /users/:id`, with its status code), every record a `createLogger` logger
writes — in the trace of the request that wrote it, so a log line leads to its
request and back — the spans of outbound `fetch`, DNS and TCP, and the
runtime's metrics. Query spans do not arrive yet: `pg` is bundled into the
server. [Telemetry → What is exported](./production.md#what-is-exported) has
the detail.

The root user is `admin@<stage domain>` on a deployed stage. Its password is
generated on the first run and kept in the stage's secrets as
`ZO_ROOT_USER_PASSWORD`, like the stage's seed, so every later run reads it
back; `gkm secrets:show --stage production --reveal` shows it. The local stage
signs in as `admin@gkm.localhost` with the fixed password `Geekmidas-1`. Set
`ZO_ROOT_USER_EMAIL` or `ZO_ROOT_USER_PASSWORD` in the stage's secrets to
choose your own; a password OpenObserve would refuse (8–128 characters, with a
lowercase and an uppercase letter, a digit and a symbol) fails with
`LogsPasswordWeak`.

A stage that already sets `OTEL_EXPORTER_OTLP_ENDPOINT` (or its headers, or a
per-signal endpoint) fails with `LogsEndpointConflict`: each backend sends its
telemetry to one place. Remove `logs`, or remove those keys from the stage.

### Reaching it: an SSH tunnel

By default OpenObserve is published on `127.0.0.1:5080` of the machine the
stack runs on, and on nothing else. The run ends with how to reach it:

```
📜 Logs (OpenObserve) on 127.0.0.1:5080 — from your computer:
     ssh -N -L 5080:localhost:5080 deploy@box-1   (user and host are guesses: this machine's)
     then open http://localhost:5080  (login: admin@example.com, password: gkm secrets:show --stage production --reveal → ZO_ROOT_USER_PASSWORD)
⚠️  Docker-published ports bypass ufw, so OpenObserve is bound to 127.0.0.1 only — reach it through the tunnel, not by opening the port.
```

The user and host are this machine's own, as a guess; use whatever you SSH in
with. To make it one word, give the tunnel a name in `~/.ssh/config`:

```
Host shop-logs
  HostName 203.0.113.10
  User deploy
  LocalForward 5080 localhost:5080
```

`ssh -N shop-logs`, then open `http://localhost:5080`.

**Why loopback: the ufw trap.** A port Docker publishes on every interface
(`5080:5080`) is opened by Docker's own iptables rules, ahead of ufw's — so
`ufw deny 5080` does not close it, and `ufw status` does not show it open. A
log UI on a public port would be readable by anyone who guessed its password.
Bound to `127.0.0.1`, it is reachable only from the machine, and the tunnel is
the way in.

### A team: Tailscale

For a team on a [Tailscale](https://tailscale.com) tailnet, bind the port to
the machine's tailnet address instead. gkm does not do this for you: put it in
the project's own `docker-compose.<stage>.yml` at the workspace root, which
`gkm compose` merges over the stack it generates (and never writes):

```yaml
# docker-compose.production.yml
services:
  openobserve:
    ports: !override
      - "100.101.102.103:5080:5080"   # this machine's tailnet IP
```

`!override` replaces the generated loopback binding rather than adding to it.
Everyone on the tailnet opens `http://<machine's tailnet name>:5080`.

### Public, to some addresses

```ts
logs: { public: { allow: ['203.0.113.7', '10.0.0.0/8'] } }
```

serves it through the stack's Caddy at `https://logs.<stage domain>` (locally
`https://logs.<project>.localhost`, from Caddy's local CA), with a certificate
like every other host. Caddy answers only the listed addresses — matched on
the connection's own address, never a header — and every other gets 403. No
host port is published. `allow` must name at least one address; an empty one
fails with `LogsAllowEmpty`, and an entry that is not an IP or a CIDR with
`LogsAllowEntryInvalid`. Point `logs.<stage domain>` at the machine, as you
did the apps' hosts.

### A hosted OTLP backend instead

To send telemetry somewhere else — Grafana Cloud, Honeycomb, your own
collector — leave `logs` off and set the standard variables in the stage's
secrets:

```bash
gkm secrets:set OTEL_EXPORTER_OTLP_ENDPOINT 'https://otlp.example.com' --stage production
gkm secrets:set OTEL_EXPORTER_OTLP_HEADERS 'x-api-key=…' --stage production
```

Every backend's env file gets each of these the stage sets — the exporter's
`OTEL_EXPORTER_OTLP_{ENDPOINT,HEADERS,PROTOCOL,TIMEOUT,COMPRESSION}`, for all
signals or one (`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`), `OTEL_TRACES_SAMPLER`,
`OTEL_TRACES_SAMPLER_ARG`, `OTEL_RESOURCE_ATTRIBUTES` and `OTEL_SERVICE_NAME`
(the app's name, unless set) — whatever the app's constructs declare. Other
`OTEL_*` keys are not passed. Sites get none: their environment is in a
bundle every browser downloads. The Dokploy target hands its backends the
same keys.

### Docker's own logs are rotated

Every service in the stack — apps, Caddy, Postgres, Redis, Mailpit, MinIO and
OpenObserve — has its Docker logs rotated, whether or not `logs` is on:

```yaml
logging:
  driver: json-file
  options: { max-size: "10m", max-file: "3" }
```

Docker's `json-file` driver never rotates by default, and a container that
logs every request fills a small server's disk in weeks. A `logging` block in
the project's `docker-compose.<stage>.yml` wins, since it is merged over the
generated file.

## The project's own compose file

`docker-compose.<stage>.yml` at the workspace root, where there is one, is
merged over the stack `gkm compose` generates (`-f .gkm/compose/<stage>/docker-compose.yml
-f docker-compose.<stage>.yml`) — on every run and on `--down` — and the run
says so. It is never written by gkm: it is where what the generated file
cannot know goes, such as a port bound to a tailnet address. Compose's merge
rules apply: a mapping such as `logging` replaces the generated one, and a
list such as `ports` is added to unless tagged `!override`. Relative paths in
it resolve from `.gkm/compose/<stage>/`, the generated file's directory.

## Auth and trusted origins

An auth server (`BetterAuth`) checks the origin of every state-changing
request — a sibling service's included, not only a browser's. Its
`<ID>_TRUSTED_ORIGINS` lists the public origin of every app that declared an
edge to it and, for each API among them, that API's **internal** origin on the
compose network (`http://api:3000`), so a service calling it across the
network is not rejected. The session cookie's domain is the parent the public
hosts share (`.example.com`), so the site and the APIs all see the session.

## What is not included yet

- **Mobile apps** ship through their own toolchain and are skipped.
- **A remote Docker host.** Provisioning and migrations connect to the stack's
  Postgres from this machine on a loopback port, so run `gkm compose` on the
  machine that hosts the stack.
