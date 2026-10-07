---
'@geekmidas/logger': minor
---

`createLogger` sends its records to OpenTelemetry when a `LoggerProvider` is registered

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
