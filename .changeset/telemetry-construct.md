---
'@geekmidas/constructs': minor
'@geekmidas/manifest': minor
'@geekmidas/cloud': patch
'@geekmidas/cli': minor
---

:sparkles: **Telemetry is a construct.** `new Telemetry('Telemetry', { ignorePaths?, attributes? })`
from `@geekmidas/constructs/telemetry` declares what an application emits —
never where it goes. `RestApi`, `BetterAuth`, `Worker` and `StaticSite` take it
in their config like `logger`, which records an edge to the node in the
manifest (`telemetry: '<id>'`, read by `dependenciesOf`). An endpoint's
`.telemetry({ ignore, attributes })` records no span for that route, or sets
attributes on its request span. The Lambda adaptors' `Telemetry` hook
interface is still exported from the package root.

`@geekmidas/manifest` adds the `telemetry` kind and `TELEMETRY_KEYS` — the
`OTEL_*` keys the node provides — with `PUBLIC.telemetry` empty, so none of
them can reach a site's public values. `@geekmidas/cloud` provisions nothing
for the node.

**`deploy.telemetry` picks the provider and the sample rate, per stage**:
`'self-hosted'`, `{ provider: 'self-hosted', port?, retentionDays?, public?, sampleRate? }`,
`{ provider: 'otlp', endpoint, headers?, sampleRate? }`, or `false`. Each
process with an edge — and no other — is handed `OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` (the app's name) and
`OTEL_TRACES_SAMPLER=parentbased_traceidratio` with `OTEL_TRACES_SAMPLER_ARG`
from the stage's rate (1 by default). `gkm compose` runs the self-hosted
OpenObserve for a stage that names nothing; Dokploy and AWS have no collector,
so a deployed stage there that uses telemetry names `otlp` or `false`, or the
deploy fails at validate with `TelemetryProviderRequired`
(`SelfHostedTelemetryUnavailable` for `'self-hosted'`).

**The build follows the edge.** A process with the edge needs
`@geekmidas/telescope` and its OpenTelemetry packages: without them
`gkm build` and `gkm dev` fail with `TelemetryPackagesMissing`, naming the app
and the `pnpm --dir <app> add …` to run. A process without the edge gets a stub
that loads nothing, even with an endpoint set.

**Local telemetry with no setup.** `gkm dev` adds OpenObserve to the dev
services whenever a process uses the node, prints its URL and login, lists it
on the discovery endpoint (without the password), and sends every trace there.
Its server entry now starts the same SDK and request middleware as the
production entry, from the same generated `telemetry.ts`. `gkm compose` on the
local stage runs the same OpenObserve on loopback (`GKM_COMPOSE_LOGS_PORT`
moves it); `gkm test` exports nothing. The local stage ignores
`deploy.telemetry`.

:boom: **Removed: `deploy.compose.logs`, the `OTEL_*` pass-through and
`LogsEndpointConflict`.** A stage's own `OTEL_*` secrets are no longer
forwarded to every backend, and `deploy.compose` now refuses `logs`. Move to a
`Telemetry` construct given to each surface and worker, plus
`deploy: { telemetry: { <stage>: 'self-hosted' } }` — `port`, `retentionDays`
and `public` move under the provider — or `{ provider: 'otlp', endpoint, headers }`
for a hosted backend. See the upgrade guide.
