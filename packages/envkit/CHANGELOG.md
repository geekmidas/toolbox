# @geekmidas/envkit

## 10.0.0-alpha.86

## 10.0.0-alpha.85

## 10.0.0-alpha.84

## 10.0.0-alpha.83

## 10.0.0-alpha.82

## 10.0.0-alpha.81

## 10.0.0-alpha.80

## 10.0.0-alpha.79

## 10.0.0-alpha.78

## 10.0.0-alpha.77

## 10.0.0-alpha.76

## 10.0.0-alpha.75

## 10.0.0-alpha.74

## 10.0.0-alpha.73

## 10.0.0-alpha.72

## 10.0.0-alpha.71

## 10.0.0-alpha.70

## 10.0.0-alpha.69

## 10.0.0-alpha.68

## 10.0.0-alpha.67

## 10.0.0-alpha.66

## 10.0.0-alpha.65

## 10.0.0-alpha.64

## 10.0.0-alpha.63

## 10.0.0-alpha.62

## 10.0.0-alpha.61

## 10.0.0-alpha.60

## 10.0.0-alpha.59

## 10.0.0-alpha.58

## 10.0.0-alpha.57

## 10.0.0-alpha.56

## 10.0.0-alpha.55

## 10.0.0-alpha.54

## 10.0.0-alpha.53

## 10.0.0-alpha.52

## 10.0.0-alpha.51

## 10.0.0-alpha.50

## 10.0.0-alpha.49

## 10.0.0-alpha.48

## 10.0.0-alpha.47

### Minor Changes

