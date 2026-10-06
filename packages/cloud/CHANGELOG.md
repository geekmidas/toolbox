# @geekmidas/cloud

## 10.0.0-alpha.55

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.55
  - @geekmidas/envkit@10.0.0-alpha.55
  - @geekmidas/events@10.0.0-alpha.55
  - @geekmidas/manifest@10.0.0-alpha.55
  - @geekmidas/storage@10.0.0-alpha.55

## 10.0.0-alpha.54

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.54
  - @geekmidas/envkit@10.0.0-alpha.54
  - @geekmidas/events@10.0.0-alpha.54
  - @geekmidas/manifest@10.0.0-alpha.54
  - @geekmidas/storage@10.0.0-alpha.54

## 10.0.0-alpha.53

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.53
  - @geekmidas/envkit@10.0.0-alpha.53
  - @geekmidas/events@10.0.0-alpha.53
  - @geekmidas/manifest@10.0.0-alpha.53
  - @geekmidas/storage@10.0.0-alpha.53

## 10.0.0-alpha.52

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.52
  - @geekmidas/envkit@10.0.0-alpha.52
  - @geekmidas/events@10.0.0-alpha.52
  - @geekmidas/manifest@10.0.0-alpha.52
  - @geekmidas/storage@10.0.0-alpha.52

## 10.0.0-alpha.51

### Minor Changes

