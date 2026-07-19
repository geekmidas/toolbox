# @geekmidas/constructs

## 6.0.0

### Patch Changes

- Updated dependencies [[`e31a60a`](https://github.com/geekmidas/toolbox/commit/e31a60a971366180a0e7bec6e7da56d8f36aa21f)]:
  - @geekmidas/db@1.1.0
  - @geekmidas/audit@2.1.0

## 5.0.0

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

- Updated dependencies [[`7323f34`](https://github.com/geekmidas/toolbox/commit/7323f34176d63170dd53450889ac0b5959420c3c), [`79e2929`](https://github.com/geekmidas/toolbox/commit/79e292978d3dbc8927e25814bdb051d1c380600a), [`03b08fe`](https://github.com/geekmidas/toolbox/commit/03b08feba2e735539c43f95b77792c18a627b07d)]:
  - @geekmidas/envkit@1.1.0
  - @geekmidas/events@1.1.5
  - @geekmidas/services@2.0.0
  - @geekmidas/rate-limit@4.0.0

## 4.0.1

### Patch Changes

- [#7](https://github.com/geekmidas/toolbox/pull/7) [`e0d06b3`](https://github.com/geekmidas/toolbox/commit/e0d06b38dfd275758f7955f5754900ab78779302) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(constructs): allow endpoint handlers to return the output schema's input type

  Endpoint handlers previously had to return the output schema's _parsed_ type
  (`InferStandardSchema`). When an output schema coerces its value (e.g. a `Date`
  serialized to an ISO `string`, or an applied default), that forced handlers to
  pre-coerce values themselves even though the schema would do it on the way out.

  A new `InferStandardSchemaInput` type is added to `@geekmidas/schema`, exposing a
  Standard Schema's _input_ type (`StandardSchemaV1.InferInput`). `Endpoint`'s
  handler return type now uses it, so handlers may return the looser pre-coercion
  input while consumers (`EndpointOutput` and the generated client) still see the
  narrower parsed output type.

- Updated dependencies [[`e0d06b3`](https://github.com/geekmidas/toolbox/commit/e0d06b38dfd275758f7955f5754900ab78779302)]:
  - @geekmidas/schema@1.0.3

## 4.0.0

### Minor Changes

- [#5](https://github.com/geekmidas/toolbox/pull/5) [`811d740`](https://github.com/geekmidas/toolbox/commit/811d740ae3875d59ad1b0dc50261266963c8cb76) Thanks [@geekmidas](https://github.com/geekmidas)! - Move the tRPC and Middy service integrations from `@geekmidas/constructs` to `@geekmidas/services`, where they belong — they depend only on `@geekmidas/services`, not on any construct.
  - ✨ **`@geekmidas/constructs`:** the `@geekmidas/constructs/trpc` and `@geekmidas/constructs/middy` entry points are removed (they were only just added). Import from `@geekmidas/services/trpc` and `@geekmidas/services/middy` instead. (`@trpc/server` is no longer a peer dependency of `@geekmidas/constructs`.)
  - ✨ **`@geekmidas/services`:** adds `/trpc` (`createServicesMiddleware`, `createRequestContextMiddleware`) and `/middy` (`requestContext`, `addServices`, `withServices`, `EventServices`) exports.

  The Middy middlewares were also tightened:
  - `requestContext` / `withServices` now require an explicit `logger` (no `ConsoleLogger` default) and are generic over `TLogger extends Logger`, so a custom logger type is preserved.
  - `addServices` / `withServices` now require an `envParser` (no implicit `process.env` default).
  - 🐛 Resolved services are attached to `event.services` (matching the `Function`/`Cron` constructs).

### Patch Changes

- Updated dependencies [[`811d740`](https://github.com/geekmidas/toolbox/commit/811d740ae3875d59ad1b0dc50261266963c8cb76)]:
  - @geekmidas/services@1.1.0
  - @geekmidas/rate-limit@3.0.0

## 3.1.0

### Minor Changes

- ✨ [#4](https://github.com/geekmidas/toolbox/pull/4) [`07093f5`](https://github.com/geekmidas/toolbox/commit/07093f5f911bf1ee48e53275da3cce398cc78ff6) Thanks [@geekmidas](https://github.com/geekmidas)! - Add `@geekmidas/constructs/middy` — Middy middlewares that bring request context and service discovery to standalone Lambda handlers:
  - `requestContext(options?)` establishes a request context so `serviceContext.getLogger()` / `getRequestId()` / `getRequestStartTime()` work inside the handler and any service it calls.
  - 🐛 `addServices([...], options?)` resolves services via `ServiceDiscovery` and attaches the typed record to `event.services` (pair with `requestContext`, or use `withServices`, if your services read `serviceContext`).
  - `withServices([...], options?)` bundles both in a single `.use(...)`.

  Also exports an `EventServices<T>` helper type for typing the handler's event.

### Patch Changes

- ✨ [#4](https://github.com/geekmidas/toolbox/pull/4) [`a20be2f`](https://github.com/geekmidas/toolbox/commit/a20be2faa4795600358904b751fa947d3cbb4c45) Thanks [@geekmidas](https://github.com/geekmidas)! - Add and export `AWSScheduledFunction` from `@geekmidas/constructs/crons` (and `/aws`). The CLI's cron handler generator already imported this adaptor, but it was never implemented, so generated cron handlers failed to load. `AWSScheduledFunction` wraps a `Cron` (which extends `Function`) and reuses the Lambda function execution pipeline, including the `runWithRequestContext` wrapper that powers request-scoped logging.

## 3.0.14

### Patch Changes

- 🐛 [#3](https://github.com/geekmidas/toolbox/pull/3) [`42fda53`](https://github.com/geekmidas/toolbox/commit/42fda532bdf4489a3352f6a684f5f30beafccedd) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix stale logger from service initialization

- Updated dependencies [[`42fda53`](https://github.com/geekmidas/toolbox/commit/42fda532bdf4489a3352f6a684f5f30beafccedd)]:
  - @geekmidas/services@1.0.4

## 3.0.13

### Patch Changes

- ✨ [`351f73b`](https://github.com/geekmidas/toolbox/commit/351f73b032bc0742b7f611a9fbcdfc85bbfd69a8) Thanks [@geekmidas](https://github.com/geekmidas)! - Update request context and add support for trpc

- Updated dependencies [[`351f73b`](https://github.com/geekmidas/toolbox/commit/351f73b032bc0742b7f611a9fbcdfc85bbfd69a8)]:
  - @geekmidas/services@1.0.3

## 3.0.12

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

- Updated dependencies [[`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651)]:
  - @geekmidas/audit@2.0.1
  - @geekmidas/cache@1.1.1
  - @geekmidas/db@1.0.2
  - @geekmidas/envkit@1.0.7
  - @geekmidas/errors@1.0.1
  - @geekmidas/events@1.1.3
  - @geekmidas/logger@1.0.2
  - @geekmidas/rate-limit@2.0.1
  - @geekmidas/schema@1.0.2
  - @geekmidas/services@1.0.2

## 3.0.11

### Patch Changes

- [`fb1e721`](https://github.com/geekmidas/toolbox/commit/fb1e721ec38c1b328d41466564c6fa1c9305e80b) Thanks [@geekmidas](https://github.com/geekmidas)! - Return 403 Forbidden instead of 401 Unauthorized when an endpoint's `.authorize()` returns false. Authorization runs after `getSession()`, so by the time it rejects, the caller is already identified — 403 is the correct semantic. Callers that want 401 for missing authentication should throw `UnauthorizedError` from `getSession()` (or `.authorize()`) directly.

## 3.0.10

### Patch Changes

- 🐛 [`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix schema, openapi generation and events testkit

- Updated dependencies [[`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553)]:
  - @geekmidas/events@1.1.2
  - @geekmidas/schema@1.0.1

## 3.0.9

### Patch Changes

- ✨ [`363c67f`](https://github.com/geekmidas/toolbox/commit/363c67fb3c3406bac6823326ab80ba55bff29e31) Thanks [@geekmidas](https://github.com/geekmidas)! - Add dynamic return types

## 3.0.8

### Patch Changes

- ✨ [`0830c6e`](https://github.com/geekmidas/toolbox/commit/0830c6e0d60842526788e0e1f0e78827514ea7b3) Thanks [@geekmidas](https://github.com/geekmidas)! - Add optional sniff support

- Updated dependencies [[`0830c6e`](https://github.com/geekmidas/toolbox/commit/0830c6e0d60842526788e0e1f0e78827514ea7b3)]:
  - @geekmidas/logger@1.0.1

## 3.0.7

### Patch Changes

- ✨ [`79e17a8`](https://github.com/geekmidas/toolbox/commit/79e17a84e630f102023005994d9d45b37f7d9d8f) Thanks [@geekmidas](https://github.com/geekmidas)! - Add msw support for construct testing for ui

## 3.0.6

### Patch Changes

- ✨ [`3941ae6`](https://github.com/geekmidas/toolbox/commit/3941ae6c9027fddb32999b9f98af813a12867877) Thanks [@geekmidas](https://github.com/geekmidas)! - Add db to authorizer

## 3.0.5

### Patch Changes

- [`fba83f3`](https://github.com/geekmidas/toolbox/commit/fba83f3ceee1d058874e62b31e38a9da205a6742) Thanks [@geekmidas](https://github.com/geekmidas)! - Release constructs

## 3.0.4

### Patch Changes

- ✨ [`f005956`](https://github.com/geekmidas/toolbox/commit/f005956573aac6bcdfcc95d2a31c17cf5b9688d4) Thanks [@geekmidas](https://github.com/geekmidas)! - Add params to authorize and decode content type on routes

## 3.0.3

### Patch Changes

- [`a39b41f`](https://github.com/geekmidas/toolbox/commit/a39b41fae9c6cfbde8e6d78bf5a11fbb9e59f67d) Thanks [@geekmidas](https://github.com/geekmidas)! - Use qs to process query params instead of custom solution

## 3.0.2

### Patch Changes

- 🐛 [`317e53e`](https://github.com/geekmidas/toolbox/commit/317e53e91c07bbc23dad3ae81faf573be91cb992) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix v2 cookie loading

## 3.0.1

### Patch Changes

- ✨ [`bfc5a4f`](https://github.com/geekmidas/toolbox/commit/bfc5a4f656445bb389b0532e9d3385d2e66a28fe) Thanks [@geekmidas](https://github.com/geekmidas)! - Add function context and suport for partitions

## 3.0.0

### Patch Changes

- Updated dependencies [[`be4f7a9`](https://github.com/geekmidas/toolbox/commit/be4f7a9bd5de7f08adbca582916d6902e0c24de2)]:
  - @geekmidas/cache@1.1.0
  - @geekmidas/audit@2.0.0
  - @geekmidas/rate-limit@2.0.0

## 2.0.0

### Patch Changes

- ✨ [`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661) Thanks [@geekmidas](https://github.com/geekmidas)! - Add pg-boss event publisher/subscriber, CLI setup and upgrade commands, and secrets sync via AWS SSM
  - ✨ **@geekmidas/events**: Add pg-boss backend for event publishing and subscribing with connection string support
  - ✨ **@geekmidas/cli**: Add `gkm setup` command for dev environment initialization, `gkm upgrade` command with workspace detection, and secrets push/pull via AWS SSM Parameter Store
  - 🐛 **@geekmidas/testkit**: Fix database creation race condition in PostgresMigrator
  - ✨ **@geekmidas/constructs**: Add integration tests for pg-boss with HonoEndpoint

- Updated dependencies [[`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661)]:
  - @geekmidas/events@1.1.0

## 1.1.1

### Patch Changes

- 🔥 [`9ac81f2`](https://github.com/geekmidas/toolbox/commit/9ac81f25fbf3676e39580c916dc0085358af99cb) Thanks [@geekmidas](https://github.com/geekmidas)! - Remove subscriber adaptor from root exports

## 1.1.0

### Minor Changes

- ⚡️ [`73511d9`](https://github.com/geekmidas/toolbox/commit/73511d912062eb0776935168c9f72d42c7c854a6) Thanks [@geekmidas](https://github.com/geekmidas)! - Improve dev script experience and export function tester

## 1.0.5

### Patch Changes

- ⬆️ [`53c39a0`](https://github.com/geekmidas/toolbox/commit/53c39a0ed9244be6ca2ff6ec8e39138a0fc88692) Thanks [@geekmidas](https://github.com/geekmidas)! - Update RLS types

## 1.0.4

### Patch Changes

- 🐛 [`05a6302`](https://github.com/geekmidas/toolbox/commit/05a6302a37ef2285aaf07ee46eeb9135ed658a68) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix lambda function generator to use correct adaptor import

## 1.0.3

### Patch Changes

- 🐛 [`8bdda11`](https://github.com/geekmidas/toolbox/commit/8bdda11f5c0f7c2eaea605befb0eca38ecc56e44) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix iam resolution for authorizers and fixed exported types for envkit

- Updated dependencies [[`8bdda11`](https://github.com/geekmidas/toolbox/commit/8bdda11f5c0f7c2eaea605befb0eca38ecc56e44)]:
  - @geekmidas/envkit@1.0.1

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release

### Patch Changes

- Updated dependencies [[`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8)]:
  - @geekmidas/audit@1.0.0
  - @geekmidas/cache@1.0.0
  - @geekmidas/db@1.0.0
  - @geekmidas/envkit@1.0.0
  - @geekmidas/errors@1.0.0
  - @geekmidas/events@1.0.0
  - @geekmidas/logger@1.0.0
  - @geekmidas/rate-limit@1.0.0
  - @geekmidas/schema@1.0.0
  - @geekmidas/services@1.0.0
