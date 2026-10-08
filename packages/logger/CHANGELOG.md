# @geekmidas/logger

## 10.0.0-alpha.88

## 10.0.0-alpha.87

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

### Patch Changes

- [#191](https://github.com/geekmidas/toolbox/pull/191) [`20264e6`](https://github.com/geekmidas/toolbox/commit/20264e62b0fcd1f9e3c523197cf4bf9828c8ced1) Thanks [@geekmidas](https://github.com/geekmidas)! - `createLogger` serializes an `Error` under `error` as well as `err`, with its type, message and stack. `logger.error({ error }, …)` used to write `"error":{}`. URL credentials in the serialized message and stack are masked, and path redaction (`error.message`, `err.stack`) applies to the serialized fields.

## 10.0.0-alpha.70

### Minor Changes

- [#189](https://github.com/geekmidas/toolbox/pull/189) [`f3114d7`](https://github.com/geekmidas/toolbox/commit/f3114d70a385d28908167d42e29cd846bb3f4fcc) Thanks [@geekmidas](https://github.com/geekmidas)! - `createLogger` sends its records to OpenTelemetry when a `LoggerProvider` is registered

  When OpenTelemetry logging is on — a global `LoggerProvider` registered, as a
  `gkm build` server's telemetry does when `OTEL_EXPORTER_OTLP_ENDPOINT` is set —
  each record is also emitted through `@opentelemetry/api-logs`: the pino level
  as its severity, the message as its body, the record's fields as attributes,
  and the trace and span ids of the span active where it was logged. The copy is
  taken in pino's `streamWrite` hook, after path redaction and URL-credential
  redaction, so it is exactly as redacted as stdout, and on the calling thread,
  so the active span is the caller's. stdout is unchanged; with no provider
  registered nothing is parsed or emitted.

  It hooks no module loading, so it works inside one bundled file, where
  `@opentelemetry/instrumentation-pino` sees nothing. `@opentelemetry/api-logs`
  is a dependency (it holds its provider on `globalThis`, so the logger's copy
  and the SDK's share one). A logger made with `pino()` directly opts in with
  `hooks: { streamWrite: otelStreamWrite }` from the new
  `@geekmidas/logger/otel` export.

## 10.0.0-alpha.69

## 10.0.0-alpha.68

### Minor Changes

- [#187](https://github.com/geekmidas/toolbox/pull/187) [`871ba05`](https://github.com/geekmidas/toolbox/commit/871ba057aa0a0f69cf8233366b5f4c311359a7cc) Thanks [@geekmidas](https://github.com/geekmidas)! - Redaction masks the credentials of any URL in a log line: `s3://KEY:SECRET@uploads` is written as `s3://REDACTED@uploads`, in any field at any depth and in the message. Path redaction cannot catch a URL, which turns up under any name (`url`, `origin`, `endpoint`). A URL with a user and no password is left as it is. It is on whenever redaction is, and off with `redact: false`. `redactUrlCredentials` is exported from `@geekmidas/logger/redact`.

## 10.0.0-alpha.67

## 10.0.0-alpha.66

## 10.0.0-alpha.65

## 10.0.0-alpha.64

## 10.0.0-alpha.63

## 10.0.0-alpha.62

## 10.0.0-alpha.61

## 10.0.0-alpha.60

## 10.0.0-alpha.59

### Patch Changes

- [#174](https://github.com/geekmidas/toolbox/pull/174) [`57eea44`](https://github.com/geekmidas/toolbox/commit/57eea445c114acbb398d4dfedc86f1c22dab3f10) Thanks [@geekmidas](https://github.com/geekmidas)! - `createLogger({ pretty: true })` no longer pretty-prints in production

  The check read `process.NODE_ENV`, which is always undefined, so `pretty: true` started the `pino-pretty` transport in production too. It reads `process.env.NODE_ENV` now.

## 10.0.0-alpha.58

### Minor Changes

- [#167](https://github.com/geekmidas/toolbox/pull/167) [`476aeda`](https://github.com/geekmidas/toolbox/commit/476aedab3128ec29948df93f9776dae4e42d3488) Thanks [@geekmidas](https://github.com/geekmidas)! - Production defaults: OpenTelemetry wired into the production entry, and logger redaction on

  - :boom: `createLogger` from `@geekmidas/logger/pino` now redacts `DEFAULT_REDACT_PATHS` when `redact` is left out. Pass `redact: false` for the old behaviour. It also takes a `destination` to write to.
  - `gkm build --production` writes a `telemetry.ts` beside `server.ts`, and the entry awaits it before importing the app. When `OTEL_EXPORTER_OTLP_ENDPOINT` is set it calls `setupTelemetry` with `service.name` (the surface id), `service.namespace` (the workspace) and `deployment.environment` (`STAGE`). Unset, nothing is imported. An app without `@geekmidas/telescope` and the `@opentelemetry/*` peers still builds and starts, and warns `TelemetryUnavailable` if the endpoint is set.
  - `setupTelemetry` gains `sampleRatio` (parent-based ratio sampling, `InvalidSampleRatio` outside 0–1), `serviceNamespace`, `deploymentEnvironment` and `handleSignals`. Without an `endpoint` it now follows the standard `OTEL_EXPORTER_OTLP_*` variables instead of writing to the console, and `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` apply when no ratio is passed.
  - 🐛 Fixed: OTLP log export never sent anything — the log processor went to a `LoggerProvider` nothing registered. It is now handed to the SDK. `shutdownTelemetry` also removes its `SIGTERM` listener.

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

## 10.0.0-alpha.46

## 10.0.0-alpha.45

## 10.0.0-alpha.44

## 10.0.0-alpha.43

## 10.0.0-alpha.42

## 10.0.0-alpha.41

## 10.0.0-alpha.40

## 10.0.0-alpha.39

## 10.0.0-alpha.38

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

### Patch Changes

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

## 1.0.3

### Patch Changes

- 🐛 [#11](https://github.com/geekmidas/toolbox/pull/11) [`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309) Thanks [@geekmidas](https://github.com/geekmidas)! - Patch release across all packages to realign published versions with the
  registry. The previous release only published the four packages that had
  version bumps; the remaining packages failed with "cannot publish over the
  previously published versions" because their versions were unchanged.

## 1.0.2

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

## 1.0.1

### Patch Changes

- ✨ [`0830c6e`](https://github.com/geekmidas/toolbox/commit/0830c6e0d60842526788e0e1f0e78827514ea7b3) Thanks [@geekmidas](https://github.com/geekmidas)! - Add optional sniff support

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release
