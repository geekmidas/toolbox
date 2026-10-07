# @geekmidas/testkit

## 10.0.0-alpha.63

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.63
  - @geekmidas/logger@10.0.0-alpha.63
  - @geekmidas/services@10.0.0-alpha.63

## 10.0.0-alpha.62

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.62
  - @geekmidas/logger@10.0.0-alpha.62
  - @geekmidas/services@10.0.0-alpha.62

## 10.0.0-alpha.61

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.61
  - @geekmidas/logger@10.0.0-alpha.61
  - @geekmidas/services@10.0.0-alpha.61

## 10.0.0-alpha.60

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.60
  - @geekmidas/logger@10.0.0-alpha.60
  - @geekmidas/services@10.0.0-alpha.60

## 10.0.0-alpha.59

### Patch Changes

- Updated dependencies [[`57eea44`](https://github.com/geekmidas/toolbox/commit/57eea445c114acbb398d4dfedc86f1c22dab3f10)]:
  - @geekmidas/logger@10.0.0-alpha.59
  - @geekmidas/envkit@10.0.0-alpha.59
  - @geekmidas/services@10.0.0-alpha.59

## 10.0.0-alpha.58

### Patch Changes

- Updated dependencies [[`476aeda`](https://github.com/geekmidas/toolbox/commit/476aedab3128ec29948df93f9776dae4e42d3488)]:
  - @geekmidas/logger@10.0.0-alpha.58
  - @geekmidas/envkit@10.0.0-alpha.58
  - @geekmidas/services@10.0.0-alpha.58

## 10.0.0-alpha.57

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.57
  - @geekmidas/logger@10.0.0-alpha.57
  - @geekmidas/services@10.0.0-alpha.57

## 10.0.0-alpha.56

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.56
  - @geekmidas/logger@10.0.0-alpha.56
  - @geekmidas/services@10.0.0-alpha.56

## 10.0.0-alpha.55

### Patch Changes

- Updated dependencies [[`eedac53`](https://github.com/geekmidas/toolbox/commit/eedac53aeec2d88d46a74ec9f3d4a55e2845b2b2)]:
  - @geekmidas/services@10.0.0-alpha.55
  - @geekmidas/envkit@10.0.0-alpha.55
  - @geekmidas/logger@10.0.0-alpha.55

## 10.0.0-alpha.54

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.54
  - @geekmidas/logger@10.0.0-alpha.54
  - @geekmidas/services@10.0.0-alpha.54

## 10.0.0-alpha.53

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.53
  - @geekmidas/logger@10.0.0-alpha.53
  - @geekmidas/services@10.0.0-alpha.53

## 10.0.0-alpha.52

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.52
  - @geekmidas/logger@10.0.0-alpha.52
  - @geekmidas/services@10.0.0-alpha.52

## 10.0.0-alpha.51

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.51
  - @geekmidas/logger@10.0.0-alpha.51
  - @geekmidas/services@10.0.0-alpha.51

## 10.0.0-alpha.50

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.50
  - @geekmidas/logger@10.0.0-alpha.50
  - @geekmidas/services@10.0.0-alpha.50

## 10.0.0-alpha.49

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.49
  - @geekmidas/logger@10.0.0-alpha.49
  - @geekmidas/services@10.0.0-alpha.49

## 10.0.0-alpha.48

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.48
  - @geekmidas/logger@10.0.0-alpha.48
  - @geekmidas/services@10.0.0-alpha.48

## 10.0.0-alpha.47

### Patch Changes

- Updated dependencies [[`10ef53d`](https://github.com/geekmidas/toolbox/commit/10ef53d921d519afa62c773a6682581e19c06b1e)]:
  - @geekmidas/envkit@10.0.0-alpha.47
  - @geekmidas/logger@10.0.0-alpha.47
  - @geekmidas/services@10.0.0-alpha.47

## 10.0.0-alpha.46

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.46
  - @geekmidas/logger@10.0.0-alpha.46
  - @geekmidas/services@10.0.0-alpha.46

## 10.0.0-alpha.45

### Minor Changes

- 🐛 [#121](https://github.com/geekmidas/toolbox/pull/121) [`8dbf325`](https://github.com/geekmidas/toolbox/commit/8dbf325495de962ea5889459b31e2700dc4d6726) Thanks [@geekmidas](https://github.com/geekmidas)! - :bug: Each test's browser connects from its own address, and a session check carries the client's
  - ✨ **`Browser` has an `address`** — a fresh private one by default, or `new Browser({ address })` — sent as `x-forwarded-for` on its requests, the way a proxy in front of the app adds it. Each browser is a different person on a different connection. Without it every test was the same client to Better Auth (`127.0.0.1` in tests), so its rate limit counted every test in one row: concurrent tests queued on each other's uncommitted inserts into `rateLimit` until they ended — sign-ins refused and timeouts, more of them the bigger the suite. A request that sets the header itself keeps its own.
  - **A surface's session check forwards `x-forwarded-for`** with the session headers. Better Auth rate-limits `/get-session` too, by client; without the address every user's session check came from the surface itself — one shared bucket, so enough traffic from anyone turned session checks into 429s (`SessionCheckFailed`).

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.45
  - @geekmidas/logger@10.0.0-alpha.45
  - @geekmidas/services@10.0.0-alpha.45

## 10.0.0-alpha.44

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.44
  - @geekmidas/logger@10.0.0-alpha.44
  - @geekmidas/services@10.0.0-alpha.44

## 10.0.0-alpha.43

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.43
  - @geekmidas/logger@10.0.0-alpha.43
  - @geekmidas/services@10.0.0-alpha.43

## 10.0.0-alpha.42

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.42
  - @geekmidas/logger@10.0.0-alpha.42
  - @geekmidas/services@10.0.0-alpha.42

## 10.0.0-alpha.41

### Minor Changes

- [#114](https://github.com/geekmidas/toolbox/pull/114) [`ec054c3`](https://github.com/geekmidas/toolbox/commit/ec054c3c54f7ca7913c3d0552c961d4d08ac1595) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: `faker.age(min, max?)` returns a birthdate for someone of that age today

  `faker.age(18)` is someone exactly 18; `faker.age(18, 24)` is someone aged 18 to 24 inclusive. It goes through faker's `date.birthdate`, so a seeded faker repeats it. An impossible range (negative, or oldest below youngest) throws `AgeRangeInvalid`.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.41
  - @geekmidas/logger@10.0.0-alpha.41
  - @geekmidas/services@10.0.0-alpha.41

## 10.0.0-alpha.40

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.40
  - @geekmidas/logger@10.0.0-alpha.40
  - @geekmidas/services@10.0.0-alpha.40

## 10.0.0-alpha.39

### Patch Changes

- [#108](https://github.com/geekmidas/toolbox/pull/108) [`9bfd949`](https://github.com/geekmidas/toolbox/commit/9bfd94997337b1990a5413d3127717cbf560be91) Thanks [@geekmidas](https://github.com/geekmidas)! - testkit's `faker` makes every email address lowercase

  `faker.internet.email()` and `faker.internet.exampleEmail()` now return
  lowercase addresses. That covers the `faker` a feature test is handed and
  the one factories build with. Better Auth stores addresses lowercased, so a
  test that signed in as faker's `Ada.Lovelace@…` and read back
  `ada.lovelace@…` failed only when faker happened to capitalise. The rest of
  `faker.internet` is unchanged.

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.39
  - @geekmidas/logger@10.0.0-alpha.39
  - @geekmidas/services@10.0.0-alpha.39

## 10.0.0-alpha.38

### Patch Changes

- [#107](https://github.com/geekmidas/toolbox/pull/107) [`5475a96`](https://github.com/geekmidas/toolbox/commit/5475a96d1d8ee0c99109c65cba76f7e269f42265) Thanks [@geekmidas](https://github.com/geekmidas)! - `ExternalApi` for third-party HTTP APIs, `<ID>_CREDENTIALS`, and `faker` and `signIn()` in feature tests

  - **`ExternalApi`** (`@geekmidas/constructs/external-api`) declares an API
    somebody else runs: a `url`, one string or one per stage name with a
    `default`, a `credentials` schema, and the `client` a handler is given. It
    provides `<ID>_URL` and `<ID>_CREDENTIALS` (kind `external-api`).
  - **Its fake lives at `test/fakes/<id>.ts`**, never in the construct, so it
    cannot reach a deployed bundle. The file default-exports
    `fake.app(handler, { credentials })` or
    `fake.image('stripe/stripe-mock', { port, credentials })`.
    - **Fakes are opt-in:** only `gkm test` and `gkm dev --fake` use them.
      Plain `gkm dev` calls the real API at its `url` for the local stage, with
      that stage's own credentials.
    - ✨ **Feature tests** serve an app fake in-process through MSW, and
      `gkm dev --fake` serves it on an allocated port.
    - **An image fake** runs as a container on an allocated host port.
    - **No fake:** an external API without one fails `gkm test` or
      `gkm dev --fake` with `NoFake`.
  - 🐛 **Deploying** resolves the URL for the stage (`NoUrlForStage` when it has
    none) and the credentials from the stage's secrets, on Dokploy and on AWS.
  - **`Credential` provides `<ID>_CREDENTIALS`**, renamed from `<ID>_CREDENTIAL`.
  - **AWS `Credential` links under `<ID>_CREDENTIALS`.** It reported SST's
    secret type, which resolves to the bare `<ID>`, so a function that declared
    `STRIPE_CREDENTIALS` was linked to nothing. It now has its own type
    (`gkm:aws:Credential`) and resolver, and holds the `sst.Secret` under the
    same name, so values already set with `sst secret set Stripe …` still apply.
  - 🐛 **Dokploy now resolves credentials.** A stage missing `<ID>_CREDENTIALS` for
    a `Credential` or an `ExternalApi` fails `gkm deploy` with
    `MissingSuppliedSecret`, naming the `gkm secrets:set` command. Before this,
    Dokploy never resolved a credential at all.
  - ✨ **Feature tests get `faker`**, testkit's faker seeded from the test's name.
    `browser.signIn()` with no address signs in as a new, unique user. testkit's
    `faker` regains `seed()`, which the spread had dropped.
  - **Every command reads and writes the stage's own secrets store.** `gkm
deploy`, `build`, `dev`, `test`, `exec`, `setup` and `secrets:*` resolve the
    store for the stage they act on: the file for the local stage, and
    `secrets.store` for a deployed one. A stage kept in SSM is set with
    `gkm secrets:set` and read by the deploy, with nothing pushed or pulled in
    between. `secrets:push` and `secrets:pull` are removed. `gkm setup` no
    longer offers to push, `deploy:github` no longer pushes, and the generated
    SST workflow has no pull step.
  - **`SecretsStore` is `{ name, read(stage), write(stage, secrets) }`.** The
    file store is `FileSecretsStore` (`name: 'file'`), and SSM is
    `AwsSecretsStore` (`name: 'ssm'`), renamed from `SsmSecretsStore`. The free
    functions `readStageSecrets`, `writeStageSecrets`, `setCustomSecret`,
    `secretsExist` and `getSecretsPath` are gone.
  - 🔒 **Security: Dokploy no longer derives secrets from repo facts.** An auth
    server's signing secret, and every Dokploy database and bucket password,
    were a SHA-256 of the project name, stage and construct id, all of which
    are in the repo. Now:
    - **Signing secrets** are random, generated on the stage's first deploy and
      kept in its secrets store.
    - **Derived passwords** are salted with a random per-stage seed kept in the
      same store.
    - **Role passwords** are set on every apply (`ALTER ROLE … PASSWORD`), so an
      existing database moves to the new passwords rather than locking the app
      out.
  - **An app is found by its configured path, never by a `package.json`
    name.**
    - **`gkm dev`, `test` and `exec`** run the app whose `path` in
      `gkm.config.ts` holds the current directory, and anywhere else `gkm dev`
      hands the workspace to turbo. A folder no app lives in fails with
      `NotInAnApp`.
    - **`gkm docker`** names its default image after the config's `name`.
    - 🔥 **Removed:** `getAppNameFromCwd` and `getAppNameFromPackageJson`.

  **Moving an existing app:**

  - Rename every `<ID>_CREDENTIAL` secret to `<ID>_CREDENTIALS` and set it on
    each deployed stage: `gkm secrets:set STRIPE_CREDENTIALS '{…}' --stage production`.
  - A custom `secrets.store` provider renames `pull` to `read` and `push` to
    `write`, and adds a `name`.
  - A deployed stage whose secrets were only in this machine's file: set
    `secrets.store`, then write its values to the store with
    `gkm secrets:import --stage <stage> --file …` or `gkm secrets:set`.
  - An existing Dokploy stage's next deploy generates its seed and signing
    secret: live sessions end once, the database roles take their new passwords,
    and a bucket's root user is reset.

- Updated dependencies [[`5475a96`](https://github.com/geekmidas/toolbox/commit/5475a96d1d8ee0c99109c65cba76f7e269f42265)]:
  - @geekmidas/envkit@10.0.0-alpha.38
  - @geekmidas/logger@10.0.0-alpha.38
  - @geekmidas/services@10.0.0-alpha.38

## 10.0.0-alpha.37

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.37
  - @geekmidas/logger@10.0.0-alpha.37
  - @geekmidas/services@10.0.0-alpha.37

## 10.0.0-alpha.36

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.36
  - @geekmidas/logger@10.0.0-alpha.36
  - @geekmidas/services@10.0.0-alpha.36

## 10.0.0-alpha.35

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.35
  - @geekmidas/logger@10.0.0-alpha.35
  - @geekmidas/services@10.0.0-alpha.35

## 10.0.0-alpha.34

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.34
  - @geekmidas/logger@10.0.0-alpha.34
  - @geekmidas/services@10.0.0-alpha.34

## 10.0.0-alpha.33

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.33
  - @geekmidas/logger@10.0.0-alpha.33
  - @geekmidas/services@10.0.0-alpha.33

## 10.0.0-alpha.32

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.32
  - @geekmidas/logger@10.0.0-alpha.32
  - @geekmidas/services@10.0.0-alpha.32

## 10.0.0-alpha.31

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.31
  - @geekmidas/logger@10.0.0-alpha.31
  - @geekmidas/services@10.0.0-alpha.31

## 10.0.0-alpha.30

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.30
  - @geekmidas/logger@10.0.0-alpha.30
  - @geekmidas/services@10.0.0-alpha.30

## 10.0.0-alpha.29

### Patch Changes

- [#92](https://github.com/geekmidas/toolbox/pull/92) [`a8632d3`](https://github.com/geekmidas/toolbox/commit/a8632d33f5e3acd8e84a5714602da5e6b85c9094) Thanks [@geekmidas](https://github.com/geekmidas)! - A feature test's database client is built with the construct's own Kysely config

  `featureTest` handed endpoints, and the test's `db`, a Kysely it built itself —
  with a dialect and nothing else. A database declared with
  `plugins: [new CamelCasePlugin()]` ran without it under test, so a test wrote
  `createdAt` to a `created_at` column and failed on code production ran fine
  (or passed on code it would not).

  `KyselyDatabase` exposes `clientConfig` — the Kysely options it was declared
  with, less `schema`/`roles`/`version` — and `connect()` builds from it.
  `openBoundTransaction(url, config)` and `TransactionRegistry.get(key, url,
config)` take it, and `featureTest` passes it for every test transaction.

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.29
  - @geekmidas/logger@10.0.0-alpha.29
  - @geekmidas/services@10.0.0-alpha.29

## 10.0.0-alpha.28

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.28
  - @geekmidas/logger@10.0.0-alpha.28
  - @geekmidas/services@10.0.0-alpha.28

## 10.0.0-alpha.27

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.27
  - @geekmidas/logger@10.0.0-alpha.27
  - @geekmidas/services@10.0.0-alpha.27

## 10.0.0-alpha.26

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.26
  - @geekmidas/logger@10.0.0-alpha.26
  - @geekmidas/services@10.0.0-alpha.26

## 10.0.0-alpha.25

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.25
  - @geekmidas/logger@10.0.0-alpha.25
  - @geekmidas/services@10.0.0-alpha.25

## 10.0.0-alpha.24

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.24
  - @geekmidas/logger@10.0.0-alpha.24
  - @geekmidas/services@10.0.0-alpha.24

## 10.0.0-alpha.23

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.23
  - @geekmidas/logger@10.0.0-alpha.23
  - @geekmidas/services@10.0.0-alpha.23

## 10.0.0-alpha.22

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.22
  - @geekmidas/logger@10.0.0-alpha.22
  - @geekmidas/services@10.0.0-alpha.22

## 10.0.0-alpha.21

### Minor Changes

- [#80](https://github.com/geekmidas/toolbox/pull/80) [`1e2bc9b`](https://github.com/geekmidas/toolbox/commit/1e2bc9b18a36f31fa5658c5695ee3e11264e2709) Thanks [@geekmidas](https://github.com/geekmidas)! - Feature test primitives: `Browser`, `createMailbox`, test context, `TransactionRegistry`

  The pieces a feature test is built from, none of which knows about constructs
  (the wiring that does lives in `@geekmidas/constructs/testing`):

  - `@geekmidas/testkit/browser` — `Browser`: a `fetch` with a cookie jar that
    follows the browser's rules, following redirects hop by hop, installable as
    the global `fetch`. On the server side of a test it never lends its cookies,
    so a server that forgets to forward one is caught rather than covered for.
  - `@geekmidas/testkit/mailbox` — `createMailbox`: reads the mail an app sent
    from Mailpit's HTTP API, waiting for it to arrive; one address per test.
  - `@geekmidas/testkit/context` — the test a request belongs to, carried in an
    `AsyncLocalStorage` and stamped onto outgoing requests as `x-test-context-id`.
  - `@geekmidas/testkit/transactions` — one transaction per database per test, on
    its own connection as deployed, rolled back together; code under test may use
    transactions itself, which become savepoints.

  Part 3 of #77.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.21
  - @geekmidas/logger@10.0.0-alpha.21
  - @geekmidas/services@10.0.0-alpha.21

## 10.0.0-alpha.20

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.20
  - @geekmidas/logger@10.0.0-alpha.20
  - @geekmidas/services@10.0.0-alpha.20

## 10.0.0-alpha.19

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.19
  - @geekmidas/logger@10.0.0-alpha.19
  - @geekmidas/services@10.0.0-alpha.19

## 10.0.0-alpha.18

### Patch Changes

- [#73](https://github.com/geekmidas/toolbox/pull/73) [`f1db506`](https://github.com/geekmidas/toolbox/commit/f1db506b9450628ccdb07f33f8fdda5bb5d006a8) Thanks [@geekmidas](https://github.com/geekmidas)! - A fresh fullstack scaffold's `pnpm test` runs

  Found by moving a real project onto v10: every fault below stood between a
  newly scaffolded workspace and its first green test run.

  `gkm test` from the workspace root skipped the reconcile. The root is not an
  app, so loading the app failed and the command fell back to the pre-constructs
  path: no container started, and every URL was whatever the stored secrets said,
  on ports nothing listened on. The root is exactly where the scaffold's own
  `pnpm test` runs it from. The workspace is now loaded there too, and what it
  declares is reconciled the same as from inside an app.

  The monorepo scaffold migrated as the wrong role. Its `test/globalSetup.ts` and
  `kysely.config.ts` rendered `Credentials.DATABASE_URL ?? Credentials.DATABASE_URL`
  — a branch from before the root declared the database — so migrations connected
  as the runtime role, which may create nothing, and failed on the first table.
  Both layouts now read `DATABASE_OWNER_URL`.

  `PostgresMigrator`'s cleanup dropped a database it had not created. `gkm test`
  provisions the test database before the suite starts, with an owner role that
  may migrate it but not drop it, so an otherwise green run ended in "must be
  owner of database". The cleanup now drops only a database `start()` created.

  Renaming a stage broke the local edge. Caddy imports every file under
  `.gkm/caddy-sites/`, and the old stage's file declared the same hosts as the
  new one's, so Caddy refused the config as ambiguous and never became healthy.
  Files for stages that are neither the local stage nor `test` are now removed
  when the routes are written.

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.18
  - @geekmidas/logger@10.0.0-alpha.18
  - @geekmidas/services@10.0.0-alpha.18

## 10.0.0-alpha.17

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.17
  - @geekmidas/logger@10.0.0-alpha.17
  - @geekmidas/services@10.0.0-alpha.17

## 10.0.0-alpha.16

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.16
  - @geekmidas/logger@10.0.0-alpha.16
  - @geekmidas/services@10.0.0-alpha.16

## 10.0.0-alpha.15

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.15
  - @geekmidas/logger@10.0.0-alpha.15
  - @geekmidas/services@10.0.0-alpha.15

## 10.0.0-alpha.14

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.14
  - @geekmidas/logger@10.0.0-alpha.14
  - @geekmidas/services@10.0.0-alpha.14

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

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.13
  - @geekmidas/logger@10.0.0-alpha.13
  - @geekmidas/services@10.0.0-alpha.13

## 10.0.0-alpha.12

### Patch Changes

- [#55](https://github.com/geekmidas/toolbox/pull/55) [`2506320`](https://github.com/geekmidas/toolbox/commit/25063205435096b28159354cd1594af0ef4cbe19) Thanks [@geekmidas](https://github.com/geekmidas)! - `memoryAdapter` passes better-auth's own adapter conformance suites again

  better-auth 1.7 moved the harness `runAdapterTest` came from into
  `@better-auth/test-utils/adapter`. `memoryAdapter` now runs its basic,
  auth-flow and case-insensitive suites (129 tests), plus a sign-up → sign-in →
  session-from-cookie check through `auth.handler`.

  The suites found two gaps, both fixed:

  - **`mode: 'insensitive'` was ignored.** `eq`, `ne`, `in`, `not_in`,
    `contains`, `starts_with` and `ends_with` now compare case-folded strings when
    asked to, as the SQL adapters do.
  - **`findMany` ignored `select`**, and once it didn't, looked selected fields up
    by their schema name instead of their stored name — so a schema that renames
    a field (`fields: { email: 'email_address' }`) lost it.

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.12
  - @geekmidas/logger@10.0.0-alpha.12
  - @geekmidas/services@10.0.0-alpha.12

## 10.0.0-alpha.11

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.11
  - @geekmidas/logger@10.0.0-alpha.11
  - @geekmidas/services@10.0.0-alpha.11

## 10.0.0-alpha.10

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.10
  - @geekmidas/logger@10.0.0-alpha.10
  - @geekmidas/services@10.0.0-alpha.10

## 10.0.0-alpha.9

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.9
  - @geekmidas/logger@10.0.0-alpha.9
  - @geekmidas/services@10.0.0-alpha.9

## 10.0.0-alpha.8

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.8
  - @geekmidas/logger@10.0.0-alpha.8
  - @geekmidas/services@10.0.0-alpha.8

## 10.0.0-alpha.7

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.7
  - @geekmidas/logger@10.0.0-alpha.7
  - @geekmidas/services@10.0.0-alpha.7

## 10.0.0-alpha.6

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.6
  - @geekmidas/logger@10.0.0-alpha.6
  - @geekmidas/services@10.0.0-alpha.6

## 10.0.0-alpha.5

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.5
  - @geekmidas/logger@10.0.0-alpha.5
  - @geekmidas/services@10.0.0-alpha.5

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

- [`dce9588`](https://github.com/geekmidas/toolbox/commit/dce958803067a24ec3c9ecbba2c76fd00d971904) Thanks [@geekmidas](https://github.com/geekmidas)! - A port conflict no longer costs the whole test run

  Only Postgres had an overridable host port. Every other service in
  `docker-compose.yml` was fixed, so a developer with another project's Redis on
  6379 could not run this suite — and not in the sense of losing a few tests: a
  `globalSetup` that cannot start its container aborts collection, so vitest
  reports _no tests_, which reads exactly like a suite that passed.

  Every host port is now overridable, under the names `gkm init` already
  generates for scaffolded projects (`REDIS_HOST_PORT`, `SRH_HOST_PORT`,
  `MINIO_API_HOST_PORT`, …). The suites read the same variables through one
  module, so they connect to wherever the container was actually published —
  including `HonoEndpointAdaptor.pgboss-publisher.spec.ts`, which hardcoded 5432
  and so tested against whichever project happened to own it.

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.4
  - @geekmidas/logger@10.0.0-alpha.4
  - @geekmidas/services@10.0.0-alpha.4

## 10.0.0-alpha.3

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.3
  - @geekmidas/logger@10.0.0-alpha.3
  - @geekmidas/services@10.0.0-alpha.3

## 10.0.0-alpha.2

### Patch Changes

- [#29](https://github.com/geekmidas/toolbox/pull/29) [`96ec6a7`](https://github.com/geekmidas/toolbox/commit/96ec6a73efbfaaf5f17f378ac3647d3c970297a9) Thanks [@geekmidas](https://github.com/geekmidas)! - Two more packages could not be installed

  Found by the check added alongside them, which packs the tarballs and installs
  each into an empty project.

  **`@geekmidas/testkit` declared no dependencies at all** while importing
  `EnvironmentParser`, `ConsoleLogger` and `serviceContext` as values from
  `@geekmidas/envkit`, `@geekmidas/logger` and `@geekmidas/services`. All three
  were optional peers. They are dependencies.

  **`@geekmidas/telescope` could not be installed beside `@geekmidas/logger`.**
  It required `pino@^9.0.0`; logger requires `pino@~10.0.0`. The two are
  mutually exclusive, so any consumer with both got `ERESOLVE` and no install at
  all. Widened to `^9.0.0 || ^10.0.0`, matching how the same package already
  treats `pino-abstract-transport`. Its `@geekmidas/logger` peer also became a
  dependency — `redact.ts` imports `DEFAULT_REDACT_PATHS` from it as a value,
  from the root entry.

- Updated dependencies [[`05ce914`](https://github.com/geekmidas/toolbox/commit/05ce91446ba29d5158a2a5c010f7bf9c00f761eb)]:
  - @geekmidas/logger@10.0.0-alpha.2
  - @geekmidas/envkit@10.0.0-alpha.2
  - @geekmidas/services@10.0.0-alpha.2

## 10.0.0-alpha.1

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.1
  - @geekmidas/logger@10.0.0-alpha.1
  - @geekmidas/services@10.0.0-alpha.1

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
  - @geekmidas/envkit@10.0.0-alpha.0
  - @geekmidas/logger@10.0.0-alpha.0
  - @geekmidas/services@10.0.0-alpha.0

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
  - @geekmidas/envkit@9.0.2
  - @geekmidas/logger@9.0.2
  - @geekmidas/services@9.0.2

## 3.1.1

### Patch Changes

- 🐛 [#11](https://github.com/geekmidas/toolbox/pull/11) [`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309) Thanks [@geekmidas](https://github.com/geekmidas)! - Patch release across all packages to realign published versions with the
  registry. The previous release only published the four packages that had
  version bumps; the remaining packages failed with "cannot publish over the
  previously published versions" because their versions were unchanged.
- Updated dependencies [[`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309)]:
  - @geekmidas/envkit@1.1.1
  - @geekmidas/logger@1.0.3
  - @geekmidas/services@2.0.1

## 3.1.0

### Minor Changes

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

## 3.0.0

### Patch Changes

- Updated dependencies [[`7323f34`](https://github.com/geekmidas/toolbox/commit/7323f34176d63170dd53450889ac0b5959420c3c), [`79e2929`](https://github.com/geekmidas/toolbox/commit/79e292978d3dbc8927e25814bdb051d1c380600a)]:
  - @geekmidas/envkit@1.1.0
  - @geekmidas/services@2.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [[`811d740`](https://github.com/geekmidas/toolbox/commit/811d740ae3875d59ad1b0dc50261266963c8cb76)]:
  - @geekmidas/services@1.1.0

## 1.0.9

### Patch Changes

- 🐛 [#3](https://github.com/geekmidas/toolbox/pull/3) [`42fda53`](https://github.com/geekmidas/toolbox/commit/42fda532bdf4489a3352f6a684f5f30beafccedd) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix stale logger from service initialization

- Updated dependencies [[`42fda53`](https://github.com/geekmidas/toolbox/commit/42fda532bdf4489a3352f6a684f5f30beafccedd)]:
  - @geekmidas/services@1.0.4

## 1.0.8

### Patch Changes

- ✨ [`351f73b`](https://github.com/geekmidas/toolbox/commit/351f73b032bc0742b7f611a9fbcdfc85bbfd69a8) Thanks [@geekmidas](https://github.com/geekmidas)! - Update request context and add support for trpc

- Updated dependencies [[`351f73b`](https://github.com/geekmidas/toolbox/commit/351f73b032bc0742b7f611a9fbcdfc85bbfd69a8)]:
  - @geekmidas/services@1.0.3

## 1.0.7

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

- Updated dependencies [[`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651)]:
  - @geekmidas/envkit@1.0.7
  - @geekmidas/logger@1.0.2

## 1.0.6

### Patch Changes

- 🐛 [`b8a17e3`](https://github.com/geekmidas/toolbox/commit/b8a17e33de415a5d749297f7840564e824609a92) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix global zod registry and fix this reference on test extensions

## 1.0.5

### Patch Changes

- 🐛 [`184c254`](https://github.com/geekmidas/toolbox/commit/184c2547a674d37c48948a9922c947ca98ff1f17) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix script parsing

## 1.0.4

### Patch Changes

- ✨ [`7815080`](https://github.com/geekmidas/toolbox/commit/781508030df7f67881f5e79349338f62b35ed684) Thanks [@geekmidas](https://github.com/geekmidas)! - Add after create hook for init scripts

## 1.0.3

### Patch Changes

- ✨ [`e99f8cb`](https://github.com/geekmidas/toolbox/commit/e99f8cbb95fa5b818d94ee99b308c2ac0b239e0b) Thanks [@geekmidas](https://github.com/geekmidas)! - Add initialization scripts for postgres

## 1.0.2

### Patch Changes

- ✨ [`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661) Thanks [@geekmidas](https://github.com/geekmidas)! - Add pg-boss event publisher/subscriber, CLI setup and upgrade commands, and secrets sync via AWS SSM
  - ✨ **@geekmidas/events**: Add pg-boss backend for event publishing and subscribing with connection string support
  - ✨ **@geekmidas/cli**: Add `gkm setup` command for dev environment initialization, `gkm upgrade` command with workspace detection, and secrets push/pull via AWS SSM Parameter Store
  - 🐛 **@geekmidas/testkit**: Fix database creation race condition in PostgresMigrator
  - ✨ **@geekmidas/constructs**: Add integration tests for pg-boss with HonoEndpoint

## 1.0.1

### Patch Changes

- ✨ [`3b6d7d9`](https://github.com/geekmidas/toolbox/commit/3b6d7d9ed41dc08675395d937248a8ab754af9e1) Thanks [@geekmidas](https://github.com/geekmidas)! - Add state provider configuration to workspace config

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release

### Patch Changes

- Updated dependencies [[`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8)]:
  - @geekmidas/envkit@1.0.0
  - @geekmidas/logger@1.0.0
