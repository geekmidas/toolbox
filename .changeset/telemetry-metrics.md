---
'@geekmidas/telescope': minor
'@geekmidas/cli': minor
'@geekmidas/constructs': patch
---

:sparkles: **Telemetry exports metrics.** Every process with a `Telemetry` edge now sends
OTLP metrics to the same collector as its traces and logs — OpenObserve under
`gkm dev` and `gkm compose`, or the stage's `otlp` endpoint:

- `http.server.request.duration` (seconds, the semantic conventions' buckets),
  recorded by `honoTelemetryMiddleware`, the Lambda `telemetryMiddleware` and
  `OTelTelemetry`, by `http.request.method`, `http.route` (the matched route,
  left off when none matched), `http.response.status_code`, `url.scheme`, and
  `error.type` on a 5xx. Not sampled: every request is counted.
- The Node.js runtime's metrics and outgoing requests'
  `http.client.request.duration`, from the auto-instrumentation.

`setupTelemetry` builds the reader itself: `<endpoint>/metrics` for an explicit
endpoint, `/v1/metrics` from `OTEL_EXPORTER_OTLP_ENDPOINT`, and none with no
collector — the SDK left to itself exported to `localhost:4318` whether or not
anything listened. `metrics: false` or `OTEL_METRICS_EXPORTER=none` turns them
off; `OTEL_METRIC_EXPORT_INTERVAL` sets the interval (60s). `flushTelemetry()`
flushes metrics too, so a Lambda exports them before it freezes. New exports:
`recordHttpServerRequest`, `HTTP_SERVER_REQUEST_DURATION`,
`setGlobalMetricReader`, `MetricFlushTimeout`.

:boom: `@opentelemetry/exporter-metrics-otlp-http` and `@opentelemetry/sdk-metrics` join
the instrumentation's optional peers and `TELEMETRY_PACKAGES`: an app with the
construct adds them, or `gkm build` fails with `TelemetryPackagesMissing`.

**The Hono adaptor logs a request it rejects before the handler.** A body,
query or params that fails its schema (`'Request validation failed'`, with an
`UnprocessableEntityError` under `err` and the `part`) and a body that cannot be
read (`'Request body could not be read'`) are logged at `error` through the
request's logger, as the Lambda adaptors already did — they returned a 422
without a line. The response carries the same `X-Request-ID` the line does.
