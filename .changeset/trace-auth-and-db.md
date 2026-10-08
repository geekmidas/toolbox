---
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
'@geekmidas/manifest': minor
'@geekmidas/client': patch
---

:bug: An API's session check joins the request's trace, and queries carry their `traceparent`

- **`@geekmidas/constructs`: the auth client's `getSession` is part of the caller's trace.** It writes the active trace context through the global propagator (unless a `fetch` instrumentation is listening, which writes the request's own CLIENT span — two `traceparent` headers would be read as none), and sends the client's address as **`x-gkm-client-ip`** instead of `x-forwarded-for`. A forwarding header made the auth server treat the call as outside traffic and start a new, linked trace; without one the call passes the internal-caller rule and the auth server's `get-session` span is the child of the API's call. **Visible change:** the auth server no longer receives `x-forwarded-for` from an API's session check.
- **`@geekmidas/constructs`: `BetterAuth` reads `x-gkm-client-ip` first** — `advanced.ipAddress.ipAddressHeaders` is `['x-gkm-client-ip', ...]` followed by the app's own list, or `x-forwarded-for` — so `/get-session` is still rate-limited per client. Its server drops the header from any request that is not an internal caller's (no `Origin`, no forwarding header, a loopback or private peer), so it cannot be spoofed where no gkm edge stands in front. New export `withTrustedClientIp`.
- **`@geekmidas/constructs`: query tags carry `traceparent`.** Inside a trace, each query's sqlcommenter tag ends in `traceparent='00-<trace id>-<span id>-<flags>'` — the query's own span — so `pg_stat_activity`, slow-query and `auto_explain` logs join to traces. Without an active span the tag is unchanged.
- **`@geekmidas/cli`: every edge strips `x-gkm-client-ip`** — `request_header -x-gkm-client-ip` in each compose Caddy site block and each `gkm dev` edge site, and a `<project>-strip-gkm-headers` middleware first in every router of the shared Traefik edge.
- **`@geekmidas/manifest`: `CLIENT_IP_HEADER`**, the reserved header's name, shared by the constructs and the edges.
- **`@geekmidas/client`: the trace headers are left to a `fetch` instrumentation** when one is listening in the process (a server with OpenTelemetry's undici instrumentation), instead of being written twice.
- **`@geekmidas/cli`: a local deploy lock is taken atomically with its holder written** (written to a temporary file, then linked into place), so a runner that loses a race is always told who holds the lock instead of `null`.
