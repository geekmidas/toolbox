# @geekmidas/manifest

## 9.4.0

### Minor Changes

- [#334](https://github.com/geekmidas/toolbox/pull/334) [`b03c43d`](https://github.com/geekmidas/toolbox/commit/b03c43dfd2c86b1daa7f0a47f43e5fb2e518518b) Thanks [@geekmidas](https://github.com/geekmidas)! - Crons report to an uptime monitor with `.uptime()`, which replaces `.monitor()`

  **Breaking:** `.monitor()` is removed from functions, crons, endpoints and `EndpointFactory`, along with the monitor hooks in the endpoint adaptors. The manifest's `monitoring` field is removed from routes, functions and crons.

  A monitor only adds something a cron can't report itself: that it didn't run. A function or endpoint runs when it's called, so no ping is ever due, and its failures are already logged where they happen. So uptime is now set on crons alone:

  ```ts
  export const nightlyReport = c
    .schedule("cron(0 8 * * MON-FRI)")
    .uptime(heartbeat.betterStack("MONITORING_URL"))
    .handle(async () => {});
  ```

  Calling `.uptime()` again replaces the monitor. `gkm build` records it on the cron's manifest entry as `uptime`, with the period the heartbeat should expect, derived from the schedule by `cronPeriod`:

  ```ts
  uptime: { type: 'heartbeat', provider: 'betterStack', env: 'MONITORING_URL', period: 259200 }
  ```

  `MonitorInfo` in `@geekmidas/manifest` is replaced by `UptimeInfo`.

## 9.3.0

### Minor Changes

- 🔥 [#331](https://github.com/geekmidas/toolbox/pull/331) [`0383ab8`](https://github.com/geekmidas/toolbox/commit/0383ab86dcbe300556d6cda5b20be24cd7e63cdd) Thanks [@geekmidas](https://github.com/geekmidas)! - Crons take Unix or AWS cron expressions, and `rate(…)` is removed

  **Breaking:** `rate(…)` schedules are no longer accepted. Write the cron they stand for, e.g. `rate(5 minutes)` is `cron(*/5 * * * *)` and `rate(1 day)` is `cron(0 0 * * *)`. `RateExpression` and `@geekmidas/cloud`'s `CronRate` are removed.

  `.schedule()` takes a five-field Unix `cron(…)` or a six-field AWS one, and checks each by its own rules at compile time:

  ```ts
  c.schedule("cron(0 9 * * MON-FRI)"); // Unix
  c.schedule("cron(0 9 ? * 6#3 *)"); // AWS
  c.schedule("cron(0 25 * * *)"); // type error: hour 25
  ```

  `gkm build` and `gkm dev` validate every cron's schedule and fail on an invalid one, listing each cron with the field and token that failed. The manifest always records the AWS form, converting a Unix expression and warning when the conversion is approximate.

  `@geekmidas/manifest` exports `parseCron`, `toAwsCron` and `toUnixCron`, and `cronPeriod`: the longest gap between runs in seconds, the period a heartbeat should expect.

## 9.2.1

## 9.2.0

### Minor Changes

- [#312](https://github.com/geekmidas/toolbox/pull/312) [`bccee5d`](https://github.com/geekmidas/toolbox/commit/bccee5d54b3675f284cd7380c8a1293fdfb6afb7) Thanks [@geekmidas](https://github.com/geekmidas)! - The manifest records each construct's monitors

  Functions, crons and routes set with `.monitor()` now carry a `monitoring` list in the build manifest, so infrastructure can provision what they report to without reading the code:

  ```ts
  {
    name: 'nightlySync',
    schedule: 'cron(0 8 * * ? *)',
    environment: ['MONITORING_URL'],
    monitoring: [{ type: 'heartbeat', provider: 'betterStack', env: 'MONITORING_URL' }],
  }
  ```

  `heartbeat.betterStack()` and `heartbeat.healthchecks()` record their provider; a custom `heartbeat()` records only its `env`, and a hand-written monitor its service name as `type`. A construct without monitors has no `monitoring` field. On the `server` provider, where one route serves the whole app, that route lists the distinct monitors across its endpoints.

  A heartbeat's URL variable is now required rather than optional, so the manifest lists it as `MONITORING_URL` instead of `MONITORING_URL?` and a deploy that does not set it is caught. If it is still missing at runtime, the monitor is skipped with a warning and the run goes on.

## 9.1.0

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

## 0.1.1

### Patch Changes

- 🐛 [#11](https://github.com/geekmidas/toolbox/pull/11) [`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309) Thanks [@geekmidas](https://github.com/geekmidas)! - Patch release across all packages to realign published versions with the
  registry. The previous release only published the four packages that had
  version bumps; the remaining packages failed with "cannot publish over the
  previously published versions" because their versions were unchanged.

## 0.1.0

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
