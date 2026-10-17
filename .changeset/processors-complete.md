---
'@geekmidas/manifest': minor
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
---

File server processors: kept results expire, `gkm dev` runs them, telemetry, Dokploy

- **Kept results expire.** A file server with processors puts an expiry on its
  bucket's `.gkm-derived/` prefix — 30 days, or `derived: { days }` on the
  file server — through the same lifecycle rules as `expire`, on S3 and MinIO.
  `bucketExpiry(manifest, id)` in `@geekmidas/manifest` is the one answer both
  read.
- **`gkm dev` runs them.** The dev server of the app holding a file server's
  processors mounts them under `/__gkm/processors/<FileServer>`, and the local
  edge sends each pattern on the file server's host there, so `processedUrl()`
  answers locally as it does deployed.
- **Telemetry.** `FileServer` takes `telemetry` as a `Worker` does: the
  processor unit starts OpenTelemetry, each request is a SERVER span named
  after the processor's pattern, and the deploy hands the unit the stage's
  `OTEL_*` keys. Without the edge it loads no tracing.
- **Dokploy.** Each processor unit is an application of its own at
  `<fileserver>-processors.<domain>`, the host the CDN reaches. Dokploy's
  proxy cannot match a header, so the unit refuses a request without the
  CDN's `X-Gkm-Origin-Verify` itself. A Dokploy file server over MinIO has no
  host to route a pattern on, so processors there fail with
  `ProcessorsNeedCdn`.