- [#124](https://github.com/geekmidas/toolbox/pull/124) [`10ef53d`](https://github.com/geekmidas/toolbox/commit/10ef53d921d519afa62c773a6682581e19c06b1e) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: `Encryption` — a key that encrypts what the application stores

  `new Encryption('Pii')` gives a handler that `.dependsOn([pii])` `services.pii.encrypt`, `decrypt`, `index` (a blind index, so an encrypted column can still be looked up) and `reencrypt`. The app names no cipher: the construct provides one `PII_URL` whose scheme picks the backend.

  - **Locally and in tests**, an `aes256gcm://` keyring derived from the project and stage, like a secret — nothing to set.
  - **On a server stage**, a keyring generated into the stage's secrets on its first deploy and never replaced by a redeploy.
  - **On AWS**, envelope encryption under a KMS key that rotates yearly, and a KMS HMAC key for the index, each granted to exactly the functions that depend on the construct (`kms:GenerateDataKey`/`kms:Decrypt`, `kms:GenerateMac`). `@aws-sdk/client-kms` is an optional peer, loaded only for a `kms://` URL.

  Every ciphertext names the key that wrote it and is bound to its construct. `gkm encryption:rotate <Id> --stage <stage>` adds a key and keeps the old ones; after a `reencrypt` sweep, `gkm encryption:retire <Id> <key> --stage <stage>` removes one, and a value still under an old key warns the first time it is decrypted. The index key never rotates.

## 10.0.0-alpha.46

## 10.0.0-alpha.45

## 10.0.0-alpha.44

## 10.0.0-alpha.43

## 10.0.0-alpha.42

## 10.0.0-alpha.41

## 10.0.0-alpha.40

## 10.0.0-alpha.39

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

## 10.0.0-alpha.37

## 10.0.0-alpha.36

## 10.0.0-alpha.35

## 10.0.0-alpha.34

## 10.0.0-alpha.33

## 10.0.0-alpha.32

## 10.0.0-alpha.31

## 10.0.0-alpha.30

## 10.0.0-alpha.29

## 10.0.0-alpha.28

## 10.0.0-alpha.27

## 10.0.0-alpha.26

## 10.0.0-alpha.25

## 10.0.0-alpha.24

## 10.0.0-alpha.23

## 10.0.0-alpha.22

## 10.0.0-alpha.21

## 10.0.0-alpha.20

## 10.0.0-alpha.19

## 10.0.0-alpha.18

## 10.0.0-alpha.17

## 10.0.0-alpha.16

## 10.0.0-alpha.15

## 10.0.0-alpha.14

## 10.0.0-alpha.13

## 10.0.0-alpha.12

## 10.0.0-alpha.11

## 10.0.0-alpha.10

## 10.0.0-alpha.9

## 10.0.0-alpha.8

## 10.0.0-alpha.7

## 10.0.0-alpha.6

## 10.0.0-alpha.5

## 10.0.0-alpha.4

## 10.0.0-alpha.3

## 10.0.0-alpha.2

## 10.0.0-alpha.1

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

## 1.1.1

### Patch Changes

- 🐛 [#11](https://github.com/geekmidas/toolbox/pull/11) [`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309) Thanks [@geekmidas](https://github.com/geekmidas)! - Patch release across all packages to realign published versions with the
  registry. The previous release only published the four packages that had
  version bumps; the remaining packages failed with "cannot publish over the
  previously published versions" because their versions were unchanged.

## 1.1.0

### Minor Changes

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`7323f34`](https://github.com/geekmidas/toolbox/commit/7323f34176d63170dd53450889ac0b5959420c3c) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(envkit): add Queue resolver and publisher connection strings (sst)

  `@geekmidas/envkit/sst` gains a `Queue` resource type (`ResourceType.Queue` /
  `SSTQueue`) whose resolver emits `<NAME>_URL`, `<NAME>_ARN`, and a
  `<NAME>_PUBLISHER_CONNECTION_STRING` (`sqs://?queueUrl=…`). The SNS topic
  resolver now also emits `<NAME>_PUBLISHER_CONNECTION_STRING` (`sns://?topicArn=…`).

  These name-namespaced connection strings are what `@geekmidas/events`'
  `Publisher.fromConnectionString` consumes, so a linked queue/topic resolves to a
  ready-to-use publisher (the protocol selects the transport — SQS/SNS deployed,
  or a local backend in dev).

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`79e2929`](https://github.com/geekmidas/toolbox/commit/79e292978d3dbc8927e25814bdb051d1c380600a) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(envkit): add an SST env-var validator to `@geekmidas/envkit/sst`

  Adds `EnvValidator`, `resolveEnvKeys`, and `EnvValidationError` alongside
  `SstEnvironmentBuilder`, so a deployable unit's required environment variables
  can be validated **before** deploy — at `sst.config.ts` synth time.

  - `resolveEnvKeys` derives the env-var keys a set of linked resources will
    produce by replaying the **same** `sstResolvers` used at runtime (reduced to
    the resource `type`, so no SST `Output` value is ever read). The infra-time
    validator and the runtime resolution share a single source of truth — they
    cannot drift, and there is no parallel suffix table to maintain.
  - `EnvValidationError` is a structured, catchable error carrying `.missing`,
    `.available`, `.suggestions`, and `.context`. Its message names the failing
    unit and gives a nearest-match "did you mean DB_URL?" hint per missing
    variable (edit-distance + token-overlap).
  - Platform whitelists are **exported, never assumed** — SST deploys to AWS, GCP,
    and Cloudflare. `AWS_RUNTIME_ENV_VARS`, `GCP_RUNTIME_ENV_VARS`,
    `CLOUDFLARE_RUNTIME_ENV_VARS`, the `PLATFORM_ENV_VARS` registry, and
    `platformEnvVars(platform)` are exported; the caller opts in via
    `new EnvValidator(links, { platform })`. Optional vars are marked with a
    trailing `?`.
  - `getProvidersForEnvVars(requested)` returns the link names that provide a
    requested var, for least-privilege linking (attach only the links a unit needs).

## 1.0.7

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

## 1.0.6

### Patch Changes

- ✨ [`e90d1fa`](https://github.com/geekmidas/toolbox/commit/e90d1fa0838769b346a98f0762c77295ef4fd09b) Thanks [@geekmidas](https://github.com/geekmidas)! - Add url support for database

## 1.0.5

### Patch Changes

- ✨ [`56e71bc`](https://github.com/geekmidas/toolbox/commit/56e71bcb57a5305270909f695a4539fa504a463b) Thanks [@geekmidas](https://github.com/geekmidas)! - Add optional params support and open api on build

## 1.0.4

### Patch Changes

- 🐛 [`a483d4c`](https://github.com/geekmidas/toolbox/commit/a483d4c193d27673ccad2aeed6f56b1c5708b5b4) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix credentials injection to work with esm/cjs

## 1.0.3

### Patch Changes

- ✨ [`bf094cd`](https://github.com/geekmidas/toolbox/commit/bf094cd29df2d18e75213f0976c0c9ff8047d14c) Thanks [@geekmidas](https://github.com/geekmidas)! - Add legacy dynamo resolution

## 1.0.2

### Patch Changes

- ✨ [`bfa41ad`](https://github.com/geekmidas/toolbox/commit/bfa41ad86c74c73a98e3922a536805fdf65d7607) Thanks [@geekmidas](https://github.com/geekmidas)! - Add support for dynamo links

## 1.0.1

### Patch Changes

- 🐛 [`8bdda11`](https://github.com/geekmidas/toolbox/commit/8bdda11f5c0f7c2eaea605befb0eca38ecc56e44) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix iam resolution for authorizers and fixed exported types for envkit

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release
