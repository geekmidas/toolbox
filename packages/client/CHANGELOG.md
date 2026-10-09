# @geekmidas/client

## 10.0.0-alpha.90

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.90
  - @geekmidas/schema@10.0.0-alpha.90

## 10.0.0-alpha.89

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.89
  - @geekmidas/schema@10.0.0-alpha.89

## 10.0.0-alpha.88

### Patch Changes

- Updated dependencies [[`06047cc`](https://github.com/geekmidas/toolbox/commit/06047cc82da9076a73e60d706612a2e25eadf08d)]:
  - @geekmidas/constructs@10.0.0-alpha.88
  - @geekmidas/schema@10.0.0-alpha.88

## 10.0.0-alpha.87

### Patch Changes

- Updated dependencies [[`8bcea8e`](https://github.com/geekmidas/toolbox/commit/8bcea8eb2a8c6f70210e9b77236f3f72aef50ae8)]:
  - @geekmidas/constructs@10.0.0-alpha.87
  - @geekmidas/schema@10.0.0-alpha.87

## 10.0.0-alpha.86

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.86
  - @geekmidas/schema@10.0.0-alpha.86

## 10.0.0-alpha.85

### Patch Changes

- 🐛 [#214](https://github.com/geekmidas/toolbox/pull/214) [`46f3d3d`](https://github.com/geekmidas/toolbox/commit/46f3d3d57682cae53ce315598fb9eeb6c3df8f2a) Thanks [@geekmidas](https://github.com/geekmidas)! - :bug: An API's session check joins the request's trace, and queries carry their `traceparent`

  - ✨ **`@geekmidas/constructs`: the auth client's `getSession` is part of the caller's trace.** It writes the active trace context through the global propagator (unless a `fetch` instrumentation is listening, which writes the request's own CLIENT span — two `traceparent` headers would be read as none), and sends the client's address as **`x-gkm-client-ip`** instead of `x-forwarded-for`. A forwarding header made the auth server treat the call as outside traffic and start a new, linked trace; without one the call passes the internal-caller rule and the auth server's `get-session` span is the child of the API's call. **Visible change:** the auth server no longer receives `x-forwarded-for` from an API's session check.
  - ✨ **`@geekmidas/constructs`: `BetterAuth` reads `x-gkm-client-ip` first** — `advanced.ipAddress.ipAddressHeaders` is `['x-gkm-client-ip', ...]` followed by the app's own list, or `x-forwarded-for` — so `/get-session` is still rate-limited per client. Its server drops the header from any request that is not an internal caller's (no `Origin`, no forwarding header, a loopback or private peer), so it cannot be spoofed where no gkm edge stands in front. New export `withTrustedClientIp`.
  - **`@geekmidas/constructs`: query tags carry `traceparent`.** Inside a trace, each query's sqlcommenter tag ends in `traceparent='00-<trace id>-<span id>-<flags>'` — the query's own span — so `pg_stat_activity`, slow-query and `auto_explain` logs join to traces. Without an active span the tag is unchanged.
  - **`@geekmidas/cli`: every edge strips `x-gkm-client-ip`** — `request_header -x-gkm-client-ip` in each compose Caddy site block and each `gkm dev` edge site, and a `<project>-strip-gkm-headers` middleware first in every router of the shared Traefik edge.
  - **`@geekmidas/manifest`: `CLIENT_IP_HEADER`**, the reserved header's name, shared by the constructs and the edges.
  - **`@geekmidas/client`: the trace headers are left to a `fetch` instrumentation** when one is listening in the process (a server with OpenTelemetry's undici instrumentation), instead of being written twice.
  - **`@geekmidas/cli`: a local deploy lock is taken atomically with its holder written** (written to a temporary file, then linked into place), so a runner that loses a race is always told who holds the lock instead of `null`.

- Updated dependencies [[`46f3d3d`](https://github.com/geekmidas/toolbox/commit/46f3d3d57682cae53ce315598fb9eeb6c3df8f2a)]:
  - @geekmidas/constructs@10.0.0-alpha.85
  - @geekmidas/schema@10.0.0-alpha.85

## 10.0.0-alpha.84

### Patch Changes

- Updated dependencies [[`cbfe22e`](https://github.com/geekmidas/toolbox/commit/cbfe22e6cfa354c649a583ac6cc16ef8c524aeba)]:
  - @geekmidas/constructs@10.0.0-alpha.84
  - @geekmidas/schema@10.0.0-alpha.84

## 10.0.0-alpha.83

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.83
  - @geekmidas/schema@10.0.0-alpha.83

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
  - @geekmidas/constructs@10.0.0-alpha.82
  - @geekmidas/schema@10.0.0-alpha.82

## 10.0.0-alpha.81

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.81
  - @geekmidas/schema@10.0.0-alpha.81

## 10.0.0-alpha.80

### Patch Changes

- Updated dependencies [[`f3638fb`](https://github.com/geekmidas/toolbox/commit/f3638fb116f7aeebbbb29c8f06deaa7813cc760e)]:
  - @geekmidas/constructs@10.0.0-alpha.80
  - @geekmidas/schema@10.0.0-alpha.80

## 10.0.0-alpha.79

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.79
  - @geekmidas/schema@10.0.0-alpha.79

## 10.0.0-alpha.78

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.78
  - @geekmidas/schema@10.0.0-alpha.78

## 10.0.0-alpha.77

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.77
  - @geekmidas/schema@10.0.0-alpha.77

## 10.0.0-alpha.76

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.76
  - @geekmidas/schema@10.0.0-alpha.76

## 10.0.0-alpha.75

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.75
  - @geekmidas/schema@10.0.0-alpha.75

## 10.0.0-alpha.74

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.74
  - @geekmidas/schema@10.0.0-alpha.74

## 10.0.0-alpha.73

### Patch Changes

- Updated dependencies [[`5db7b84`](https://github.com/geekmidas/toolbox/commit/5db7b84aba6455989163abcd2c203b6dc28b7cb3)]:
  - @geekmidas/constructs@10.0.0-alpha.73
  - @geekmidas/schema@10.0.0-alpha.73

## 10.0.0-alpha.72

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.72
  - @geekmidas/schema@10.0.0-alpha.72

## 10.0.0-alpha.71

### Patch Changes

- Updated dependencies [[`5b5cc7b`](https://github.com/geekmidas/toolbox/commit/5b5cc7bf2141558b03418d4338de4f5ac6b4be6c)]:
  - @geekmidas/constructs@10.0.0-alpha.71
  - @geekmidas/schema@10.0.0-alpha.71

## 10.0.0-alpha.70

### Patch Changes

- Updated dependencies [[`42e6e4e`](https://github.com/geekmidas/toolbox/commit/42e6e4ef52b465df702c927758be58120b9a5976)]:
  - @geekmidas/constructs@10.0.0-alpha.70
  - @geekmidas/schema@10.0.0-alpha.70

## 10.0.0-alpha.69

### Patch Changes

- Updated dependencies [[`f209d09`](https://github.com/geekmidas/toolbox/commit/f209d09a763538fdb843833a7519f744647239e4)]:
  - @geekmidas/constructs@10.0.0-alpha.69
  - @geekmidas/schema@10.0.0-alpha.69

## 10.0.0-alpha.68

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.68
  - @geekmidas/schema@10.0.0-alpha.68

## 10.0.0-alpha.67

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.67
  - @geekmidas/schema@10.0.0-alpha.67

## 10.0.0-alpha.66

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.66
  - @geekmidas/schema@10.0.0-alpha.66

## 10.0.0-alpha.65

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.65
  - @geekmidas/schema@10.0.0-alpha.65

## 10.0.0-alpha.64

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.64
  - @geekmidas/schema@10.0.0-alpha.64

## 10.0.0-alpha.63

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.63
  - @geekmidas/schema@10.0.0-alpha.63

## 10.0.0-alpha.62

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.62
  - @geekmidas/schema@10.0.0-alpha.62

## 10.0.0-alpha.61

### Patch Changes

- Updated dependencies [[`7aece20`](https://github.com/geekmidas/toolbox/commit/7aece20749fef144a790a8f3077dc3de2055e0de)]:
  - @geekmidas/constructs@10.0.0-alpha.61
  - @geekmidas/schema@10.0.0-alpha.61

## 10.0.0-alpha.60

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.60
  - @geekmidas/schema@10.0.0-alpha.60

## 10.0.0-alpha.59

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.59
  - @geekmidas/schema@10.0.0-alpha.59

## 10.0.0-alpha.58

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.58
  - @geekmidas/schema@10.0.0-alpha.58

## 10.0.0-alpha.57

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.57
  - @geekmidas/schema@10.0.0-alpha.57

## 10.0.0-alpha.56

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.56
  - @geekmidas/schema@10.0.0-alpha.56

## 10.0.0-alpha.55

### Patch Changes

- Updated dependencies [[`eedac53`](https://github.com/geekmidas/toolbox/commit/eedac53aeec2d88d46a74ec9f3d4a55e2845b2b2)]:
  - @geekmidas/constructs@10.0.0-alpha.55
  - @geekmidas/schema@10.0.0-alpha.55

## 10.0.0-alpha.54

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.54
  - @geekmidas/schema@10.0.0-alpha.54

## 10.0.0-alpha.53

### Patch Changes

- Updated dependencies [[`6fb1ce4`](https://github.com/geekmidas/toolbox/commit/6fb1ce4406c4dc8517b65923190af169c2aa70a7)]:
  - @geekmidas/constructs@10.0.0-alpha.53
  - @geekmidas/schema@10.0.0-alpha.53

## 10.0.0-alpha.52

### Patch Changes

- Updated dependencies [[`0eb2628`](https://github.com/geekmidas/toolbox/commit/0eb2628f0fc00dc65543f6c6fe64400cd3bbd6b5)]:
  - @geekmidas/constructs@10.0.0-alpha.52
  - @geekmidas/schema@10.0.0-alpha.52

## 10.0.0-alpha.51

### Patch Changes

- Updated dependencies [[`1aa7b43`](https://github.com/geekmidas/toolbox/commit/1aa7b434e28ef24e4bdf057847b510fa9cfa1fcf)]:
  - @geekmidas/constructs@10.0.0-alpha.51
  - @geekmidas/schema@10.0.0-alpha.51

## 10.0.0-alpha.50

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.50
  - @geekmidas/schema@10.0.0-alpha.50

## 10.0.0-alpha.49

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.49
  - @geekmidas/schema@10.0.0-alpha.49

## 10.0.0-alpha.48

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.48
  - @geekmidas/schema@10.0.0-alpha.48

## 10.0.0-alpha.47

### Patch Changes

- Updated dependencies [[`10ef53d`](https://github.com/geekmidas/toolbox/commit/10ef53d921d519afa62c773a6682581e19c06b1e)]:
  - @geekmidas/constructs@10.0.0-alpha.47
  - @geekmidas/schema@10.0.0-alpha.47

## 10.0.0-alpha.46

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.46
  - @geekmidas/schema@10.0.0-alpha.46

## 10.0.0-alpha.45

### Patch Changes

- Updated dependencies [[`8dbf325`](https://github.com/geekmidas/toolbox/commit/8dbf325495de962ea5889459b31e2700dc4d6726)]:
  - @geekmidas/constructs@10.0.0-alpha.45
  - @geekmidas/schema@10.0.0-alpha.45

## 10.0.0-alpha.44

### Patch Changes

- Updated dependencies [[`067b7a9`](https://github.com/geekmidas/toolbox/commit/067b7a9b3ede9e2de4f52b9d4fdf5af008abc269)]:
  - @geekmidas/constructs@10.0.0-alpha.44
  - @geekmidas/schema@10.0.0-alpha.44

## 10.0.0-alpha.43

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.43
  - @geekmidas/schema@10.0.0-alpha.43

## 10.0.0-alpha.42

### Patch Changes

- Updated dependencies [[`9917e96`](https://github.com/geekmidas/toolbox/commit/9917e9608582a11170d289f14476c5ed72d18d3b), [`9d96389`](https://github.com/geekmidas/toolbox/commit/9d9638977a5b24dd64bb8135d6bcdc1ed182b594)]:
  - @geekmidas/constructs@10.0.0-alpha.42
  - @geekmidas/schema@10.0.0-alpha.42

## 10.0.0-alpha.41

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.41
  - @geekmidas/schema@10.0.0-alpha.41

## 10.0.0-alpha.40

### Patch Changes

- Updated dependencies [[`e8d29dd`](https://github.com/geekmidas/toolbox/commit/e8d29dd29084e59b40a3b5bd1a2806c3b9c93f6d)]:
  - @geekmidas/constructs@10.0.0-alpha.40
  - @geekmidas/schema@10.0.0-alpha.40

## 10.0.0-alpha.39

### Patch Changes

- Updated dependencies [[`087444c`](https://github.com/geekmidas/toolbox/commit/087444c16591656ab7d85b7713939982231cb1f2)]:
  - @geekmidas/constructs@10.0.0-alpha.39
  - @geekmidas/schema@10.0.0-alpha.39

## 10.0.0-alpha.38

### Patch Changes

- Updated dependencies [[`5475a96`](https://github.com/geekmidas/toolbox/commit/5475a96d1d8ee0c99109c65cba76f7e269f42265)]:
  - @geekmidas/constructs@10.0.0-alpha.38
  - @geekmidas/schema@10.0.0-alpha.38

## 10.0.0-alpha.37

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.37
  - @geekmidas/schema@10.0.0-alpha.37

## 10.0.0-alpha.36

### Patch Changes

- Updated dependencies [[`95cef66`](https://github.com/geekmidas/toolbox/commit/95cef66e07893be917b5d560a06618c60504b94e)]:
  - @geekmidas/constructs@10.0.0-alpha.36
  - @geekmidas/schema@10.0.0-alpha.36

## 10.0.0-alpha.35

### Patch Changes

- Updated dependencies [[`78d87ac`](https://github.com/geekmidas/toolbox/commit/78d87ace5e9a6027c8bba74e0bb40260431f7912)]:
  - @geekmidas/constructs@10.0.0-alpha.35
  - @geekmidas/schema@10.0.0-alpha.35

## 10.0.0-alpha.34

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.34
  - @geekmidas/schema@10.0.0-alpha.34

## 10.0.0-alpha.33

### Patch Changes

- Updated dependencies [[`e7178a8`](https://github.com/geekmidas/toolbox/commit/e7178a8d804b7f9ffbffd2df3f6974d8f65feeb5)]:
  - @geekmidas/constructs@10.0.0-alpha.33
  - @geekmidas/schema@10.0.0-alpha.33

## 10.0.0-alpha.32

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.32
  - @geekmidas/schema@10.0.0-alpha.32

## 10.0.0-alpha.31

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.31
  - @geekmidas/schema@10.0.0-alpha.31

## 10.0.0-alpha.30

### Patch Changes

- Updated dependencies [[`58eba5c`](https://github.com/geekmidas/toolbox/commit/58eba5cd5bc0e76565668bd9a48d836dd622ef98)]:
  - @geekmidas/constructs@10.0.0-alpha.30
  - @geekmidas/schema@10.0.0-alpha.30

## 10.0.0-alpha.29

### Patch Changes

- Updated dependencies [[`cf82cef`](https://github.com/geekmidas/toolbox/commit/cf82cefb1aa19cc551c61e58a5c4d8ed608c85b3), [`a8632d3`](https://github.com/geekmidas/toolbox/commit/a8632d33f5e3acd8e84a5714602da5e6b85c9094)]:
  - @geekmidas/constructs@10.0.0-alpha.29
  - @geekmidas/schema@10.0.0-alpha.29

## 10.0.0-alpha.28

### Patch Changes

- Updated dependencies [[`376b2ce`](https://github.com/geekmidas/toolbox/commit/376b2ce470ee919e2f30a0eebd9ba229d37112af)]:
  - @geekmidas/constructs@10.0.0-alpha.28
  - @geekmidas/schema@10.0.0-alpha.28

## 10.0.0-alpha.27

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.27
  - @geekmidas/schema@10.0.0-alpha.27

## 10.0.0-alpha.26

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.26
  - @geekmidas/schema@10.0.0-alpha.26

## 10.0.0-alpha.25

### Patch Changes

- Updated dependencies [[`6b4e1b9`](https://github.com/geekmidas/toolbox/commit/6b4e1b9190eef542099952d80e9b9001a8939621)]:
  - @geekmidas/constructs@10.0.0-alpha.25
  - @geekmidas/schema@10.0.0-alpha.25

## 10.0.0-alpha.24

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.24
  - @geekmidas/schema@10.0.0-alpha.24

## 10.0.0-alpha.23

### Patch Changes

- Updated dependencies [[`31a4ed5`](https://github.com/geekmidas/toolbox/commit/31a4ed57b5c962bc5b961e734b20249b3c64f3d6), [`7c7e0ef`](https://github.com/geekmidas/toolbox/commit/7c7e0efac3b655a20c9eb8f3a4ff4e3e9e4deea9)]:
  - @geekmidas/constructs@10.0.0-alpha.23
  - @geekmidas/schema@10.0.0-alpha.23

## 10.0.0-alpha.22

### Patch Changes

- [#82](https://github.com/geekmidas/toolbox/pull/82) [`ba670bf`](https://github.com/geekmidas/toolbox/commit/ba670bfde5db17f89a4f59d73ca63a09ef449a0c) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm test` writes a test manifest, and the feature-test kit is built from it

  `gkm test` already discovered an app's constructs and resolved its test stage —
  then threw both away and left a test to declare them again, environment keys
  included. It now writes `.gkm/test/` into each app:

  - `manifest.json` — every construct and endpoint's source (file and export) and
    the test stage's environment, keyed as the constructs derive their keys;
  - `clients/<surface>.ts` — each surface's typed client, from the generator
    `gkm build` uses;
  - `index.ts` — a `Browser` with a typed client per surface and a better-auth
    client per auth server (server plugins paired with their client plugins), the
    drivers the server entry registers, and the configured `it`, with `db` typed
    by the schema of the database the endpoints name.

  An app maps `"#test": "./.gkm/test/index.ts"`, and a test is `import { it }
from '#test'` — no construct, environment key or client written by hand.
  `gkm test --prepare` writes it and stops, for a typecheck that runs before the
  suite.

  `featureTest` reads the manifest (`GKM_TEST_MANIFEST`), imports the app's own
  construct and endpoint instances from their sources, serves each auth server's
  whole origin, and gains `published(topic | queue)` and `subscriber(s)` /
  `queue(q)` — handlers run on their own with the test's services and
  transactions. Its `modules`/`env` options are gone. `BetterAuth.pluginIds()`
  reports the plugins a server runs.

  The generated `createApi` for a surface with authorizers accepts a `fetch`, and
  `createAuthAwareFetcher`'s type now includes the method calls it already had.

  kitchen-sink's suite runs on this, in CI, through `gkm test`: it had run
  nothing since its tests moved (a stale `include`), and its constructs glob
  missed its endpoints and queues.

- Updated dependencies [[`ba670bf`](https://github.com/geekmidas/toolbox/commit/ba670bfde5db17f89a4f59d73ca63a09ef449a0c)]:
  - @geekmidas/constructs@10.0.0-alpha.22
  - @geekmidas/schema@10.0.0-alpha.22

## 10.0.0-alpha.21

### Patch Changes

- Updated dependencies [[`d505053`](https://github.com/geekmidas/toolbox/commit/d505053ef116d609a8fac6dec85dfcb091d6ac5e)]:
  - @geekmidas/constructs@10.0.0-alpha.21
  - @geekmidas/schema@10.0.0-alpha.21

## 10.0.0-alpha.20

### Minor Changes

- [#78](https://github.com/geekmidas/toolbox/pull/78) [`6ee966c`](https://github.com/geekmidas/toolbox/commit/6ee966c1ea27d25720ac6767c9f2e7ffe63b3f7f) Thanks [@geekmidas](https://github.com/geekmidas)! - Typed method calls: `api.post('/users', { body })`

  Every client — `createTypedFetcher`, `createAuthAwareFetcher`, and so the
  generated `createApi` — now answers by method as well as by
  `api('POST /users', …)`: `api.get`, `post`, `put`, `patch`, `delete`, `options`.
  The route autocompletes per method (only routes with a `POST` appear in
  `api.post`), the second argument has only the keys the endpoint declares, and it
  is required exactly when something in it is.

  Three typing fixes came out of testing it, and apply to `api('…')` too:

  - **Routes declared with `:param` were uncallable.** `InferOpenApi` keyed them by
    the declared form (`/users/:id`) instead of the served one (`/users/{id}`), so
    no path parameter was inferred and the documented `api('GET /users/{id}')` did
    not typecheck against an endpoint declared that way. Paths are now keyed with
    `ConvertRouteParams`, which `@geekmidas/constructs/endpoints` now exports.
  - **A GET accepted any body.** An absent body is `requestBody?: never`, which
    matched `{ content?: … }` with the body inferred as `unknown`.
  - **A required query was optional.** `query` was always optional and never made
    the argument required; now a query with a required key is required, and so is
    the argument.

### Patch Changes

- Updated dependencies [[`6ee966c`](https://github.com/geekmidas/toolbox/commit/6ee966c1ea27d25720ac6767c9f2e7ffe63b3f7f), [`59e3fab`](https://github.com/geekmidas/toolbox/commit/59e3fabaec37ac7ffd9c26c2927daf0cc8f406c8)]:
  - @geekmidas/constructs@10.0.0-alpha.20
  - @geekmidas/schema@10.0.0-alpha.20

## 10.0.0-alpha.19

### Patch Changes

- Updated dependencies [[`8533bac`](https://github.com/geekmidas/toolbox/commit/8533baca5b4771281cdb017e44719d925bdcd883)]:
  - @geekmidas/constructs@10.0.0-alpha.19
  - @geekmidas/schema@10.0.0-alpha.19

## 10.0.0-alpha.18

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.18
  - @geekmidas/schema@10.0.0-alpha.18

## 10.0.0-alpha.17

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.17
  - @geekmidas/schema@10.0.0-alpha.17

## 10.0.0-alpha.16

### Patch Changes

- [#69](https://github.com/geekmidas/toolbox/pull/69) [`259cd9c`](https://github.com/geekmidas/toolbox/commit/259cd9ca0318d2da3193f989f0c78a4c62d774c8) Thanks [@geekmidas](https://github.com/geekmidas)! - Built and typechecked with TypeScript 7

  The packages now build with the native compiler; declarations are emitted by
  tsgo. Nothing in their public types changes.

  `@geekmidas/client` no longer ships `dist/openapi.*`: a stale spec from another
  app that no export named and nothing imported.

  `@geekmidas/cloud`'s `fromManifest` types a database's provider inputs as
  `DatabaseProps` — the `Vpc` component its bootstrap function needs — rather
  than RDS's wider `PostgresArgs`, which also accepts bare subnet ids.

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.16
  - @geekmidas/schema@10.0.0-alpha.16

## 10.0.0-alpha.15

### Patch Changes

- [#67](https://github.com/geekmidas/toolbox/pull/67) [`fa7433f`](https://github.com/geekmidas/toolbox/commit/fa7433f1d396cece6ab4f5736c2835de4e3b3591) Thanks [@geekmidas](https://github.com/geekmidas)! - React 19.3, React Query 5.104, Tailwind 4.3 and lucide-react 1.x

  `@geekmidas/ui` moves to lucide-react 1.48; its `Spinner` props follow
  lucide's narrower `LucideProps`. `gkm init` scaffolds lucide-react 1.48. Peer
  ranges for React, React Query and Tailwind are unchanged.

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.15
  - @geekmidas/schema@10.0.0-alpha.15

## 10.0.0-alpha.14

### Patch Changes

- Updated dependencies [[`9602a19`](https://github.com/geekmidas/toolbox/commit/9602a19a9b4fb9cecd2641d108976f73272df55e)]:
  - @geekmidas/schema@10.0.0-alpha.14
  - @geekmidas/constructs@10.0.0-alpha.14

## 10.0.0-alpha.13

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.13
  - @geekmidas/schema@10.0.0-alpha.13

## 10.0.0-alpha.12

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.12
  - @geekmidas/schema@10.0.0-alpha.12

## 10.0.0-alpha.11

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.11
  - @geekmidas/schema@10.0.0-alpha.11

## 10.0.0-alpha.10

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.10
  - @geekmidas/schema@10.0.0-alpha.10

## 10.0.0-alpha.9

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.9
  - @geekmidas/schema@10.0.0-alpha.9

## 10.0.0-alpha.8

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.8
  - @geekmidas/schema@10.0.0-alpha.8

## 10.0.0-alpha.7

### Patch Changes

- Updated dependencies [[`960425f`](https://github.com/geekmidas/toolbox/commit/960425f73bc99ab0304c8ef2d22c7e98ca8313a4)]:
  - @geekmidas/constructs@10.0.0-alpha.7
  - @geekmidas/schema@10.0.0-alpha.7

## 10.0.0-alpha.6

### Patch Changes

- Updated dependencies [[`0e99180`](https://github.com/geekmidas/toolbox/commit/0e991805d82c0affae5f12d6d7d31eddd82533fc), [`26fc832`](https://github.com/geekmidas/toolbox/commit/26fc832910fef9ed6adabfeb76cfb3712219f6e2)]:
  - @geekmidas/constructs@10.0.0-alpha.6
  - @geekmidas/schema@10.0.0-alpha.6

## 10.0.0-alpha.5

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.5
  - @geekmidas/schema@10.0.0-alpha.5

## 10.0.0-alpha.4

### Patch Changes

- Updated dependencies [[`dce9588`](https://github.com/geekmidas/toolbox/commit/dce958803067a24ec3c9ecbba2c76fd00d971904)]:
  - @geekmidas/schema@10.0.0-alpha.4
  - @geekmidas/constructs@10.0.0-alpha.4

## 10.0.0-alpha.3

### Patch Changes

- [#31](https://github.com/geekmidas/toolbox/pull/31) [`633c217`](https://github.com/geekmidas/toolbox/commit/633c217c7e23e024db7d6c6224121a8792190e45) Thanks [@geekmidas](https://github.com/geekmidas)! - A coercing schema no longer rejects what it coerces

  `z.coerce.number()` accepts `'100'` and produces `100`. The handler is
  downstream of parsing, so it reads a number; the client is upstream, so it
  sends the string. The generated client types took both from the schema's
  **output**, and so demanded the parsed type of a request that had not been sent
  yet — rejecting at compile time exactly what the endpoint accepts at runtime.

  Query parameters made it plainest. A query string is text on the wire, always,
  so a coerced query parameter asked callers for a number that cannot be put in a
  URL.

  `requestBody` and `parameters.query` are now typed from the schema's input.
  Responses are unchanged: those are read rather than sent, so the parsed type is
  the right one. For a schema that coerces nothing the two are identical, so this
  costs nothing where it does not matter.

  Type tests now run. `tsconfig.json` excludes `src/__tests__/**`, so every
  `expectTypeOf` in the package compiled to nothing and passed for that reason —
  this bug sat behind those assertions the whole time. `*.test-d.ts` files are
  compiled under `typecheck` and their errors reported as failures.

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.3
  - @geekmidas/schema@10.0.0-alpha.3

## 10.0.0-alpha.2

### Patch Changes

- Updated dependencies [[`3426eae`](https://github.com/geekmidas/toolbox/commit/3426eaec72e0837a33dae873d7fe36282445158b)]:
  - @geekmidas/constructs@10.0.0-alpha.2
  - @geekmidas/schema@10.0.0-alpha.2

## 10.0.0-alpha.1

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@10.0.0-alpha.1
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
  - @geekmidas/constructs@10.0.0-alpha.0
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
  - @geekmidas/constructs@9.0.2
  - @geekmidas/schema@9.0.2

## 9.0.1

### Patch Changes

- 🐛 [#11](https://github.com/geekmidas/toolbox/pull/11) [`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309) Thanks [@geekmidas](https://github.com/geekmidas)! - Patch release across all packages to realign published versions with the
  registry. The previous release only published the four packages that had
  version bumps; the remaining packages failed with "cannot publish over the
  previously published versions" because their versions were unchanged.
- Updated dependencies [[`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309)]:
  - @geekmidas/constructs@7.0.1
  - @geekmidas/schema@1.0.4

## 9.0.0

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@7.0.0

## 8.0.0

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@6.0.0

## 7.0.0

### Patch Changes

- Updated dependencies [[`b004fd8`](https://github.com/geekmidas/toolbox/commit/b004fd8ee74b5f20a047260b16669d16d8fc03b4), [`0dad77e`](https://github.com/geekmidas/toolbox/commit/0dad77e574000e4018033b956ed4bb95935911a5)]:
  - @geekmidas/constructs@5.0.0

## 6.0.0

### Patch Changes

- Updated dependencies [[`811d740`](https://github.com/geekmidas/toolbox/commit/811d740ae3875d59ad1b0dc50261266963c8cb76)]:
  - @geekmidas/constructs@4.0.0

## 5.0.0

### Patch Changes

- Updated dependencies [[`a20be2f`](https://github.com/geekmidas/toolbox/commit/a20be2faa4795600358904b751fa947d3cbb4c45), [`07093f5`](https://github.com/geekmidas/toolbox/commit/07093f5f911bf1ee48e53275da3cce398cc78ff6)]:
  - @geekmidas/constructs@3.1.0

## 4.0.5

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

- Updated dependencies [[`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651)]:
  - @geekmidas/constructs@3.0.12
  - @geekmidas/schema@1.0.2

## 4.0.4

### Patch Changes

- ✨ [`6f8f28a`](https://github.com/geekmidas/toolbox/commit/6f8f28a1317c0b519fd2067a2cd39b73c0585755) Thanks [@geekmidas](https://github.com/geekmidas)! - Add method preservation on the client and add query helpers to hooks

## 4.0.3

### Patch Changes

- ✨ [`54589f8`](https://github.com/geekmidas/toolbox/commit/54589f89d4707c287a133be5c7dbb224b86d630c) Thanks [@geekmidas](https://github.com/geekmidas)! - Add ok discriminator for wrapped clients

## 4.0.2

### Patch Changes

- ✨ [`414e7e1`](https://github.com/geekmidas/toolbox/commit/414e7e1f8ca038e397a5533279bf3a2f6f193a6d) Thanks [@geekmidas](https://github.com/geekmidas)! - Add .wrap on the fetch client for no throw handling

## 4.0.1

### Patch Changes

- [`a39b41f`](https://github.com/geekmidas/toolbox/commit/a39b41fae9c6cfbde8e6d78bf5a11fbb9e59f67d) Thanks [@geekmidas](https://github.com/geekmidas)! - Use qs to process query params instead of custom solution

- Updated dependencies [[`a39b41f`](https://github.com/geekmidas/toolbox/commit/a39b41fae9c6cfbde8e6d78bf5a11fbb9e59f67d)]:
  - @geekmidas/constructs@3.0.3

## 4.0.0

### Patch Changes

- ✨ [`be4f7a9`](https://github.com/geekmidas/toolbox/commit/be4f7a9bd5de7f08adbca582916d6902e0c24de2) Thanks [@geekmidas](https://github.com/geekmidas)! - Add partition support for manifest generation. Users can now group constructs (routes, functions, crons, subscribers) into named partitions by providing a `partition` callback per construct type in the config. Manifests output partitioned fields as `Record<string, T[]>` while remaining flat `T[]` arrays when no partitions are configured.

  Fix mutation type inference in endpoint hooks by using `UseMutationResult` and `UseQueryResult` types directly instead of `ReturnType<typeof useMutation>`, which could resolve to `never` for complex path definitions.

  Add `FileCache` implementation that persists cache entries to a JSON file on disk. Default location is `process.cwd()/.gkm/cache.json`. Uses an in-process mutex combined with `proper-lockfile` for safe concurrent and cross-process writes.

- Updated dependencies []:
  - @geekmidas/constructs@3.0.0

## 3.0.0

### Patch Changes

- Updated dependencies [[`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661)]:
  - @geekmidas/constructs@2.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [[`73511d9`](https://github.com/geekmidas/toolbox/commit/73511d912062eb0776935168c9f72d42c7c854a6)]:
  - @geekmidas/constructs@1.1.0

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release

### Patch Changes

- Updated dependencies [[`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8)]:
  - @geekmidas/constructs@1.0.0
  - @geekmidas/schema@1.0.0
