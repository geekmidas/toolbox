# Project Structure

## A scaffolded project

`gkm init` lays out a single-app project like this:

```
my-api/
├── gkm.config.ts              # constructs glob, routes glob, backends
├── src/
│   ├── constructs/            # what this app declares
│   │   ├── database.ts        # KyselyDatabase — why a Postgres exists
│   │   ├── storage.ts         # ObjectStorage — why a MinIO exists
│   │   ├── cache.ts           # Cache
│   │   └── email.ts           # Email — why a Mailpit exists
│   ├── endpoints/             # the routes glob
│   │   ├── health.ts
│   │   └── users/
│   ├── db/migrations/         # applied by kysely-ctl or the test setup
│   ├── router.ts              # the shared endpoint factory
│   └── config/
│       ├── env.ts             # EnvironmentParser + Credentials
│       └── logger.ts
├── test/                      # transaction-isolated suite + factories
└── .gkm/                      # generated — compose, secrets, manifest
```

Two directories carry the model:

- **`src/constructs/`** — one file per declaration. Everything else derives from
  what is here: the containers `gkm dev` starts, the env keys the build writes,
  and the cloud resources a deploy provisions.
- **`src/endpoints/`** — the handlers, which reach those declarations by edge
  (`.dependsOn([…])`) rather than by env key.

`.gkm/` is generated and gitignored except for `secrets/`, which is encrypted
and safe to commit.

::: tip One glob, every kind
`constructs: './src/constructs/**/*.ts'` is a convention, not a requirement —
discovery inspects every export of every matching module and keeps the ones with
an `id` that can `declare()`. Point it at `./src/**/*.ts` and colocate a bucket
with the feature that uses it if you prefer.
:::

## A workspace

```
my-saas/
├── gkm.config.ts              # defineWorkspace — apps, backends, deploy
├── apps/
│   ├── api/
│   │   ├── src/constructs/    # this app's declarations
│   │   └── src/endpoints/
│   ├── auth/
│   └── web/
└── packages/
    ├── models/                # shared schemas
    └── ui/
```

Each app's `constructs` glob resolves against that app's own path, and reconcile
reads all of them into one manifest. Apps share infrastructure by declaring
derived forms of it — `database.schema()` for a schema of its own,
`database.reader()` for read-only access — never by agreeing on a URL string.

## The toolbox repo itself

```
toolbox/
├── packages/
│   ├── constructs/    # endpoints, functions, crons, and the resource constructs
│   ├── manifest/      # declarations, naming, derivation — the build/run seam
│   ├── cli/           # gkm: reconcile, dev, build, deploy
│   ├── cloud/         # deploy targets
│   └── …              # audit, auth, cache, db, envkit, errors, events, …
├── apps/
│   ├── docs/          # this site
│   └── example/       # a worked v10 app
├── docs/design/       # the design docs, including the constructs paradigm
└── turbo.json
```

Built with **tsdown** (ESM + CJS), orchestrated by **Turbo**, linted and
formatted by **Biome**.

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```
