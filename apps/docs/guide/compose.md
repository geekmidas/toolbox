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
gkm compose --stage production --destroy # delete everything it made — asks first
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
stage, on this machine's Docker. A deployed stage runs on **its server**: gkm
runs where the deploy is started — a CI runner, your laptop — and drives the
server's Docker engine over SSH (see [The server](#the-server)). With
`deploy.default: 'compose'`, `gkm deploy --stage production` needs no
`--target`.

How it compares with `dokploy` and `sst` is in [Deploy targets](./deploy-targets.md).

It reads the same construct manifest as `gkm dev` and `gkm deploy`. Nothing is
configured for it: the apps, the databases they need, the keys each one reads,
and the hosts they answer on all come from what the workspace declares.

## What runs

- **Every `RestApi`** — one container each, an auth server included.
- **Every site** (`StaticSite`, Next.js, TanStack) — one container each. A
  site that runs a server (`variant: 'next'` or `'tanstack'`) reads its own
  `0600` env file at runtime, as a backend does; a `static` one reads none.
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
  app starts. Nothing needs setting — no bucket URL, no mail server. Mailpit's
  inbox is served through the stack's edge — see
  [The local inbox](#the-local-inbox). A deployed stage brings its own; see
  [Mail and storage on a deployed stage](#mail-and-storage-on-a-deployed-stage).
- **OpenObserve, when a process uses a `Telemetry` construct** and the
  stage's telemetry is self-hosted, receiving the logs and traces of every
  process with an edge to it — see [Telemetry](#telemetry).
- **One Caddy**, one host per app — and one per file server over the stack's
  MinIO (`https://uploads.<project>.localhost` locally), rewriting to its
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

What a site's image is built with — every value its build reads, as build
arguments its Dockerfile declares:

- its edges' public values and its own address, under the variant's public
  prefix: `VITE_API_URL`, `VITE_WEB_URL` (`NEXT_PUBLIC_` on a Next.js site);
- its own address under its own name, `WEB_URL`, for server code that runs at
  build time — `next build` prerenders, and a page's `metadataBase` is read then;
- every stage secret already named for the bundle: `NEXT_PUBLIC_APP_STORE_URL`,
  set with `gkm secrets:set … --stage production`, reaches a Next.js site's
  build. A secret without the site's prefix never does.

`gkm exec -- next build` has the same values locally, so a site that builds on
your machine builds in the image.

So a site's image belongs to one stage, and so does every other image: two
builds of one commit are never the same image, so a tag two stages pushed
would belong to whichever push finished last. Every image carries the stage in
its tag. For a release, `gkm compose --build --push` pushes:

| App | Image |
| --- | --- |
| an API | `ghcr.io/acme/shop/shop-api:v1.4.0-production`, `…:v1.4.0-staging` |
| a site | `ghcr.io/acme/shop/shop-web:v1.4.0-production`, `…:v1.4.0-staging` |

and `gkm compose --stage production --tag v1.4.0` pulls exactly the
`-production` ones. An image built by `gkm compose` without a tag is tagged
`<commit>-<stage>` the same way, and `gkm deploy --target dokploy` names its
images by the same rule.

## The server

A deployed stage runs on its server's Docker, reached over SSH. gkm itself
never runs there: `gkm compose --stage production` on a runner or a laptop sets
`DOCKER_HOST=ssh://deploy@<host>` for every docker and compose call it makes —
up, down, pull, build, port, ps, exec — so the stack starts on the server, and
nothing of a deployed stage ever starts on the machine you typed it on.

```ts
// gkm.config.ts
deploy: {
  default: 'compose',
  compose: {
    server: {
      production: { user: 'deploy' },                    // host: GKM_SERVER_IPV4
      staging: { user: 'deploy', host: 'staging.example.com', port: 2222 },
    },
  },
},
```

The host is the stage's `GKM_SERVER_IPV4` secret — the address its DNS records
point at — unless `host` names another; the port is 22 unless `port` says
otherwise. Every deployed stage needs one: a stage with no entry is
`ComposeServerMissing`, naming the line to add, before anything happens. The
local stage takes none (`ComposeServerOnLocalStage`) — it always runs here.

SSH uses your own setup — `~/.ssh/known_hosts` for the server's host key, your
agent or `~/.ssh/config` for the key — and never prompts. Before a deploy
changes anything, it checks the login with a read-only `docker version` on the
server; a failure is `ComposeServerUnreachable`, quoting what ssh said. A dry
run connects to nothing and prints where it would deploy:

```
🧱 shop-production — stage production
   → deploy@203.0.113.10 (docker over ssh)
```

### Setting the server up

`gkm compose:server` makes a fresh VPS ready for a stage, from your machine:

```bash
gkm compose:server --stage production            # as you: ssh's own user and key
gkm compose:server --stage production --admin ops --identity ~/.ssh/ops
gkm compose:server --stage production --dry-run  # the plan and the script
```

It logs in as the server's **admin** — the sudo user you log in as, never root
— and through sudo:

- turns SSH to **keys only** with **root's login off**, in a file that sorts
  before a provider's own (cloud-init's `50-cloud-init.conf` turns passwords
  back on), then reads `sshd -T` to confirm that is what sshd does;
- **locks root's password** — root is reached through the admin's sudo;
- enables **ufw**: SSH, 80 and 443 in, everything out — and names any other
  port left open;
- installs **unattended-upgrades** (security updates daily) and **fail2ban**
  on sshd;
- installs **Docker** and its compose plugin from Docker's own repository;
- creates the **deploy user** (in the docker group, no sudo, no password) and
  authorizes a deploy key there as `restrict,port-forwarding`.
- with `--zsh`, makes **zsh** the admin's login shell; with `--oh-my-zsh`,
  also clones **Oh My Zsh** into the admin's home and starts a `.zshrc` from
  its template. An existing `.zshrc` is the admin's own and is never replaced.
  Only the admin's shell changes: the deploy user never opens one.

Off the server, it makes that key pair here (`~/.ssh/gkm-<project>-<stage>`),
pins the server's host key — checked against the fingerprint the server
reports of itself — and gives the stage's GitHub environment both, as
`DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS` (`--no-github` skips it). Last, it
logs in exactly as CI will and checks Docker and the tunnel answer. Running it
again changes only what is missing or wrong.

A brand-new server, where only root logs in, gets its admin first. gkm logs
in as root — with its key, or with the password the provider gave it — and
creates the admin as a sudo user (you choose the password sudo will ask for),
with root's keys if root has any. If it has none, `ssh-copy-id` puts yours on
the admin. Then the setup above runs as the admin: password logins and root's
login off, root's password locked.

```bash
gkm compose:server --stage production   # ssh would log in as midas
#   midas can't log in with a key. Is this a new server …? [y/N] y
#   root@203.0.113.7's password:            ← the provider's root password
#   creating midas — choose the password sudo will ask for:
#   midas can't log in with a key. Copy yours there with ssh-copy-id? [Y/n]
```

Once it is done, the stage's state records it (`server:compose`), with who
ran it and when; a later run says so before it starts. Nothing personal is
kept: the admin is whoever runs it, logging in with their own key. On a server
already set up, root and password logins are off, so a teammate whose key
can't log in is stopped and told who set it up: an admin there adds their key
(or creates them a sudo user) before they run it.

What it leaves to you: the provider's panel (its console login, its own
malware scanner), and uptime monitoring from outside the server. It installs no
reverse proxy — the stack brings Caddy, or the shared edge — and no image
auto-updater such as Watchtower, which would replace the exact images a deploy
pinned. Docker's published ports bypass ufw, so a stack publishes Postgres and
MinIO on the server's loopback alone, and only the edge on 80 and 443.

### What the server needs

What `gkm compose:server` sets up, for a server set up by hand — and nothing
else:

1. Docker and its compose plugin.
2. A deploy user in the `docker` group, with the deploying machine's (or CI's)
   public key in `~/.ssh/authorized_keys`. The deploy reaches the stack's
   Postgres (and MinIO) through an SSH tunnel (`ssh -L`), so both sshd and the
   key must allow local port forwarding:
   - sshd: `AllowTcpForwarding yes` (OpenSSH's default) or `local`, globally
     or in a `Match User deploy` block.
   - the key's `authorized_keys` entry: a key installed with `restrict`
     refuses forwarding unless it also names it —
     `restrict,port-forwarding ssh-ed25519 AAAA… ci-deploy`. `no-port-forwarding`
     refuses it outright.

   Either refusal fails the deploy with `ComposeTunnelFailed` before any app
   starts (ssh typically says `administratively prohibited`).
3. A firewall open on 22, 80 and 443 — 80 for ACME's HTTP challenge and the
   redirect to HTTPS.

The server holds **no cloud credentials** — no AWS CLI, no IAM user, no access
key — and no gkm, Node or checkout of the project. The stage's secrets, its
deploy state and the DNS provider's token stay where the deploy runs. Nor does
it need a `docker login`: the images are pulled with the deploying machine's
registry login, which docker sends with each pull. A backup job's credentials,
when there is one, reach its container as its environment like any app's
secret.

**How the stack's files reach it.** Nothing a deployed stack runs is a file on
the server:

- Each backend's env file is written under `.gkm/compose/<stage>/` where the
  deploy runs. Compose reads it there and sends the values in the call that
  creates the container, so a stage's secrets are never written to the
  server's disk — they live in the container's configuration, which only the
  docker group can read.
- Caddy's Caddyfile and a stage's own certificate (`deploy.compose.tls`), and
  the shared edge's static configuration, are inline `configs` in the compose
  file (compose v2.23 or later), copied into the container through the
  engine's API. A stack's routes and certificate on the shared edge are
  written into the edge's volumes through `docker exec`.
- Images are built from the checkout where the deploy runs — the build
  context is sent to the server's engine — or pulled at a tag.

**Migrations and seeds** run where the deploy runs, with the project's own
Kysely, as `gkm migrate` runs them. The stack's Postgres (and MinIO, where the
stack runs one) is published on the server's loopback alone; the deploy opens
an SSH tunnel to that port over the same login, migrates and seeds through it,
and closes it before any app starts. Neither is ever published beyond the
server.

