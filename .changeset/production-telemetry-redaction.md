---
'@geekmidas/telescope': minor
'@geekmidas/logger': minor
'@geekmidas/cli': minor
---

Production defaults: OpenTelemetry wired into the production entry, and logger redaction on

- :boom: `createLogger` from `@geekmidas/logger/pino` now redacts `DEFAULT_REDACT_PATHS` when `redact` is left out. Pass `redact: false` for the old behaviour. It also takes a `destination` to write to.
- `gkm build --production` writes a `telemetry.ts` beside `server.ts`, and the entry awaits it before importing the app. When `OTEL_EXPORTER_OTLP_ENDPOINT` is set it calls `setupTelemetry` with `service.name` (the surface id), `service.namespace` (the workspace) and `deployment.environment` (`STAGE`). Unset, nothing is imported. An app without `@geekmidas/telescope` and the `@opentelemetry/*` peers still builds and starts, and warns `TelemetryUnavailable` if the endpoint is set.
- `setupTelemetry` gains `sampleRatio` (parent-based ratio sampling, `InvalidSampleRatio` outside 0–1), `serviceNamespace`, `deploymentEnvironment` and `handleSignals`. Without an `endpoint` it now follows the standard `OTEL_EXPORTER_OTLP_*` variables instead of writing to the console, and `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` apply when no ratio is passed.
- Fixed: OTLP log export never sent anything — the log processor went to a `LoggerProvider` nothing registered. It is now handed to the SDK. `shutdownTelemetry` also removes its `SIGTERM` listener.
