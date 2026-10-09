# Deploy with Docker Compose

`gkm compose` runs a workspace's APIs and sites for one stage as a single
Docker Compose stack on one machine, with [Caddy](https://caddyserver.com) in
front serving every app over HTTPS — or, on a server that runs several stacks,
registered with one shared [Traefik](https://traefik.io) edge (see
[Proxy: Caddy or Traefik](#proxy-caddy-or-traefik)).

```bash
gkm compose --stage development         # the local stage, built from this checkout
gkm compose --stage production --tag v1.4.0   # the images CI pushed as v1.4.0
gkm compose --stage production --build --push --tag v1.4.0  # CI: build and push, start nothing
gkm compose --stage production --down    # stop it (volumes are kept)
gkm compose --stage preview --allow-dev-services  # a demo, on dev services
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
- **OpenObserve, when a process uses a `Telemetry` construct** and the
  stage's telemetry is self-hosted, receiving the logs and traces of every
  process with an edge to it — see [Telemetry](#telemetry).
- **One Caddy**, one host per app — and one per file server over the stack's
  MinIO (`https://uploadsserver.<project>.localhost` locally), rewriting to its
  bucket the way `gkm dev`'s edge does. With `proxy: 'traefik'` the stack runs
  no Caddy: it registers the same hosts with the server's shared edge.

The databases, roles and grants are created, each database's migrations
(`db/<construct>/migrations`) applied, and then every one of its seeds
(`db/<construct>/seeds`) run, before any app starts — so an app never boots
against a schema that is not there yet, or without the reference data (roles,
plans, permissions) its first request reads:

```
🗄️  db/database/migrations: applied 1
   ✓ 20261008120000_notes
🌱 db/database/seeds: ran 1
   ✓ 001_roles
```

Every deploy migrates, then seeds, every time. Seeds have no history: each
runs on every run, on every stage, production included, in its own
transaction, as the construct's owner. So **a seed must be an idempotent
upsert** (`insert … on conflict … do update`), and changing one and deploying
is how the reference data changes. A seed that should write something only on
some stages decides by the `stage` it is handed. A failing seed stops the run
before any app starts (`DeploySeedsFailed`, naming the construct and the seed);
its own writes are rolled back, and the migrations and seeds before it stay.
A dry run lists the seeds a run would run (`🌱 db/database/seeds: would run 1
(001_roles)`), and `--build --push` runs neither migrations nor seeds.

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
provisioning, migrations or seeds, no container started, no secret generated and
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

`gkm init --deploy compose` writes `.github/workflows/deploy.yml`, which names
no stage: the [stages action](./deployment.md#the-stages-action) reads them
from `gkm.config.ts` with the project's own gkm. A push builds every deployed
stage and deploys the unprotected ones; publishing a release deploys the
protected ones; a manual run deploys the stage and `ref` you name. Abridged:

```yaml
# .github/workflows/deploy.yml (generated)
jobs:
  stages:   # build, deploy, has-build, has-deploy, aws-region, resources
    steps:
      - uses: actions/checkout@v4
      # … node, the package manager, install
      - id: stages
        uses: geekmidas/toolbox/actions/stages@<commit> # @geekmidas/cli <version>
        with:
          stage: ${{ inputs.stage }}

  build:
    needs: stages
    if: needs.stages.outputs.has-build == 'true'
    strategy:
      matrix:
        stage: ${{ fromJSON(needs.stages.outputs.build) }}
    environment: ${{ matrix.stage }}
    permissions: { contents: read, packages: write, id-token: write }
    steps:
      # … checkout, install, docker login to the registry
      - if: needs.stages.outputs.aws-region != ''   # an AWS secrets store
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: ${{ needs.stages.outputs.aws-region }}
      - run: pnpm exec gkm compose --stage "$STAGE" --build --push --tag "$SHA" --digests-file digests.json
        env:
          STAGE: ${{ matrix.stage }}
          SHA: ${{ github.sha }}
      - uses: actions/upload-artifact@v4
        with:
          name: digests-${{ matrix.stage }}
          path: digests.json
          retention-days: 90

  deploy:
    needs: [stages, build]
    if: ${{ !cancelled() && !failure() && needs.stages.outputs.has-deploy == 'true' }}
    strategy:
      matrix:
        stage: ${{ fromJSON(needs.stages.outputs.deploy) }}
    environment: ${{ matrix.stage }}
    concurrency: { group: 'deploy-${{ matrix.stage }}', cancel-in-progress: false }
    env:
      RESOURCES_ON_RUNNER: ${{ contains(fromJSON(needs.stages.outputs.resources || '[]'), matrix.stage) }}
    steps:
      # 1. the commit: a release's tag, a manual run's ref, or the push
      # 2. a stage in `resources`: on the runner, check out that commit,
      #    install, assume the stage's role, and create its resources
      - if: env.RESOURCES_ON_RUNNER == 'true'
        run: pnpm exec gkm deploy --stage "$STAGE" --resources-only
        env:
          STAGE: ${{ matrix.stage }}
          GODADDY_API_TOKEN: ${{ secrets.GODADDY_API_TOKEN }}
          HOSTINGER_API_TOKEN: ${{ secrets.HOSTINGER_API_TOKEN }}
      # 3. that commit's push build of this workflow, and its digests-<stage>
      #    (missing: deploy by tag, with a warning on the run)
      # 4. over SSH, host key pinned, on the server:
      #      git checkout <sha> && pnpm install --frozen-lockfile
      #      pnpm exec gkm compose --stage <stage> --tag <sha> --digests-file … \
      #        [--skip-resources]   # when step 2 ran
```

The server runs `gkm compose` itself, from a checkout at the same commit:
provisioning and migrations reach the stack's Postgres on its loopback port.
`DEPLOY_PATH` is that checkout, and it needs a `docker login` to the registry
(a read-only token is enough) and the stage's secrets store. Each environment
holds `DEPLOY_SSH_KEY` (a secret) and `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`,
`DEPLOY_USER` and `DEPLOY_PATH` (variables). The SSH session is
non-interactive, so the package manager has to be on that user's `PATH`
without a login shell.

A stage's **resources** — a [provider's](./providers.md) buckets and keys,
and its hosts' [DNS records](#dns) — are created by the deploy. Run on the
server, that would need the stage account's credentials and the DNS
provider's token there. So for each stage in the stages action's `resources`
output, the runner creates them first (`gkm deploy --resources-only`) with the
stage's role and the token from the stage's environment, and the server
deploys with `--skip-resources`: neither credential reaches it. `resources`
holds the deployed stages that have a `deploy.<kind>.<stage>` provider or a
`dns` domain whose provider writes records, **and** whose secrets are in an
AWS store (`secrets.store` `ssm` or `secrets-manager`) the runner reads with
the stage's role. A stage on the default `file` store is not in it: its
deploy on the server does everything, so the server holds those credentials.
To create a stage's resources from CI instead, keep its secrets in `ssm` or
`secrets-manager`.

The images are pinned by digest: a release deploys exactly what the push of
its commit built, even if a tag was pushed over since. The digests are kept for
90 days; a release of an older commit deploys by tag, and says so.

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

### Sites that import a generated client

A site that calls an API through the typed client gkm generates
(`import { createApi } from '@myapp/client/api'`, mapped by its tsconfig to the
workspace root's `.gkm/client/api.ts`) gets that client in its image the same
way everything else gets there: generated inside Docker, never copied from this
machine — `.dockerignore` leaves every `.gkm` out of the build context.

So a site's image carries the gkm workspace, as a backend's does: its config,
the directories its constructs and endpoints live in (sources only — no
`node_modules`, no build output), the workspace's own package where it is
nested in a monorepo, and the package of each backend the site depends on.
Before the site is built, its builder runs, for each of those backends,

```sh
cd apps/api && gkm openapi --app api
```

which loads the API's endpoints through the workspace's constructs globs and
writes `.gkm/client/api.ts` at the workspace root, where the site's tsconfig
paths point. It needs no secret, no stage and no container. A backend with an
`entry` of its own, or one with `openapi: false`, has no client to generate.

`gkm` is on the builder's `PATH`, resolved from the workspace, so a site's build
script can be `gkm exec -- next build` (or `gkm exec -- vite build`). In the
image `GKM_IMAGE_BUILD=1` is set, and `gkm exec` then injects only the public
values the Dockerfile's build args carry (`NEXT_PUBLIC_*`, `VITE_*`,
`EXPO_PUBLIC_*`): it reads no secrets store and resolves no local address, so a
bundle never inlines a developer's `localhost`. The site is built with
`turbo run build --env-mode=loose`, so those values reach its build whatever the
project's `turbo.json` declares.

## The files

Everything for a stage is in `.gkm/compose/<stage>/` (directory `0700`):

```
docker-compose.yml   the stack — compose project <scope>-<stage>
Caddyfile            one host per app (proxy: 'caddy')
traefik.yml          a copy of what the stack registers with the edge (proxy: 'traefik')
tls/                 the stage's own certificate, where it sets one (proxy: 'caddy')
api.env              one env file per backend, mode 0600
auth.env
openobserve.env      with self-hosted telemetry: its root login, mode 0600
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
- for a process with an edge to a `Telemetry` construct, the stage's
  `OTEL_*` keys — the stack's OpenObserve, or the provider
  `deploy.telemetry` names — see [Telemetry](#telemetry).

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
| deployed | the stage's domains, from `domains` — `api.example.com`, `example.com` | Let's Encrypt, automatically |

The hosts are the ones `gkm deploy` uses: an app's `subdomain` (or its name)
under the stage's base domain, and the root site on the base domain itself.
For a deployed stage, those names point at the machine — [the deploy writes
the records](#dns) through the domain's DNS provider — and ports 80 and 443
stay open; Caddy obtains each certificate on first request.

Caddy forwards `Host` and `X-Forwarded-*` as it does by default, so an app sees
the address its caller used. Responses are never buffered (`flush_interval
-1`): server-sent events and streamed Next.js RSC payloads reach the client as
they are written.

The edge removes **`x-gkm-client-ip`** from every request it forwards
(`request_header -x-gkm-client-ip` in each site block). That header is gkm's
own: an API's session check carries the client's address in it, and the auth
server rate-limits by it, so only a service inside the stack may send it.

The edge is published on 443 and 80. When those are taken — locally they often
are — move it:

```bash
GKM_COMPOSE_HTTPS_PORT=8443 GKM_COMPOSE_HTTP_PORT=8080 gkm compose --stage development
```

For the local stage the URLs then carry the port
(`https://api.shop.localhost:8443`), and the env files and site builds use them.
The local CA's root is copied to `.gkm/compose/<stage>/caddy-root.crt`; point
`NODE_EXTRA_CA_CERTS` at it, or trust it in a browser.

## DNS

A deployed stage's server is in its own secrets: its public addresses, never
in `gkm.config.ts`.

```bash
gkm secrets:set GKM_SERVER_IPV4 '203.0.113.10' --stage production
gkm secrets:set GKM_SERVER_IPV6 '2001:db8::10' --stage production   # optional
```

`GKM_SERVER_IPV4` is **required** of every deployed stage that has a domain
(`domains.<stage>`): every deploy refuses one without it, before anything else
runs, with `ServerAddressMissing` and the `gkm secrets:set` line. `gkm
secrets:add` lists it among the stage's required keys. A stage whose domain is
a `*.localhost` name needs none. A value that is not an address fails with
`ServerAddressInvalid`, naming the key. Both keys are gkm's own: no app's or
worker's env file ever holds them.

### Writing the records

With [`dns`](./deployment.md#dns-providers) naming the provider of the
stage's root domain, **the deploy writes the records**. Every `gkm deploy
--stage <stage>` (and `gkm compose --stage <stage>`, the same deploy) points
each public host the stack serves at the server, before its checks run and
before anything starts — the apex (the root site), each API and auth server,
each file server, and the public log UI when it is enabled:

```ts
// gkm.config.ts
domains: { production: 'shop.example.com' },
dns: { 'example.com': { provider: 'godaddy' } },
```

```text
$ gkm deploy --stage production --dry-run
🌐 DNS for 'production' → *** (dry run — nothing is written)
   example.com (godaddy) — dry run
   + api.shop.example.com             A     ***  (TTL 600) — would create
   ✓ auth.shop.example.com            A     ***  (TTL 600) — up to date
   ~ shop.example.com                 A     198.51.100.7 → ***  (TTL 600) — would update
```

The server's address is `***` because it is a stage secret, masked in
everything a deploy prints.

Every host gets an A record, and an AAAA record with `GKM_SERVER_IPV6`. With
`records: { mode: 'cname', target: 'server.example.com' }` on the domain, the
target gets the A record and every other host a CNAME to it; the apex is
always an A record. A record that already has its value is not written; one
with another value is replaced. The deploy touches only the A, AAAA and CNAME
records of the stage's own hosts, and never another name; the only record it
deletes is one a change of mode replaces (an A record where a CNAME now goes,
or the other way round). What it wrote is recorded in the stage's deploy state as
`dns-record` resources. A `manual` domain is printed, not written.

**No wildcard.** One record is written per host, never `*.shop.example.com`.
A wildcard host is refused with `DnsWildcardRefused`.

The DNS provider's credentials are read by the machine that runs the deploy —
see [DNS Providers](./deployment.md#dns-providers) for GoDaddy's token and its
API access restriction. With a token provider (GoDaddy, Hostinger) configured
and no token, the deploy fails at its start — before anything is created,
built or started — with `DnsCredentialMissing`, naming the key.

### Adding an app

A new app's host gets its record from the next deploy. Nothing is run by hand
first: the deploy sees the host has no record, writes it, confirms it, and
only then starts the stack and asks for its certificate.

### A stage on another server

Each deployed stage has its own `GKM_SERVER_IPV4` (and `GKM_SERVER_IPV6`), so
two stages can live on two machines under one domain:

```ts
domains: { production: 'example.com', dev: 'dev.example.com' },
dns: { 'example.com': { provider: 'godaddy' } },
```

```bash
gkm secrets:set GKM_SERVER_IPV4 '203.0.113.10' --stage production
gkm secrets:set GKM_SERVER_IPV4 '198.51.100.20' --stage dev
```

A stage's deploy writes only its own hosts — `api.dev.example.com` from the
`dev` deploy, `api.example.com` from `production`'s — never another stage's.

### In CI

The DNS token is a secret on the stage's GitHub **environment**, passed to
the step that runs the deploy:

```yaml
env:
  GODADDY_API_TOKEN: ${{ secrets.GODADDY_API_TOKEN }}
```

In the [compose workflow](#a-github-actions-workflow), that step is the
runner's `gkm deploy --stage <stage> --resources-only`, and the server deploys
with `--skip-resources`, so the token never reaches the server. A stage whose
environment lacks the secret fails that step with `DnsCredentialMissing`,
which says where to add it.

### The DNS check

A certificate for a name that points elsewhere cannot be issued, and each
failed attempt counts against Let's Encrypt's rate limit, so every deploy of a
deployed stage confirms each public host **before** the stack starts and Caddy
or Traefik ask for certificates.

Records the deploy wrote, or found up to date, through a provider are
confirmed by **reading them back from the provider** — not by a public lookup,
which can lag behind a change or have cached a brand-new name as missing. A
record the provider does not return as written stops the deploy with
`DnsRecordsNotConfirmed`.

Every other host is resolved with the system resolver (all of its addresses):
a `manual` domain, a host under no `dns` domain, a GoDaddy key that can write
records but not read them, and a workspace with no `dns` at all. A host that
does not resolve to `GKM_SERVER_IPV4`, or also resolves to an address that is
not the server's, stops `validate`:

```text
HostNotPointingAtServer: A host of 'production' does not resolve to its server, so a certificate for it cannot be issued:
  - api.shop.example.com → 198.51.100.7, expected 203.0.113.10
Fix: gkm deploy --stage production writes the records for example.com through their provider (--dry-run shows them first).
```

A dry run prints the same as a warning. With a CDN or proxy in front of the
server — the hosts resolve to it, not to the server — or records written
elsewhere, pass `--skip-dns` to `gkm deploy` or `gkm compose`: the deploy
neither writes the hosts' records nor checks them. The local stage is never
checked.

## Proxy: Caddy or Traefik

What sits in front of a deployed stage's stack is `deploy.compose.proxy`:

```ts
deploy: {
  compose: {
    proxy: 'traefik',                                  // every deployed stage
    // proxy: { staging: 'traefik', production: 'caddy' }  // or one per stage
  },
},
```

| `proxy` | What serves the stack | Pick it when |
| --- | --- | --- |
| `'caddy'` (default) | the stack's own Caddy, on 80 and 443 | the server runs one stack |
| `'traefik'` | the server's shared Traefik edge, which every stack registers with | the server runs several — two stages, or two projects |

Two stacks with their own Caddy cannot share a server: both want 80 and 443.
With `'traefik'`, one edge owns those ports, the ACME state and the redirect to
HTTPS, and each stack adds its hosts to it.

**The local stage always uses Caddy**, whatever is configured: its internal CA
is the one `gkm trust` installs. A site's image keeps Caddy inside it as its
file server either way.

Both proxies serve the same routes. A stack's routes are worked out once — each
host, the service and port behind it, whether it streams, its allowlist and its
health path — and rendered as a Caddyfile or as Traefik configuration, so the
two never drift. Either way `Host` and `X-Forwarded-*` reach the app as the
caller sent them, `x-gkm-client-ip` never does (Traefik removes it with a
`<project>-strip-gkm-headers` headers middleware first in every router's
chain), a streamed response is never buffered, and the log UI's public mode
answers only its `allow` list (Traefik's `ipAllowList`, matched on the
connection's own address).

### The shared edge

`gkm compose` starts the edge when a stack needs it and it is not running, and
leaves it running on `--down`. There is no Docker socket: the edge is
configured through Traefik's file provider alone. Everything lives in the
deploy user's gkm home, so nothing needs root:

```
~/.gkm/edge/                      ($GKM_HOME/edge when GKM_HOME is set)
  docker-compose.yml              compose project gkm-edge, traefik:v3.7.13 pinned
  traefik.yml                     entrypoints web (80 → HTTPS) and websecure (443),
                                  ACME over HTTP-01, no dashboard and no API
  dynamic/<project>.yml           one per stack: its routers, services, middlewares
  certs/<project>.crt, .key       a stack's own certificate, where it sets one
```

- **The network.** The edge and the stacks meet on the external Docker
  network `gkm-edge`. Only a stack's public services join it — its APIs, its
  sites, MinIO when a file server routes to it, and OpenObserve when it is served
  publicly. Postgres, Redis and the workers stay on the stack's own network.
- **Names.** On a shared network every stack's `api` would answer to `api`,
  so each public service is reached by an alias prefixed with its project —
  `shop-production-api` — by the edge and by the rest of its own stack alike:
  an API calls its auth server at `http://shop-production-auth:3001`, and the
  auth server trusts that origin. Every router, service and middleware in a
  stack's file is prefixed the same way, so stacks never collide.
- **A stack's file** is written after its services are up, whole — a
  temporary file, then a rename the edge picks up — and removed by
  `gkm compose --down`, which leaves every other stack served.
- **The edge's ports** are 443 and 80; `GKM_COMPOSE_HTTPS_PORT` and
  `GKM_COMPOSE_HTTP_PORT` move them, as they move a stack's own Caddy.
- **`verify`** asks the edge on this machine, on its published port, with each
  host as SNI and `Host`: it checks the edge routes the host and presents a
  certificate a client accepts.
- **Stop the edge**, once no stack uses it:
  `docker compose -p gkm-edge -f ~/.gkm/edge/docker-compose.yml down`.

### Certificates

A deployed stage gets its certificates from Let's Encrypt on either proxy —
Traefik over the HTTP-01 challenge on port 80, keeping its account and
certificates in the edge's `acme` volume. Point the stage's names at the server
and leave 80 and 443 open.

A stage can bring its own certificate instead — an origin certificate from a
CDN, one from an internal CA, a wildcard you already have:

```ts
deploy: {
  compose: {
    tls: {
      production: { certFile: 'certs/origin.pem', keyFile: 'certs/origin.key' },
    },
  },
},
```

Paths are relative to the workspace root, or absolute; the certificate is PEM
with its chain. Caddy reads a copy beside its Caddyfile; Traefik gets a copy in
the edge's `certs/` (the key `0600`) and the stack's file names it. A file that
is not there fails the run with `ComposeTlsFileMissing` before anything starts,
a certificate for the local stage with `ComposeTlsOnLocalStage`, and a stage the
workspace does not have — in `tls` or a per-stage `proxy` — with
`ComposeStageUnknown`.

### Switching a server from Caddy to the shared edge

A stack that ran with its own Caddy still holds 80 and 443. Moving it is a
one-time step:

1. Set `proxy: 'traefik'` for the stage.
2. Stop the stack's Caddy: `docker compose -p <project> stop caddy` (or
   `gkm compose --stage <stage> --down`, which stops the whole stack).
3. Run `gkm compose --stage <stage>` again. It starts the edge, which takes
   80 and 443, and registers the stack; the stack's old Caddy container is
   removed with it.

Run with Caddy still holding the ports, `gkm compose` refuses before it writes
or starts anything, with `ComposeProxyClash` naming the container and the
command that stops it. The reverse is refused the same way: a stage with
`proxy: 'caddy'` on a server where the shared edge holds 80 and 443. The
certificates do not move — Traefik obtains its own — so expect each host's
first request after the switch to wait for one.

## The phases

| Phase | What it does |
| --- | --- |
| `validate` | the stack, worked out from the manifest; with `--push` or a tag, `deploy.registry` required; with a tag, every image looked up in the registry |
| `plan` (`--dry-run`) | the files written, and what a run would build, pull and start — nothing else |
| `provision` | the stage's generated secrets kept, the files written, the infrastructure started, its databases, roles, grants and migrations applied, then its seeds run |
| `build` | every image built inside Docker — or, with a tag, pulled. With `--push`, each built image pushed, and the run ends here |
| `release` | `docker compose up --wait --remove-orphans`, and each app's image recorded |
| `verify` | each app asked through the edge — its own Caddy, or the shared Traefik — over HTTPS: an API at `/health`, a site at `/`, with the certificate verified |

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
For a stage that is not production — a preview, a demo — the dev services can run instead, with --allow-dev-services. …
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

Or have gkm create the buckets: with `deploy.objects.production: { provider:
's3' }`, `gkm deploy --stage production` creates each bucket, its IAM user and
key in the stage's AWS account and writes `UPLOADS_URL` and
`UPLOADS_SERVER_URL` itself, before its checks run — see
[Providers](./providers.md). Every deploy then checks the bucket answers the
key in the stage's secrets (`verify()`), and stops with
`ProvisionedBucketUnreachable` if it does not.

### `--allow-dev-services`

For a stage that is not production — a preview box, a demo — the stack can run
the dev services anyway:

```bash
gkm compose --stage preview --allow-dev-services
gkm deploy --target compose --stage preview --allow-dev-services
```

It is a switch, with no value: every construct the stage does not **account
for** gets the dev service the local stage runs for it. A construct is
accounted for when the stage's secrets hold its key, or when a provider backs
its kind (`deploy.objects.<stage>: { provider: 's3' }`, or `false`).

- **A bucket** gets MinIO in the stack: the buckets are created from this
  machine on a loopback port, and the backends are handed MinIO's URL and key
  pair. Its root credential is the stage's own
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` where set, and otherwise derived
  from the stage's seed, as its database passwords are. Each file server over
  it answers on `https://<id>.<stage domain>` through Caddy, unless its URL is
  set.
- **Mail** gets Mailpit, unless the stage set `MAIL_URL`. `MAIL_FROM` is
  `noreply@<stage domain>` unless set. Mailpit catches every message and
  **delivers none** — nobody receives a sign-in link.

What the stage accounts for always wins: a key it set, or a provider. Every run
that uses a dev service prints a warning saying which, and emits a
`dev-service.used` event. The flag took a list before (`minio,mailpit`); a
value now fails with `AllowDevServicesTakesNoValue`.

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
  --reveal`). The local stage uses the password generated for this machine
  with `gkm dev`'s logins (`gkm dev:credentials` shows it). Set `REDIS_PASSWORD` yourself to choose it. It is in `redis.env`
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

## Telemetry

What a process emits is the application's — a [`Telemetry`
construct](./telemetry.md) passed to its surfaces and workers. Where it goes
is the stage's, in `deploy.telemetry`. The [Telemetry guide](./telemetry.md)
has the whole model; this is what a compose stack does with it.

A stage that names nothing runs the **self-hosted** provider:
[OpenObserve](https://openobserve.ai), in the stack. Its options are the
provider's, per stage:

```ts
deploy: {
  telemetry: {
    production: {
      provider: 'self-hosted',
      port: 5080,          // published on 127.0.0.1 only
      retentionDays: 30,   // at least 3
      sampleRate: 0.1,     // the fraction of traces kept
      // public: { allow: ['203.0.113.7', '10.0.0.0/8'] },
    },
    preview: { provider: 'otlp', endpoint: 'https://otlp.example.com' },
    scratch: false,
  },
}
```

| Option | Default | |
| --- | --- | --- |
| `port` | `5080` | the port it is published on — on `127.0.0.1` only |
| `retentionDays` | `30` | days of data kept (OpenObserve's `ZO_COMPACT_DATA_RETENTION_DAYS`); at least 3, which is OpenObserve's own minimum |
| `public.allow` | — | serve it through the edge instead, to these IPs and CIDRs only |
| `sampleRate` | `1` | `OTEL_TRACES_SAMPLER_ARG`, with `parentbased_traceidratio` |

The local stage ignores `deploy.telemetry`: `gkm compose --stage <local>`
always runs OpenObserve on `127.0.0.1:5080`, keeping every trace.
`GKM_COMPOSE_LOGS_PORT` moves it to another port, for a machine where 5080 is
taken.

With it on, the stack adds:

- an `openobserve` service (`public.ecr.aws/zinclabs/openobserve`, a pinned
  version), its data in the `openobserve-data` volume — kept by
  `gkm compose --down`, as every volume is — with a health check and
  `restart: unless-stopped`. Its anonymous usage reporting is off;
- in the env file of each process with an edge to the `Telemetry`
  construct, `OTEL_EXPORTER_OTLP_ENDPOINT=http://openobserve:5080/api/default`,
  `OTEL_EXPORTER_OTLP_HEADERS` signing in as its root user,
  `OTEL_SERVICE_NAME` set to the app's name, and `OTEL_TRACES_SAMPLER` /
  `OTEL_TRACES_SAMPLER_ARG` from the stage's rate. A process without the
  edge gets none of it, and sites get none;
- a check of its health in `verify`, beside the apps, and a `logs.ready`
  event saying where it is.

Nothing waits on it: an app whose telemetry cannot be delivered still serves.

The stage's own `OTEL_*` secrets are never passed to a backend; to send
somewhere else, name the provider — `{ provider: 'otlp', endpoint, headers }`.

What arrives, each under its app's `service.name`: a SERVER span per request
(`GET /users/:id`, with its status code), every record a `createLogger` logger
writes — in the trace of the request that wrote it — the spans the constructs
record (queries, cache, storage, mail, external API calls), a queue job in
the trace of the request that sent it, and the spans of outbound `fetch`, DNS
and TCP. [Telemetry → What is exported](./production.md#what-is-exported) has
the detail.

The root user is `admin@<stage domain>` on a deployed stage. Its password is
generated on the first run and kept in the stage's secrets as
`ZO_ROOT_USER_PASSWORD`, like the stage's seed, so every later run reads it
back; `gkm secrets:show --stage production --reveal` shows it. The local stage
signs in as `admin@gkm.localhost` with a password generated for this machine,
alongside `gkm dev`'s other local logins; `gkm dev:credentials` prints it. Set
`ZO_ROOT_USER_EMAIL` or `ZO_ROOT_USER_PASSWORD` in the stage's secrets to
choose your own; a password OpenObserve would refuse (8–128 characters, with a
lowercase and an uppercase letter, a digit and a symbol) fails with
`LogsPasswordWeak`.

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
telemetry: {
  production: { provider: 'self-hosted', public: { allow: ['203.0.113.7', '10.0.0.0/8'] } },
}
```

serves it through the stack's edge at `https://logs.<stage domain>`, with a certificate
like every other host. Caddy answers only the listed addresses — matched on
the connection's own address, never a header — and every other gets 403. No
host port is published. `allow` must name at least one address; an empty one
fails with `LogsAllowEmpty`, and an entry that is not an IP or a CIDR with
`LogsAllowEntryInvalid`. Point `logs.<stage domain>` at the machine, as you
did the apps' hosts.

### A hosted OTLP backend instead

To send telemetry somewhere else — Grafana Cloud, Honeycomb, your own
collector — name it as the stage's provider; the stack then runs no
OpenObserve:

```ts
deploy: {
  telemetry: {
    production: {
      provider: 'otlp',
      endpoint: 'https://otlp.example.com',
      headers: { 'x-team': 'shop' },
      sampleRate: 0.1,
    },
  },
}
```

Each process with an edge gets the endpoint, the headers (as
`OTEL_EXPORTER_OTLP_HEADERS`), its own `OTEL_SERVICE_NAME` and the sampler.
Sites get none: their environment is in a bundle every browser downloads.

### Docker's own logs are rotated

Every service in the stack — apps, Caddy, Postgres, Redis, Mailpit, MinIO and
OpenObserve — has its Docker logs rotated, whether or not it runs OpenObserve:

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
compose network (`http://api:3000`, or `http://<project>-api:3000` behind the
[shared edge](#the-shared-edge)), so a service calling it across the
network is not rejected. The session cookie's domain is the parent the public
hosts share (`.example.com`), so the site and the APIs all see the session.

## What is not included yet

- **Mobile apps** ship through their own toolchain and are skipped.
- **A remote Docker host.** Provisioning and migrations connect to the stack's
  Postgres from this machine on a loopback port, so run `gkm compose` on the
  machine that hosts the stack.
