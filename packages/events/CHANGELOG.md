# @geekmidas/events

## 10.0.0-alpha.103

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.103

## 10.0.0-alpha.102

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.102

## 10.0.0-alpha.101

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.101

## 10.0.0-alpha.100

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.100

## 10.0.0-alpha.99

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.99

## 10.0.0-alpha.98

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.98

## 10.0.0-alpha.97

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.97

## 10.0.0-alpha.96

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.96

## 10.0.0-alpha.95

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.95

## 10.0.0-alpha.94

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.94

## 10.0.0-alpha.93

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.93

## 10.0.0-alpha.92

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.92

## 10.0.0-alpha.91

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.91

## 10.0.0-alpha.90

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.90

## 10.0.0-alpha.89

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.89

## 10.0.0-alpha.88

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.88

## 10.0.0-alpha.87

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.87

## 10.0.0-alpha.86

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.86

## 10.0.0-alpha.85

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.85

## 10.0.0-alpha.84

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.84

## 10.0.0-alpha.83

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.83

## 10.0.0-alpha.82

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.82

## 10.0.0-alpha.81

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.81

## 10.0.0-alpha.80

### Minor Changes

- [#208](https://github.com/geekmidas/toolbox/pull/208) [`f3638fb`](https://github.com/geekmidas/toolbox/commit/f3638fb116f7aeebbbb29c8f06deaa7813cc760e) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: One trace from a request through a queue to the worker: every events driver
  (pg-boss, SNS, SQS, RabbitMQ, basic) wraps each publish in a PRODUCER span and
  carries its W3C trace context in the message — SQS/SNS message attributes,
  RabbitMQ headers, or pg-boss job data under the reserved key `__gkmTrace`,
  which is removed before a handler sees the payload. Consumers run each job in a
  CONSUMER span that continues it (a message without context starts a new
  trace), Lambda queue and subscriber adaptors do the same from their records,
  and each cron run is a root trace of its own. The constructs record their own
  spans: a span per database query (`select orders`, with `db.system`, `db.name`,
  `db.operation`, never parameter values), `cache.get`/`set`/`delete` with
  hit/miss on the Redis and Postgres drivers, `storage.presign`/`put`/`delete`,
  `email.send`, and a span per `ExternalApi` client call. Everything goes through
  the global `@opentelemetry/api` and is a no-op without a registered provider.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.80

## 10.0.0-alpha.79

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.79

## 10.0.0-alpha.78

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.78

## 10.0.0-alpha.77

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.77

## 10.0.0-alpha.76

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.76

## 10.0.0-alpha.75

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.75

## 10.0.0-alpha.74

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.74

## 10.0.0-alpha.73

### Patch Changes

- [#196](https://github.com/geekmidas/toolbox/pull/196) [`5db7b84`](https://github.com/geekmidas/toolbox/commit/5db7b84aba6455989163abcd2c203b6dc28b7cb3) Thanks [@geekmidas](https://github.com/geekmidas)! - A Worker is its own deploy unit on a server target

  `gkm build --provider server --production` now writes an entry for each `Worker` that has crons, queue consumers or topic subscribers, in the app whose directory holds that work, and bundles it to `.gkm/server/dist/worker-<worker>.mjs`. It registers the drivers its target needs, starts every cron (through pg-boss), consumer and subscriber the worker owns, and serves only `GET /health` on `PORT`: `200` when every consumer started and every broker connection answers, `503` otherwise. On `SIGTERM` it stops pulling messages and scheduling crons, lets the handlers in flight finish, closes its broker connections and database pools, and exits `0` within `GKM_SHUTDOWN_TIMEOUT_MS` (default 8000), or `1` at the deadline.

  `gkm docker` writes a Dockerfile per worker (`.gkm/docker/Dockerfile.<worker>`), built inside Docker like a backend's, with credentials from the `gkm_credentials` BuildKit secret; the runner is the bundle on `node` with `tini` and a `HEALTHCHECK` on `/health`.

  `gkm compose` runs each worker as a service with no Caddy route and no published port, `restart: unless-stopped`, log rotation, its own `0600` env file holding exactly the keys its constructs read, and `depends_on` the stack's infrastructure; it starts after migrations, the plan lists it, and `verify` waits for its Docker health check. Dokploy deploys each worker as an application with no domain after the backends, checked by Dokploy's status and rolled back like any app. A worker with topic subscribers in a build whose broker is SNS fails with `WorkerSubscribersNeedPush`.

  The generated `queues.ts`, `subscribers.ts` and `crons.ts` no longer install their own `SIGTERM` handlers; they export `stopQueues`, `stopSubscribers` and `stopCrons`, and a status function each, for the entry that runs them. pg-boss connections name themselves to Postgres with `GKM_APP_NAME` when it is set.

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.73

## 10.0.0-alpha.72

### Minor Changes

- [#195](https://github.com/geekmidas/toolbox/pull/195) [`b55a94c`](https://github.com/geekmidas/toolbox/commit/b55a94ceb3d07f1e0b336fb34503a1566177e624) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: Event brokers are drivers, registered by the entry point, so a bundle carries only its own broker

  - 🐛 **`registerEventsDriver(driver)`.** `Publisher`, `Subscriber` and `EventConnectionFactory` pick a broker by the connection string's scheme from a registry instead of a literal `import()` per broker. esbuild followed every one of those, so `gkm build --provider server --production` failed with `Could not resolve "pg-boss"` / `"amqplib"` for a project that had not installed every broker (#192). Each broker's subpath exports its driver and is the only module that imports its peer dependency: `basicEventsDriver` (`/basic`), `pgbossEventsDriver` (`/pgboss`), `rabbitmqEventsDriver` (`/rabbitmq`), `snsEventsDriver` (`/sns`), `sqsEventsDriver` (`/sqs`). `eventsDriverFor(scheme)` and `registeredEventsSchemes()` look them up.
  - ✨ **An unregistered broker throws `UnregisteredEventsScheme`**, carrying the `scheme`, the `subpath` and `driver` to register, and what is `registered`. A script that builds its own publisher adds `registerEventsDriver(pgbossEventsDriver)` (or its broker's) once before the first call. A scheme no broker implements still throws `UnsupportedEventTransport`.
  - 🐛 **Generated entries register their target's broker** — `EVENTS_DRIVERS` beside the cache and storage drivers: pg-boss on a server, SNS and SQS on AWS, the local stage's broker in `gkm dev` and `gkm test`. Only when the app declares a `Topic` or a `Queue` (or, on pg-boss, a worker whose crons it schedules), so a project without events resolves nothing. The production and dev servers, and every Lambda handler — endpoint, function, cron, queue consumer and subscriber — register them; the function, cron, queue and subscriber handlers now register the storage and cache drivers too.
  - A server's SNS push subscriptions are generated only when its broker is SNS, and its crons reach pg-boss through the registered driver, so neither drags the other broker's client into the bundle. An app that declares no crons gets a crons file that imports nothing.
  - `Publisher.fromConnection(connection, options)` takes the publisher options, as `fromConnectionString` does.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.72

## 10.0.0-alpha.71

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.71

## 10.0.0-alpha.70

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.70

## 10.0.0-alpha.69

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.69

## 10.0.0-alpha.68

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.68

## 10.0.0-alpha.67

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.67

## 10.0.0-alpha.66

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.66

## 10.0.0-alpha.65

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.65

## 10.0.0-alpha.64

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.64

## 10.0.0-alpha.63

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.63

## 10.0.0-alpha.62

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.62

## 10.0.0-alpha.61

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.61

## 10.0.0-alpha.60

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.60

## 10.0.0-alpha.59

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.59

## 10.0.0-alpha.58

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.58

## 10.0.0-alpha.57

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.57

## 10.0.0-alpha.56

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.56

## 10.0.0-alpha.55

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.55

## 10.0.0-alpha.54

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.54

## 10.0.0-alpha.53

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.53

## 10.0.0-alpha.52

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.52

## 10.0.0-alpha.51

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.51

## 10.0.0-alpha.50

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.50

## 10.0.0-alpha.49

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.49

## 10.0.0-alpha.48

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.48

## 10.0.0-alpha.47

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.47

## 10.0.0-alpha.46

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.46

## 10.0.0-alpha.45

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.45

## 10.0.0-alpha.44

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.44

## 10.0.0-alpha.43

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.43

## 10.0.0-alpha.42

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.42

## 10.0.0-alpha.41

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.41

## 10.0.0-alpha.40

### Minor Changes

- [#113](https://github.com/geekmidas/toolbox/pull/113) [`e8d29dd`](https://github.com/geekmidas/toolbox/commit/e8d29dd29084e59b40a3b5bd1a2806c3b9c93f6d) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: Topic subscribers on SNS are pushed to over HTTP; each consumer reaches its own topic or queue; topics fan out on pg-boss (#112)
  - ⬆️ **SNS push.** On SNS a topic subscriber is no longer polled. The server mounts `POST /__gkm/subscribers/<name>` and, once listening, subscribes it to the topic with a filter policy of the events the subscriber names, so SNS fans out to each subscriber. Confirmations are handled, signatures verified (skipped only against an emulator), and startup converges: a stuck-pending subscription is replaced and a changed event list updates the filter. The route runs the subscriber through the same adaptor as Lambda. `GKM_SUBSCRIBER_PUSH_URL` is where SNS pushes; locally it defaults to `host.docker.internal`.
  - **`@geekmidas/events/sns`**: `verifySnsMessage`, `confirmSnsSubscription`, `subscribeHttpEndpoint`, `toSnsEvent`. **`@geekmidas/constructs/aws`**: `SnsPushSubscriberAdaptor`.
  - 🔥 **Each consumer reaches what it consumes**, through that topic's or queue's own `<ID>_PUBLISHER_CONNECTION_STRING`. `EVENT_SUBSCRIBER_CONNECTION_STRING` is deleted: it was built from the first queue or topic in the plan, so every other consumer polled the wrong place. Crons schedule through `EVENT_PUBLISHER_CONNECTION_STRING`.
  - **pg-boss fans out.** A topic's message is published as `<topic>/<type>` and each subscriber drains a queue of its own, so every subscriber sees every message; replicas of one subscriber share it. Subscribers used to compete for one queue per event type, and two topics with an event of the same name shared it. `Publisher.fromConnectionString(url, { topic })`, `Subscriber.fromConnection(connection, { topic, subscription })`.
  - **Local SNS works.** On an AWS target `gkm dev` creates each topic and queue on the floci emulator and composes their addresses, instead of throwing `UnprovisionedEventsBackend`. The emulator's healthcheck no longer calls `curl`, which the image does not ship.
  - **`gkm dev --no-subscribers`** runs no topic subscribers. Fan-out is the default.
  - A queue consumer that fails now leaves its message for a retry instead of acknowledging it.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.40

## 10.0.0-alpha.39

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.39

## 10.0.0-alpha.38

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.38

## 10.0.0-alpha.37

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.37

## 10.0.0-alpha.36

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.36

## 10.0.0-alpha.35

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.35

## 10.0.0-alpha.34

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.34

## 10.0.0-alpha.33

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.33

## 10.0.0-alpha.32

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.32

## 10.0.0-alpha.31

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.31

## 10.0.0-alpha.30

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.30

## 10.0.0-alpha.29

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.29

## 10.0.0-alpha.28

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.28

## 10.0.0-alpha.27

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.27

## 10.0.0-alpha.26

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.26

## 10.0.0-alpha.25

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.25

## 10.0.0-alpha.24

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.24

## 10.0.0-alpha.23

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.23

## 10.0.0-alpha.22

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.22

## 10.0.0-alpha.21

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.21

## 10.0.0-alpha.20

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.20

## 10.0.0-alpha.19

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.19

## 10.0.0-alpha.18

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.18

## 10.0.0-alpha.17

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.17

## 10.0.0-alpha.16

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.16

## 10.0.0-alpha.15

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.15

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

- Updated dependencies [[`9602a19`](https://github.com/geekmidas/toolbox/commit/9602a19a9b4fb9cecd2641d108976f73272df55e)]:
  - @geekmidas/schema@10.0.0-alpha.14

## 10.0.0-alpha.13

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.13

## 10.0.0-alpha.12

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.12

## 10.0.0-alpha.11

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.11

## 10.0.0-alpha.10

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.10

## 10.0.0-alpha.9

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.9

## 10.0.0-alpha.8

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.8

## 10.0.0-alpha.7

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.7

## 10.0.0-alpha.6

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.6

## 10.0.0-alpha.5

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.5

## 10.0.0-alpha.4

### Patch Changes

- Updated dependencies [[`dce9588`](https://github.com/geekmidas/toolbox/commit/dce958803067a24ec3c9ecbba2c76fd00d971904)]:
  - @geekmidas/schema@10.0.0-alpha.4

## 10.0.0-alpha.3

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.3

## 10.0.0-alpha.2

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.2

## 10.0.0-alpha.1

### Patch Changes

- Updated dependencies []:
  - @geekmidas/schema@10.0.0-alpha.1

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
  - @geekmidas/schema@10.0.0-alpha.0

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
  - @geekmidas/schema@9.0.2

## 1.1.6

### Patch Changes

- 🐛 [#11](https://github.com/geekmidas/toolbox/pull/11) [`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309) Thanks [@geekmidas](https://github.com/geekmidas)! - Patch release across all packages to realign published versions with the
  registry. The previous release only published the four packages that had
  version bumps; the remaining packages failed with "cannot publish over the
  previously published versions" because their versions were unchanged.
- Updated dependencies [[`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309)]:
  - @geekmidas/schema@1.0.4

## 1.1.5

### Patch Changes

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

## 1.1.4

### Patch Changes

- 🐛 [`75954ab`](https://github.com/geekmidas/toolbox/commit/75954ab60413ecba60b24aad7f9e0a08f29863dd) Thanks [@geekmidas](https://github.com/geekmidas)! - Republish with the `package.json` exports fix that nests `types` inside each `import`/`require` condition and points at the `.d.mts`/`.d.cts` files that `tsdown` actually emits. The previous version (1.1.3) was tagged but failed to publish to npm; this bump retries publication so consumers can resolve types correctly under NodeNext/Bundler module resolution.

## 1.1.3

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

- Updated dependencies [[`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651)]:
  - @geekmidas/schema@1.0.2

## 1.1.2

### Patch Changes

- 🐛 [`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix schema, openapi generation and events testkit

- Updated dependencies [[`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553)]:
  - @geekmidas/schema@1.0.1

## 1.1.1

### Patch Changes

- ⬆️ [`bf6c028`](https://github.com/geekmidas/toolbox/commit/bf6c0286c046794c322ebf7765378fc6ae1f9155) Thanks [@geekmidas](https://github.com/geekmidas)! - Upgrade pg-boss to 12

## 1.1.0

### Minor Changes

- ✨ [`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661) Thanks [@geekmidas](https://github.com/geekmidas)! - Add pg-boss event publisher/subscriber, CLI setup and upgrade commands, and secrets sync via AWS SSM
  - ✨ **@geekmidas/events**: Add pg-boss backend for event publishing and subscribing with connection string support
  - ✨ **@geekmidas/cli**: Add `gkm setup` command for dev environment initialization, `gkm upgrade` command with workspace detection, and secrets push/pull via AWS SSM Parameter Store
  - 🐛 **@geekmidas/testkit**: Fix database creation race condition in PostgresMigrator
  - ✨ **@geekmidas/constructs**: Add integration tests for pg-boss with HonoEndpoint

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release

### Patch Changes

- Updated dependencies [[`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8)]:
  - @geekmidas/schema@1.0.0