## Deploying from CI

The release is built and pushed where the code is, and deployed from the same
runner:

```bash
# build every image and push it to deploy.registry; start nothing
gkm compose --stage production --build --push --tag $SHA --digests-file digests.json

# run exactly those images on the stage's server, over SSH
gkm compose --stage production --tag $SHA --digests-file digests.json
```

`--build --push` builds every image the stack needs exactly as a deploy of the
stage would — every image at `<tag>-<stage>`, a site with the stage's public
URLs — pushes each to
`deploy.registry`, and prints every pushed ref with the digest the registry
stored. Nothing else happens: no stage lock, no infrastructure, no
provisioning, migrations or seeds, no container started, no secret generated and
kept, nothing recorded in the stage's state. So the runner needs Docker, the
stage's secrets store (for a site's public URLs) and a `docker login` to the
registry — no Postgres, no server. Nor does it run the deploy's readiness
checks: a build needs none of the stage's runtime keys, its server's address
(`GKM_SERVER_IPV4`), a DNS token or cloud credentials — so a stage whose bucket
the deploy creates (`deploy.objects`) builds before its first deploy has
written the bucket's URL. `--push` without `--build`, or with `--pull`, is
`ComposePushNeedsBuild`.

`--digests-file <path>` writes each pushed image as JSON, `{ "api":
"<ref>@sha256:…" }`. Handed the same file, a pull runs each image at its digest
rather than its tag, and asks the registry for it by digest alone
(`<image>@sha256:…`), so a tag moved after the push cannot change what is
released, and the stage's state records the pinned ref.

A file missing an app is `ImageDigestMissing`, and an entry for another image
or tag `ImageDigestMismatch` — both before the registry is asked. A pinned
digest the registry will not give, while its tag answers, is
`PinnedImageMoved`: the tag names another image now, which is not a login
problem.

### A GitHub Actions workflow

