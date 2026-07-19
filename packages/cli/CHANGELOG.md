# @geekmidas/cli

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
