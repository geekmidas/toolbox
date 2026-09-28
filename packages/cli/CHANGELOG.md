# @geekmidas/cli

## 10.0.0-alpha.14

### Patch Changes

- 🔥 [#66](https://github.com/geekmidas/toolbox/pull/66) [`5235875`](https://github.com/geekmidas/toolbox/commit/52358754906af071a40d29dcbd4c28e25887d5e1) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm generate:react-query` is removed, and with it the `openapi-typescript` dependency

  It read an `openapi.json` and shelled out to `npx openapi-typescript`. Each
  surface's typed client is written by `gkm build` (and kept current by
  `gkm dev`) to `.gkm/openapi/<surface>.ts`, built from the endpoints
  themselves: its `createApi()` returns a typed fetcher with React Query hooks.
  Verified against openapi-typescript on kitchen-sink's endpoints, its types
  match. Import that file instead. The `@geekmidas/cli/openapi-react-query`
  export is gone too.

- [#62](https://github.com/geekmidas/toolbox/pull/62) [`db9cc57`](https://github.com/geekmidas/toolbox/commit/db9cc57ce5fa0ec5529ec5a01b33fbedf8848493) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm init` installs `pino` only for the pino logger

  The API, minimal, serverless and worker templates listed `pino` among their
  dependencies whatever logger was chosen, so a console-logger project installed
  a logging library it never imports. `pino` is now added only when the pino
  logger is picked, beside the `@geekmidas/logger/pino` import it serves.

- Updated dependencies [[`9602a19`](https://github.com/geekmidas/toolbox/commit/9602a19a9b4fb9cecd2641d108976f73272df55e)]:
  - @geekmidas/schema@10.0.0-alpha.14
  - @geekmidas/constructs@10.0.0-alpha.14
  - @geekmidas/cache@10.0.0-alpha.14
  - @geekmidas/db@10.0.0-alpha.14
  - @geekmidas/envkit@10.0.0-alpha.14
  - @geekmidas/errors@10.0.0-alpha.14
  - @geekmidas/logger@10.0.0-alpha.14
  - @geekmidas/manifest@10.0.0-alpha.14
  - @geekmidas/telescope@10.0.0-alpha.14

## 10.0.0-alpha.13

### Patch Changes

- [#58](https://github.com/geekmidas/toolbox/pull/58) [`07d1827`](https://github.com/geekmidas/toolbox/commit/07d1827bb0a2a76d04a0fc25a7517df282004137) Thanks [@geekmidas](https://github.com/geekmidas)! - The build and test toolchain moves to its latest versions (tranche 2)
  - **tsx 4.23, tsdown 0.23.** The CLI runs TypeScript through tsx, so its
    `tsx` dependency moves with it.
  - **Vite 8, `@vitejs/plugin-react` 6** for the Studio and Telescope UIs, which
    ship inside those packages.
  - **Vitest 5.** `@geekmidas/testkit` and `@geekmidas/db` require `vitest ~5.0.2`,
    so a project on an older Vitest needs to move with them. A fresh `gkm init`
    already ships Vitest 4+; the scaffold's pin follows with #43.

- Updated dependencies [[`07d1827`](https://github.com/geekmidas/toolbox/commit/07d1827bb0a2a76d04a0fc25a7517df282004137)]:
  - @geekmidas/db@10.0.0-alpha.13
  - @geekmidas/telescope@10.0.0-alpha.13
  - @geekmidas/constructs@10.0.0-alpha.13
  - @geekmidas/cache@10.0.0-alpha.13
  - @geekmidas/envkit@10.0.0-alpha.13
  - @geekmidas/errors@10.0.0-alpha.13
  - @geekmidas/logger@10.0.0-alpha.13
  - @geekmidas/manifest@10.0.0-alpha.13
  - @geekmidas/schema@10.0.0-alpha.13

## 10.0.0-alpha.12

### Patch Changes

- 🔥 [#57](https://github.com/geekmidas/toolbox/pull/57) [`b4a95b6`](https://github.com/geekmidas/toolbox/commit/b4a95b68433c0906fcc06e6c5fdff1a80af06166) Thanks [@geekmidas](https://github.com/geekmidas)! - Delete the `services` block from `gkm.config`. Whether a resource exists is its
  construct; which backend serves it follows the deploy target (cache: a table on
  a server, Upstash on AWS; events: pg-boss on a server, SNS/SQS on AWS; storage:
  MinIO / S3); mail is whatever `MAIL_URL` names. The config schema is now strict,
  so a leftover `services` key — or any unknown key — fails to load instead of
  being ignored.

  Compose is now two files. `docker-compose.constructs.yml`, at the project root,
  is generated from the construct plan by `gkm dev`, `gkm test`, `gkm setup` and
  `gkm docker`, and is gitignored. The project's own `docker-compose.yml` is
  merged over it (`-f docker-compose.constructs.yml -f docker-compose.yml`), so
  image pins and extra services live there. `gkm docker` puts each app in the
  same file behind the `apps` profile, wired to every construct's own keys
  (`ORDERS_URL`, a schema tenant's URL) instead of a hardcoded `DATABASE_URL` /
  `REDIS_URL`. `docker.compose.services`, `generateDockerCompose` and
  `generateMinimalDockerCompose` are gone.

  `gkm init` asks which constructs to declare instead of which services to run,
  and writes no compose file. `trustLocalCa` is gone from the config: trusting
  the local CA is per machine — `gkm trust`, or `gkm setup --yes`.

  Migrating: delete `services` from `gkm.config.ts` and `docker.compose` from any
  app config; move image pins into a `docker-compose.yml`; add
  `docker-compose.constructs.yml` to `.gitignore`.

- [#56](https://github.com/geekmidas/toolbox/pull/56) [`abe60e1`](https://github.com/geekmidas/toolbox/commit/abe60e129feb34f1cb38e7bdf4de17e050bb7307) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm init` takes every third-party version from one place, and a construct edit invalidates cached builds

  Scaffold versions were hardcoded across the templates and generators and had
  never been reviewed against latest. They now all come from
  `init/dependencies.ts`, in three groups: current dependencies (inside every
  `@geekmidas` peer range), the build and test toolchain (held at its current
  versions until tranche 2, #40, moves it), and the Expo SDK 55 set. A scan test
  fails on any version literal outside that file.

  Scaffolds get Turbo 2.11. Turbo 2.3 ignored `$TURBO_ROOT# @geekmidas/cli, so the per-app
`turbo.json`files`gkm build`generated never hashed the root constructs:
editing`constructs/database.ts`replayed a stale cached build. The root`turbo.json`that`init`writes now declares those inputs once for every
package, and`gkm build`no longer writes`apps/\*/turbo.json`.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.12
  - @geekmidas/constructs@10.0.0-alpha.12
  - @geekmidas/db@10.0.0-alpha.12
  - @geekmidas/envkit@10.0.0-alpha.12
  - @geekmidas/errors@10.0.0-alpha.12
  - @geekmidas/logger@10.0.0-alpha.12
  - @geekmidas/manifest@10.0.0-alpha.12
  - @geekmidas/schema@10.0.0-alpha.12
  - @geekmidas/telescope@10.0.0-alpha.12

## 10.0.0-alpha.11

### Patch Changes

- [#52](https://github.com/geekmidas/toolbox/pull/52) [`e0762b2`](https://github.com/geekmidas/toolbox/commit/e0762b20d07014537952c99ae7e3691de353821c) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm deploy:github --stage <stage> --profile <aws-profile>`: GitHub Actions deploys a stage without AWS keys

  Run once per stage, with the profile for that stage's account. It creates
  GitHub's OIDC provider in the account if missing, and a role
  `<project>-github-<stage>` that only the repository's `<stage>` environment can
  assume (`AdministratorAccess` unless `--policy-arn`), then creates that GitHub
  environment with `AWS_ROLE_ARN` and `GKM_SECRETS_KEY`. The profile is resolved
  on its own — SSO included — and never replaced by `AWS_*` in the environment.
  `--dry-run` prints the plan.

  Stage and init failures are named errors now (`InvalidStages`,
  `UndeclaredStage`, `UnknownDeployTarget`, `NotAnAwsRegion`, `NoStageToTest`,
  `SsoSessionExpired`), not bare `Error`s.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.11
  - @geekmidas/constructs@10.0.0-alpha.11
  - @geekmidas/db@10.0.0-alpha.11
  - @geekmidas/envkit@10.0.0-alpha.11
  - @geekmidas/errors@10.0.0-alpha.11
  - @geekmidas/logger@10.0.0-alpha.11
  - @geekmidas/manifest@10.0.0-alpha.11
  - @geekmidas/schema@10.0.0-alpha.11
  - @geekmidas/telescope@10.0.0-alpha.11

## 10.0.0-alpha.10

### Patch Changes

- [#51](https://github.com/geekmidas/toolbox/pull/51) [`b7a16c9`](https://github.com/geekmidas/toolbox/commit/b7a16c9ab735dc32fb25588e394e99cf58d7243d) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm init` ships GitHub Actions: CI, a release drafter, and a deploy workflow

  Every scaffold gets `.github/workflows/ci.yml` (pull requests: install, build,
  lint, typecheck, `test:once` with `GKM_AUTO_SETUP=1`) and a release drafter
  that labels pull requests from their titles. With a deploy target it also gets
  `deploy.yml`: a push to main deploys the stages that are not protected, and
  publishing the drafted release deploys the protected ones. It reads `stages`
  from `gkm.config.ts` when it runs rather than naming any, deploys each stage in
  the GitHub environment of the same name — `GKM_SECRETS_KEY`, plus
  `AWS_ROLE_ARN` (OIDC) for SST or `DOKPLOY_API_TOKEN` / `DOKPLOY_ENDPOINT` for
  Dokploy — and follows the project's package manager.

- ⬆️ [#50](https://github.com/geekmidas/toolbox/pull/50) [`665ab5e`](https://github.com/geekmidas/toolbox/commit/665ab5e975359f787e5d14625088557db3ca3ff5) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm upgrade` follows the release line a project is on, and never goes backwards

  It read npm's `latest` tag, which is 9.x while 10 is in prerelease: it could
  not reach a 10 alpha, and on a project already on one it proposed 9.0.2 — a
  downgrade — because it compared version text rather than versions. It then ran
  `pnpm update --latest`, and never touched pnpm catalogs.

  Now the target is the dist-tag of the line the project is on (`alpha` for
  `10.0.0-alpha.x`), or `--tag`. A target behind what is installed is refused.
  Without `--all` only `@geekmidas/cli` moves; with it, every `@geekmidas`
  package moves to the one shared version, and third-party packages the project
  lists are raised to the floor of the peer ranges that version declares. Ranges
  keep their `^`/`~`/`>=`, pnpm `catalog:` entries are rewritten in place,
  `workspace:` references and hand-written ranges are left alone, and one
  install runs at the end.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.10
  - @geekmidas/constructs@10.0.0-alpha.10
  - @geekmidas/db@10.0.0-alpha.10
  - @geekmidas/envkit@10.0.0-alpha.10
  - @geekmidas/errors@10.0.0-alpha.10
  - @geekmidas/logger@10.0.0-alpha.10
  - @geekmidas/manifest@10.0.0-alpha.10
  - @geekmidas/schema@10.0.0-alpha.10
  - @geekmidas/telescope@10.0.0-alpha.10

## 10.0.0-alpha.9

### Patch Changes

- [#48](https://github.com/geekmidas/toolbox/pull/48) [`36f4586`](https://github.com/geekmidas/toolbox/commit/36f45865df512bf473469914b7a50c198e47135e) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm init` asks where the project deploys: Dokploy, AWS through SST, or later

  AWS (SST) was missing from the choices. Picking it asks for the AWS region
  and writes an `sst.config.ts` that hands the manifest `gkm build --provider
aws` writes to `@geekmidas/cloud`'s `fromManifest`, plus a `deploy` script,
  `sst`, and the packages `@geekmidas/cloud/sst` imports. The database gets a
  VPC, and a project that sends mail reads its SES sender from `MAIL_FROM`.

  `--deploy <dokploy|sst|none>` and `--region` answer the questions without
  prompting. `--yes` now picks no deploy target rather than Dokploy, and
  `eu-west-1` when `--deploy sst` is given without a region.

  **Stages are declared, not assumed.** `gkm.config.ts` now requires
  `stages: { local, deployed, protected? }`, and every command reads it: `gkm
dev`, `exec`, `setup` and `test` run as `stages.local` (it was `development`,
  after looking for `dev` secrets first), reconcile leaves only the local stage's
  resources unsuffixed, and `gkm deploy --stage` refuses a stage that is not in
  `deployed`. The config is checked: names fit a physical name, `test` is
  reserved for `gkm test`, the local stage is never also deployed (they would
  share secrets), and `protected` is a subset of `deployed`.

  `gkm init` asks for them by name — the deployed stages, which one is
  production, and the local stage (`--stages`, `--protected-stage`,
  `--local-stage`) — and derives from them the local secrets it seeds, a
  `deploy:<stage>` script per deployed stage, SST's retain/protect list, and the
  scaffolded `STAGE` enum.

  **Migrating:** add `stages` to `gkm.config.ts`. To keep existing local
  secrets, name the local stage after the file they are in — `local:
'development'` for `.gkm/secrets/development.json` — or rename that file and
  its key in `~/.gkm/<project>/` to the new name.

  `gkm init` formats what it writes. It ran `biome format --write --unsafe`,
  which Biome 2 rejects, and swallowed the error, so scaffolds kept the
  generators' double quotes; it now runs the project's own `biome check --write`
  and says so if that fails.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.9
  - @geekmidas/constructs@10.0.0-alpha.9
  - @geekmidas/db@10.0.0-alpha.9
  - @geekmidas/envkit@10.0.0-alpha.9
  - @geekmidas/errors@10.0.0-alpha.9
  - @geekmidas/logger@10.0.0-alpha.9
  - @geekmidas/manifest@10.0.0-alpha.9
  - @geekmidas/schema@10.0.0-alpha.9
  - @geekmidas/telescope@10.0.0-alpha.9

## 10.0.0-alpha.8

### Patch Changes

- [#47](https://github.com/geekmidas/toolbox/pull/47) [`e49677e`](https://github.com/geekmidas/toolbox/commit/e49677e31780d2f0d91c54d9cb7ecc750b97446e) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm init` names what it declares plainly: `Database`, `Cache`, `Uploads`, `Mail`

  The scaffold named them after the project — `new Cache('BeetlefitCache')`,
  `new KyselyDatabase<Database, 'Beetlefit'>('Beetlefit')` — but the workspace
  `name` already scopes every physical name, so the cache deployed as
  `production-beetlefit-beetlefit-cache`. The ids are now plain, and so are the
  keys they publish: `DATABASE_URL`, `DATABASE_OWNER_URL`, `CACHE_URL`,
  `UPLOADS_URL`, `MAIL_URL`.

  Existing projects are unaffected; a project scaffolded before this keeps its
  ids until it renames them.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.8
  - @geekmidas/constructs@10.0.0-alpha.8
  - @geekmidas/db@10.0.0-alpha.8
  - @geekmidas/envkit@10.0.0-alpha.8
  - @geekmidas/errors@10.0.0-alpha.8
  - @geekmidas/logger@10.0.0-alpha.8
  - @geekmidas/manifest@10.0.0-alpha.8
  - @geekmidas/schema@10.0.0-alpha.8
  - @geekmidas/telescope@10.0.0-alpha.8

## 10.0.0-alpha.7

### Patch Changes

- [#39](https://github.com/geekmidas/toolbox/pull/39) [`960425f`](https://github.com/geekmidas/toolbox/commit/960425f73bc99ab0304c8ef2d22c7e98ca8313a4) Thanks [@geekmidas](https://github.com/geekmidas)! - A surface has no `app`, and `gkm init --template fullstack` builds

  `RestApi` and `BetterAuth` no longer take an `app` block, and the manifest's
  `rest-api` declaration loses it too. The one thing the block carried that the id
  does not — whether the surface streams into a Telescope — is `telescope: true`
  on the declaration itself.

  `RestApi`, `BetterAuth` and `StaticSite` take a required `path`: the app that
  serves them, relative to the workspace root (`'apps/api'`, or `'.'` in a
  single-app project). It was inferred from the id — `apps/<kebab-id>` if that
  directory existed, the root otherwise — so an app's home was whatever happened
  to be on disk. `BetterAuth`'s `basePath` is unchanged and still means the URL
  its routes are mounted at. `path` does not change discovery.

  Constructs, and the endpoints built from them, are loaded from the workspace's
  `constructs` glob. `gkm init` writes one that reaches every app laid out the
  way it was told — `'./apps/*/src/endpoints/**/*.ts'` for the default layout —
  rather than naming the API's directory. An endpoint belongs to the surface it
  was built from, not to the directory its file is in: each app's build now keeps only the endpoints
  built from the surface that app serves. Before this, every build in a workspace
  guessed the same surface and kept every endpoint the glob found — so an auth
  server's build would have served the API's routes.

  Every module's path aliases resolve through the tsconfig beside it. tsx applies
  the tsconfig of the directory a command ran from to the whole process, so a
  glob that reaches every app resolved `~/router.ts` in `apps/api` through
  `apps/web`'s `~` — silently, to the wrong file — when the command ran there.

  The fullstack scaffold did not build. What it gets now:
  - **The root `constructs/` folder's dependencies at the root**, where it
    resolves them: `@geekmidas/constructs` and the peers each declared construct
    needs. The root tsconfig allows the `.ts` imports they use.
  - **An API tsconfig that maps `@<name>/constructs/*`**. Only the `--monorepo`
    copy did; in the fullstack one it fell through to `packages/*/src`.
  - **An auth app built by `gkm`**, since its entry is generated from the
    `BetterAuth` construct — not `tsc` over a `src/` that no longer exists.
  - **Third-party ranges inside the packages' peer ranges**, kept in one place:
    Kysely 0.29, Hono 4.13, Better Auth 1.7 on the server and every client, pino
    10, Zod 4.6, kysely-ctl 0.21.
  - **A client the site can import**: `./client` points at the per-surface
    `.gkm/openapi/api.ts`, and the API depends on what that file imports.
  - 💄 **UI barrel imports that resolve** to `<name>/index.tsx`.
  - **A Next.js site that typechecks**: no project `references` to packages that
    are not `composite`, which made its `tsc --noEmit` fail with TS6306.
  - **A Biome config Biome 2 accepts**: `assist` and `files.includes` rather than
    the 1.x `organizeImports` and `files.ignore`, and Tailwind directives parsed.
  - ✅ **Tests that run**: the root Vitest config uses projects, so the API's own
    `globalSetup` runs; the API ships the `users` migration its endpoints and
    that setup expect; the example test asks for testkit's `trx` fixture, and
    hands testkit a connection function.
  - **No `NODE_ENV` among the development secrets.** `gkm exec` injects secrets
    over the environment, so every `gkm exec -- next build` was a development
    build, which Next refuses to prerender.

  `gkm build` in a workspace no longer runs an OpenAPI pass after every app has
  built: each surface's own build already writes its client before anything
  depending on it builds.

  `gkm init shop--monorepo` — a missing space — is refused with the command that
  was meant, instead of scoping every package and physical name under it.

  The release workflow syncs the scaffold's pinned versions after `changeset
version` bumps them, and rebuilds the CLI before publishing; `alpha.6`
  scaffolded `alpha.5`.

- Updated dependencies [[`960425f`](https://github.com/geekmidas/toolbox/commit/960425f73bc99ab0304c8ef2d22c7e98ca8313a4)]:
  - @geekmidas/constructs@10.0.0-alpha.7
  - @geekmidas/manifest@10.0.0-alpha.7
  - @geekmidas/cache@10.0.0-alpha.7
  - @geekmidas/db@10.0.0-alpha.7
  - @geekmidas/envkit@10.0.0-alpha.7
  - @geekmidas/errors@10.0.0-alpha.7
  - @geekmidas/logger@10.0.0-alpha.7
  - @geekmidas/schema@10.0.0-alpha.7
  - @geekmidas/telescope@10.0.0-alpha.7

## 10.0.0-alpha.6

### Major Changes

- [#37](https://github.com/geekmidas/toolbox/pull/37) [`0e99180`](https://github.com/geekmidas/toolbox/commit/0e991805d82c0affae5f12d6d7d31eddd82533fc) Thanks [@geekmidas](https://github.com/geekmidas)! - `c`, `s` and `f` are gone

  The free-standing builders produced a construct with no owner, and an unowned
  construct no longer builds: it has nothing to take a logger or an environment
  parser from, and nothing says which process runs it. Keeping them exported
  meant shipping an API whose only outcome was a build error.

  Everything runnable now comes from the process that runs it, and comes from it
  _directly_ — there is no `crons`, `subscribers` or `functions` namespace to
  reach through:

  ```ts
  export const worker = new Worker('Jobs', { logger }).database(database);

  export const cleanup = worker.cron('rate(1 day)').handle(…);
  export const onUserCreated = worker.topic(users).subscribe(['user.created']).handle(…);
  export const reindex = worker.input(schema).handle(…);
  ```

  The namespaces named a collection in order to reach one member of it, and only
  crons had sugar past them — `worker.cron(schedule)` existed while
  `worker.functions.input(…)` did not. Which kind is being built is decided by
  what is called first: a schedule makes a cron, a topic makes a subscriber, and
  anything else makes a function.

  A worker is not a container — it names which process runs a runnable and what
  logger it runs with — so declaring one costs nothing, and declaring several is
  several groupings rather than several deployments.

  Migration is mechanical: declare a `Worker`, then replace `c` with
  `worker.crons`, `s` with `worker.subscribers` and `f` with `worker.functions`.
  The `.logger(…)` call each of them used to need goes away, because the worker
  carries it.

### Minor Changes

- [#35](https://github.com/geekmidas/toolbox/pull/35) [`26fc832`](https://github.com/geekmidas/toolbox/commit/26fc832910fef9ed6adabfeb76cfb3712219f6e2) Thanks [@geekmidas](https://github.com/geekmidas)! - Crons run on a server target

  A cron used to run on AWS Lambda and nowhere else. `CronGenerator` returned an
  empty array for every other provider, and `.gkm/server/` held `endpoints.ts`,
  `queues.ts` and `subscribers.ts` but no crons — so a scheduled job on a server
  deploy built, deployed, and never fired.

  It now generates `crons.ts` exporting `setupCrons`, which the generated entry
  calls beside `setupSubscribers` and `setupQueues`. Same shape, same place: the
  process that serves the endpoints schedules the crons.

  **The schedule lives in Postgres**, in the database the worker names:

  ```ts
  export const jobs = new Worker("Jobs", { logger }).database(database);
  ```

  pg-boss holds it there, so a deployment running four replicas fires each job
  once — which is what a timer in every process gets wrong and never reports.

  Declared rather than discovered, and no connection string appears anywhere. The
  construct that owns the database is the only thing that knows its key; it is
  resolved through service discovery like any other dependency. Inferring the
  store from whatever database an app happened to declare would work until it
  declared a second, and then move the schedules without saying so.

  **A known limitation of workers.** A worker with crons and no `.database(…)`
  schedules nothing on a server target and reports why at startup. On AWS the
  question does not arise — a cron is an EventBridge rule. The store could as
  well be a cache or something the deploy target provisions; Postgres is what
  exists today.

  `toCronExpression` converts a `ScheduleExpression` to standard cron.
  `cron(…)` unwraps; `rate(n unit)` converts when it divides its unit evenly.
  When it does not — `rate(7 hours)`, whose `*/7` fires at 0, 7, 14, 21 and then
  restarts three hours later — it throws rather than rounding. A job at the wrong
  hour is harder to notice than one that refused to build.

### Patch Changes

- [#37](https://github.com/geekmidas/toolbox/pull/37) [`5492dea`](https://github.com/geekmidas/toolbox/commit/5492dea08655c60529fe4b8a25b7bee4e02ff2fc) Thanks [@geekmidas](https://github.com/geekmidas)! - Projects with storage could not start: the MinIO image needs a login

  MinIO put `quay.io/minio/minio` behind authentication, so every compose file
  the CLI writes (`gkm init`, `gkm setup`, `gkm docker`, deploy) failed at the
  pull with `unauthorized`. The default is now `pgsty/minio`, a community build
  of the same server, pinned at `RELEASE.2026-08-04T00-00-00Z`. It keeps the
  same entrypoint, `mc` and `curl`, so the healthchecks and bucket bootstrapping
  still work. If a project already pins its own MinIO image in config, that pin
  wins.

- 🐛 [#35](https://github.com/geekmidas/toolbox/pull/35) [`f3c5998`](https://github.com/geekmidas/toolbox/commit/f3c59982c992286659e7717c1093e509b2ea942f) Thanks [@geekmidas](https://github.com/geekmidas)! - A single-app scaffold could not resolve its own `~/` imports

  The monorepo and fullstack layouts mapped `~/*` to `./src/*`; a single app did
  not. Every `~/…` import the templates write — the api's `~/router.ts`, the
  worker's `~/constructs/worker.ts` — resolved to nothing, and the project failed
  on its first build with `Cannot find package '~'`.

  Found by building a scaffolded worker rather than by reading the generator,
  which is the only way this kind of thing is found.

- Updated dependencies [[`0e99180`](https://github.com/geekmidas/toolbox/commit/0e991805d82c0affae5f12d6d7d31eddd82533fc), [`26fc832`](https://github.com/geekmidas/toolbox/commit/26fc832910fef9ed6adabfeb76cfb3712219f6e2)]:
  - @geekmidas/constructs@10.0.0-alpha.6
  - @geekmidas/cache@10.0.0-alpha.6
  - @geekmidas/db@10.0.0-alpha.6
  - @geekmidas/envkit@10.0.0-alpha.6
  - @geekmidas/errors@10.0.0-alpha.6
  - @geekmidas/logger@10.0.0-alpha.6
  - @geekmidas/manifest@10.0.0-alpha.6
  - @geekmidas/schema@10.0.0-alpha.6
  - @geekmidas/telescope@10.0.0-alpha.6

## 10.0.0-alpha.5

### Patch Changes

- [#34](https://github.com/geekmidas/toolbox/pull/34) [`faf13c3`](https://github.com/geekmidas/toolbox/commit/faf13c3f3381bfda8fa3cb217d84303ebece5ad1) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm init --template worker` produced a project that did not compile

  Three faults, in a template described as "Background job processing":

  It scaffolded `src/crons/cleanup.ts` importing `{ cron }` from
  `@geekmidas/constructs/crons` — an export that does not exist. The generated
  project failed to resolve on first build.

  It declared a `RestApi` with no endpoints on it: an HTTP surface, in a project
  whose premise is that nothing calls it over HTTP. A surface was the only
  construct that made an app exist and the only way to get a logger into the
  generated runtime, so one was written for that reason alone. It is built from
  `Worker` now — no authorizer, no address, and its factories carry its logger,
  so a subscriber file opens with what it subscribes to.

  Its subscriber destructured `event` where the handler is passed `events`, a
  batch. Both transports deliver in batches.

  It also scaffolds no cron any more. `CronGenerator` emits handlers for
  `aws-lambda` only and `.gkm/server/` has no crons file, so a scheduled job on a
  server target deploys nothing at all — an example that teaches a feature which
  silently does not happen is worse than no example. Subscribers and queues do
  have a server runtime, and are what the template teaches until there is a
  scheduler to run a cron.

  `apps/example` is removed in the same change: it still declared `routes`,
  `envParser` and `logger`, a config shape v10 does not read, and nothing
  typechecked it because `apps/` is absent from the root tsconfig's references.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.5
  - @geekmidas/constructs@10.0.0-alpha.5
  - @geekmidas/db@10.0.0-alpha.5
  - @geekmidas/envkit@10.0.0-alpha.5
  - @geekmidas/errors@10.0.0-alpha.5
  - @geekmidas/logger@10.0.0-alpha.5
  - @geekmidas/manifest@10.0.0-alpha.5
  - @geekmidas/schema@10.0.0-alpha.5
  - @geekmidas/telescope@10.0.0-alpha.5

## 10.0.0-alpha.4

### Patch Changes

- [`dce9588`](https://github.com/geekmidas/toolbox/commit/dce958803067a24ec3c9ecbba2c76fd00d971904) Thanks [@geekmidas](https://github.com/geekmidas)! - Every package now agrees on every dependency version

  One hundred dependencies were realigned so that each has a single range per
  field across the repo. Thirty had disagreed with themselves — `hono` carried
  four different peer ranges, `@types/pg` four dev ranges, `@middy/core` four of
  each — which meant two packages could install two copies of the same library
  and behave differently for reasons nobody had chosen.

  Twenty-three were major bumps, and three of them broke something real:

  **OpenTelemetry 1.x → 2.x** removed `addSpanProcessor` and
  `BasicTracerProvider.register()`. Processors are constructor-only now, because a
  provider whose pipeline could be re-plumbed after it had begun producing spans
  was never safe. `NodeTracerProvider.register()` survives and is still the right
  call where the async-hooks context manager is wanted.

  **Zod 4.1 → 4.6** exposed a generator bug rather than causing one. A schema that
  _is_ a registered schema now converts to a bare `$ref` where it used to be
  inlined, and `OpenApiTsGenerator` turned that into `export type User = User` — a
  circular alias that is not a type. The def it points at was already being
  emitted; the generator now leaves the declaration to it. 4.6 also collapses a
  union of primitives to a `type` array instead of `anyOf`, which is the 2020-12
  spelling this project already emits.

  **better-auth 1.7** removed `runAdapterTest`, the conformance harness
  `memoryAdapter` was tested with. There is nothing to repair — the API is gone —
  so that suite is skipped with the gap recorded rather than deleted, because a
  deleted file would not say that `memoryAdapter` now has no test.

  Not included: the build and test toolchain — TypeScript, Vitest, Vite,
  Storybook — and `expo-secure-store`, whose version tracks an Expo SDK release
  train. Those replace how every package compiles and runs, and belong where a
  failure has one candidate cause instead of twenty-eight.

- Updated dependencies [[`dce9588`](https://github.com/geekmidas/toolbox/commit/dce958803067a24ec3c9ecbba2c76fd00d971904)]:
  - @geekmidas/telescope@10.0.0-alpha.4
  - @geekmidas/schema@10.0.0-alpha.4
  - @geekmidas/constructs@10.0.0-alpha.4
  - @geekmidas/cache@10.0.0-alpha.4
  - @geekmidas/db@10.0.0-alpha.4
  - @geekmidas/envkit@10.0.0-alpha.4
  - @geekmidas/errors@10.0.0-alpha.4
  - @geekmidas/logger@10.0.0-alpha.4
  - @geekmidas/manifest@10.0.0-alpha.4

## 10.0.0-alpha.3

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.3
  - @geekmidas/constructs@10.0.0-alpha.3
  - @geekmidas/db@10.0.0-alpha.3
  - @geekmidas/envkit@10.0.0-alpha.3
  - @geekmidas/errors@10.0.0-alpha.3
  - @geekmidas/logger@10.0.0-alpha.3
  - @geekmidas/manifest@10.0.0-alpha.3
  - @geekmidas/schema@10.0.0-alpha.3
  - @geekmidas/telescope@10.0.0-alpha.3

## 10.0.0-alpha.2

### Patch Changes

- [#29](https://github.com/geekmidas/toolbox/pull/29) [`3426eae`](https://github.com/geekmidas/toolbox/commit/3426eaec72e0837a33dae873d7fe36282445158b) Thanks [@geekmidas](https://github.com/geekmidas)! - The published package could not be installed

  `10.0.0-alpha.1` crashed on `gkm init`. Three packaging faults, each of which
  made `@geekmidas/constructs` unloadable for anyone who was not inside this
  repository — where pnpm's workspace links hid all of them.

  **Statically imported packages were declared optional peers.** `queue/Queue.ts`
  imports `Publisher` from `@geekmidas/events` as a value, and `envkit`,
  `errors`, `logger`, `manifest`, `schema` and `services` are imported by entries
  that always load. All were `peerDependenciesMeta.optional`, so a consumer's
  install fetched none of them. Installing the tarball on its own produced a
  package where _no entry point loaded at all_ — `gkm init` only reached
  `@geekmidas/events` because the CLI happened to depend on the rest directly.
  They are dependencies now, which is what a static import means.

  **`@geekmidas/telescope` was a required peer of a type-only import.**
  `rest-api.ts` does `import type { Telescope }`, which has no runtime, yet the
  peer was non-optional and exactly pinned — so every install warned it was
  missing and pnpm reported `Conflicting peer dependencies` against the CLI's own
  range. Marked optional.

  **Declaring a cron required AWS Lambda middleware.** `crons/index.ts`
  re-exported `AWSScheduledFunction`, so importing the barrel to declare a cron
  pulled in `@middy/core`. The adaptor was already exported from
  `@geekmidas/constructs/aws`, the entry that admits it needs Lambda; the
  redundant re-export is gone and `CronGenerator` emits the `/aws` specifier.

  Verified by packing the tarballs, installing them into an empty project the way
  a consumer does, and running `gkm init --monorepo` to completion.

- Updated dependencies [[`3426eae`](https://github.com/geekmidas/toolbox/commit/3426eaec72e0837a33dae873d7fe36282445158b), [`96ec6a7`](https://github.com/geekmidas/toolbox/commit/96ec6a73efbfaaf5f17f378ac3647d3c970297a9), [`05ce914`](https://github.com/geekmidas/toolbox/commit/05ce91446ba29d5158a2a5c010f7bf9c00f761eb)]:
  - @geekmidas/constructs@10.0.0-alpha.2
  - @geekmidas/telescope@10.0.0-alpha.2
  - @geekmidas/logger@10.0.0-alpha.2
  - @geekmidas/cache@10.0.0-alpha.2
  - @geekmidas/db@10.0.0-alpha.2
  - @geekmidas/envkit@10.0.0-alpha.2
  - @geekmidas/errors@10.0.0-alpha.2
  - @geekmidas/manifest@10.0.0-alpha.2
  - @geekmidas/schema@10.0.0-alpha.2

## 10.0.0-alpha.1

### Major Changes

- [#24](https://github.com/geekmidas/toolbox/pull/24) [`979731e`](https://github.com/geekmidas/toolbox/commit/979731eec71ecd8519a339fd2a36d68c24140d22) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm init --monorepo` scaffolds constructs, not an `apps` block

  It was the last thing producing the shape v10 removed. A scaffolded workspace
  got a `gkm.config.ts` naming three apps — type, path, port, framework,
  dependencies — with `envParser` and `logger` as module paths beside them, which
  is precisely what the surface replaced.

  The generated config is three keys: the name, the constructs glob, and secrets.
  Everything else it used to write, it wrote twice. `services` is gone, because a
  declared database is why a Postgres exists. `deploy` is gone, because that is
  picked at deploy time and it was writing the default anyway. `shared` is gone
  because nothing reads it.

  In its place is a `constructs/` directory at the workspace root — the database
  and the auth server's schema in it, the surface, the auth server, the site —
  reached from the apps through the `@<name>/constructs/*` path the tsconfig maps.

  `apps/auth` loses its hand-written Hono server: the PORT read, the CORS list
  split out of `BETTER_AUTH_TRUSTED_ORIGINS`, the `/api/auth/*` mount and the
  Better Auth instance behind them. The `BetterAuth` construct declares all of it
  and the build generates the entry, because the routes are a wildcard no glob
  can find.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.1
  - @geekmidas/constructs@10.0.0-alpha.1
  - @geekmidas/db@10.0.0-alpha.1
  - @geekmidas/envkit@10.0.0-alpha.1
  - @geekmidas/errors@10.0.0-alpha.1
  - @geekmidas/logger@10.0.0-alpha.1
  - @geekmidas/manifest@10.0.0-alpha.1
  - @geekmidas/schema@10.0.0-alpha.1
  - @geekmidas/telescope@10.0.0-alpha.1

## 10.0.0-alpha.0

### Major Changes

- [#23](https://github.com/geekmidas/toolbox/pull/23) [`25f346f`](https://github.com/geekmidas/toolbox/commit/25f346fb240b2a51996f6f67bbbe39baff32569d) Thanks [@geekmidas](https://github.com/geekmidas)! - v10: the manifest is the single source of truth

  `gkm.config.ts` used to restate what the constructs already declared — the
  apps, their paths, their routes, the containers they wanted, the origins they
  trusted. Every one of those was a second place to be wrong. In v10 the config
  carries a name, where to find the constructs, the services and the deploy
  target; everything else is read from the manifest.

  **The surface is the factory.** `e` is gone. An endpoint is built from the
  surface that will serve it — `api.post('/users').handle(...)` — so the logger,
  the env parser and the authorizers come from the `RestApi` rather than being
  threaded in per endpoint. `Endpoint` carries the surface it belongs to, and
  that is how the build knows which process an endpoint runs in.

  **Apps come from the manifest.** `apps` is no longer a config block. A
  declaration carries an `AppSpec` (`path`, and a `code` glob when the surface is
  built from files), and the CLI derives the workspace from that. A `RestApi`
  that declares its own routes — an auth server mounting a wildcard, where no
  glob has anything to find — now has its entry generated from the declaration
  itself.

  **Every surface gets its own deployment.** An api, an auth server and a studio
  are three containers, not one with three route prefixes. Sharing is something a
  declaration asks for, never a default. Which site holds the base domain is
  declared, and a construct is named by the same rule on every provider.

  **Derived rather than configured:** CORS origins from the auth construct's
  trusted origins, Studio from the declared database, containers from what the
  manifest says exists. Telescope's tables moved into a schema and dropped their
  prefix.

  **Fixed in the same release:** all four auth middlewares found a cookie by
  searching the `Cookie` header for `name=`, so `evil_auth_token=…;
auth_token=…` yielded the attacker's value; `@geekmidas/client` and
  `@geekmidas/ui` published exports that resolved to nothing; the MinIO image
  moved off Docker Hub and an unpinned `latest` took the dev stack with it.

  Upgrading is not mechanical. The config shrinks, `e` disappears, and anything
  that assumed one container per workspace now gets one per surface.

### Patch Changes

- Updated dependencies [[`25f346f`](https://github.com/geekmidas/toolbox/commit/25f346fb240b2a51996f6f67bbbe39baff32569d)]:
  - @geekmidas/cache@10.0.0-alpha.0
  - @geekmidas/constructs@10.0.0-alpha.0
  - @geekmidas/db@10.0.0-alpha.0
  - @geekmidas/envkit@10.0.0-alpha.0
  - @geekmidas/errors@10.0.0-alpha.0
  - @geekmidas/logger@10.0.0-alpha.0
  - @geekmidas/manifest@10.0.0-alpha.0
  - @geekmidas/schema@10.0.0-alpha.0
  - @geekmidas/telescope@10.0.0-alpha.0

## 9.0.2

### Patch Changes

- [#12](https://github.com/geekmidas/toolbox/pull/12) [`d53863a`](https://github.com/geekmidas/toolbox/commit/d53863a84db2e4ab5420e08f79128b637043fc42) Thanks [@geekmidas](https://github.com/geekmidas)! - Align every published package on a single version and keep them in step.

  All packages now share one version, enforced by a changesets `fixed` group. The
  baseline is 9.0.1 — @geekmidas/client's published version — so nothing moves
  backwards; this release takes the whole set to 9.0.2 together.

  Independent versions made "which version of the docs applies to me"
  unanswerable: a reader on constructs@7 and cli@2 was on no version at all. One
  number per release makes versioned documentation possible, and lets 9 freeze as
  the current paradigm while the constructs rework is developed against it.

  Every release now publishes every package, and a major anywhere is a major
  everywhere. Peer ranges get simpler in return.

- Updated dependencies [[`d53863a`](https://github.com/geekmidas/toolbox/commit/d53863a84db2e4ab5420e08f79128b637043fc42)]:
  - @geekmidas/constructs@9.0.2
  - @geekmidas/envkit@9.0.2
  - @geekmidas/errors@9.0.2
  - @geekmidas/logger@9.0.2
  - @geekmidas/manifest@9.0.2
  - @geekmidas/schema@9.0.2
  - @geekmidas/telescope@9.0.2

## 2.0.2

### Patch Changes

- 🐛 [#11](https://github.com/geekmidas/toolbox/pull/11) [`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309) Thanks [@geekmidas](https://github.com/geekmidas)! - Patch release across all packages to realign published versions with the
  registry. The previous release only published the four packages that had
  version bumps; the remaining packages failed with "cannot publish over the
  previously published versions" because their versions were unchanged.
- Updated dependencies [[`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309)]:
  - @geekmidas/constructs@7.0.1
  - @geekmidas/envkit@1.1.1
  - @geekmidas/errors@1.0.2
  - @geekmidas/logger@1.0.3
  - @geekmidas/manifest@0.1.1
  - @geekmidas/schema@1.0.4
  - @geekmidas/telescope@1.1.1

## 2.0.1

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@7.0.0

## 2.0.0

### Patch Changes

- [#9](https://github.com/geekmidas/toolbox/pull/9) [`e31a60a`](https://github.com/geekmidas/toolbox/commit/e31a60a971366180a0e7bec6e7da56d8f36aa21f) Thanks [@geekmidas](https://github.com/geekmidas)! - Support kysely 0.29.

  kysely 0.29 moved `Migrator` and `FileMigrationProvider` from the root barrel
  (`'kysely'`) to the `'kysely/migration'` subpath. `@geekmidas/testkit`'s
  `PostgresKyselyMigrator` now imports `Migrator` from `'kysely/migration'` and
  its kysely peer becomes `~0.29.4` — consumers must be on kysely 0.29+.

  The library packages that only declare a kysely _peer_ (`db`, `audit`, `studio`,
  `telescope`) don't touch the moved symbols, so their peer range is _widened_ to
  `>=0.28.2 <0.30.0` — they now support both 0.28 and 0.29 (non-breaking).

  `@geekmidas/cli`'s scaffolded `test/globalSetup.ts` template now imports
  `FileMigrationProvider` from `'kysely/migration'` so generated projects work on
  kysely 0.29.

- Updated dependencies [[`e31a60a`](https://github.com/geekmidas/toolbox/commit/e31a60a971366180a0e7bec6e7da56d8f36aa21f)]:
  - @geekmidas/telescope@1.1.0
  - @geekmidas/constructs@6.0.0

## 1.12.0

### Minor Changes

- [#8](https://github.com/geekmidas/toolbox/pull/8) [`b004fd8`](https://github.com/geekmidas/toolbox/commit/b004fd8ee74b5f20a047260b16669d16d8fc03b4) Thanks [@geekmidas](https://github.com/geekmidas)! - feat: queue workers (`q`) — producer, runtime adaptors, and `gkm` discovery

  Adds end-to-end support for point-to-point queues, alongside subscribers (`s`):

  **`@geekmidas/constructs/queue`** — the `q` builder:

  ```ts
  import { q } from '@geekmidas/constructs/queue';

  export const orders = q
    .queue('orders')
    .services([db])              // array; sniffed for required env vars
    .message(z.object({ orderId: z.string() }))
    .handle(async ({ messages, services }) => { … }); // the single consumer
  ```

  Unlike `s` (topic fan-out, filtered by `subscribedEvents`), a queue drains
  _every_ message of its one typed `message`.
  - **Producer side** — `orders.publisher`, a ready-to-inject `Service` typed to
    the queue's message. Drop it into any `.services([...])` and call
    `services.ordersPublisher.publish([{ type: 'orders', payload }])`. It reads
    `<NAME>_PUBLISHER_CONNECTION_STRING` and picks its transport from the URL
    protocol — `pgboss://` locally, `sqs://` deployed — so the same code targets
    Postgres in dev and SQS in prod. The env requirement is sniffed into the
    manifest, so infra links exactly that queue with least privilege.
  - **Runtime adaptors** — `AWSLambdaQueue` (`@geekmidas/constructs/aws`, SQS
    event-source with partial-batch failures) and `TestQueueAdaptor`
    (`@geekmidas/constructs/testing`).

  **`@geekmidas/cli`** — `gkm build`/`gkm dev` discover `q` definitions:
  - ✨ New `queues: './src/queues/**/*.ts'` config glob.
  - Server / `gkm dev`: an in-process pg-boss poller (`setupQueues()`) runs
    alongside the Hono server — each queue subscribes by its name on the shared
    `EVENT_SUBSCRIBER_CONNECTION_STRING`. Queues are background workers, not HTTP
    routes.
  - AWS: one `AWSLambdaQueue` handler per queue.
  - Queues are recorded in the manifest's `queues` field (`QueueInfo`).

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`0dad77e`](https://github.com/geekmidas/toolbox/commit/0dad77e574000e4018033b956ed4bb95935911a5) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(topic): add the `t` topic construct + derived publisher (closes the topic/queue asymmetry)

  Topics now have the same app-driven story queues already had — declare the topic
  in the app, get a typed publisher for free, and let `gkm build` capture it. This
  removes the need to hand-write a publisher `Service` (e.g. `EventsService`) to
  fan events out.

  **`@geekmidas/constructs/topic`** — the `t` builder:

  ```ts
  import { t } from "@geekmidas/constructs/topic";

  export const userTopic = t.topic("users").events({
    "user.created": z.object({ userId: z.string(), email: z.string() }),
    "user.updated": z.object({
      userId: z.string(),
      changes: z.array(z.string()),
    }),
  });
  ```

  - A `Topic` is a _resource_ construct (`ConstructType.Topic`) — fan-out, owned by
    no single handler. It declares the event contract and derives a publisher.
  - **`userTopic.publisher`** — a derived `Service` typed to the union of the topic's
    events, reading `<NAME>_PUBLISHER_CONNECTION_STRING` (transport by protocol:
    `sns://` deployed, `pgboss://` local). Replaces hand-written publisher services.
    Inject via `.publisher(userTopic.publisher)` (declarative `.event(...)`) or
    `.services([userTopic.publisher])`.
  - **`s.topic(userTopic)`** — binds a subscriber to a topic: supplies the
    subscribable event types/payloads _and_ records the binding for the manifest.
    A consumer doesn't publish, so this requires **no** publisher connection string
    (least privilege) — unlike typing via `.publisher(...)`.

  **`@geekmidas/manifest`** — new `TopicInfo` + `manifest.topics`; `SubscriberInfo`
  gains `topic` (the bound topic name).

  **`@geekmidas/cli`** — `TopicGenerator` discovers `t` topics into `manifest.topics`
  (a topic has no handler to generate); new `topics` config glob; wired through
  `gkm build`/`gkm dev` and both manifest writers.

  Hand-written publisher services still work; `t` is the encouraged path.

### Patch Changes

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`b42e96b`](https://github.com/geekmidas/toolbox/commit/b42e96b9dd28d8926a1253a97aa553bd0e08bf56) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(cloud): add `fromManifest` integrators backed by a shared `@geekmidas/manifest` package

  Introduces `@geekmidas/manifest` — a dependency-free package holding the
  deployment manifest types (`RouteInfo`/`FunctionInfo`/`CronInfo`/`SubscriberInfo`
  and their `*Manifest` containers) that `gkm build` emits. `@geekmidas/cli`
  re-exports these from the shared package (no behaviour change), so producer and
  consumers share one contract.

  `@geekmidas/cloud/sst` constructs gain static `fromManifest` factories that map
  a manifest straight into infrastructure:
  - `Api.fromManifest(stack, id, routesManifest, props)` — one route per
    `RouteInfo` (env vars, authorizer, timeout/memory mapped); supply
    `authorizers`/`links`/native args via `props`.
  - `Function.fromManifest(stack, functionsManifest, props)` — one `Function` per
    entry.
  - `Cron.fromManifest(stack, cronsManifest, { links, ... })` — one `Cron` per
    entry; each handler becomes a validated `Function` the cron triggers.

  `Api` routes also gain per-route `timeout`/`memory` passthrough.

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`03b08fe`](https://github.com/geekmidas/toolbox/commit/03b08feba2e735539c43f95b77792c18a627b07d) Thanks [@geekmidas](https://github.com/geekmidas)! - refactor(manifest): model the unified `gkm build` manifest and add `QueueInfo`

  `gkm build` emits a single TypeScript module per provider
  (`export const manifest = { routes, functions, crons, subscribers } as const`),
  not separate JSON files. `@geekmidas/manifest` now models that:
  - a unified `Manifest` type plus `ManifestField<T>` (a field is a flat
    `readonly T[]` or a partitioned `Record<string, readonly T[]>`) and a
    `flattenManifestField` helper;
  - the item types (`RouteInfo`/`FunctionInfo`/`CronInfo`/`SubscriberInfo`) gain a
    new `QueueInfo`, `SubscriberInfo.transport`, and readonly array fields so the
    `as const` manifest assigns cleanly;
  - 🔥 the per-unit `*Manifest` wrapper types are removed.

  `@geekmidas/cloud/sst`'s `Api`/`Function`/`Cron` `fromManifest` now take the
  manifest **field** (`Api.fromManifest(stack, id, manifest.routes, …)`) and
  flatten the flat-or-partitioned shape. `@geekmidas/cli` re-exports the updated
  types.

  Also fixes `@geekmidas/events` to externalise `pg-boss` (it was the one
  transport dep being bundled).

- Updated dependencies [[`b42e96b`](https://github.com/geekmidas/toolbox/commit/b42e96b9dd28d8926a1253a97aa553bd0e08bf56), [`b004fd8`](https://github.com/geekmidas/toolbox/commit/b004fd8ee74b5f20a047260b16669d16d8fc03b4), [`7323f34`](https://github.com/geekmidas/toolbox/commit/7323f34176d63170dd53450889ac0b5959420c3c), [`79e2929`](https://github.com/geekmidas/toolbox/commit/79e292978d3dbc8927e25814bdb051d1c380600a), [`03b08fe`](https://github.com/geekmidas/toolbox/commit/03b08feba2e735539c43f95b77792c18a627b07d), [`0dad77e`](https://github.com/geekmidas/toolbox/commit/0dad77e574000e4018033b956ed4bb95935911a5)]:
  - @geekmidas/manifest@0.1.0
  - @geekmidas/constructs@5.0.0
  - @geekmidas/envkit@1.1.0

## 1.11.0

### Minor Changes

- ✨ [#6](https://github.com/geekmidas/toolbox/pull/6) [`86a7967`](https://github.com/geekmidas/toolbox/commit/86a7967332a437c73177d06f6a2ed709e42c7060) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(cli): add `gkm test --auto-setup` to self-provision a stage in CI

  `gkm test` previously required a local secrets file and the matching `~/.gkm`
  encryption key, so it could not run on a fresh CI checkout (where `.env` and
  `.gkm/` are gitignored).

  With `--auto-setup` (or the `GKM_AUTO_SETUP` env var), `gkm test` now
  regenerates a fresh stage from the committed `gkm.config.ts` when no secrets
  exist — minting service credentials and a local key, then starting Docker with
  those values. For tests this is safe because the credentials are ephemeral local
  service passwords used to bring up the matching containers. The behavior is a
  no-op when secrets already exist and is scoped to `gkm test` only.

## 1.10.41

### Patch Changes

- Updated dependencies [[`811d740`](https://github.com/geekmidas/toolbox/commit/811d740ae3875d59ad1b0dc50261266963c8cb76)]:
  - @geekmidas/constructs@4.0.0

## 1.10.40

### Patch Changes

- Updated dependencies [[`a20be2f`](https://github.com/geekmidas/toolbox/commit/a20be2faa4795600358904b751fa947d3cbb4c45), [`07093f5`](https://github.com/geekmidas/toolbox/commit/07093f5f911bf1ee48e53275da3cce398cc78ff6)]:
  - @geekmidas/constructs@3.1.0

## 1.10.39

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

- Updated dependencies [[`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651)]:
  - @geekmidas/constructs@3.0.12
  - @geekmidas/envkit@1.0.7
  - @geekmidas/errors@1.0.1
  - @geekmidas/logger@1.0.2
  - @geekmidas/schema@1.0.2
  - @geekmidas/telescope@1.0.1

## 1.10.38

### Patch Changes

- 🐛 [`54b8743`](https://github.com/geekmidas/toolbox/commit/54b87433ba969a03afe56de0dba7c0173d15dbc9) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `gkm openapi` workspace-mode generation when invoked from a directory other than the workspace root. The command now derives the workspace root from the loaded config, so subprocess-per-app generation works regardless of where the command is invoked from (previously the subprocess used CWD and silently no-op'd or failed with `spawn node ENOENT`).

## 1.10.37

### Patch Changes

- 🐛 [`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix schema, openapi generation and events testkit

- Updated dependencies [[`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553)]:
  - @geekmidas/constructs@3.0.10
  - @geekmidas/schema@1.0.1

## 1.10.36

### Patch Changes

- [`2b83833`](https://github.com/geekmidas/toolbox/commit/2b83833758dce93e37104e7f4a83653000ab027b) Thanks [@geekmidas](https://github.com/geekmidas)! - Support custom environment variables for frontends

- 🐛 [`017e93a`](https://github.com/geekmidas/toolbox/commit/017e93aeaa1edc55a7f1f0520b08e8823e26343c) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `gkm openapi` failing on workspace builds when an app uses tsconfig path aliases (e.g. `~/*`) defined only in that app's `tsconfig.json`.

  Workspace mode now spawns one subprocess per backend app with `cwd` set to the app's directory, giving each generation its own tsx instance whose tsconfig discovery picks up the app's `paths` aliases. Adds a `--app <name>` flag to `gkm openapi` that the workspace flow uses internally to target a single app.

## 1.10.35

### Patch Changes

- ✨ [`b1de1e0`](https://github.com/geekmidas/toolbox/commit/b1de1e01e1181ea5c3edcf7e23dcf3a5128fc0f3) Thanks [@geekmidas](https://github.com/geekmidas)! - Add different framework support

## 1.10.34

### Patch Changes

- 🐛 [`b8a17e3`](https://github.com/geekmidas/toolbox/commit/b8a17e33de415a5d749297f7840564e824609a92) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix global zod registry and fix this reference on test extensions

## 1.10.33

### Patch Changes

- ✨ [`363c67f`](https://github.com/geekmidas/toolbox/commit/363c67fb3c3406bac6823326ab80ba55bff29e31) Thanks [@geekmidas](https://github.com/geekmidas)! - Add dynamic return types

- Updated dependencies [[`363c67f`](https://github.com/geekmidas/toolbox/commit/363c67fb3c3406bac6823326ab80ba55bff29e31)]:
  - @geekmidas/constructs@3.0.9

## 1.10.32

### Patch Changes

- ✨ [`0830c6e`](https://github.com/geekmidas/toolbox/commit/0830c6e0d60842526788e0e1f0e78827514ea7b3) Thanks [@geekmidas](https://github.com/geekmidas)! - Add optional sniff support

- Updated dependencies [[`0830c6e`](https://github.com/geekmidas/toolbox/commit/0830c6e0d60842526788e0e1f0e78827514ea7b3)]:
  - @geekmidas/constructs@3.0.8
  - @geekmidas/logger@1.0.1

## 1.10.31

### Patch Changes

- ✨ [`56e71bc`](https://github.com/geekmidas/toolbox/commit/56e71bcb57a5305270909f695a4539fa504a463b) Thanks [@geekmidas](https://github.com/geekmidas)! - Add optional params support and open api on build

- Updated dependencies [[`56e71bc`](https://github.com/geekmidas/toolbox/commit/56e71bcb57a5305270909f695a4539fa504a463b)]:
  - @geekmidas/envkit@1.0.5

## 1.10.30

### Patch Changes

- ✨ [`79e17a8`](https://github.com/geekmidas/toolbox/commit/79e17a84e630f102023005994d9d45b37f7d9d8f) Thanks [@geekmidas](https://github.com/geekmidas)! - Add msw support for construct testing for ui

- Updated dependencies [[`79e17a8`](https://github.com/geekmidas/toolbox/commit/79e17a84e630f102023005994d9d45b37f7d9d8f)]:
  - @geekmidas/constructs@3.0.7

## 1.10.29

### Patch Changes

- ✨ [`3941ae6`](https://github.com/geekmidas/toolbox/commit/3941ae6c9027fddb32999b9f98af813a12867877) Thanks [@geekmidas](https://github.com/geekmidas)! - Add db to authorizer

- Updated dependencies [[`3941ae6`](https://github.com/geekmidas/toolbox/commit/3941ae6c9027fddb32999b9f98af813a12867877)]:
  - @geekmidas/constructs@3.0.6

## 1.10.28

### Patch Changes

- 🔥 [`9e8f923`](https://github.com/geekmidas/toolbox/commit/9e8f9239798649bedeb16906ed83d0b71065c917) Thanks [@geekmidas](https://github.com/geekmidas)! - Remove client generation from cli

## 1.10.27

### Patch Changes

- 🐛 [`bead80b`](https://github.com/geekmidas/toolbox/commit/bead80b78437f616c593c521a39a22155de3c498) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix recociliation to have pg boss

## 1.10.26

### Patch Changes

- 🐛 [`5691cdf`](https://github.com/geekmidas/toolbox/commit/5691cdfc8298e8f943de8b3541b8e79ce64edccd) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix subsciber defaults

## 1.10.25

### Patch Changes

- 🐛 [`26765a3`](https://github.com/geekmidas/toolbox/commit/26765a3d1ce6a568e609011ab218455a1062dd2c) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix node options on exec

## 1.10.24

### Patch Changes

- 🐛 [`b3565b8`](https://github.com/geekmidas/toolbox/commit/b3565b89e57f100157faf82d89077c3d24df78fd) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix exec script to load mjs instead of ts

## 1.10.23

### Patch Changes

- 🐛 [`61ae404`](https://github.com/geekmidas/toolbox/commit/61ae404061a1061c4a724d0f187764475903b625) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix tsx import

## 1.10.22

### Patch Changes

- 🐛 [`acfc00a`](https://github.com/geekmidas/toolbox/commit/acfc00a0ec99691e978c3d0978f3ec63e1ec9869) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix tsx loader for loading extentionless typescript files

## 1.10.21

### Patch Changes

- ✨ [`9b56519`](https://github.com/geekmidas/toolbox/commit/9b5651989ccd1ca55c8b7150647c850eda056213) Thanks [@geekmidas](https://github.com/geekmidas)! - Add debugging and complete traces

## 1.10.20

### Patch Changes

- 🐛 [`02991d4`](https://github.com/geekmidas/toolbox/commit/02991d410c4f2fab5fbaa568300e5d8943b3ba45) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix dev command port credentials resolution

## 1.10.19

### Patch Changes

- ✨ [`ac041cc`](https://github.com/geekmidas/toolbox/commit/ac041cc459e87107ffb4e508e85c04c3079bf040) Thanks [@geekmidas](https://github.com/geekmidas)! - Add objection pagination and fix secret loading for server apps

## 1.10.18

### Patch Changes

- 🐛 [`70a63e5`](https://github.com/geekmidas/toolbox/commit/70a63e57e1867c88b79c66fe979c613ce2272d54) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix exec command to resolve the correct credentials

## 1.10.17

### Patch Changes

- 🐛 [`94a25c0`](https://github.com/geekmidas/toolbox/commit/94a25c01ee2a0313eb01260055e4988b20c64dc4) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix exec command credentials resolution

## 1.10.16

### Patch Changes

- ✨ [`9607c5e`](https://github.com/geekmidas/toolbox/commit/9607c5e6045bf0a4df3bee81437df2b3d7a34513) Thanks [@geekmidas](https://github.com/geekmidas)! - Add events support on root config

## 1.10.15

### Patch Changes

- ✨ [`619e4e6`](https://github.com/geekmidas/toolbox/commit/619e4e6e3de73c0266008e9747d7bd735e214216) Thanks [@geekmidas](https://github.com/geekmidas)! - Add default MAIL_FROM and SMTP_SECURE

## 1.10.14

### Patch Changes

- 🐛 Fix smtp resolution ports

## 1.10.13

### Patch Changes

- ✨ [`a2738e2`](https://github.com/geekmidas/toolbox/commit/a2738e23c47ab4291284d7c1abffb97f9665cfe5) Thanks [@geekmidas](https://github.com/geekmidas)! - Add mailpit credentails to reconsiliation

## 1.10.12

### Patch Changes

- ✨ [`3c920fe`](https://github.com/geekmidas/toolbox/commit/3c920feb4aca4ec3b1a3bab2c88a35be5c986ddd) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix service start on test and also add mailpit env

## 1.10.11

### Patch Changes

- 🐛 [`a0917af`](https://github.com/geekmidas/toolbox/commit/a0917af20fce16ae7482dd3712d11d2d9351c714) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix minio credentials mapping

## 1.10.10

### Patch Changes

- 🐛 [`71cb452`](https://github.com/geekmidas/toolbox/commit/71cb45209123fdca32ad6aa2e2995daae307848a) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix docker service reconsiliation

## 1.10.9

### Patch Changes

- 🐛 [`4010c0d`](https://github.com/geekmidas/toolbox/commit/4010c0dae742b725c036801a4a5d8b42432fbbfe) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix bug when running gkm dev and test to run all docker services

## 1.10.8

### Patch Changes

- 🐛 [`ef1754d`](https://github.com/geekmidas/toolbox/commit/ef1754dd96cfc0f6e79a04ac9eaff56e37023f0f) Thanks [@geekmidas](https://github.com/geekmidas)! - fix test and dev commands to inject correct creds on compose

## 1.10.7

### Patch Changes

- [`4a65756`](https://github.com/geekmidas/toolbox/commit/4a6575647cb91b8782182ef0d09cfb685565b6ae) Thanks [@geekmidas](https://github.com/geekmidas)! - Phantom push

## 1.10.6

### Patch Changes

- 🐛 [`d77b70e`](https://github.com/geekmidas/toolbox/commit/d77b70ebf8f68ae39a6daec02023703c2025167b) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix credentials for tests

## 1.10.5

### Patch Changes

- 🐛 [`c97b9db`](https://github.com/geekmidas/toolbox/commit/c97b9db7cb66040b461cd3682f0b82ae2f24bd14) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix credentials embedding

## 1.10.4

### Patch Changes

- 🐛 [`6123575`](https://github.com/geekmidas/toolbox/commit/6123575f05ba5c8563413fffdad67d0e2880fb08) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix config hosts

- 🐛 [`96618ff`](https://github.com/geekmidas/toolbox/commit/96618ff36fd3248bfc29f4517fda79eea4a66dda) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix credentials loading for tests

## 1.10.3

### Patch Changes

- 🐛 [`6a92fa7`](https://github.com/geekmidas/toolbox/commit/6a92fa737057d77178a4d31480505013fbe033af) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix dev scripts and spawns also when canceling prcocess.

## 1.10.2

### Patch Changes

- 🐛 [`fefefe0`](https://github.com/geekmidas/toolbox/commit/fefefe0e7825d95c333375ea280e9aba23599bf0) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix issue with env loading on docker during setup

## 1.10.1

### Patch Changes

- ✨ [`bfc5a4f`](https://github.com/geekmidas/toolbox/commit/bfc5a4f656445bb389b0532e9d3385d2e66a28fe) Thanks [@geekmidas](https://github.com/geekmidas)! - Add function context and suport for partitions

- Updated dependencies [[`bfc5a4f`](https://github.com/geekmidas/toolbox/commit/bfc5a4f656445bb389b0532e9d3385d2e66a28fe)]:
  - @geekmidas/constructs@3.0.1

## 1.10.0

### Minor Changes

- ✨ [`be4f7a9`](https://github.com/geekmidas/toolbox/commit/be4f7a9bd5de7f08adbca582916d6902e0c24de2) Thanks [@geekmidas](https://github.com/geekmidas)! - Add partition support for manifest generation. Users can now group constructs (routes, functions, crons, subscribers) into named partitions by providing a `partition` callback per construct type in the config. Manifests output partitioned fields as `Record<string, T[]>` while remaining flat `T[]` arrays when no partitions are configured.

  Fix mutation type inference in endpoint hooks by using `UseMutationResult` and `UseQueryResult` types directly instead of `ReturnType<typeof useMutation>`, which could resolve to `never` for complex path definitions.

  Add `FileCache` implementation that persists cache entries to a JSON file on disk. Default location is `process.cwd()/.gkm/cache.json`. Uses an in-process mutex combined with `proper-lockfile` for safe concurrent and cross-process writes.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@3.0.0

## 1.9.1

### Patch Changes

- ✨ [`3d20e46`](https://github.com/geekmidas/toolbox/commit/3d20e46aa2454c322ffa9e482f23c12c9e9686d4) Thanks [@geekmidas](https://github.com/geekmidas)! - Add secret reconsilation and fix bug with dev loading credentials

## 1.9.0

### Minor Changes

- ✨ [`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661) Thanks [@geekmidas](https://github.com/geekmidas)! - Add pg-boss event publisher/subscriber, CLI setup and upgrade commands, and secrets sync via AWS SSM
  - ✨ **@geekmidas/events**: Add pg-boss backend for event publishing and subscribing with connection string support
  - ✨ **@geekmidas/cli**: Add `gkm setup` command for dev environment initialization, `gkm upgrade` command with workspace detection, and secrets push/pull via AWS SSM Parameter Store
  - 🐛 **@geekmidas/testkit**: Fix database creation race condition in PostgresMigrator
  - ✨ **@geekmidas/constructs**: Add integration tests for pg-boss with HonoEndpoint

### Patch Changes

- Updated dependencies [[`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661)]:
  - @geekmidas/constructs@2.0.0

## 1.8.0

### Minor Changes

- ⬆️ [`5c5d844`](https://github.com/geekmidas/toolbox/commit/5c5d8447d0bab29397879bcd723bf1f44c50e61c) Thanks [@geekmidas](https://github.com/geekmidas)! - Bump version to capture latest version of constructs

## 1.7.0

### Minor Changes

- 🔥 [`66a0eac`](https://github.com/geekmidas/toolbox/commit/66a0eacfb2aa711da5d67ec10f28a8fa8bcbdf1e) Thanks [@geekmidas](https://github.com/geekmidas)! - Remove test adaptor from subscriber exports

## 1.6.0

### Minor Changes

- ⚡️ [`73511d9`](https://github.com/geekmidas/toolbox/commit/73511d912062eb0776935168c9f72d42c7c854a6) Thanks [@geekmidas](https://github.com/geekmidas)! - Improve dev script experience and export function tester

### Patch Changes

- Updated dependencies [[`73511d9`](https://github.com/geekmidas/toolbox/commit/73511d912062eb0776935168c9f72d42c7c854a6)]:
  - @geekmidas/constructs@1.1.0

## 1.5.1

### Patch Changes

- 🐛 [`1a74469`](https://github.com/geekmidas/toolbox/commit/1a744694de77cdcc030ad5a5d99d6fc9800c0533) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix function adaptor for lambda

## 1.5.0

### Minor Changes

- ✨ [`36166de`](https://github.com/geekmidas/toolbox/commit/36166defde0a66e68cb9ac5c6a6856ea23e2da62) Thanks [@geekmidas](https://github.com/geekmidas)! - Add sniffing and config for frontend apps. Also ensure next.js apps get args at build time.

## 1.4.0

### Minor Changes

- 🐛 [`bebf821`](https://github.com/geekmidas/toolbox/commit/bebf821ce4534e314d3d536e9956260c4230a183) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix dependecy output injecttion for urls

## 1.3.0

### Minor Changes

- 🐛 [`bee0e64`](https://github.com/geekmidas/toolbox/commit/bee0e64367dc937869556de516fedfea64f2a438) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix route53 profile setting for state management, fix web templates on init.

## 1.2.3

### Patch Changes

- 🐛 [`11c96af`](https://github.com/geekmidas/toolbox/commit/11c96af896fa5355f37edd276fc96010cd177ccc) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix cli client generation for monorepos

## 1.2.2

### Patch Changes

- 🐛 [`ab91786`](https://github.com/geekmidas/toolbox/commit/ab917864eaf64793e5bc93818a98caeb5b766324) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix env var injection for dev, and make sure openapi generation for client apps

## 1.2.1

### Patch Changes

- 🐛 [`e4ab724`](https://github.com/geekmidas/toolbox/commit/e4ab724fc044bbcab9e4a1426e55b515a4185a2b) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix bug when running gkm exec so tsx is importted correctly

## 1.2.0

### Minor Changes

- 🔥 [`43d4451`](https://github.com/geekmidas/toolbox/commit/43d44510f1077ecdf0c64ae56c8d2d97d446cea2) Thanks [@geekmidas](https://github.com/geekmidas)! - Remove projectId from workspace config and move to state

## 1.1.0

### Minor Changes

- ✨ [`3b6d7d9`](https://github.com/geekmidas/toolbox/commit/3b6d7d9ed41dc08675395d937248a8ab754af9e1) Thanks [@geekmidas](https://github.com/geekmidas)! - Add state provider configuration to workspace config

## 1.0.2

### Patch Changes

- 🐛 [`159e365`](https://github.com/geekmidas/toolbox/commit/159e36572adb2b489629d4ab2a0142f8ff59b7a8) Thanks [@geekmidas](https://github.com/geekmidas)! - Resolve correct cli version at runtime

## 1.0.1

### Patch Changes

- [`169ccd6`](https://github.com/geekmidas/toolbox/commit/169ccd62ada0dfd23f47434b57b967213d1538e5) Thanks [@geekmidas](https://github.com/geekmidas)! - Use the correct version for cli dependencies

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release

### Patch Changes

- Updated dependencies [[`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8)]:
  - @geekmidas/constructs@1.0.0
  - @geekmidas/envkit@1.0.0
  - @geekmidas/errors@1.0.0
  - @geekmidas/logger@1.0.0
  - @geekmidas/schema@1.0.0
  - @geekmidas/telescope@1.0.0