- [#134](https://github.com/geekmidas/toolbox/pull/134) [`c0279b9`](https://github.com/geekmidas/toolbox/commit/c0279b98545445b1eceedc314d92d0fbd91953e3) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: `fromManifest`'s overrides are typed from the manifest

  The overrides were `Record<string, Record<string, unknown>>`, so a misspelt id or a prop nothing reads went through without complaint, and a missing database `vpc` or mail `from` only showed up at synth, partway through a deploy. They are now `ManifestOverrides<typeof constructs, typeof backends>`:
  - **Keys:** only the manifest's own construct ids.
  - **Values:** what each construct's kind actually takes. Props the declaration already decides are left out, such as a database's `schema`, a queue's `fifo` or a site's `path`.
  - **Required:** what the synth won't guess. That means a database's `vpc` and mail's `from`. Some depend on the backend: ElastiCache needs `vpc`, and Resend or SMTP mail needs `url`.
  - **No key:** kinds with nothing to override, such as a database's reader or schema, a cache that lives in a database, functions and crons.

  `ComponentOverrides` is removed, and `overrides` is now a required argument (pass `{}` when there is nothing to say). A manifest typed only as `ConstructManifest` still accepts the untyped record. The synth-time checks stay for anything that isn't typed.

### Patch Changes

- Updated dependencies [[`1aa7b43`](https://github.com/geekmidas/toolbox/commit/1aa7b434e28ef24e4bdf057847b510fa9cfa1fcf)]:
  - @geekmidas/manifest@10.0.0-alpha.51
  - @geekmidas/db@10.0.0-alpha.51
  - @geekmidas/envkit@10.0.0-alpha.51
  - @geekmidas/events@10.0.0-alpha.51
  - @geekmidas/storage@10.0.0-alpha.51

## 10.0.0-alpha.50

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.50
  - @geekmidas/envkit@10.0.0-alpha.50
  - @geekmidas/events@10.0.0-alpha.50
  - @geekmidas/manifest@10.0.0-alpha.50
  - @geekmidas/storage@10.0.0-alpha.50

## 10.0.0-alpha.49

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.49
  - @geekmidas/envkit@10.0.0-alpha.49
  - @geekmidas/events@10.0.0-alpha.49
  - @geekmidas/manifest@10.0.0-alpha.49
  - @geekmidas/storage@10.0.0-alpha.49

## 10.0.0-alpha.48

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.48
  - @geekmidas/envkit@10.0.0-alpha.48
  - @geekmidas/events@10.0.0-alpha.48
  - @geekmidas/manifest@10.0.0-alpha.48
  - @geekmidas/storage@10.0.0-alpha.48

## 10.0.0-alpha.47

### Minor Changes

- [#124](https://github.com/geekmidas/toolbox/pull/124) [`10ef53d`](https://github.com/geekmidas/toolbox/commit/10ef53d921d519afa62c773a6682581e19c06b1e) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: `Encryption` — a key that encrypts what the application stores

  `new Encryption('Pii')` gives a handler that `.dependsOn([pii])` `services.pii.encrypt`, `decrypt`, `index` (a blind index, so an encrypted column can still be looked up) and `reencrypt`. The app names no cipher: the construct provides one `PII_URL` whose scheme picks the backend.
  - **Locally and in tests**, an `aes256gcm://` keyring derived from the project and stage, like a secret — nothing to set.
  - **On a server stage**, a keyring generated into the stage's secrets on its first deploy and never replaced by a redeploy.
  - **On AWS**, envelope encryption under a KMS key that rotates yearly, and a KMS HMAC key for the index, each granted to exactly the functions that depend on the construct (`kms:GenerateDataKey`/`kms:Decrypt`, `kms:GenerateMac`). `@aws-sdk/client-kms` is an optional peer, loaded only for a `kms://` URL.

  Every ciphertext names the key that wrote it and is bound to its construct. `gkm encryption:rotate <Id> --stage <stage>` adds a key and keeps the old ones; after a `reencrypt` sweep, `gkm encryption:retire <Id> <key> --stage <stage>` removes one, and a value still under an old key warns the first time it is decrypted. The index key never rotates.

### Patch Changes

- Updated dependencies [[`f1fc3e7`](https://github.com/geekmidas/toolbox/commit/f1fc3e7e9a8fdc995e3a4b957e29ce451f6fd959), [`10ef53d`](https://github.com/geekmidas/toolbox/commit/10ef53d921d519afa62c773a6682581e19c06b1e)]:
  - @geekmidas/manifest@10.0.0-alpha.47
  - @geekmidas/envkit@10.0.0-alpha.47
  - @geekmidas/db@10.0.0-alpha.47
  - @geekmidas/events@10.0.0-alpha.47
  - @geekmidas/storage@10.0.0-alpha.47

## 10.0.0-alpha.46

### Minor Changes

- [#122](https://github.com/geekmidas/toolbox/pull/122) [`31585c5`](https://github.com/geekmidas/toolbox/commit/31585c55f294520ce77483c653c543a835133d6e) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: `gkm build` builds for where the project deploys; the legacy providers are gone, and an SST deploy mounts its routes
  - **No legacy providers.** `aws-apigatewayv1`, `aws-apigatewayv2` and `aws-lambda` are gone, along with `--providers` and the `providers` block in `gkm.config.ts` (`providers.server.port`/`production`/`enableOpenApi` and `providers.dokploy` included). A bare `gkm build` follows `deploy.default`; `--provider aws|server` remains only as an override, which is what a Dockerfile's `gkm build --provider server` is.
  - 🐛 **`sst` is a deploy target.** `deploy: { default: 'sst' }` builds one Lambda per construct and resolves the AWS backends (cache, storage, events) everywhere, `gkm dev` included. Without it an SST project was normalised into a Dokploy one. `gkm init --deploy sst` writes it, and its deploy scripts are `gkm build && sst deploy --stage <stage>`.
  - **One manifest, the application's, written by the root.** A root `gkm build` builds every backend app in its own process, then writes one `.gkm/manifest/aws.ts` (or `server.ts`) from everything the workspace declares, with each app's routes folded into its own surface; turbo builds only the frontends. An app's own `gkm build` writes its handlers (`<app>/.gkm/aws/{routes,functions,crons,queues,subscribers}`) and no manifest. Handler paths are measured from the root, where `sst.config.ts` runs. A build clears what it superseded: the per-provider trees, an app-level manifest, and the other target's manifest. `gkm init` maps `@<name>/manifest` to it in the root tsconfig, and no longer exports a `./endpoints` the AWS build never writes.
  - **The manifest is the declarations, and nothing else.** `.gkm/manifest/<target>.ts` exports `constructs` and `backends`; the `export const manifest = { routes, functions, crons, … }` table and its derived types (`Route`, `Cron`, `RoutePartition`, …) are gone, as are partitioned manifests and the `{ paths, partition }` form of `constructs`, which only shaped them — `constructs` is a glob or a list of globs. Every endpoint is on its surface on both targets — its own Lambda on AWS, the app's entry on a server — functions and crons are declarations of their own, and a queue's worker and a topic's subscribers sit inside them. `@geekmidas/manifest` drops `Manifest`, `ManifestField` and `flattenManifestField`; `@geekmidas/cli/reconcile` drops `writeManifestModule` and `MANIFEST_PATH`.
  - 🔥 **`fromManifest` deploys functions and crons.** Each is a Lambda linked to its own edges, in the database's VPC when it reaches one; a function gets an IAM-authorized URL, a cron its schedule. `Api.fromManifest`, `Function.fromManifest` and `Cron.fromManifest`, which read the deleted table, are removed.
  - **`fromManifest` mounts each surface's endpoints.** An API Gateway used to deploy with no routes. Each endpoint is now its own Lambda, linked only to what it depends on, in the database's VPC when it reaches one (queue consumers too). `iam` is enforced by the gateway; every other authorizer runs in the handler.
  - **A `--production` server runs its background work.** Queues, crons and subscribers are wired into the production entry. They used to be left out unless `providers.server.production.subscribers` said `'include'`, so a Docker deploy never ran its worker.
  - **`gkm deploy:init` writes nothing into `gkm.config.ts`.** The `providers.dokploy` block it wrote was never read; the ids are rediscovered by name and kept in the state file.

### Patch Changes

- Updated dependencies [[`31585c5`](https://github.com/geekmidas/toolbox/commit/31585c55f294520ce77483c653c543a835133d6e)]:
  - @geekmidas/manifest@10.0.0-alpha.46
  - @geekmidas/db@10.0.0-alpha.46
  - @geekmidas/envkit@10.0.0-alpha.46
  - @geekmidas/events@10.0.0-alpha.46
  - @geekmidas/storage@10.0.0-alpha.46

## 10.0.0-alpha.45

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.45
  - @geekmidas/envkit@10.0.0-alpha.45
  - @geekmidas/events@10.0.0-alpha.45
  - @geekmidas/manifest@10.0.0-alpha.45
  - @geekmidas/storage@10.0.0-alpha.45

## 10.0.0-alpha.44

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.44
  - @geekmidas/envkit@10.0.0-alpha.44
  - @geekmidas/events@10.0.0-alpha.44
  - @geekmidas/manifest@10.0.0-alpha.44
  - @geekmidas/storage@10.0.0-alpha.44

## 10.0.0-alpha.43

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.43
  - @geekmidas/envkit@10.0.0-alpha.43
  - @geekmidas/events@10.0.0-alpha.43
  - @geekmidas/manifest@10.0.0-alpha.43
  - @geekmidas/storage@10.0.0-alpha.43

## 10.0.0-alpha.42

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.42
  - @geekmidas/envkit@10.0.0-alpha.42
  - @geekmidas/events@10.0.0-alpha.42
  - @geekmidas/manifest@10.0.0-alpha.42
  - @geekmidas/storage@10.0.0-alpha.42

## 10.0.0-alpha.41

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.41
  - @geekmidas/envkit@10.0.0-alpha.41
  - @geekmidas/events@10.0.0-alpha.41
  - @geekmidas/manifest@10.0.0-alpha.41
  - @geekmidas/storage@10.0.0-alpha.41

## 10.0.0-alpha.40

### Patch Changes

- Updated dependencies [[`e8d29dd`](https://github.com/geekmidas/toolbox/commit/e8d29dd29084e59b40a3b5bd1a2806c3b9c93f6d)]:
  - @geekmidas/events@10.0.0-alpha.40
  - @geekmidas/db@10.0.0-alpha.40
  - @geekmidas/envkit@10.0.0-alpha.40
  - @geekmidas/manifest@10.0.0-alpha.40
  - @geekmidas/storage@10.0.0-alpha.40

## 10.0.0-alpha.39

### Minor Changes

- [#111](https://github.com/geekmidas/toolbox/pull/111) [`087444c`](https://github.com/geekmidas/toolbox/commit/087444c16591656ab7d85b7713939982231cb1f2) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: Queues and topics are constructs, and events name their topic (#110)
  - A queue is built from a worker, `worker.queue('Emails').message(schema).handle(…)`: the queue and its one consumer, one construct. `q` and the public `QueueBuilder` export are gone. A producer depends on it, `.dependsOn([emails])`, and sends through `services.emails`.
  - ✨ A topic is `new Topic('Users', { events })`. `t` and `TopicBuilder` are gone.
  - 🔥 `.publisher(service)` is gone everywhere: from `RestApi`, endpoint, function, cron and subscriber builders, and `Worker`. A construct publishes with `.event(users, { type, payload, when? })`, repeatable across topics; each event goes through its own topic's publisher, and the topic lands in `services` exactly as `.dependsOn([users])` would put it. `Topic.publisher`, `Queue.publisher`, `derivedFrom` and `edgesWith` are deleted.
  - `TestEndpointAdaptor` / `TestFunctionAdaptor` / the MSW adaptor lose their `publisher` option: pass a recorder under the topic's name in `services`.
  - Discovery records what a worker-owned queue's consumer depends on under the worker.
  - SST: `fromManifest` subscribes each queue's consumer Lambda (`Queue.consume`), and skips `worker`, `cron` and `function` declarations instead of throwing `UnknownDeclarationKind`.

### Patch Changes

- Updated dependencies [[`087444c`](https://github.com/geekmidas/toolbox/commit/087444c16591656ab7d85b7713939982231cb1f2)]:
  - @geekmidas/manifest@10.0.0-alpha.39
  - @geekmidas/db@10.0.0-alpha.39
  - @geekmidas/envkit@10.0.0-alpha.39
  - @geekmidas/events@10.0.0-alpha.39
  - @geekmidas/storage@10.0.0-alpha.39

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
  - @geekmidas/manifest@10.0.0-alpha.38
  - @geekmidas/envkit@10.0.0-alpha.38
  - @geekmidas/db@10.0.0-alpha.38
  - @geekmidas/events@10.0.0-alpha.38
  - @geekmidas/storage@10.0.0-alpha.38

## 10.0.0-alpha.37

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.37
  - @geekmidas/envkit@10.0.0-alpha.37
  - @geekmidas/events@10.0.0-alpha.37
  - @geekmidas/manifest@10.0.0-alpha.37
  - @geekmidas/storage@10.0.0-alpha.37

## 10.0.0-alpha.36

### Patch Changes

- Updated dependencies [[`95cef66`](https://github.com/geekmidas/toolbox/commit/95cef66e07893be917b5d560a06618c60504b94e)]:
  - @geekmidas/manifest@10.0.0-alpha.36
  - @geekmidas/db@10.0.0-alpha.36
  - @geekmidas/envkit@10.0.0-alpha.36
  - @geekmidas/events@10.0.0-alpha.36
  - @geekmidas/storage@10.0.0-alpha.36

## 10.0.0-alpha.35

### Patch Changes

- [#102](https://github.com/geekmidas/toolbox/pull/102) [`78d87ac`](https://github.com/geekmidas/toolbox/commit/78d87ace5e9a6027c8bba74e0bb40260431f7912) Thanks [@geekmidas](https://github.com/geekmidas)! - `MobileApp`: an Expo app declared as a construct

  ```ts
  // constructs/app.ts
  export const app = new MobileApp("App", { path: "apps/app" }).dependsOn([
    api,
    auth,
  ]);
  ```

  Like a `StaticSite`, its `.dependsOn()` is the single fact everything a mobile
  app otherwise writes down by hand is derived from:
  - **Shaped like `StaticSite`:** `path`, `port?`, `config?` and
    `variant?` (`'expo'`), plus `scheme?`. A mobile app is given a port in the
    same stable order, and `gkm exec` hands it to Expo as `RCT_METRO_PORT`.
  - **A scheme per stage:** the project's name deployed (`shop`), suffixed
    locally (`shop-dev`), so a development build and the store build on one
    phone never answer each other's links. It arrives as `APP_SCHEME`.
  - **URLs a phone can reach:** `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_AUTH_URL`.
    Locally they're each server's own port, which the app points at the LAN
    address Metro served it from on a phone, or `10.0.2.2` on the Android
    emulator, instead of an edge hostname that only resolves on this machine.
  - **Trusted origins:** the scheme, in every surface it depends on. Locally that
    also covers the `exp://` origins Expo Go sends from, for this machine's exact
    LAN address and `localhost` on Metro's port, never a subnet.
  - ✨ **Better Auth's Expo plugin:** `BetterAuth` adds `expo()` itself when a
    mobile app depends on it. `@better-auth/expo` is an optional peer, and
    `ExpoPluginMissing` says to install it.
  - **Sign-in links a phone can open:** locally, a magic link the app asked for
    (its `callbackURL` is the scheme) is built on the auth server's LAN address,
    `AUTH_DEVICE_URL`. A browser's link is left alone.
  - **Signing in from the emailed link:** the server's Expo plugin carries the
    session back into the app as `?cookie=` (tested for the dev build's scheme
    and Expo Go). The scaffold's `useSessionFromLink()` stores it, merged with
    the client's `getSetCookie`, since the Expo client only does this for social
    sign-in.
  - **Deployed:** Dokploy and AWS trust the bare scheme. Neither builds the app;
    EAS and the stores do.

  `gkm init` with Expo scaffolds on Expo SDK 57 (React Native 0.86, with
  `react-native-worklets` for Reanimated 4), declares the app in
  `constructs/app.ts` and installs
  `@better-auth/expo` at the root. Its `app.config.ts` parses `APP_SCHEME` and
  both URLs into `extra.config`, which `config.ts` reads at runtime. `eas.json`
  no longer hard-codes local URLs. `gkm dev` lists the app with its scheme and
  the address devices reach.

  `@geekmidas/manifest` adds the `mobile-app` declaration kind, and
  `schemeBase`, `appScheme`, `mobileOrigins` and `isWebOrigin` for the rules all
  three targets share.

  See `docs/design/mobile-app.md`.

- Updated dependencies [[`78d87ac`](https://github.com/geekmidas/toolbox/commit/78d87ace5e9a6027c8bba74e0bb40260431f7912)]:
  - @geekmidas/manifest@10.0.0-alpha.35
  - @geekmidas/db@10.0.0-alpha.35
  - @geekmidas/envkit@10.0.0-alpha.35
  - @geekmidas/events@10.0.0-alpha.35
  - @geekmidas/storage@10.0.0-alpha.35

## 10.0.0-alpha.34

### Patch Changes

- [#99](https://github.com/geekmidas/toolbox/pull/99) [`1e71b33`](https://github.com/geekmidas/toolbox/commit/1e71b33cf55a6eff0f458b3b8e80ab98d1058acc) Thanks [@geekmidas](https://github.com/geekmidas)! - A database's owner role can create trusted extensions

  A migration running `create extension if not exists citext` failed with
  `permission denied to create extension "citext"`. The extension is trusted, so
  a role without superuser may create it, but Postgres also requires `CREATE` on
  the database itself. Each construct's owner role (the one migrations run as)
  was confined to its own schema, and nothing granted that.

  `roleStatements` now takes `database` for a database construct's roles and
  adds `GRANT CREATE ON DATABASE <database> TO <owner>`. All three provisioners
  pass it for a database, and only for a database:
  - reconcile (`gkm dev`, `gkm test`, `gkm migrate`);
  - the Dokploy deploy;
  - the AWS bootstrap Lambda.

  A schema tenant's owner (`.schema('AuthDatabase')`) is unchanged and stays
  confined to its own schema. The app's runtime role is untouched.

  **Existing databases** get the grant on the next reconcile or deploy. The
  statement is idempotent.

- Updated dependencies [[`1e71b33`](https://github.com/geekmidas/toolbox/commit/1e71b33cf55a6eff0f458b3b8e80ab98d1058acc)]:
  - @geekmidas/db@10.0.0-alpha.34
  - @geekmidas/envkit@10.0.0-alpha.34
  - @geekmidas/events@10.0.0-alpha.34
  - @geekmidas/manifest@10.0.0-alpha.34
  - @geekmidas/storage@10.0.0-alpha.34

## 10.0.0-alpha.33

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.33
  - @geekmidas/envkit@10.0.0-alpha.33
  - @geekmidas/events@10.0.0-alpha.33
  - @geekmidas/manifest@10.0.0-alpha.33
  - @geekmidas/storage@10.0.0-alpha.33

## 10.0.0-alpha.32

### Patch Changes

- Updated dependencies [[`9b647d0`](https://github.com/geekmidas/toolbox/commit/9b647d09e28ba095178d33613ee4a9e91b8eb47d)]:
  - @geekmidas/manifest@10.0.0-alpha.32
  - @geekmidas/db@10.0.0-alpha.32
  - @geekmidas/envkit@10.0.0-alpha.32
  - @geekmidas/events@10.0.0-alpha.32
  - @geekmidas/storage@10.0.0-alpha.32

## 10.0.0-alpha.31

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.31
  - @geekmidas/envkit@10.0.0-alpha.31
  - @geekmidas/events@10.0.0-alpha.31
  - @geekmidas/manifest@10.0.0-alpha.31
  - @geekmidas/storage@10.0.0-alpha.31

## 10.0.0-alpha.30

### Patch Changes

- Updated dependencies [[`58eba5c`](https://github.com/geekmidas/toolbox/commit/58eba5cd5bc0e76565668bd9a48d836dd622ef98)]:
  - @geekmidas/manifest@10.0.0-alpha.30
  - @geekmidas/db@10.0.0-alpha.30
  - @geekmidas/envkit@10.0.0-alpha.30
  - @geekmidas/events@10.0.0-alpha.30
  - @geekmidas/storage@10.0.0-alpha.30

## 10.0.0-alpha.29

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.29
  - @geekmidas/envkit@10.0.0-alpha.29
  - @geekmidas/events@10.0.0-alpha.29
  - @geekmidas/manifest@10.0.0-alpha.29
  - @geekmidas/storage@10.0.0-alpha.29

## 10.0.0-alpha.28

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.28
  - @geekmidas/envkit@10.0.0-alpha.28
  - @geekmidas/events@10.0.0-alpha.28
  - @geekmidas/manifest@10.0.0-alpha.28
  - @geekmidas/storage@10.0.0-alpha.28

## 10.0.0-alpha.27

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.27
  - @geekmidas/envkit@10.0.0-alpha.27
  - @geekmidas/events@10.0.0-alpha.27
  - @geekmidas/manifest@10.0.0-alpha.27
  - @geekmidas/storage@10.0.0-alpha.27

## 10.0.0-alpha.26

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.26
  - @geekmidas/envkit@10.0.0-alpha.26
  - @geekmidas/events@10.0.0-alpha.26
  - @geekmidas/manifest@10.0.0-alpha.26
  - @geekmidas/storage@10.0.0-alpha.26

## 10.0.0-alpha.25

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.25
  - @geekmidas/envkit@10.0.0-alpha.25
  - @geekmidas/events@10.0.0-alpha.25
  - @geekmidas/manifest@10.0.0-alpha.25
  - @geekmidas/storage@10.0.0-alpha.25

## 10.0.0-alpha.24

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.24
  - @geekmidas/envkit@10.0.0-alpha.24
  - @geekmidas/events@10.0.0-alpha.24
  - @geekmidas/manifest@10.0.0-alpha.24
  - @geekmidas/storage@10.0.0-alpha.24

## 10.0.0-alpha.23

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.23
  - @geekmidas/envkit@10.0.0-alpha.23
  - @geekmidas/events@10.0.0-alpha.23
  - @geekmidas/manifest@10.0.0-alpha.23
  - @geekmidas/storage@10.0.0-alpha.23

## 10.0.0-alpha.22

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.22
  - @geekmidas/envkit@10.0.0-alpha.22
  - @geekmidas/events@10.0.0-alpha.22
  - @geekmidas/manifest@10.0.0-alpha.22
  - @geekmidas/storage@10.0.0-alpha.22

## 10.0.0-alpha.21

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.21
  - @geekmidas/envkit@10.0.0-alpha.21
  - @geekmidas/events@10.0.0-alpha.21
  - @geekmidas/manifest@10.0.0-alpha.21
  - @geekmidas/storage@10.0.0-alpha.21

## 10.0.0-alpha.20

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.20
  - @geekmidas/envkit@10.0.0-alpha.20
  - @geekmidas/events@10.0.0-alpha.20
  - @geekmidas/manifest@10.0.0-alpha.20
  - @geekmidas/storage@10.0.0-alpha.20

## 10.0.0-alpha.19

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.19
  - @geekmidas/envkit@10.0.0-alpha.19
  - @geekmidas/events@10.0.0-alpha.19
  - @geekmidas/manifest@10.0.0-alpha.19
  - @geekmidas/storage@10.0.0-alpha.19

## 10.0.0-alpha.18

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.18
  - @geekmidas/envkit@10.0.0-alpha.18
  - @geekmidas/events@10.0.0-alpha.18
  - @geekmidas/manifest@10.0.0-alpha.18
  - @geekmidas/storage@10.0.0-alpha.18

## 10.0.0-alpha.17

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.17
  - @geekmidas/envkit@10.0.0-alpha.17
  - @geekmidas/events@10.0.0-alpha.17
  - @geekmidas/manifest@10.0.0-alpha.17
  - @geekmidas/storage@10.0.0-alpha.17

## 10.0.0-alpha.16

### Patch Changes

- [#69](https://github.com/geekmidas/toolbox/pull/69) [`259cd9c`](https://github.com/geekmidas/toolbox/commit/259cd9ca0318d2da3193f989f0c78a4c62d774c8) Thanks [@geekmidas](https://github.com/geekmidas)! - Built and typechecked with TypeScript 7

  The packages now build with the native compiler; declarations are emitted by
  tsgo. Nothing in their public types changes.

  `@geekmidas/client` no longer ships `dist/openapi.*`: a stale spec from another
  app that no export named and nothing imported.

  `@geekmidas/cloud`'s `fromManifest` types a database's provider inputs as
  `DatabaseProps` — the `Vpc` component its bootstrap function needs — rather
  than RDS's wider `PostgresArgs`, which also accepts bare subnet ids.

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.16
  - @geekmidas/envkit@10.0.0-alpha.16
  - @geekmidas/events@10.0.0-alpha.16
  - @geekmidas/manifest@10.0.0-alpha.16
  - @geekmidas/storage@10.0.0-alpha.16

## 10.0.0-alpha.15

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.15
  - @geekmidas/envkit@10.0.0-alpha.15
  - @geekmidas/events@10.0.0-alpha.15
  - @geekmidas/manifest@10.0.0-alpha.15
  - @geekmidas/storage@10.0.0-alpha.15

## 10.0.0-alpha.14

### Patch Changes

- [#64](https://github.com/geekmidas/toolbox/pull/64) [`ce969d3`](https://github.com/geekmidas/toolbox/commit/ce969d39a79811f36622f07a2f797cc493a87d1b) Thanks [@geekmidas](https://github.com/geekmidas)! - Cloud and events failures are named errors, and a Dokploy failure during a deploy says what failed

  Every bare `throw new Error` in `@geekmidas/cloud` and `@geekmidas/events` is a
  named class now, matched by class rather than message text:
  - `@geekmidas/cloud`: `DokployCallFailed` (a Dokploy API call answered with an
    error status: `path`, `status`, `statusText`, `detail`) and
    `RoutesMissingEnvironment` (routes reading variables nothing links).
  - `@geekmidas/events`: `UnsupportedEventTransport` (every factory, for a
    scheme or connection nothing implements), `SnsQueueMissing`,
    `SqsBatchPartlyFailed` (with the refused entries), `RabbitMQChannelUnavailable`
    and `PgBossNotStarted`.

  The Dokploy provider is serialised into Pulumi state, and serialisation turned
  its error into an object with no message, no stack and no `Error` prototype —
  so a failed Dokploy call during a deploy reported nothing at all. The class now
  sets its message and stack itself and says how to print itself, and a test runs
  the serialised provider to keep that true. Whether a delete found the
  application already gone is decided by the status, not by matching "404" in a
  message.

- Updated dependencies [[`ce969d3`](https://github.com/geekmidas/toolbox/commit/ce969d39a79811f36622f07a2f797cc493a87d1b)]:
  - @geekmidas/events@10.0.0-alpha.14
  - @geekmidas/db@10.0.0-alpha.14
  - @geekmidas/envkit@10.0.0-alpha.14
  - @geekmidas/manifest@10.0.0-alpha.14
  - @geekmidas/storage@10.0.0-alpha.14

## 10.0.0-alpha.13

### Patch Changes

- Updated dependencies [[`07d1827`](https://github.com/geekmidas/toolbox/commit/07d1827bb0a2a76d04a0fc25a7517df282004137)]:
  - @geekmidas/db@10.0.0-alpha.13
  - @geekmidas/envkit@10.0.0-alpha.13
  - @geekmidas/events@10.0.0-alpha.13
  - @geekmidas/manifest@10.0.0-alpha.13
  - @geekmidas/storage@10.0.0-alpha.13

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

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.12
  - @geekmidas/envkit@10.0.0-alpha.12
  - @geekmidas/events@10.0.0-alpha.12
  - @geekmidas/manifest@10.0.0-alpha.12
  - @geekmidas/storage@10.0.0-alpha.12

## 10.0.0-alpha.11

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.11
  - @geekmidas/envkit@10.0.0-alpha.11
  - @geekmidas/events@10.0.0-alpha.11
  - @geekmidas/manifest@10.0.0-alpha.11
  - @geekmidas/storage@10.0.0-alpha.11

## 10.0.0-alpha.10

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.10
  - @geekmidas/envkit@10.0.0-alpha.10
  - @geekmidas/events@10.0.0-alpha.10
  - @geekmidas/manifest@10.0.0-alpha.10
  - @geekmidas/storage@10.0.0-alpha.10

## 10.0.0-alpha.9

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.9
  - @geekmidas/envkit@10.0.0-alpha.9
  - @geekmidas/events@10.0.0-alpha.9
  - @geekmidas/manifest@10.0.0-alpha.9
  - @geekmidas/storage@10.0.0-alpha.9

## 10.0.0-alpha.8

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.8
  - @geekmidas/envkit@10.0.0-alpha.8
  - @geekmidas/events@10.0.0-alpha.8
  - @geekmidas/manifest@10.0.0-alpha.8
  - @geekmidas/storage@10.0.0-alpha.8

## 10.0.0-alpha.7

### Patch Changes

- Updated dependencies [[`960425f`](https://github.com/geekmidas/toolbox/commit/960425f73bc99ab0304c8ef2d22c7e98ca8313a4)]:
  - @geekmidas/manifest@10.0.0-alpha.7
  - @geekmidas/db@10.0.0-alpha.7
  - @geekmidas/envkit@10.0.0-alpha.7
  - @geekmidas/events@10.0.0-alpha.7
  - @geekmidas/storage@10.0.0-alpha.7

## 10.0.0-alpha.6

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.6
  - @geekmidas/envkit@10.0.0-alpha.6
  - @geekmidas/events@10.0.0-alpha.6
  - @geekmidas/manifest@10.0.0-alpha.6
  - @geekmidas/storage@10.0.0-alpha.6

## 10.0.0-alpha.5

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.5
  - @geekmidas/envkit@10.0.0-alpha.5
  - @geekmidas/events@10.0.0-alpha.5
  - @geekmidas/manifest@10.0.0-alpha.5
  - @geekmidas/storage@10.0.0-alpha.5

## 10.0.0-alpha.4

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.4
  - @geekmidas/envkit@10.0.0-alpha.4
  - @geekmidas/events@10.0.0-alpha.4
  - @geekmidas/manifest@10.0.0-alpha.4
  - @geekmidas/storage@10.0.0-alpha.4

## 10.0.0-alpha.3

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.3
  - @geekmidas/envkit@10.0.0-alpha.3
  - @geekmidas/events@10.0.0-alpha.3
  - @geekmidas/manifest@10.0.0-alpha.3
  - @geekmidas/storage@10.0.0-alpha.3

## 10.0.0-alpha.2

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.2
  - @geekmidas/envkit@10.0.0-alpha.2
  - @geekmidas/events@10.0.0-alpha.2
  - @geekmidas/manifest@10.0.0-alpha.2
  - @geekmidas/storage@10.0.0-alpha.2

## 10.0.0-alpha.1

### Patch Changes

- Updated dependencies []:
  - @geekmidas/db@10.0.0-alpha.1
  - @geekmidas/envkit@10.0.0-alpha.1
  - @geekmidas/events@10.0.0-alpha.1
  - @geekmidas/manifest@10.0.0-alpha.1
  - @geekmidas/storage@10.0.0-alpha.1

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
  - @geekmidas/db@10.0.0-alpha.0
  - @geekmidas/envkit@10.0.0-alpha.0
  - @geekmidas/events@10.0.0-alpha.0
  - @geekmidas/manifest@10.0.0-alpha.0
  - @geekmidas/storage@10.0.0-alpha.0

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
  - @geekmidas/manifest@9.0.2

## 1.1.1

### Patch Changes

- 🐛 [#11](https://github.com/geekmidas/toolbox/pull/11) [`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309) Thanks [@geekmidas](https://github.com/geekmidas)! - Patch release across all packages to realign published versions with the
  registry. The previous release only published the four packages that had
  version bumps; the remaining packages failed with "cannot publish over the
  previously published versions" because their versions were unchanged.
- Updated dependencies [[`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309)]:
  - @geekmidas/envkit@1.1.1
  - @geekmidas/manifest@0.1.1

## 1.1.0

### Minor Changes

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

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`33c1dc9`](https://github.com/geekmidas/toolbox/commit/33c1dc95cacb507f8aa348bcb393f1597d6e3844) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(cloud): add Queue and Topic linkable constructs

  `Queue` (wraps `sst.aws.Queue`) and `Topic` (wraps `sst.aws.SnsTopic`) are
  linkable messaging resources. Linking one to a producer resolves a
  name-namespaced `<NAME>_PUBLISHER_CONNECTION_STRING` (plus `<NAME>_URL`/`_ARN`)
  that `@geekmidas/events`'s `Publisher.fromConnectionString` consumes. `Queue`
  overrides `getSSTLink` to also expose `arn` (SST's native link exposes only
  `url`). `QueueProps`/`TopicProps` extend the native `QueueArgs`/`SnsTopicArgs`.

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`a9532e8`](https://github.com/geekmidas/toolbox/commit/a9532e82e5f22070998e2d813532fbaff4399890) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(cloud): add the `@geekmidas/cloud/sst` constructs entry (first cut)

  Introduces a source-only `./sst` subpath for SST v4 (ion) constructs that map
  1:1 to deployable units and validate their environment before deploy.
  - 🔌 **`Api`** wraps `sst.aws.ApiGatewayV2`: `ApiProps` extends the native
    `ApiGatewayV2Args` (CORS/domain/etc. pass through untouched), with a typed
    route table, per-route env validation via `@geekmidas/envkit/sst`'s
    `EnvValidator`, least-privilege per-route linking, and a `nodejs24.x` runtime
    default that's overridable per route or API-wide.
  - Supporting `GkmLinkable`/`ResourceType` and a `StackType` context interface.
  - Distribution: `./sst` ships as raw TypeScript (it extends SST's ambient
    `.sst/platform` globals, which only exist after `sst install`), so it is
    excluded from the dist build. A `sst.config.ts` fixture + `sst install`
    postinstall + `tsconfig.sst.json` let `src/sst` type-check against the real
    SST v4 globals locally and in CI.
  - ✨ Bumps the `sst` peer dependency to `^4.15.2` and adds `@geekmidas/envkit`.

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`b966277`](https://github.com/geekmidas/toolbox/commit/b966277eb1fcd44d05edcd1ac46c9222443a89fa) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(cloud): add the `Storage` construct

  `Storage` is a linkable `sst.aws.Bucket` (`ResourceType.Bucket`). Link it to a
  `Function`/`Api`/`Cron` and the runtime resolves a `<NAME>_NAME` environment
  variable holding the bucket's name — exactly what `@geekmidas/storage`'s
  `AmazonStorageClient.create({ bucket })` consumes. `StorageProps` extends
  `sst.aws.BucketArgs`, so native options pass through.

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

### Patch Changes

- Updated dependencies [[`b42e96b`](https://github.com/geekmidas/toolbox/commit/b42e96b9dd28d8926a1253a97aa553bd0e08bf56), [`7323f34`](https://github.com/geekmidas/toolbox/commit/7323f34176d63170dd53450889ac0b5959420c3c), [`79e2929`](https://github.com/geekmidas/toolbox/commit/79e292978d3dbc8927e25814bdb051d1c380600a), [`03b08fe`](https://github.com/geekmidas/toolbox/commit/03b08feba2e735539c43f95b77792c18a627b07d), [`0dad77e`](https://github.com/geekmidas/toolbox/commit/0dad77e574000e4018033b956ed4bb95935911a5)]:
  - @geekmidas/manifest@0.1.0
  - @geekmidas/envkit@1.1.0

## 1.0.1

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release
