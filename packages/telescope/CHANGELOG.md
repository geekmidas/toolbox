# @geekmidas/telescope

## 10.0.0-alpha.87

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.87

## 10.0.0-alpha.86

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.86

## 10.0.0-alpha.85

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.85

## 10.0.0-alpha.84

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.84

## 10.0.0-alpha.83

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.83

## 10.0.0-alpha.82

### Minor Changes

- [#210](https://github.com/geekmidas/toolbox/pull/210) [`7b7732a`](https://github.com/geekmidas/toolbox/commit/7b7732aae2d094f53a0da66527851ec112820cde) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: One trace from the browser to the API: the client propagates W3C trace context, and the API decides whose to trust

  - ✨ **`@geekmidas/client`: `telemetry` on `createTypedFetcher`, the auth-aware fetcher and the generated `createApi`** — off unless set. With it on, every request to the client's own API origin (never another) carries `traceparent`/`tracestate`: through the global OpenTelemetry propagator when a span is active (a browser SDK, or a server-side caller inside a request span), otherwise a page-view trace id (one per page load in a browser, per client in Node), a fresh span id per request, and a sampled flag decided once per page view at `sampleRate` (default 1) by the trace-id rule OpenTelemetry's ratio sampler uses. `@opentelemetry/api` is not imported: its globals are read from `globalThis`, so the feature adds about 0.7 kB gzipped. A `traceparent` the caller sets is kept. New export `@geekmidas/client/telemetry`; a bad rate throws `InvalidClientSampleRate`.
  - 💥 **`@geekmidas/telescope`: incoming trace context is trusted only from the API's own sites and internal callers.** `honoTelemetryMiddleware` takes `trustedOrigins` (an array, or a function read per request) and `internalCallers` (default: no `Origin`, no proxy forwarding header, and a loopback or private peer address). Any other caller's `traceparent` is no longer continued: the request starts a new trace with a link to it. The Lambda `telemetryMiddleware` takes `trustedOrigins` and `trustRequest`. **Breaking for direct users:** a middleware mounted with no options continues only internal callers.
  - **`@geekmidas/telescope`: the stage's rate caps a caller's sampled flag.** `traceSampler(rate)` is `parentbased_traceidratio` with the ratio applied to a remote sampled parent as well, so a request cannot force a trace the stage would not keep; `setupTelemetry` uses it for `sampleRatio` and for `OTEL_TRACES_SAMPLER=parentbased_traceidratio`. Also exported: `traceSamplerFromEnv`, `incomingTraceContext`, `isTrustedOrigin`, `isInternalCaller`, `isPrivateAddress`.
  - **`@geekmidas/cli`: the API's derived CORS always allows `traceparent` and `tracestate`,** and a built server hands the same origins its CORS allows to the request spans (`createApp()` returns `trustedOrigins`).
  - **`@geekmidas/cli`: `gkm openapi --telemetry [sampleRate]`** writes clients whose `createApi` propagates by default (`telemetryDefault`); off otherwise. A site's Dockerfile passes it to its in-image `gkm openapi --app` when the client's `telemetry` is set.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.82

## 10.0.0-alpha.81

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.81

## 10.0.0-alpha.80

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.80

## 10.0.0-alpha.79

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.79

## 10.0.0-alpha.78

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.78

## 10.0.0-alpha.77

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.77

## 10.0.0-alpha.76

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.76

## 10.0.0-alpha.75

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.75

## 10.0.0-alpha.74

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.74

## 10.0.0-alpha.73

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.73

## 10.0.0-alpha.72

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.72

## 10.0.0-alpha.71

### Patch Changes

- Updated dependencies [[`20264e6`](https://github.com/geekmidas/toolbox/commit/20264e62b0fcd1f9e3c523197cf4bf9828c8ced1)]:
  - @geekmidas/logger@10.0.0-alpha.71

## 10.0.0-alpha.70

### Minor Changes

- [#189](https://github.com/geekmidas/toolbox/pull/189) [`42e6e4e`](https://github.com/geekmidas/toolbox/commit/42e6e4ef52b465df702c927758be58120b9a5976) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm compose` can run a log UI, every target passes `OTEL_*` to its backends, and Docker logs are rotated

  **`OTEL_*` reach the backends.** A production server exports traces and pino
  logs over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, but each backend's
  environment held only the keys its constructs declare, so a stage's telemetry
  settings never arrived. Now the standard variables the stage's secrets hold —
  the exporter's endpoint, headers, protocol, timeout and compression (for all
  signals or one), the sampler and its argument, resource attributes and the
  service name — go to every backend on `gkm compose` and on Dokploy, with
  `OTEL_SERVICE_NAME` defaulting to the app's name. They are matched by a
  pattern over the `OTEL_` prefix, not the bare prefix, so an unrelated
  `OTEL_LOG_LEVEL` is not forwarded. Sites get none: their environment ends up
  in a browser bundle.

  **`deploy.compose.logs`** runs OpenObserve (`v1.0.4`, pinned) in a compose
  stack and points every backend's telemetry at it:

  ```ts
  deploy: {
    compose: {
      logs: true;
    }
  }
  // or { port?: number; retentionDays?: number; public?: { allow: string[] } }
  ```

  - Published on `127.0.0.1:5080` only, because Docker opens a port published
    on every interface past ufw. The run ends with the `ssh -N -L` line that
    reaches it, and a `logs.ready` event.
  - `public: { allow: [...] }` serves it at `https://logs.<stage domain>`
    through Caddy instead, to those IPs and CIDRs only (403 otherwise), with no
    host port.
  - Its root password is generated once per deployed stage and kept in the
    stage's secrets as `ZO_ROOT_USER_PASSWORD`; the local stage uses a fixed
    one. Data is kept 30 days (`retentionDays`, at least 3).
  - `verify` checks it is healthy; `--down` keeps its volume.
  - A stage that also sets its own OTLP endpoint fails with
    `LogsEndpointConflict`; a bad config with `LogsAllowEmpty`,
    `LogsAllowEntryInvalid`, `LogsRetentionInvalid` or `LogsPortInvalid`.
  - Dokploy never reads it.

  **Docker's logs are rotated.** Every service a compose stack runs — apps,
  Caddy, Postgres, Mailpit, MinIO, OpenObserve — logs through `json-file` with
  `max-size: 10m` and `max-file: 3`. Docker never rotates that driver by
  default, and a busy container filled a small server's disk.

  **`docker-compose.<stage>.yml`** at the workspace root, where there is one, is
  merged over the generated stack — on every run and on `--down` — for what the
  generated file cannot know, such as a port bound to a tailnet address or
  another `logging` block.

  **Request spans and logs from a bundled server.** A production server is one
  bundled file, where OpenTelemetry's load-time hooks see neither pino nor
  `node:http`, so only DNS, TCP and `fetch` spans arrived. The server now mounts
  telescope's `honoTelemetryMiddleware` ahead of every route: a SERVER span per
  request named `GET /users/:id`, with method, route, status code, `url.path`,
  `url.scheme` and user agent — never the query string or headers — `ERROR` on a
  5xx or a thrown error (the exception recorded; a 4xx is not an error), an
  incoming `traceparent` continued, and the handler run inside it. Logs come from
  `@geekmidas/logger`'s own bridge, in the request's trace. The generated setup
  turns `@opentelemetry/instrumentation-pino` and the http instrumentation's
  incoming spans off, so nothing is sent twice where they can hook. `pg` is
  bundled too, so there are no query spans yet.

  The middleware itself changed to fit: it names the span after the matched
  route once the handler has run (it used the raw path), drops `url.full`, sets
  `ERROR` only on a 5xx, and records the error Hono hands `onError`.
  `setupTelemetry` takes `incomingHttpSpans: false`. An endpoint whose handler
  fails with a 5xx leaves the error on `c.error` for middleware.

### Patch Changes

- Updated dependencies [[`f3114d7`](https://github.com/geekmidas/toolbox/commit/f3114d70a385d28908167d42e29cd846bb3f4fcc)]:
  - @geekmidas/logger@10.0.0-alpha.70

## 10.0.0-alpha.69

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.69

## 10.0.0-alpha.68

### Patch Changes

- Updated dependencies [[`871ba05`](https://github.com/geekmidas/toolbox/commit/871ba057aa0a0f69cf8233366b5f4c311359a7cc)]:
  - @geekmidas/logger@10.0.0-alpha.68

## 10.0.0-alpha.67

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.67

## 10.0.0-alpha.66

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.66

## 10.0.0-alpha.65

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.65

## 10.0.0-alpha.64

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.64

## 10.0.0-alpha.63

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.63

## 10.0.0-alpha.62

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.62

## 10.0.0-alpha.61

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.61

## 10.0.0-alpha.60

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.60

## 10.0.0-alpha.59

### Patch Changes

- Updated dependencies [[`57eea44`](https://github.com/geekmidas/toolbox/commit/57eea445c114acbb398d4dfedc86f1c22dab3f10)]:
  - @geekmidas/logger@10.0.0-alpha.59

## 10.0.0-alpha.58

### Minor Changes

- [#167](https://github.com/geekmidas/toolbox/pull/167) [`476aeda`](https://github.com/geekmidas/toolbox/commit/476aedab3128ec29948df93f9776dae4e42d3488) Thanks [@geekmidas](https://github.com/geekmidas)! - Production defaults: OpenTelemetry wired into the production entry, and logger redaction on

  - :boom: `createLogger` from `@geekmidas/logger/pino` now redacts `DEFAULT_REDACT_PATHS` when `redact` is left out. Pass `redact: false` for the old behaviour. It also takes a `destination` to write to.
  - `gkm build --production` writes a `telemetry.ts` beside `server.ts`, and the entry awaits it before importing the app. When `OTEL_EXPORTER_OTLP_ENDPOINT` is set it calls `setupTelemetry` with `service.name` (the surface id), `service.namespace` (the workspace) and `deployment.environment` (`STAGE`). Unset, nothing is imported. An app without `@geekmidas/telescope` and the `@opentelemetry/*` peers still builds and starts, and warns `TelemetryUnavailable` if the endpoint is set.
  - `setupTelemetry` gains `sampleRatio` (parent-based ratio sampling, `InvalidSampleRatio` outside 0–1), `serviceNamespace`, `deploymentEnvironment` and `handleSignals`. Without an `endpoint` it now follows the standard `OTEL_EXPORTER_OTLP_*` variables instead of writing to the console, and `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` apply when no ratio is passed.
  - 🐛 Fixed: OTLP log export never sent anything — the log processor went to a `LoggerProvider` nothing registered. It is now handed to the SDK. `shutdownTelemetry` also removes its `SIGTERM` listener.

### Patch Changes

- Updated dependencies [[`476aeda`](https://github.com/geekmidas/toolbox/commit/476aedab3128ec29948df93f9776dae4e42d3488)]:
  - @geekmidas/logger@10.0.0-alpha.58

## 10.0.0-alpha.57

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.57

## 10.0.0-alpha.56

### Minor Changes

- 🔥 [#169](https://github.com/geekmidas/toolbox/pull/169) [`efd9019`](https://github.com/geekmidas/toolbox/commit/efd9019cd2d8ec93dea462675da3ded175e732ee) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: Toolbox is headless: `@geekmidas/ui` and `@geekmidas/studio` are removed, Telescope serves JSON only, and `gkm dev` serves the declared database as a read-only JSON API

  - ✨ **`@geekmidas/ui` and `@geekmidas/studio` are deprecated and no longer published.** Their last versions are `@geekmidas/ui@9.0.2` and `@geekmidas/studio@9.0.2` (`latest`), and `@geekmidas/ui@10.0.0-alpha.55` and `@geekmidas/studio@10.0.0-alpha.55` on `alpha`. Pin those to keep using them; nothing in toolbox depends on them any more. Studio's data layer lives on in `@geekmidas/db/introspect`; for components, run `npx shadcn@latest add` in your app.
  - **Telescope has no dashboard.** The embedded React UI and its assets are gone, and `createUI` is renamed `createApi`: it serves the same JSON routes under `/api/*` (requests, exceptions, logs, stats, metrics) and nothing else, so the mount point's root and the old dashboard routes now 404. Recorders, storage adapters, the OTLP receiver and the WebSocket feed are unchanged. Replace `createUI(telescope)` with `createApi(telescope)`.
  - ✨ **`@geekmidas/db/introspect`** (new): `listSchemas`, `introspectSchema`, `introspectTable`, a `DataBrowser` for cursor-paged, filtered and sorted rows, and `createIntrospectionHandler`, a fetch-style `(Request) => Promise<Response>` JSON API over them (`/schemas`, `/tables`, `/tables/:name`, `/tables/:name/rows`), read-only and with no HTTP framework dependency. A table with no configured cursor pages by its single-column primary key. Mistakes are named errors: `TableNotFound`, `ColumnNotFound`, `UnsupportedFilterOperator`, `InvalidCursor`.
  - **`decodeCursor` throws `InvalidCursor`** (exported from `@geekmidas/db/pagination`, `/kysely/pagination` and `/objection/pagination`) instead of a plain `Error`; match on the class rather than the message.
  - **`gkm dev` serves the database API at `/__gkm/db`** for the app's declared database, through the client its handlers use, and prints `db /__gkm/db` on the ready line. It replaces the Studio mount at `/__studio`. `gkm build` never includes it. The app needs `@geekmidas/db` installed, which a scaffold with a database already has.
  - 🔥 **The `studio` config option is removed** from `gkm.config.ts` and workspace app config, along with `StudioConfig`. Delete it; there is nothing to configure.
  - **`gkm init` scaffolds no UI package.** Fullstack projects get shadcn/ui components written into the web app (`apps/web/src/components/ui/`, `components.json`, `src/lib/utils.ts`, the theme in its global stylesheet) instead of a `packages/ui` workspace package with Storybook. No template writes `src/config/studio.ts` or depends on `@geekmidas/studio`.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.56

## 10.0.0-alpha.55

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.55

## 10.0.0-alpha.54

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.54

## 10.0.0-alpha.53

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.53

## 10.0.0-alpha.52

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.52

## 10.0.0-alpha.51

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.51

## 10.0.0-alpha.50

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.50

## 10.0.0-alpha.49

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.49

## 10.0.0-alpha.48

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.48

## 10.0.0-alpha.47

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.47

## 10.0.0-alpha.46

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.46

## 10.0.0-alpha.45

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.45

## 10.0.0-alpha.44

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.44

## 10.0.0-alpha.43

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.43

## 10.0.0-alpha.42

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.42

## 10.0.0-alpha.41

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.41

## 10.0.0-alpha.40

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.40

## 10.0.0-alpha.39

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.39

## 10.0.0-alpha.38

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.38

## 10.0.0-alpha.37

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.37

## 10.0.0-alpha.36

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.36

## 10.0.0-alpha.35

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.35

## 10.0.0-alpha.34

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.34

## 10.0.0-alpha.33

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.33

## 10.0.0-alpha.32

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.32

## 10.0.0-alpha.31

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.31

## 10.0.0-alpha.30

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.30

## 10.0.0-alpha.29

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.29

## 10.0.0-alpha.28

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.28

## 10.0.0-alpha.27

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.27

## 10.0.0-alpha.26

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.26

## 10.0.0-alpha.25

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.25

## 10.0.0-alpha.24

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.24

## 10.0.0-alpha.23

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.23

## 10.0.0-alpha.22

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.22

## 10.0.0-alpha.21

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.21

## 10.0.0-alpha.20

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.20

## 10.0.0-alpha.19

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.19

## 10.0.0-alpha.18

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.18

## 10.0.0-alpha.17

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.17

## 10.0.0-alpha.16

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.16

## 10.0.0-alpha.15

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.15

## 10.0.0-alpha.14

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.14

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
  - @geekmidas/logger@10.0.0-alpha.13

## 10.0.0-alpha.12

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.12

## 10.0.0-alpha.11

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.11

## 10.0.0-alpha.10

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.10

## 10.0.0-alpha.9

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.9

## 10.0.0-alpha.8

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.8

## 10.0.0-alpha.7

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.7

## 10.0.0-alpha.6

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.6

## 10.0.0-alpha.5

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.5

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

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.4

## 10.0.0-alpha.3

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.3

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

- [#29](https://github.com/geekmidas/toolbox/pull/29) [`05ce914`](https://github.com/geekmidas/toolbox/commit/05ce91446ba29d5158a2a5c010f7bf9c00f761eb) Thanks [@geekmidas](https://github.com/geekmidas)! - Using the logger interface no longer requires pino

  `Logger` is a structural interface — six log methods and `child()` — and
  `ConsoleLogger` implements it with no pino anywhere. Pino is one
  implementation, reached through `@geekmidas/logger/pino`.

  The manifest said otherwise. `pino` and `pino-pretty` were peer dependencies
  with no `peerDependenciesMeta` block, which makes them **required**, and npm
  installs required peers silently. Since `@geekmidas/logger` is a dependency of
  `constructs`, `telescope` and `testkit`, every consumer of the interface was
  made to install the one implementation they might never use. Installing
  `@geekmidas/logger` now pulls in nothing at all; reaching for
  `@geekmidas/logger/pino` is what opts into pino.

  **`@geekmidas/telescope` required pino it never imported.** Outside JSDoc and
  its own tests it imports `pino-abstract-transport` and nothing else, yet
  declared `pino@^9.0.0` — which could not be satisfied beside logger's
  `~10.0.0`, so a consumer holding both got `ERESOLVE` and no install. The peer
  is gone rather than widened: the honest fix for a dependency that was never
  used is to stop declaring it. Its tests now run against the same pino 10 that
  logger ships against, where all 447 pass.

- Updated dependencies [[`05ce914`](https://github.com/geekmidas/toolbox/commit/05ce91446ba29d5158a2a5c010f7bf9c00f761eb)]:
  - @geekmidas/logger@10.0.0-alpha.2

## 10.0.0-alpha.1

### Patch Changes

- Updated dependencies []:
  - @geekmidas/logger@10.0.0-alpha.1

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
  - @geekmidas/logger@10.0.0-alpha.0

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
  - @geekmidas/logger@9.0.2

## 1.1.1

### Patch Changes

- 🐛 [#11](https://github.com/geekmidas/toolbox/pull/11) [`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309) Thanks [@geekmidas](https://github.com/geekmidas)! - Patch release across all packages to realign published versions with the
  registry. The previous release only published the four packages that had
  version bumps; the remaining packages failed with "cannot publish over the
  previously published versions" because their versions were unchanged.
- Updated dependencies [[`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309)]:
  - @geekmidas/logger@1.0.3

## 1.1.0

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

## 1.0.1

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

- Updated dependencies [[`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651)]:
  - @geekmidas/logger@1.0.2

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release

### Patch Changes

- Updated dependencies [[`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8)]:
  - @geekmidas/logger@1.0.0
