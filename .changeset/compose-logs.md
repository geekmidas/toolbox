---
'@geekmidas/cli': minor
---

`gkm compose` can run a log UI, every target passes `OTEL_*` to its backends, and Docker logs are rotated

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
deploy: { compose: { logs: true } }
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
