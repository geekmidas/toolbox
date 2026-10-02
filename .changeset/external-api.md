---
'@geekmidas/manifest': patch
'@geekmidas/constructs': patch
'@geekmidas/cli': patch
'@geekmidas/cloud': patch
'@geekmidas/envkit': patch
'@geekmidas/testkit': patch
---

`ExternalApi` for third-party HTTP APIs, `<ID>_CREDENTIALS`, and `faker` and `signIn()` in feature tests

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
  - **Feature tests** serve an app fake in-process through MSW, and
    `gkm dev --fake` serves it on an allocated port.
  - **An image fake** runs as a container on an allocated host port.
  - **No fake:** an external API without one fails `gkm test` or
    `gkm dev --fake` with `NoFake`.
- **Deploying** resolves the URL for the stage (`NoUrlForStage` when it has
  none) and the credentials from the stage's secrets, on Dokploy and on AWS.
- **`Credential` provides `<ID>_CREDENTIALS`**, renamed from `<ID>_CREDENTIAL`.
- **AWS `Credential` links under `<ID>_CREDENTIALS`.** It reported SST's
  secret type, which resolves to the bare `<ID>`, so a function that declared
  `STRIPE_CREDENTIALS` was linked to nothing. It now has its own type
  (`gkm:aws:Credential`) and resolver, and holds the `sst.Secret` under the
  same name, so values already set with `sst secret set Stripe …` still apply.
- **Dokploy now resolves credentials.** A stage missing `<ID>_CREDENTIALS` for
  a `Credential` or an `ExternalApi` fails `gkm deploy` with
  `MissingSuppliedSecret`, naming the `gkm secrets:set` command. Before this,
  Dokploy never resolved a credential at all.
- **Feature tests get `faker`**, testkit's faker seeded from the test's name.
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

- **Security: Dokploy no longer derives secrets from repo facts.** An auth
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
  - **Removed:** `getAppNameFromCwd` and `getAppNameFromPackageJson`.

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
