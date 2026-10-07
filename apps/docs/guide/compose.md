# Deploy with Docker Compose

`gkm compose` runs a workspace's APIs and sites for one stage as a single
Docker Compose stack on one machine, with [Caddy](https://caddyserver.com) in
front serving every app over HTTPS.

```bash
gkm compose --stage development         # the local stage, built from this checkout
gkm compose --stage production --tag v1.4.0   # the images CI pushed as v1.4.0
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
- **The infrastructure those apps declared** — Postgres with a named volume,
  holding every declared database, a database-backed cache's table and
  pg-boss's schema.
- **Mail and object storage, on the local stage**: Mailpit, and MinIO with
  every declared bucket (and its file servers' open paths) created before any
  app starts. Nothing needs setting — no bucket URL, no mail server. A
  deployed stage brings its own; see
  [Mail and storage on a deployed stage](#mail-and-storage-on-a-deployed-stage).
- **One Caddy**, one host per app — and one per file server over the stack's
  MinIO (`https://uploadsserver.<project>.localhost` locally), rewriting to its
  bucket the way `gkm dev`'s edge does.

The databases, roles and grants are created, and each database's migrations
(`db/<construct>/migrations`) applied, before any app starts — so an app never
boots against a schema that is not there yet.

A stack is a server target: whatever `deploy.default` says, its cache lives in
the declared database and its events go through pg-boss beside it.

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
target pushes to and pulls from; without one, image names have no registry
prefix.

Each run records, per app, the image ref, the tag it ran and the digest that
tag resolved to (for an image built here and never pushed, its image id) in the
stage's deploy state, under `images` — the same record a Dokploy deploy keeps —
so "what is this stage running" has an exact answer.

### A site's tag is `<tag>-<stage>`

A site's public URLs (`VITE_API_URL`, `NEXT_PUBLIC_AUTH_URL`) are inlined into
its bundle when it is built, so one site image serves one stage. A backend
reads its URLs at runtime, so one backend image serves every stage.

So for a release, CI pushes:

| App | Image |
| --- | --- |
| an API | `ghcr.io/acme/shop/shop-api:v1.4.0` |
| a site, per stage | `ghcr.io/acme/shop/shop-web:v1.4.0-production`, `…:v1.4.0-staging` |

and `gkm compose --stage production --tag v1.4.0` pulls exactly those. A site
built by `gkm compose` without a tag is tagged `<commit>-<stage>` the same way.

## Building

Every image is built inside Docker, from the same Dockerfiles `gkm docker`
writes, and nothing is built on this machine first. Each prunes the build root
to its app's slice with `turbo prune`, installs it, builds the workspace
packages the app depends on, and then the app: a backend by `gkm build
--provider server --production` — one file, no dependencies, in a slim
runner — and a site by its framework, with its public URLs passed as **build
args**. A site's container gets no server environment and waits on no
database.

A backend's environment is embedded in its image encrypted: handed to the
build as the `gkm_credentials` BuildKit secret (`<app>.credentials`, mode
`0600`, beside the stack) and decrypted at runtime with the `GKM_MASTER_KEY`
its env file holds — the way a Dokploy deploy builds one.

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
api.credentials      when building: a backend's encrypted environment, mode 0600
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
- connection strings to the stack's own Postgres;
- `PORT`, `STAGE` and `NODE_ENV=production`;
- its secrets and credentials, from the stage's secrets store.

A secret an app does not read is never written to its file. Images stay
stage-agnostic: no secret is baked into one. Compose reads the files raw, so
nothing in a value is interpolated.

For a deployed stage, everything the stage generates once — its seed, each
`Secret`'s value, each encryption keyring — is generated on the first run and
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
| `validate` | the stack, worked out from the manifest; with a tag, every image looked up in the registry |
| `plan` (`--dry-run`) | the files written, and what a run would build, pull and start — nothing else |
| `provision` | the stage's generated secrets kept, the files written, the infrastructure started, its databases, roles, grants and migrations applied |
| `build` | every image built inside Docker — or, with a tag, pulled |
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
| a bucket, `ObjectStorage('Uploads')` | `UPLOADS_URL` (`s3://bucket?region=…`, with `&endpoint=…` for R2 or any S3-compatible store), and `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` — one pair, read beside every bucket's URL |
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

## Auth and trusted origins

An auth server (`BetterAuth`) checks the origin of every state-changing
request — a sibling service's included, not only a browser's. Its
`<ID>_TRUSTED_ORIGINS` lists the public origin of every app that declared an
edge to it and, for each API among them, that API's **internal** origin on the
compose network (`http://api:3000`), so a service calling it across the
network is not rejected. The session cookie's domain is the parent the public
hosts share (`.example.com`), so the site and the APIs all see the session.

## What is not included yet

- **Workers.** Crons, queue consumers and topic subscribers belong to a
  `Worker`, and a RestApi's production image serves HTTP only. A stack runs no
  background work yet.
- **Mobile apps** ship through their own toolchain and are skipped.
- **A remote Docker host.** Provisioning and migrations connect to the stack's
  Postgres from this machine on a loopback port, so run `gkm compose` on the
  machine that hosts the stack.