`gkm init --deploy compose` writes `.github/workflows/deploy.yml`, which names
no stage: the [stages action](./deployment.md#the-stages-action) reads them
from `gkm.config.ts` with the project's own gkm. A push builds every deployed
stage and deploys the unprotected ones; publishing a release deploys the
protected ones; a manual run deploys the stage and `ref` you name. Abridged:

```yaml
# .github/workflows/deploy.yml (generated)
jobs:
  stages:   # build, deploy, has-build, has-deploy, aws-region
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
    permissions: { contents: read, actions: read, packages: read, id-token: write }
    steps:
      # 1. the commit: a release's tag, a manual run's ref, or the push
      # 2. check out that commit, install, docker login (read), and assume
      #    the stage's role
      # 3. that commit's push build of this workflow, and its digests-<stage>
      #    (missing: deploy by tag, with a warning on the run)
      # 4. the deploy key and the server's pinned host key, into ~/.ssh
      - run: |
          args=(--stage "$STAGE" --tag "$SHA")
          if [ -f digests.json ]; then args+=(--digests-file digests.json); fi
          pnpm exec gkm compose "${args[@]}"
        env:
          STAGE: ${{ matrix.stage }}
          SHA: ${{ steps.commit.outputs.sha }}
          GODADDY_API_TOKEN: ${{ secrets.GODADDY_API_TOKEN }}
          HOSTINGER_API_TOKEN: ${{ secrets.HOSTINGER_API_TOKEN }}
```

One `gkm compose`, on the runner, does the whole deploy: the stage's
[provider](./providers.md) resources and keys, its hosts' [DNS records](#dns),
its databases migrated through the tunnel, and the stack started on the
server's engine. Each environment holds `DEPLOY_SSH_KEY` (a secret: the deploy
user's private key) and `DEPLOY_KNOWN_HOSTS` (a variable: the server's host
key, pinned — never accepted on first sight); the step before the deploy
writes them, with an `~/.ssh/config` that uses them and shares one SSH
connection between compose's calls. The server's user and host come from
`deploy.compose.server` and the stage's `GKM_SERVER_IPV4`, which the runner
reads from the stage's secrets store with the stage's role — so keep a
deployed stage's secrets in a store on AWS — `s3` (the project bucket, beside
the state), `ssm` or `secrets-manager`, not the default `file` — to deploy it
from CI.

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
args**. A `static` site's container gets no server environment; a Next or
TanStack Start site's server gets an env file of its own (see
[Env files](#env-files)). Neither waits on a database.

No image embeds anything of a stage. A backend, a worker or a site's server
reads every secret at runtime from its own env file (mode `0600`, written by the deploy),
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

### A site is built without its APIs

A site's image is built before the stack it belongs to starts, so **no stage
is reachable from the build**: the APIs its `.dependsOn()` names are not up
yet, on the local stage or a deployed one. A page that fetches from them
while the framework renders it at build gets no data, and a framework that
caches what it rendered (Next's static and ISR pages, a sitemap with no
`revalidate`) serves that empty page until it is rendered again.

Two things make that explicit:

- **`GKM_BUILD_OFFLINE=1`** is set in every site's builder stage — `next`,
  `tanstack` and `static` alike — and never in the running container. It is
  the one signal a site's own code tests to know it is being built with no
  stage behind it. (`GKM_IMAGE_BUILD=1`, beside it, is about something else:
  it tells `gkm exec` to inject the build args rather than a stage's secrets.)
- **The site's own host and its edges' hosts are refused during the build.**
  Every image build gkm drives maps each of them to `127.0.0.1` in the
  build's `/etc/hosts` (compose's `build.extra_hosts`, or `docker build
  --add-host` where a deploy builds the image itself), where nothing listens, so a fetch to
  `https://api.example.com` fails at once with `ECONNREFUSED` rather than
  hanging until the framework's limit (`Failed to build /… after 60
  seconds`). The build args — the URLs the bundle inlines — are the real ones,
  and the mapping is the build's only: the running container resolves the
  same hosts as anything else does. Hosts the site did not get from an edge
  (an analytics service, a store link named `NEXT_PUBLIC_*`) are left alone.

So a site renders its data-backed pages **on request**, not at build, and the
[warm-up](#the-warm-up) after the deploy makes that first request:

- **`next`**: give a data-backed page a `revalidate` and skip the fetch
  while offline. The build caches the page empty, and the
  [warm-up](#the-warm-up) has Next render it again from the deployed APIs
  before any visitor asks:

  ```ts
  // app/page.tsx
  export const revalidate = 300;

  export default async function Page() {
    const notes =
      process.env.GKM_BUILD_OFFLINE === '1' ? [] : await api.notes.list();
    // …
  }
  ```

  Give `app/sitemap.ts` a `revalidate` and the same skip: the warm-up
  renders it again first, and follows the URLs it then lists. With no
  `revalidate` it is rendered once, in the image build, and lists no
  data-backed URL until the next build. Keep the fetches such a page makes
  cacheable (no `cache: 'no-store'`): a page that was static at build and
  makes an uncached fetch when rendered again fails with Next's
  `DYNAMIC_SERVER_USAGE` error.

  The warm-up can force that render only where it can read the image's
  preview-mode id (see [the warm-up](#the-warm-up)). Where it cannot, an
  ISR page the build cached is served empty until its `revalidate` window,
  counted from the build, has passed — up to an hour after every deploy
  for `revalidate = 3600`. A page that must have its data on the first
  request whatever the Next version renders at request time instead:
  `export const dynamic = 'force-dynamic'`, or `await connection()` (from
  `next/server`) before it fetches.
- **`tanstack`**: leave pre-rendering off — pages render on the server at
  request time — or guard any route it pre-renders with `GKM_BUILD_OFFLINE`.
- **`static`**: load data in the browser. A static site that pre-renders data
  at build (vite-ssg and the like) has nothing to fetch it from in an offline
  build, and nothing at runtime can fill it in: declare it
  [`prerender: 'stage'`](#a-site-pre-rendered-against-its-stage).

### A site pre-rendered against its stage

A `static` site whose build fetches from its APIs and bakes their answers into
its files says so on its construct:

```ts
// constructs/site.ts
export const docs = new StaticSite('Docs', {
  path: 'apps/docs',
  variant: 'static',
  prerender: 'stage',
}).dependsOn([api]);
```

Its image is then built **after** the APIs its `.dependsOn()` names are up,
not before the stack starts:

1. `build` builds every other image, and holds the site back.
2. `release` registers the routes, then starts every service of the stack
   but the site (`up --wait`), so each API is healthy by its own check.
3. Each API the site depends on is asked through the edge, by its public host
   (`/health`), exactly as [`verify`](#the-phases) asks it — the address the
   site's build will fetch from. One that does not answer fails the deploy
   with `SitePrerenderApisDown`, and the site is not built: pages built
   without their data would ship.
4. The site is built, and the full `up` starts it.

The build reaches the APIs the way the stack's own containers do, at the URLs
it inlines (`VITE_API_URL`, …):

- **No offline signal, no refused hosts.** `GKM_BUILD_OFFLINE` is not set, and
  its hosts are not mapped to `127.0.0.1`.
- **On a deployed stage**, its hosts resolve as anywhere and are served with
  the stage's public certificate.
- **On the local stage**, each `*.localhost` host points at the host's gateway,
  where the edge publishes its ports (compose's `build.extra_hosts`), and the
  build trusts gkm's local CA, handed in as the build secret `gkm_local_ca`
  and set as `NODE_EXTRA_CA_CERTS` for the site's build step only.
- **Built afresh on every deploy.** The step that fetches is keyed by a
  `GKM_PRERENDER_RUN` build argument that changes with each run, so Docker's
  cache never ships the last deploy's data. The layers before it are cached
  as usual.

It is opt-in because **the image holds that stage's data**: the same commit
builds a different image per stage. Its tag is already per stage
(`<tag>-<stage>`), but its content also depends on when it was built.

- **`gkm compose --build --push`** builds such a site against the stage as it
  runs now: its APIs are asked through their public hosts before anything is
  built, and a stage that does not answer fails the push with
  `SitePrerenderApisDown` (nothing is built or pushed). Deploy the stage once
  before pushing its site, and a change to an API reaches a pre-rendered page
  only once the site is built again after that API is deployed.
- **`--tag`** runs the image the push built, as for any app: nothing is held
  back, and nothing is fetched at deploy time.

Only a `static` site takes it — `next` and `tanstack` render on their own
server, and the [warm-up](#the-warm-up) renders their pages from the deployed
APIs — and the construct refuses it on another variant
(`PrerenderNeedsStaticSite`).

On the SST target the option changes nothing: SST builds a site during the
deploy, from an environment resolved from the resources behind its edges, so
the build already runs after those are created.

## The files

Everything for a stage is in `.gkm/compose/<stage>/` (directory `0700`), on
the machine that runs the deploy — never on the server:

```
docker-compose.yml   the stack — compose project <scope>-<stage>; Caddy's files
                     inline (mode 0600 when it holds the stage's own key)
Caddyfile            a copy, for reading, of the inline one (proxy: 'caddy')
traefik.yml          a copy of what the stack registers with the edge (proxy: 'traefik')
gkm-edge.yml         the shared edge's compose file (proxy: 'traefik')
api.env              one env file per backend, worker and site server, mode 0600
auth.env
jobs.env
web.env              a Next or TanStack Start site's server
openobserve.env      with self-hosted telemetry: its root login, mode 0600
redis.env            with a cache: the Redis password, mode 0600
Dockerfile.api       when building
local-edge.pem       the local stage's edge certificate and key, from gkm's local CA, mode 0600
```

The compose project is named after the workspace's deploy identity and the
stage (`shop-production`, or `acme-shop-production` in a namespace), so two
stages, or two workspaces, can run side by side on one machine.

## Env files

Each process's env file holds **the keys `gkm dev` hands the same app** —
one rule, shared by `gkm dev`, `gkm exec` and `gkm compose`:

- **what its constructs reach**: what its own declaration provides and
  requires, and what each construct it has an edge to provides — a worker's
  through every cron, consumer and subscriber built from it;
- **who calls it**, for a surface: each site's `<ID>_URL` and each mobile
  app's `<ID>_SCHEME` that has an edge to it (`APP_SCHEME`, `WEB_URL`), so it
  can link and redirect back to them — see
  [Edges and Environment](./edges.md);
- **the stage's own secrets**: every key set with `gkm secrets:set` that no
  construct provides (`STRIPE_KEY`, read with `get('STRIPE_KEY')`), for every
  process — but for what gkm keeps for the stack itself, such as a
  container's login or the server's address. A key a construct provides —
  an auth server's signing secret — reaches only the processes with an edge
  to it.

Resolved for the stage, that is:

- its own public URL, `https://<host>`, which it builds links and cookies on;
- each surface and site it depends on, **at its public address**
  (`AUTH_URL=https://auth.shop.example.com`), as `gkm dev` hands it and as a
  browser reaches it — through the edge. On the local stage the containers
  reach the stage's hosts through the edge too (see
  [Calling the stage's own hosts](#calling-the-stage-s-own-hosts-from-inside-the-stack));
- connection strings to the stack's own Postgres, and each cache's URL on
  the stack's Redis;
- `PORT`, `STAGE` and `NODE_ENV=production`;
- its secrets and credentials, from the stage's secrets store;
- for a backend with an edge to a `Telemetry` construct, the stage's
  `OTEL_*` keys — the stack's OpenObserve, or the provider
  `deploy.telemetry` names — see [Telemetry](#telemetry).

Under `gkm dev` an API's own process also runs the crons, consumers and
subscribers of the workers whose code it holds, so it has their keys as well;
the stack runs each worker in its own container, with its own file.

A site that runs a server — `variant: 'next'` or `'tanstack'` — gets a file
too: its edges' public URLs (`API_URL`, `AUTH_URL`), its own `WEB_URL`, and
the stage's own secrets, which its server components read. Its `NEXT_PUBLIC_*`
values stay build args, inlined into the bundle. A `static` site has no file.

A construct's secret is never written to the file of a process without an
edge to it. Images stay
stage-agnostic: no secret is baked into one. Compose reads the files raw, so
nothing in a value is interpolated — and reads them where the deploy runs: on a
deployed stage it sends the values with the call that creates each container on
the server, so no env file is ever copied there.

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
| local | `api.<project>.localhost`, `<project>.localhost` for the root site | gkm's local CA, as `gkm dev`'s edge — or the stage's own, [`deploy.compose.tls`](#certificates) |
| deployed | the stage's domains, from `domains` — `api.example.com`, `example.com` | Let's Encrypt, automatically |

The hosts are the ones `gkm deploy` uses: an app's `subdomain` (or its name)
under the stage's base domain, and the root site on the base domain itself,
plus each of its `aliases` and `redirects` (see
[Domains, Aliases and Redirects](./domains.md)).
For a deployed stage, those names point at the machine — [the deploy writes
the records](#dns) through the domain's DNS provider — and ports 80 and 443
stay open; Caddy obtains each certificate on first request.

Caddy forwards `Host` and `X-Forwarded-*` as it does by default, so an app sees
the address its caller used. Responses are never buffered (`flush_interval
-1`): server-sent events and streamed Next.js RSC payloads reach the client as
they are written.

The edge removes **`x-gkm-client-ip`** from every request it forwards but
one from a service of this stack. That header is gkm's own: an API's session
check carries the client's address in it, and the auth server rate-limits by
it. The API calls the auth server at its public address, through the edge, so
it proves it is one of the stack's own with the stack's token,
**`x-gkm-edge-token`** — derived from the stage's seed, handed to every
process as `GKM_EDGE_TOKEN`, never to a browser:

```
@gkm_outside not header x-gkm-edge-token <token>
request_header @gkm_outside -x-gkm-client-ip
```

A request without the token, or with a wrong one, has the header removed, so
nobody outside can choose the address they are rate-limited by. The auth
server checks the token again before it believes the header. The `gkm dev`
edge does the same with the local stage's token.

Why a token rather than the caller's address: a stack's services reach the
edge the way anything else does — on the local stage through the host
gateway, deployed through the server's own public address — so the address
the edge sees cannot tell one of them from a browser on the same network.

The edge is published on 443 and 80. When those are taken — locally they often
are — move it:

```bash
GKM_COMPOSE_HTTPS_PORT=8443 GKM_COMPOSE_HTTP_PORT=8080 gkm compose --stage development
```

For the local stage the URLs then carry the port
(`https://api.shop.localhost:8443`), and the env files and site builds use them.

### The local stage's certificate {#local-certificate}

The local stage's edge — its own Caddy, or the shared Traefik edge on this
machine ([with a per-stage `proxy`](#the-local-stage-behind-the-shared-edge)) —
serves a certificate from **gkm's local certificate authority**: the same
per-machine root `gkm dev`'s edge uses, in `~/.gkm/ca/` (or `$GKM_HOME/ca/`).
It is issued for `<project>.localhost`, `*.<project>.localhost` and any other
host the stack routes, handed to the proxy the way a deployed stage's
`deploy.compose.tls` files are (Caddy's inline configs, or the edge's `certs/`
volume), and kept in `.gkm/compose/<stage>/local-edge.pem` so an unchanged
stack keeps it. `gkm trust` puts the root in the system store for a browser;
for anything else, point `NODE_EXTRA_CA_CERTS` at `~/.gkm/ca/root.pem`. The
root's key never leaves `~/.gkm/ca/`.

A `deploy.compose.tls` entry for the local stage replaces it, on either proxy —
see [Certificates](#certificates).

### Calling the stage's own hosts from inside the stack

A site's server-side code calls the API at the public address it was built
with — `https://api.<project>.localhost` — because a browser is handed the
same one. Inside a container `*.localhost` is the container's own loopback, so
on the local stage every app, worker and processor container is given:

```yaml
api:
  extra_hosts:
    - api.shop.localhost:host-gateway     # each of the stage's public hosts
    - shop.localhost:host-gateway
  volumes:
    - ~/.gkm/ca/root.pem:/etc/gkm/local-ca.pem:ro   # the root's certificate only
  environment:
    NODE_EXTRA_CA_CERTS: /etc/gkm/local-ca.pem
```

Each host resolves to the machine, where the edge — the stack's Caddy or the
shared Traefik edge — publishes its port, so an address carrying a moved port
(`:8443`) works too, and the certificate there verifies against gkm's root.
With the stage's own certificate, the root mounted is its `caFile`, and with
no `caFile` none is. A wildcard site's tenants have no one name to
list. A deployed stage needs none of this: its hosts resolve to the server and
its certificates are publicly trusted.

### The local inbox

A local stack that sends mail runs its own Mailpit, separate from `gkm dev`'s,
so the mail it sends — a magic-link sign-in, an invite — is only in its inbox.
The edge serves that inbox at `https://mail.<project>.localhost`, beside the
apps, and `gkm compose` prints it with the stack's other URLs:

```
✅ shop is running:
   api          https://api.shop.localhost
   web          https://shop.localhost
   mail         https://mail.shop.localhost  (inbox)
```

The route is the edge's, like an app's: Mailpit publishes no port, and any
number of local stacks serve their inboxes side by side. `mail` is reserved for
it on the local stage, so an app whose host would be `mail.<project>.localhost`
(`subdomain: 'mail'`, or an app named `mail`) fails with `MailInboxHostTaken`.

A deployed stage has no inbox route. With `--allow-dev-services` its Mailpit
runs on the stack's network only, and nothing outside the stack reaches it.

### A site behind a password

A site can stay private on some deployed stages. It's meant for a staging
build you're still trying out. Give the site a `RandomPassword` and the
stages it guards:

```ts
// constructs/site.ts
import { RandomPassword } from '@geekmidas/constructs/random-password';
import { StaticSite } from '@geekmidas/constructs/site';

export const sitePassword = new RandomPassword('SitePassword');

export const web = new StaticSite('Web', {
  path: 'apps/web',
  password: { secret: sitePassword, stages: ['staging'] },
});
```

The edge asks with HTTP basic auth before a request reaches the site. The
browser shows its own login prompt, and nothing of the site loads until the
right login is given. The user is the stage's name. The password is the
`RandomPassword`'s value on that stage: generated on the first deploy and
kept in the stage's secrets under its key, `SITE_PASSWORD`. Read it with:

```bash
gkm secrets:show --stage staging --reveal   # → SITE_PASSWORD
```

To choose the password yourself, set it with
`gkm secrets:set SITE_PASSWORD '…' --stage staging`. A value set by hand
always wins over a generated one.

- `stages` are your deployed stages, typed from `stages.deployed`. A stage
  the workspace doesn't deploy fails the deploy (`UnknownPasswordStage`). A
  stage that isn't listed is public.
- Export the `RandomPassword`, as any construct is. It isn't an edge: the
  site is handed none of it, and only the edge reads it. Several sites can
  share one, or each have their own.
- Only the sites are covered. The APIs and the auth server they call answer
  on hosts of their own, so a site's requests to them carry no login and
  need none.
- Caddy and the shared Traefik edge render it alike (`basic_auth`, or a
  `basicAuth` middleware). Both get only the password's bcrypt hash.
- The deploy's health check signs in with the login, so a wrong one fails
  the deploy rather than leaving a site nobody can open.
- Compose only for now. A site behind a password on a stage that deploys
  through Dokploy or AWS fails before anything is deployed
  (`SitePasswordNeedsCompose`), so it never ends up public by mistake.

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
🌐 DNS for 'production' → 203.0.113.10 (dry run — nothing is written)
   example.com (godaddy) — dry run
   + api.shop.example.com             A     203.0.113.10  (TTL 600) — would create
   ✓ auth.shop.example.com            A     203.0.113.10  (TTL 600) — up to date
   ~ shop.example.com                 A     198.51.100.7 → 203.0.113.10  (TTL 600) — would update
```

The server's address is printed, not masked: it is in public DNS, and it is
where the deploy goes. Every other stage secret is masked in everything a
deploy prints.

Every host gets an A record, and an AAAA record with `GKM_SERVER_IPV6`. With
`records: { mode: 'cname', target: 'server.example.com' }` on the domain, the
target gets the A record and every other host a CNAME to it; the apex is
always an A record. A record that already has its value is not written; one
with another value is replaced. The deploy touches only the A, AAAA and CNAME
records of the stage's own hosts, and the records it wrote for them before.
It deletes one a change of mode replaces (an A record where a CNAME now goes,
or the other way round), and one it wrote for a host the stage no longer
serves — see [Changing the domain](#changing-the-domain). What it wrote is
recorded in the stage's deploy state as `dns-record` resources. A `manual`
domain is printed, not written.

**One wildcard, for a wildcard site.** One record is written per host. The
only wildcard written is `*.<stage domain>` for a site declared
`subdomain: '*'` (see [A site on every subdomain](#a-site-on-every-subdomain)):
its tenants are created by the running app, not by a deploy. It is read back
like the others, and resolved, where no provider confirms it, through
`gkm-wildcard-check.<stage domain>`. Every other wildcard host is refused with
`DnsWildcardRefused`.

The DNS provider's credentials are read by the machine that runs the deploy —
see [DNS Providers](./deployment.md#dns-providers) for GoDaddy's token and its
API access restriction. With a token provider (GoDaddy, Hostinger) configured
and no token, the deploy fails at its start — before anything is created,
built or started — with `DnsCredentialMissing`, naming the key.

### Adding an app

A new app's host gets its record from the next deploy. Nothing is run by hand
first: the deploy sees the host has no record, writes it, confirms it, and
only then starts the stack and asks for its certificate.

### Changing the domain

Change `domains.<stage>` (or an app's `domain` or `subdomain`) and deploy. The
deploy writes the new hosts' records, starts the stack on them, and checks
each app answers. Only then does it go through the records the stage's state
says it wrote, and delete each one whose host and type the stack no longer
has:

```
   No longer served by 'production':
   - old.example.com                  A     203.0.113.10 — delete
   - api.old.example.com              A     203.0.113.10 — delete
   ⚠ auth.old.example.com             A     198.51.100.7 — pointed elsewhere since gkm wrote 203.0.113.10; left as it is
🌐 2 records deleted
```

A record is deleted only if its provider still holds the value gkm wrote, so
a name someone has pointed elsewhere since is left alone. Where no provider
can delete it (a `manual` domain, a domain taken out of `dns`, a key that can
only write), it is printed for you to remove. Each one is forgotten from the
stage's state either way. A deploy that stops before its apps answer deletes
nothing: the old hosts keep working until the new ones do. `--dry-run` prints
what would go. The same goes for an app that is removed or renamed, and for
the AAAA records once `GKM_SERVER_IPV6` is unset.

Keep the old domain's entry in `dns` until a deploy has run without it in
`domains`: that entry is how the deploy reaches the provider to delete its
records.

**What the providers made on the old domain.** The resources a provider
creates move to the new domain on the same deploy:

- **Mail** (`deploy.email`): the new domain is verified in SES, its DKIM
  records are written, and the sending user may send as it. A `MAIL_FROM`
  gkm wrote moves to the new domain, keeping the construct's local part
  (`noreply@` without one). One you set yourself, or `from`, is kept.
- **Inboxes** (`deploy.inbox`): the new domain gets its own SES identity and
  MX records, and each receipt rule its new addresses.
- **File servers behind CloudFront**: a certificate for the new host is
  requested and validated, and the distribution moves to it.

The DNS records providers write — DKIM, MX, certificate validation, a file
server's CNAME — are kept in the stage's state like the stack's, marked as a
provider's. Each provider asks for its records on every deploy. One it asked
for before and not now, such as the old domain's DKIM records, is pruned
with the stack's records, after the apps answer, under the same rules. The
old domain's SES identity and certificate are left in place, since another
stack may use them. Delete them by hand if nothing does.

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
runner's one `gkm compose`, which drives the server over SSH — the token never
reaches the server. A stage whose environment lacks the secret fails that step
with `DnsCredentialMissing`, which says where to add it.

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

What sits in front of a stage's stack is `deploy.compose.proxy`:

```ts
deploy: {
  compose: {
    proxy: 'traefik',                                  // every deployed stage
    // proxy: { staging: 'traefik', production: 'caddy' }  // or one per stage
    // proxy: { development: 'traefik', production: 'traefik' } // local too
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

**The string form is for the deployed stages.** `proxy: 'traefik'` sets every
deployed stage, and the local stage stays on its own Caddy. To run the local
stage behind the edge too, name it in the per-stage map — see
[The local stage behind the shared edge](#the-local-stage-behind-the-shared-edge).
A site's image keeps Caddy inside it as its file server either way.

Both proxies serve the same routes. A stack's routes are worked out once — each
host, the service and port behind it, whether it streams, its allowlist and its
health path — and rendered as a Caddyfile or as Traefik configuration, so the
two never drift. Either way `Host` and `X-Forwarded-*` reach the app as the
caller sent them, `x-gkm-client-ip` only from a service of the stack (Traefik
removes it with a `<project>-strip-gkm-headers` headers middleware first in
every router's chain, and a `<route>-stack` router matching
``Header(`x-gkm-edge-token`, `<token>`)`` — a longer rule, so ahead of
the route's own — sends the stack's own calls to the same service without
it), a streamed response is never buffered, and the log UI's public mode
answers only its `allow` list (Traefik's `ipAllowList`, matched on the
connection's own address).

### The shared edge

`gkm compose` starts the edge when a stack needs it and it is not running, and
leaves it running on `--down`. There is no Docker socket: the edge is
configured through Traefik's file provider alone. Everything lives in Docker
on the server — nothing is a file there, and nothing needs root:

```
gkm-edge (compose project, traefik:v3.7.13 pinned)
  traefik.yml                     inline config: entrypoints web (80 → HTTPS) and
                                  websecure (443), ACME over HTTP-01, no dashboard
                                  and no API
  dynamic/<project>.yml           volume: one per stack — its routers, services,
                                  middlewares
  certs/<project>.crt, .key       volume: a stack's own certificate, where it sets one
  acme/                           volume: the ACME account and certificates
```

The deploy writes a stack's routes and certificate into those volumes through
`docker exec` on the edge's container, over the same SSH connection as every
other call. An edge started by an older gkm, which mounted `~/.gkm/edge` on the
server, is recreated on the first deploy; every stack on it registers again
on its own next deploy.

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
- **A stack's file** is written before its apps are waited on, whole — a
  temporary file, then a rename the edge picks up — and removed by
  `gkm compose --down`, which leaves every other stack served.
- **One host, one stack.** A host is routed by one project only. Each stack's
  file opens with the hosts it routes (a `# gkm-claims:` comment, which
  Traefik ignores), and before a deploy changes anything it reads every other
  project's file on the edge and refuses a host one of them already routes
  — see [Several workspaces on one server](#several-workspaces-on-one-server).
- **The edge's ports** are 443 and 80; `GKM_COMPOSE_HTTPS_PORT` and
  `GKM_COMPOSE_HTTP_PORT` move them, as they move a stack's own Caddy.
- **`verify`** asks the edge on the server's address, on its published port,
  with each host as SNI and `Host`: it checks the edge routes the host and
  presents a certificate a client accepts.
- **Stop the edge**, once no stack uses it: `docker compose -p gkm-edge down`
  on the server.
- **Another edge on one engine** — a testing and advanced knob:
  `GKM_EDGE_PROJECT` renames the edge's compose project, and with it its
  network and its volumes (`<project>_acme`, `_certs`, `_dynamic`). gkm's own
  end-to-end suite runs `GKM_EDGE_PROJECT=gkm-edge-e2e-<random>` on free
  ports beside a developer's `gkm-edge`, and removes only its own. Every
  command that registers with an edge — `gkm compose`, `--down` — must be run
  with the same value, or it registers with another one.

### Several workspaces on one server

Two workspaces — or two stages of one — share a server by both setting
`proxy: 'traefik'` and pointing their stage at the same server. Each is its
own compose project (`<workspace>-<stage>`), with its own containers and
network, and each registers its own hosts with the one edge:

```ts
// shop/gkm.config.ts
domains: { production: 'shop.example.com' },
deploy: {
  default: 'compose',
  compose: {
    proxy: 'traefik',
    server: { production: { user: 'deploy', host: '203.0.113.10' } },
  },
},

// blog/gkm.config.ts — another workspace, the same server
domains: { production: 'blog.example.com' },
deploy: {
  default: 'compose',
  compose: {
    proxy: 'traefik',
    server: { production: { user: 'deploy', host: '203.0.113.10' } },
  },
},
```

```bash
(cd shop && gkm compose --stage production)  # starts gkm-edge, registers shop-production
(cd blog && gkm compose --stage production)  # registers blog-production beside it
```

```
gkm-edge
  dynamic/shop-production.yml   api.shop.example.com, shop.example.com
  dynamic/blog-production.yml   api.blog.example.com, blog.example.com
```

A host belongs to the project that routes it first. Were `blog` to set
`domains.production: 'shop.example.com'` as well, its deploy would stop
before it touched DNS, a secret, an image or a container, with
`EdgeHostClaimed` naming the host and the project that routes it:

```
blog-production routes api.shop.example.com, and shop-production already
routes it through the shared edge (gkm-edge) on this server. …
```

Give it another domain, or take the other stack off the edge first with
`gkm compose --stage production --down` in its workspace — that frees its
hosts. A redeploy of the same project replaces its own file, so it never
clashes with itself. A [site on every subdomain](#a-site-on-every-subdomain) claims every one
label under its domain but the ones it leaves out, so another project's
`acme.example.com` clashes with `*.example.com`, while a stage it leaves out
(`staging.example.com`) does not. The check runs once more as the routes are
written, for an edge that was not running when the deploy began.

### The local stage behind the shared edge

Local testing exercises the path staging and production take — the edge, its
routes, its middlewares, Traefik itself — when the local stage is named in the
per-stage map:

```ts
deploy: {
  compose: {
    proxy: { development: 'traefik', production: 'traefik' },
  },
},
```

`gkm compose --stage development` then starts the same `gkm-edge` on this
machine's Docker and registers the local stack with it, as a deployed stage's
deploy does on its server. What differs is the certificate: Let's Encrypt
cannot issue for `*.localhost`, so the edge serves the one gkm's local CA
issues (see [The local stage's certificate](#local-certificate)),
written into its `certs/` volume where a deployed stage's own certificate goes.
`gkm trust` is still the one step to trust it in a browser.

Everything else is as it is on Caddy: the hosts (`https://api.<project>.localhost`,
and `:8443` with `GKM_COMPOSE_HTTPS_PORT=8443`), the Mailpit inbox at
`https://mail.<project>.localhost`, the containers' `extra_hosts` entries —
the edge publishes on the host, as the stack's Caddy did — and the check
after the start, which asks `127.0.0.1` and trusts gkm's root.
`gkm compose --stage development --down` unregisters the stack and leaves the
edge running.

Switching the local stage between proxies is the
[same one-time step](#switching-a-server-from-caddy-to-the-shared-edge) as on
a server: the stack's own Caddy and the edge cannot both hold the ports.

### Certificates

Certificates do not depend on the proxy. Without one of its own, a stage gets:

| Stage | Certificate |
| --- | --- |
| deployed | Let's Encrypt, on either proxy — Traefik over the HTTP-01 challenge on port 80, keeping its account and certificates in the edge's `acme` volume. Point the stage's names at the server and leave 80 and 443 open. |
| local | one gkm's local CA issues ([above](#local-certificate)), on either proxy. |

Any stage — the local one included — can bring its own instead: an origin
certificate from a CDN, one from an internal CA, a wildcard you already have,
an mkcert certificate for `*.<project>.localhost`:

```ts
deploy: {
  compose: {
    tls: {
      production: { certFile: 'certs/origin.pem', keyFile: 'certs/origin.key' },
      development: {
        certFile: 'certs/dev.pem',
        keyFile: 'certs/dev-key.pem',
        caFile: 'certs/rootCA.pem', // the root it chains to: `mkcert -CAROOT`
      },
    },
  },
},
```

Paths are relative to the workspace root, or absolute; the certificate is PEM
with its chain. It is read where the deploy runs: Caddy gets it as inline
configs beside its Caddyfile; Traefik gets a copy in the edge's `certs/` volume
(the key `0600`) and the stack's file names it. On the local stage it replaces
the certificate gkm would issue.

**`caFile`** is the root the certificate chains to, for one no public CA
issued. The check after a start (`🩺`) trusts whichever CA issued the stage's
certificate:

- gkm's root, for the local stage's certificate from gkm's local CA;
- the `caFile`, for a stage's own certificate that names one — and on the local
  stage the stack's containers are handed it too (mounted read-only, with
  `NODE_EXTRA_CA_CERTS`), so they call the stage's hosts as they would with
  gkm's;
- otherwise what Node trusts by default — its bundled roots, and
  `NODE_EXTRA_CA_CERTS` where it is set — as for a publicly trusted
  certificate. A local certificate from a private CA without `caFile` fails
  that check, unless `NODE_EXTRA_CA_CERTS` names its root.

The check never assumes gkm's root for a certificate gkm did not issue. A file
that is not there — the certificate, its key or its `caFile` — fails the run
with `ComposeTlsFileMissing` before anything starts, and a stage the workspace
does not have — in `tls` or a per-stage `proxy` — with `ComposeStageUnknown`.

### A site on every subdomain

A site declared `subdomain: '*'` (see
[Naming](./naming.md#a-site-on-every-subdomain)) answers on every one label
under the stage's domain that no other app does: `acme.shop.example.com`
reaches it, `api.shop.example.com` still reaches the API, and
`a.b.shop.example.com` reaches nothing. The deploy writes one
`*.shop.example.com` record to the server beside the named ones.

A tenant never takes a label the stage needs. The site's protected
subdomains — every app's own label, `protectedSubdomains`, and the first
label of any other stage whose domain sits under this one's (`staging` for
`staging.shop.example.com`) — never reach it, on either proxy.

Let's Encrypt issues a wildcard certificate only over the DNS challenge, so
each proxy gets the tenants' certificates its own way:

- **Traefik (the shared edge)**: one `*.<stage domain>` certificate per stage,
  obtained and renewed by the edge over the DNS challenge when Route 53 holds
  the domain (`dns: { 'example.com': { provider: 'route53' } }`). The wildcard
  router (`HostRegexp`, priority 1) sits below every named host's. The deploy
  creates what the edge writes the challenge with: an IAM user for the server,
  `gkm-edge-acme-<hash>` under `/gkm/`, with one inline policy per stack
  allowing `ChangeResourceRecordSets` on the stage's zone for the TXT record
  `_acme-challenge.<stage domain>` alone — plus `ListResourceRecordSets` on
  that zone, `GetChange` and `ListHostedZonesByName`, which write nothing. Its
  key is written into the edge's `certs/aws-credentials` (`0600`), never into
  the stage's secrets, and the deploy prints the user and the zone. A user by
  that name that gkm did not tag for the server is refused with
  `EdgeAcmeUserNotOwned`.
- **Caddy (the stack's own)**: one certificate per tenant, on demand. Before
  Caddy gets one for a host, it asks the site's `hosts` route on the stack's
  network (`GET <path>?domain=<host>`); a host that is no tenant gets no
  certificate, so it fails in the browser rather than reaching the app.
- **Either**: the stage's own wildcard certificate, `deploy.compose.tls` (see
  [Certificates](#certificates)), wins over both, for a server that must hold
  no key.

A stage with none of these is refused with `WildcardSiteCertificateMissing`,
naming what would give it one. Two stages on one server each get their own
router and certificate: a wildcard covers one label, so `*.example.com` never
matches `acme.staging.example.com`.

The verify phase asks the wildcard site's container for its health rather than
a tenant's host, which only the app knows.

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
| `build` | every image built inside Docker — or, with a tag, pulled. A site [pre-rendered against its stage](#a-site-pre-rendered-against-its-stage) is held back. With `--push`, each built image pushed (such a site built once the running stage's APIs answer), and the run ends here |
| `release` | a held-back site built once the rest of the stack is up and its APIs answer through the edge; then `docker compose up --wait --remove-orphans`, and each app's image recorded |
| `verify` | each app asked through the edge — its own Caddy, or the shared Traefik — over HTTPS: an API at `/health`, a site at `/`, with the certificate verified; then each server-rendered site [warmed](#the-warm-up) |

`verify` goes through the edge by hostname, so it proves what `up --wait`
cannot: that Caddy routes each host and presents a certificate a client
accepts. On the local stage it trusts gkm's local root (`~/.gkm/ca/root.pem`)
and connects to 127.0.0.1. Each app is asked for up to three minutes; one that never answers
fails the deploy with `ComposeAppsUnhealthy`, naming it and what it answered.
The target has no rollback: the previous images are still tagged, so deploying
the previous tag again is the way back.

The events are the ones every target reports: `artifact.built` per image (with
its digest), `resource.applied` per service, `app.deployed` per app and
`health.checked` per check — `gkm deploy --target compose --json` writes them.

### The warm-up

Once every app is healthy, `verify` warms each server-rendered site — a
`next` or `tanstack` one; a `static` site's pages are files. It asks the site
for `/sitemap.xml` first (a sitemap index's sitemaps are followed one level),
then for `/` and every page the sitemap lists, through the edge exactly as
the health check is asked: connected to the edge, the site's host as SNI and
`Host`, the local CA trusted on the local stage, and the site's login sent
where it is behind a password. Pages are asked four at a time, each given 30
seconds, at most 500 per site, and only those on the site's own origin.

Since the image was [built without its APIs](#a-site-is-built-without-its-apis),
each page renders on its first request; the warm-up makes that request, from
the deployed APIs, before any visitor does.

**A `next` site's pages are rendered, whatever the build cached.** An offline
build still prerenders each ISR page, empty, and Next counts that copy as
fresh for the page's whole `revalidate` window — a plain request would be
answered from it and render nothing. So the warm-up reads the build's
preview-mode id (`preview.previewModeId` in `.next/prerender-manifest.json`)
from the running site's container, through the stack's Docker — on a
deployed stage, the server's engine; never a file on the deploying machine —
and sends it as Next's on-demand revalidation header,
`x-prerender-revalidate`, with every request to that site. Next renders each
page again from the deployed APIs and caches that. The id is only ever sent
to the site: it is not logged or written anywhere.

If the id cannot be read — the container did not answer, or a Next version
whose manifest has no `previewModeId` — the deploy says so once and warms
the site with plain requests:

```
   ⚠ web          can't force ISR pages to render: /app/apps/web/.next/prerender-manifest.json has no preview.previewModeId, which this version of Next may not write. Warming with plain requests; …
```

Then an ISR page is rendered only once its window has passed; see
[built without its APIs](#a-site-is-built-without-its-apis) for making such
a page dynamic instead.

**The summary never says a page rendered when it did not.** Each response's
`x-nextjs-cache` is read, and a page Next answered from its cache (`HIT`, or
`STALE`) is counted apart and named:

```
🔥 Warming each server-rendered site…
   ✓ web          warmed 12 page(s), 2 served from the build cache: /, /about
```

**A page that fails to warm never fails the deploy** — a 5xx, a timeout, no
answer at all. Every app is already healthy, and the page renders on the
next request for it. The summary says what happened:

```
🔥 Warming each server-rendered site…
   ⚠ web          warmed 41 page(s), 1 warning(s):
       https://example.com/notes/broken: HTTP 500
```

A site with no sitemap is warmed at `/` alone. A site on every subdomain has
no one host to ask, and is skipped with a note.

## Mail and storage on a deployed stage

A deployed stage's mail and object storage are real services, from its
secrets — the stack runs no Mailpit or MinIO for it:

| Declared | Keys the stage sets |
|---|---|
| `Email('Mail')` | `MAIL_URL` (any SMTP server: `smtp://user:pass@host:587`) and `MAIL_FROM` |
| a bucket, `ObjectStorage('Uploads')` | `UPLOADS_CONNECTION_STRING` (`s3://bucket?region=…`, with `&endpoint=…` for R2 or any S3-compatible store). Its credentials are optional: a key for this bucket alone in the URL (`s3://KEY:SECRET@bucket?…`), or the shared `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` for every bucket whose URL has none |
| a file server, `FileServer('Uploads')` | `UPLOADS_CONNECTION_STRING` for its bucket, and `UPLOADS_URL` — the public address its objects are served on |

Every mail and storage construct the workspace declares counts. A stage
missing any of them stops in the deploy's readiness check — after the stage's
providers have written their keys, and before a file is written, a secret generated or a container
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
gkm secrets:set UPLOADS_CONNECTION_STRING 's3://AKIA…:…@acme-uploads?region=eu-west-1' --stage production
# or, for every bucket whose URL carries no key:
gkm secrets:set AWS_ACCESS_KEY_ID 'AKIA…' --stage production
gkm secrets:set AWS_SECRET_ACCESS_KEY '…' --stage production
```

Or have gkm create the buckets: with `deploy.objects.production: { provider:
's3' }`, `gkm deploy --stage production` creates each bucket, its IAM user and
key in the stage's AWS account and writes `UPLOADS_CONNECTION_STRING`
and `UPLOADS_URL` itself, before its checks run — see
[Providers](./providers.md). Every deploy then checks the bucket answers the
key in the stage's secrets (`verify()`), and stops with
`ProvisionedBucketUnreachable` if it does not.

Mail too: with `deploy.email.production: { provider: 'ses' }`, the deploy
verifies the sending domain in SES, creates an IAM user allowed only to send
as it, and writes `MAIL_URL` (its key, as an SES SMTP URL) and `MAIL_FROM` —
see [`email: ses`](./providers.md#email-ses). A `MAIL_URL` the stage already
set is kept, and nothing is created for it.

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
its kind (`deploy.objects.<stage>: { provider: 's3' }`,
`deploy.email.<stage>: { provider: 'ses' }`, or `false`).

- **A bucket** gets MinIO in the stack: the buckets are created from this
  machine on a loopback port, and the backends are handed MinIO's URL and key
  pair. Its root credential is the stage's own
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` where set, and otherwise derived
  from the stage's seed, as its database passwords are. Each file server over
  it answers on `https://<id>.<stage domain>` through Caddy, unless its URL is
  set.
- **Mail** gets Mailpit, unless the stage set `MAIL_URL`. `MAIL_FROM` is
  the construct's `from` (`noreply` without one) `@<stage domain>` unless set. Mailpit catches every message and
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

## WebSocket surfaces

A `WebSocketApi` is an app like a `RestApi`: an image built from its
directory, a host on the stage's domain (`wss://realtime.example.com`), and
`/health` on the same port as its sockets. What differs is that it holds
connections, so the stack is sized for that:

- **One container per replica.** `replicas: 3` runs `realtime`,
  `realtime-2` and `realtime-3` from one image and one env file, each an
  upstream of the surface's one route. Node runs one thread, and each
  edge-to-container pair has its own budget of ports, so a busy surface wants
  about one replica per core.
- **Redis carries the sends.** The surface's publisher is the stack's Redis
  (the one [the cache](#the-cache) uses), so an endpoint in the API's
  container reaches a socket held by `realtime-2`. A stage that sets
  `REALTIME_PUBLISHER_CONNECTION_STRING` itself uses that instead.
- **The edge is widened.** Caddy — and the shared Traefik — run with
  `net.ipv4.ip_local_port_range=1024 65535` and a million file descriptors:
  every client connection is two sockets at the edge, and the half to the
  container is opened from the edge's own port range — about 28k by Linux's
  default, per container. The surface's containers get the same descriptor
  limit.
- **The kernel is raised** by `gkm compose:server`:
  `nf_conntrack_max=1048576` (each connection is tracked twice, and the
  default table fills long before memory does — then new connections are
  dropped silently), and `somaxconn`/`tcp_max_syn_backlog` for reconnect
  storms after a deploy.

A deploy replaces the containers, and every socket on them is closed with
1012; clients reconnect, which the edge spreads across the replicas that are
up.

### What is limited

A surface bounds what one client may ask of it ([`limits`](../packages/constructs.md#limits-limits)),
counted on the stack's Redis so each limit holds across every replica:

| | Default | Enforced by | Past it |
|---|---|---|---|
| Handshakes per client address | 120 a minute | Traefik (`rateLimit`) and the surface | 429, `Retry-After` |
| Sockets per client address | 256 open | Traefik (`inFlightReq`) and the surface | 429 |
| Handshakes in flight per address | 16 | the surface | 429 |
| Frames per socket | 50/s, burst 100 | the surface | one `$error`, then close 1008 |
| Sockets per identity | off; 16 with `maxConnectionsPer` | the surface | 429, or the oldest closed with 1008 |
| Frame size | 1 MiB (`maxPayload`) | the surface | close 1009 |
| A socket that stops reading | 4 MB queued | the surface | close 1013 |

Under Caddy only the surface counts, because Caddy has no rate limiter. The
stack's own services, which reach the surface through the edge from one
address, aren't counted against the edge's limits. An upgrade with no `Origin`
gets through unless the surface sets `requireOrigin: true`. What's not limited:
the total number of sockets a replica holds (memory is the bound, see below),
and how fast the surface's own publisher sends.

### How many connections fit

Measured with real sockets through the edge as `gkm compose` renders it — the
simulator and every run are in `apps/websocket-load` (`RESULTS.md`):

| Per connection | |
|---|---|
| The edge (Caddy 2 or Traefik v3), TLS | **~170–185 KB** |
| The `WebSocketApi` process | ~10–15 KB |

**The edge, not the app, is what fills a box.** Budgeting ~190 KB per
connection for the stack:

| VPS memory | Concurrent WebSockets |
|---|---|
| 4 GB | ~15k |
| 8 GB | ~35k |
| 16 GB | ~80k |
| 32 GB | ~165k |

At 50k connections across four replicas, every broadcast reached every socket
in 150–200 ms and an echo round trip was 1.3–1.7 ms at the median. One
replica holds 35k and broadcasts to all of them in ~0.5 s; more replicas buy
broadcast latency, not memory. Without the widened port range a replica stops
at exactly 28,231 sockets and the edge answers the rest with 502. Traefik's
60-second read timeout does not cut an idle upgraded socket.

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
| `port` | the first free from `5080` | the port it is published on — on `127.0.0.1` only. Named, a deploy refuses it when another stack on the server holds it (`LogsPortTaken`) |
| `retentionDays` | `30` | days of data kept (OpenObserve's `ZO_COMPACT_DATA_RETENTION_DAYS`); at least 3, which is OpenObserve's own minimum |
| `public.allow` | — | serve it through the edge instead, to these IPs and CIDRs only |
| `sampleRate` | `1` | `OTEL_TRACES_SAMPLER_ARG`, with `parentbased_traceidratio` |

The local stage ignores `deploy.telemetry`: `gkm compose --stage <local>`
always runs OpenObserve on `127.0.0.1:5080`, keeping every trace.
`GKM_COMPOSE_LOGS_PORT` moves it to another port, for a machine where 5080 is
taken.

With it on, the stack adds:

- an `openobserve` service (`public.ecr.aws/zinclabs/openobserve`, a pinned
  version, or the `image` the `Telemetry` construct names), its data in the `openobserve-data` volume — kept by
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

The root login is stored on a deployed stage's first run, in its secrets,
like the stage's seed: `ZO_ROOT_USER_EMAIL` — `admin@<stage domain>` as the
domain was then — and a generated `ZO_ROOT_USER_PASSWORD`. Every later run
reads both back and derives neither, so the login OpenObserve signs in with,
its health check, the header each app sends and the login the run prints are
one value, whatever the stage's domain becomes. That matters because
OpenObserve creates its root user from these only once, on its first start,
in its data volume: a login that followed the domain would leave the stored
user behind, and the health check would get 401s.
`gkm secrets:show --stage production --reveal` shows the password. The local
stage signs in as `admin@gkm.localhost` with a password generated for this
machine, alongside `gkm dev`'s other local logins; `gkm dev:credentials`
prints it. Set `ZO_ROOT_USER_EMAIL` or `ZO_ROOT_USER_PASSWORD` in the stage's
secrets to choose your own — before OpenObserve's first start, or to the user
its volume already holds; a password OpenObserve would refuse (8–128 characters, with a
lowercase and an uppercase letter, a digit and a symbol) fails with
`LogsPasswordWeak`.

### Reaching it: an SSH tunnel

By default OpenObserve is published on `127.0.0.1:5080` of the server the
stack runs on, and on nothing else. The run ends with how to reach it:

```
📜 Logs (OpenObserve) on 127.0.0.1:5080 — from your computer:
     ssh -N -L 5080:localhost:5080 deploy@203.0.113.10
     then open http://localhost:5080  (login: admin@example.com, password: gkm secrets:show --stage production --reveal → ZO_ROOT_USER_PASSWORD)
⚠️  Docker-published ports bypass ufw, so OpenObserve is bound to 127.0.0.1 only — reach it through the tunnel, not by opening the port.
```

The login is the stage's `deploy.compose.server`. To make it one word, give
the tunnel a name in `~/.ssh/config`:

```
Host shop-logs
  HostName 203.0.113.10
  User deploy
  LocalForward 5080 localhost:5080
```

`ssh -N shop-logs`, then open `http://localhost:5080`.

**Two stages on one server.** Each stage's stack runs its own OpenObserve, so
each needs its own loopback port. Before a deploy changes anything, it reads
the ports every other stack on the server publishes:

- with no `port` set, the stack keeps the port it already publishes, or takes
  the first free one from `5080` up. A second stage on the box gets `5081`,
  and its run prints that tunnel;
- a `port` the stage names, held by another stack, fails the deploy with
  `LogsPortTaken`, naming the stack that holds it.

One `~/.ssh/config` entry can forward both:

```
Host shop-logs
  HostName 203.0.113.10
  User deploy
  LocalForward 5080 localhost:5080   # production
  LocalForward 5081 localhost:5081   # staging
```

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

serves it through the stack's edge at `https://telemetry.<stage domain>`, with a certificate
like every other host. Caddy answers only the listed addresses — matched on
the connection's own address, never a header — and every other gets 403. No
host port is published. `allow` must name at least one address; an empty one
fails with `LogsAllowEmpty`, and an entry that is not an IP or a CIDR with
`LogsAllowEntryInvalid`. The host is DNS-planned and checked with the apps'
hosts.

The label is the `Telemetry` construct's, the same on every stage: its id
kebab-cased, or the `subdomain` it names. Like any app's label it is claimed,
so no app, alias or tenant can take it:

```ts
export const telemetry = new Telemetry('Telemetry', {
  subdomain: 'logs',  // https://logs.<stage domain>
  image: 'public.ecr.aws/zinclabs/openobserve:v1.0.4', // optional
});
```

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
edge to it. A sibling service calls it at its public address, through the
edge, so its public origin is the one it is trusted by — there is no internal
one. The session cookie's domain is the parent the public
hosts share (`.example.com`), so the site and the APIs all see the session.

## Backups

A deployed stage whose stack runs Postgres is backed up, without being asked:
every day at 02:00 UTC, each backup kept 30 days. The local stage never is.

```ts
// gkm.config.ts
deploy: {
  default: 'compose',
  backups: {
    production: { every: '6h', keep: '30d' },   // 02:00, 08:00, 14:00, 20:00 UTC
    staging: { cron: '30 3 * * 1-5', keep: '7d' }, // five fields, in UTC
    preview: false,                                // none — and nothing is deleted
  },
},
```

`every` is a number and a unit — `90m`, `6h`, `1d` — counted from 02:00 UTC;
`cron` is five fields in UTC. Either runs at most once an hour: anything more
frequent fails the config with `BackupIntervalInvalid` or `BackupCronInvalid`.
`keep` is days. `false` takes no backups, prints a notice on every deploy, and
deletes none that were taken.

### Where they are

In the project bucket — the one the deploy state lives in, `gkm-<project>-<account
id>` — under the stage's own prefix, one folder per run and one file per
database, named after its construct the way its migrations folder is
(`AuthDatabase` is `db/auth-database`):

```
gkm/<project>/<stage>/backups/2026-10-10/02-00-00Z/database.sql.gz
gkm/<project>/<stage>/backups/2026-10-10/02-00-00Z/auth-database.sql.gz
```

Each file is a gzipped plain `pg_dump --create --clean`: restored, it drops
and recreates its database, owners and grants included.

### Retention

An S3 lifecycle rule on each stage's runs expires a backup after its `keep`,
and aborts an upload that never finished. A lifecycle filter cannot leave a
folder out, so the rule matches what every run folder starts with — its year,
`backups/2…` — and the stage's `imports/` is never expired. A bucket has one
lifecycle, so the deploy rebuilds the whole of it from every stage's
`deploy.backups` — the bucket's own rule for old versions, and each stage's
expiry — and puts it only when it differs. One stage's deploy never drops
another's rule.

### What the deploy creates

Beside the stage's providers, with the stage account's credentials — in CI,
the role `gkm deploy:github` grants the deploy job:

- the project bucket, if it is not there yet, and its lifecycle;
- an IAM user, `gkm-<project>-<stage>-backups` under `/gkm/`, whose policy
  allows `s3:PutObject` under the stage's backups prefix and **nothing else**
  — no get, no list, no delete. A server that is broken into can neither read
  the backups nor wipe them;
- its key, in the stage's secrets as `BACKUPS_URL`
  (`s3://KEY:SECRET@bucket?region=…`).

`--rotate-keys` issues the key a successor and `--retire-old-keys` deletes the
old one, as for a bucket's key. Every deploy's check puts a marker with the
key, waiting out a key issued moments ago, so a key that does not work stops
the deploy rather than the night's run.

### The `backups` service

The stack runs one more container, on its own network. Its image is built on
the server from the stack's own Postgres image — the same major, so its
`pg_dump` matches the server — with Node added and gkm's uploader copied in:
nothing is pulled that the stack does not already have, and nothing is mounted
from the host: its build context — a Dockerfile and the uploader — is sent to
the server's engine over the same SSH every deploy uses. It reads `BACKUPS_URL`
from its environment like any app reads its keys; the server holds no AWS
credentials of its own.

It signs in as a role of its own, `<project>_backups`, granted
`pg_read_all_data`: it reads every database and can write none. On schedule it
dumps each database and streams it, gzipped and in parts, to the run's folder,
and logs each run as a JSON line — to the stack's telemetry too, when it is on:

```json
{"time":"2026-10-10T02:00:04.211Z","level":"info","msg":"backup finished","ok":true,"folder":"gkm/shop/production/backups/2026-10-10/02-00-00Z","databases":["auth-database","database"],"bytes":{"auth-database":18342,"database":5120934},"durationMs":3912}
```

It is unhealthy when its last good run is older than twice the schedule's
longest gap, after a startup grace — so a missed night shows in
`docker compose ps`.

### Listing, backing up now, restoring

Run from a laptop, or CI, with the stage account's own credentials:

```bash
gkm backup:list --stage production          # newest first: time, databases, sizes; then imports/
gkm backup:now --stage production           # docker exec on the server, over SSH: a run now
gkm backup:restore --stage production --latest
gkm backup:restore --stage production --at 2026-10-10/02-00-00Z --database auth-database
gkm backup:restore --stage production --at 2026-10-09T12:00:00Z --yes
```

A restore asks first (`--yes` skips it), then:

1. checks the run holds every database it restores — `BackupDatabaseMissing`
   otherwise, before anything changes;
2. takes a fresh backup;
3. downloads each file with **your** credentials — the backups key cannot read
   — and streams it, through the server's engine over SSH, into a one-off
   container of the backups image on the stack's network, which closes the database to new connections, ends the
   open ones, and recreates it from the file as the stack's superuser.

`--at` takes a run's folder, or a time for the newest run at or before it.

### Importing a database

Moving an existing database onto a compose stage — from RDS, another host, or
an older layout — goes through the same command. The data has to land after
the stack and its roles exist and before the next deploy migrates, so a
prepared file is kept beside the stage's runs, in its own `imports/` folder,
and loaded with `--from`:

```
gkm/<project>/<stage>/backups/imports/app.sql.gz
```

`backup:list` shows what is in `imports/` under the runs, apart from them:
`--latest` never picks an import, and the stage's expiry never deletes one.

1. **Prepare the file offline.** Restore the source dump into a scratch
   Postgres, migrate it to the stack's latest migration, and compare a
   schema-only dump of it with a fresh build of the stack, so its rows fit
   the schema the deploy made. Then dump it **data only**, as plain SQL,
   leaving out the migration bookkeeping tables, wrapped in one transaction
   that empties the stack's tables first, and gzip it:

   ```sql
   BEGIN;
   SET LOCAL session_replication_role = replica;  -- FK triggers off for the load
   -- empty every table but the migration bookkeeping, so the first deploy's
   -- seed rows don't collide
   DO $$ DECLARE t text; BEGIN
     SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') INTO t
     FROM pg_tables
     WHERE schemaname IN ('public') AND tablename !~ '^(kysely_migration|knex_migrations)';
     EXECUTE 'TRUNCATE ' || t;
   END $$;
   -- pg_dump --data-only -n public --exclude-table='kysely_migration*'
   COMMIT;
   ```

   A data-only file keeps the schema the stack's migrations built and brings
   only rows; a `--create` dump would replace that schema with the source's,
   drift included.
2. **Upload it** to `<backups prefix>/imports/`, with the stage account's
   credentials: `aws s3 cp app.sql.gz s3://<project bucket>/gkm/<project>/<stage>/backups/imports/`.
3. **Deploy once**, so the stack, its databases and its roles exist.
4. **Load it:**

   ```bash
   gkm backup:restore --stage production --from imports/app.sql.gz --database database
   ```

5. **Deploy again**: provision, the pending migrations, and the seeds.

`--from` is relative to the stage's backups prefix and must name a
`.sql.gz` file in `imports/` — a path that leaves it (`..`, an absolute path, a
URL) fails with `ImportPathInvalid`. One file loads one database, so
`--database` is required (`ImportNeedsDatabase`), and `--from` stands in for
`--at`/`--latest`, never beside them.

A data-only file has to run connected to the database it loads, so the
database cannot be closed to connections the way a run's restore closes it.
After asking and taking a fresh backup, `--from` instead:

1. stops every container of the stack but its infrastructure — Postgres, the
   backups container, the proxy and the other services the stack runs — so no
   app, worker or processor is connected or reconnects;
2. ends any other session still open on the database;
3. runs the file inside it, as the stack's superuser, in one transaction
   (`psql --single-transaction -v ON_ERROR_STOP=1`): a file that fails halfway
   changes nothing;
4. starts the stopped containers again — whether the load worked or not. If
   they will not start, `AppsNotRestarted` names them, for `docker start` on
   the server, or the next deploy.

**Seeds run over imported rows.** The deploy after an import migrates and runs
every seed on top of what was loaded, so a seed must match an existing row by
its natural key — a name, an identifier — and keep that row's id. A seed that
upserts with an id taken from the stage's secrets rewrites the row to
whatever the stage holds, so the stage's secrets have to carry the source's
values before that deploy.

The local stage takes no backups, so `--from` runs only where `backup:restore`
does: a deployed compose stage.

## Destroying a stage

`--down` stops a stage and keeps everything. `--destroy` deletes what the
stage's deploys made, for good:

```bash
gkm compose --stage production --destroy --dry-run   # what it would delete
gkm compose --stage production --destroy             # delete it — asks first
gkm compose --stage production --destroy --secrets   # its secrets too
```

```
🧨 This deletes stage 'production' of shop for good:

   - on deploy@203.0.113.10: stack shop-production — its containers, its volumes and their data, its routes on gkm-edge
   - CloudFront distribution E2ABC… (uploads.shop.example.com)
   - CloudFront origin access control gkm-shop-production-uploads-server
   - CloudFront response headers policy gkm-shop-production-uploads-server-cors
   - ACM certificate uploads.shop.example.com (us-east-1)
   - IAM user gkm-shop-production-uploads, its access keys and policies
   - S3 bucket shop-production-uploads, emptied first: 1204 object versions
   - DNS: A shop.example.com, A api.shop.example.com, CNAME uploads.shop.example.com, …

   Left where it is:
   · ses-receipt-rule gkm-shop-production-inbox — gkm does not delete a ses-receipt-rule yet: delete it by hand

   Type shop-production to destroy it:
```

**It asks, every time.** The whole plan is printed, then the compose project's
name, `<project>-<stage>`, has to be typed back. No flag answers it, and with
no terminal to ask at (in CI, from a script) it refuses before it reads
anything. Only `--dry-run` runs anywhere.

**It deletes only what it can prove is the stage's.** A deploy records what it
found as well as what it made: a certificate someone requested for the host, a
bucket that existed. So each AWS resource is checked against gkm's own mark
before it is deleted: the `gkm:project` and `gkm:stage` tags (on a bucket, a
user, a certificate, a topic, a queue), the `gkm <project> <stage> <server>`
comment on a distribution, and the stage's own name on an origin access
control or a headers policy. What fails the check is listed under **Left where
it is**, and so is everything a distribution that stays still uses. A DNS
record is deleted only while it holds the value gkm wrote, so a name pointed
elsewhere since is kept. That includes the CDN's name and its certificate's
validation record, which the stage's state never recorded.

**The order is the one AWS needs**, and a run that stops part way carries on
when it is run again. Each resource is forgotten from the stage's state as soon
as it is gone:

1. the stack: its routes on the shared edge, then its containers and volumes;
2. each distribution, disabled and then deleted once CloudFront has deployed
   that (often 15 minutes), then its origin access control, headers policies
   and certificate;
3. SNS subscriptions, topics and queues;
4. IAM users, with their keys and policies;
5. buckets, emptied first, every version included;
6. DNS records;
7. with `--secrets`, the stage's secrets, wherever its store keeps them.

**What it never touches:**
- what other stages and projects share: the project bucket holding every
  stage's state and backups, the shared Traefik edge, and the server's own
  setup (`gkm compose:server`);
- images in the registry.

The stage's secrets are kept unless you pass `--secrets`, so a deploy of the
stage again reuses its passwords and keys. A custom secrets store needs a
`delete(stage)` for `--secrets` (`SecretsStoreCannotDelete` otherwise).

| Error | What happened |
|---|---|
| `ComposeDestroyNeedsTerminal` | No terminal to type the project's name at. Run it yourself; `--dry-run` works anywhere. |
| `ComposeDestroyNotConfirmed` | What was typed wasn't `<project>-<stage>`. Nothing was deleted. |
| `ComposeDestroyNeedsAwsCredentials` | The stage has AWS resources, and no credentials to delete them with. Supply them as for a deploy. |
| `DistributionStillDeploying` | A disabled distribution was still deploying when the wait ran out. Run it again later; it carries on. |
| `ComposeDestroyConflict` | `--destroy` with `--down`, `--build`, `--pull`, `--push` or `--tag`. |
| `ComposeSecretsNeedsDestroy` | `--secrets` without `--destroy`. |

## Running a script against a deployed stage

A data import, a backfill, a report: run it from a laptop or CI as the app
runs on the stage, from the app's directory.

```bash
cd apps/api
gkm exec --stage production -- node scripts/backfill.ts
gkm exec --stage production --profile acme-prod -- pnpm tsx scripts/report.ts
```

- **The environment is the container's.** It is derived the way the deploy
  derives it, from the stage's secrets, read from the stage's store the way
  the deploy reads them (`--profile` names the AWS profile for an S3, SSM or
  Secrets Manager store). The app's own keys — its database login, its bucket
  key, its public URLs — and those of each worker built from it.
- **Databases go through SSH tunnels.** Each service the environment names
  that the server publishes on its loopback — Postgres, MinIO — is reached
  through an SSH tunnel on the deploy's own login, the one the deploy
  migrates through, and its URL points at `127.0.0.1:<local port>`. A sibling
  app is reached at its public address. A service the server does not
  publish (the stack's Redis) keeps its address, and gkm says so.
- **Nothing is written to disk.** The values exist only in the command's
  environment; its `Credentials` are filled from there.
- **The tunnels close when the command exits** — on success, failure or
  Ctrl-C — and `gkm exec` exits with the command's code.
- **A protected stage asks first.** `--yes` runs without asking, for CI.
- **Your own SSH login.** The server is reached as
  `deploy.compose.server.<stage>.user` by default. Where only CI holds that
  key, `--ssh-user <you>` logs in as you instead. That login needs Docker
  (the server's `docker` group) and TCP forwarding.

The stage must have been deployed: one whose secrets lack what its first
deploy generates is refused with `ExecStageNotDeployed`, since what its apps
run with is not decided yet.

## Connecting to a deployed stage's database

`gkm exec --stage` runs a script as the app, with the app's own login. To sign
in to the database yourself, from `psql` or a SQL client, as its owner, use
`gkm db:tunnel`:

```bash
gkm db:tunnel --stage production            # every database
gkm db:tunnel --stage production Database   # one construct
```

```
🚇 'production' postgres → 127.0.0.1:61234 (over SSH to 203.0.113.10)

🔑 Database (DATABASE_OWNER_URL)
   postgresql://database_production_owner:…@localhost:61234/…

The tunnel is open. Press Ctrl-C to close it.
```

- **The deploy's own tunnel.** Postgres is published on the server's loopback
  alone. The tunnel is SSH on the deploy's login, or yours with `--ssh-user`.
- **The owner's login, printed in full.** It's the same URL the deploy's
  migrations connect with, derived from the stage's secrets. Nothing is
  stored, and nothing is written to disk. The owner can create, alter and
  drop, so a protected stage asks first. `--yes` skips the question.
- **Open until Ctrl-C.** The URL works only while the tunnel is open.

## What is not included yet

- **Mobile apps** ship through their own toolchain and are skipped.
