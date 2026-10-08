# @geekmidas/services

## 10.0.0-alpha.77

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.77
  - @geekmidas/logger@10.0.0-alpha.77

## 10.0.0-alpha.76

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.76
  - @geekmidas/logger@10.0.0-alpha.76

## 10.0.0-alpha.75

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.75
  - @geekmidas/logger@10.0.0-alpha.75

## 10.0.0-alpha.74

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.74
  - @geekmidas/logger@10.0.0-alpha.74

## 10.0.0-alpha.73

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.73
  - @geekmidas/logger@10.0.0-alpha.73

## 10.0.0-alpha.72

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.72
  - @geekmidas/logger@10.0.0-alpha.72

## 10.0.0-alpha.71

### Patch Changes

- Updated dependencies [[`20264e6`](https://github.com/geekmidas/toolbox/commit/20264e62b0fcd1f9e3c523197cf4bf9828c8ced1)]:
  - @geekmidas/logger@10.0.0-alpha.71
  - @geekmidas/envkit@10.0.0-alpha.71

## 10.0.0-alpha.70

### Patch Changes

- Updated dependencies [[`f3114d7`](https://github.com/geekmidas/toolbox/commit/f3114d70a385d28908167d42e29cd846bb3f4fcc)]:
  - @geekmidas/logger@10.0.0-alpha.70
  - @geekmidas/envkit@10.0.0-alpha.70

## 10.0.0-alpha.69

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.69
  - @geekmidas/logger@10.0.0-alpha.69

## 10.0.0-alpha.68

### Patch Changes

- Updated dependencies [[`871ba05`](https://github.com/geekmidas/toolbox/commit/871ba057aa0a0f69cf8233366b5f4c311359a7cc)]:
  - @geekmidas/logger@10.0.0-alpha.68
  - @geekmidas/envkit@10.0.0-alpha.68

## 10.0.0-alpha.67

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.67
  - @geekmidas/logger@10.0.0-alpha.67

## 10.0.0-alpha.66

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.66
  - @geekmidas/logger@10.0.0-alpha.66

## 10.0.0-alpha.65

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.65
  - @geekmidas/logger@10.0.0-alpha.65

## 10.0.0-alpha.64

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.64
  - @geekmidas/logger@10.0.0-alpha.64

## 10.0.0-alpha.63

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.63
  - @geekmidas/logger@10.0.0-alpha.63

## 10.0.0-alpha.62

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.62
  - @geekmidas/logger@10.0.0-alpha.62

## 10.0.0-alpha.61

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.61
  - @geekmidas/logger@10.0.0-alpha.61

## 10.0.0-alpha.60

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.60
  - @geekmidas/logger@10.0.0-alpha.60

## 10.0.0-alpha.59

### Patch Changes

- Updated dependencies [[`57eea44`](https://github.com/geekmidas/toolbox/commit/57eea445c114acbb398d4dfedc86f1c22dab3f10)]:
  - @geekmidas/logger@10.0.0-alpha.59
  - @geekmidas/envkit@10.0.0-alpha.59

## 10.0.0-alpha.58

### Patch Changes

- Updated dependencies [[`476aeda`](https://github.com/geekmidas/toolbox/commit/476aedab3128ec29948df93f9776dae4e42d3488)]:
  - @geekmidas/logger@10.0.0-alpha.58
  - @geekmidas/envkit@10.0.0-alpha.58

## 10.0.0-alpha.57

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.57
  - @geekmidas/logger@10.0.0-alpha.57

## 10.0.0-alpha.56

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.56
  - @geekmidas/logger@10.0.0-alpha.56

## 10.0.0-alpha.55

### Minor Changes

- [#142](https://github.com/geekmidas/toolbox/pull/142) [`eedac53`](https://github.com/geekmidas/toolbox/commit/eedac53aeec2d88d46a74ec9f3d4a55e2845b2b2) Thanks [@geekmidas](https://github.com/geekmidas)! - Database connections say who holds them, and queries say what ran them
  - **`application_name` on every connection** — the Lambda function's name, or the surface's id on a server (`GKM_APP_NAME`, set by the generated entry), or the app under `gkm dev`. A fallback: `PGAPPNAME` or `?application_name=` in the URL still win. `pg_stat_activity` can now say which function or app is holding connections.
  - ✨ **Query tags.** A query run inside an endpoint, subscriber, queue or cron ends in a sqlcommenter comment, `/*operation='POST /orders',request_id='…'*/`, visible in `pg_stat_activity` and the server's logs. `pg_stat_statements` ignores it. Off with `new KyselyDatabase(id, { queryTags: false })`.
  - **An idle connection ended by the server no longer crashes the process.** Pools had no `'error'` listener, so `idle_session_timeout` or a failover surfaced as an uncaught exception.
  - ✨ **Production servers close their pools on shutdown.** On `SIGTERM` the server stops taking requests, lets in-flight ones finish, and runs `runShutdownHooks()` (new, from `@geekmidas/constructs`) before exiting, instead of waiting 30s with every connection still open. It exits by `GKM_SHUTDOWN_TIMEOUT_MS` (8s by default, under Docker's 10s stop timeout), with code 1 if it had to cut a request off.
  - `@geekmidas/services`: the request context carries the `operation` it is for; `currentRequestContext()` reads it without throwing outside a request.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.55
  - @geekmidas/logger@10.0.0-alpha.55

## 10.0.0-alpha.54

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.54
  - @geekmidas/logger@10.0.0-alpha.54

## 10.0.0-alpha.53

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.53
  - @geekmidas/logger@10.0.0-alpha.53

## 10.0.0-alpha.52

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.52
  - @geekmidas/logger@10.0.0-alpha.52

## 10.0.0-alpha.51

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.51
  - @geekmidas/logger@10.0.0-alpha.51

## 10.0.0-alpha.50

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.50
  - @geekmidas/logger@10.0.0-alpha.50

## 10.0.0-alpha.49

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.49
  - @geekmidas/logger@10.0.0-alpha.49

## 10.0.0-alpha.48

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.48
  - @geekmidas/logger@10.0.0-alpha.48

## 10.0.0-alpha.47

### Patch Changes

- Updated dependencies [[`10ef53d`](https://github.com/geekmidas/toolbox/commit/10ef53d921d519afa62c773a6682581e19c06b1e)]:
  - @geekmidas/envkit@10.0.0-alpha.47
  - @geekmidas/logger@10.0.0-alpha.47

## 10.0.0-alpha.46

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.46
  - @geekmidas/logger@10.0.0-alpha.46

## 10.0.0-alpha.45

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.45
  - @geekmidas/logger@10.0.0-alpha.45

## 10.0.0-alpha.44

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.44
  - @geekmidas/logger@10.0.0-alpha.44

## 10.0.0-alpha.43

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.43
  - @geekmidas/logger@10.0.0-alpha.43

## 10.0.0-alpha.42

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.42
  - @geekmidas/logger@10.0.0-alpha.42

## 10.0.0-alpha.41

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.41
  - @geekmidas/logger@10.0.0-alpha.41

## 10.0.0-alpha.40

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.40
  - @geekmidas/logger@10.0.0-alpha.40

## 10.0.0-alpha.39

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.39
  - @geekmidas/logger@10.0.0-alpha.39

## 10.0.0-alpha.38

### Patch Changes

- Updated dependencies [[`5475a96`](https://github.com/geekmidas/toolbox/commit/5475a96d1d8ee0c99109c65cba76f7e269f42265)]:
  - @geekmidas/envkit@10.0.0-alpha.38
  - @geekmidas/logger@10.0.0-alpha.38

## 10.0.0-alpha.37

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.37
  - @geekmidas/logger@10.0.0-alpha.37

## 10.0.0-alpha.36

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.36
  - @geekmidas/logger@10.0.0-alpha.36

## 10.0.0-alpha.35

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.35
  - @geekmidas/logger@10.0.0-alpha.35

## 10.0.0-alpha.34

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.34
  - @geekmidas/logger@10.0.0-alpha.34

## 10.0.0-alpha.33

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.33
  - @geekmidas/logger@10.0.0-alpha.33

## 10.0.0-alpha.32

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.32
  - @geekmidas/logger@10.0.0-alpha.32

## 10.0.0-alpha.31

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.31
  - @geekmidas/logger@10.0.0-alpha.31

## 10.0.0-alpha.30

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.30
  - @geekmidas/logger@10.0.0-alpha.30

## 10.0.0-alpha.29

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.29
  - @geekmidas/logger@10.0.0-alpha.29

## 10.0.0-alpha.28

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.28
  - @geekmidas/logger@10.0.0-alpha.28

## 10.0.0-alpha.27

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.27
  - @geekmidas/logger@10.0.0-alpha.27

## 10.0.0-alpha.26

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.26
  - @geekmidas/logger@10.0.0-alpha.26

## 10.0.0-alpha.25

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.25
  - @geekmidas/logger@10.0.0-alpha.25

## 10.0.0-alpha.24

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.24
  - @geekmidas/logger@10.0.0-alpha.24

## 10.0.0-alpha.23

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.23
  - @geekmidas/logger@10.0.0-alpha.23

## 10.0.0-alpha.22

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.22
  - @geekmidas/logger@10.0.0-alpha.22

## 10.0.0-alpha.21

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.21
  - @geekmidas/logger@10.0.0-alpha.21

## 10.0.0-alpha.20

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.20
  - @geekmidas/logger@10.0.0-alpha.20

## 10.0.0-alpha.19

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.19
  - @geekmidas/logger@10.0.0-alpha.19

## 10.0.0-alpha.18

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.18
  - @geekmidas/logger@10.0.0-alpha.18

## 10.0.0-alpha.17

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.17
  - @geekmidas/logger@10.0.0-alpha.17

## 10.0.0-alpha.16

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.16
  - @geekmidas/logger@10.0.0-alpha.16

## 10.0.0-alpha.15

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.15
  - @geekmidas/logger@10.0.0-alpha.15

## 10.0.0-alpha.14

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.14
  - @geekmidas/logger@10.0.0-alpha.14

## 10.0.0-alpha.13

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.13
  - @geekmidas/logger@10.0.0-alpha.13

## 10.0.0-alpha.12

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.12
  - @geekmidas/logger@10.0.0-alpha.12

## 10.0.0-alpha.11

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.11
  - @geekmidas/logger@10.0.0-alpha.11

## 10.0.0-alpha.10

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.10
  - @geekmidas/logger@10.0.0-alpha.10

## 10.0.0-alpha.9

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.9
  - @geekmidas/logger@10.0.0-alpha.9

## 10.0.0-alpha.8

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.8
  - @geekmidas/logger@10.0.0-alpha.8

## 10.0.0-alpha.7

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.7
  - @geekmidas/logger@10.0.0-alpha.7

## 10.0.0-alpha.6

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.6
  - @geekmidas/logger@10.0.0-alpha.6

## 10.0.0-alpha.5

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.5
  - @geekmidas/logger@10.0.0-alpha.5

## 10.0.0-alpha.4

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.4
  - @geekmidas/logger@10.0.0-alpha.4

## 10.0.0-alpha.3

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.3
  - @geekmidas/logger@10.0.0-alpha.3

## 10.0.0-alpha.2

### Patch Changes

- Updated dependencies [[`05ce914`](https://github.com/geekmidas/toolbox/commit/05ce91446ba29d5158a2a5c010f7bf9c00f761eb)]:
  - @geekmidas/logger@10.0.0-alpha.2
  - @geekmidas/envkit@10.0.0-alpha.2

## 10.0.0-alpha.1

### Patch Changes

- Updated dependencies []:
  - @geekmidas/envkit@10.0.0-alpha.1
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
  - @geekmidas/envkit@10.0.0-alpha.0
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
  - @geekmidas/envkit@9.0.2
  - @geekmidas/logger@9.0.2

## 2.0.1

### Patch Changes

- 🐛 [#11](https://github.com/geekmidas/toolbox/pull/11) [`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309) Thanks [@geekmidas](https://github.com/geekmidas)! - Patch release across all packages to realign published versions with the
  registry. The previous release only published the four packages that had
  version bumps; the remaining packages failed with "cannot publish over the
  previously published versions" because their versions were unchanged.
- Updated dependencies [[`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309)]:
  - @geekmidas/envkit@1.1.1
  - @geekmidas/logger@1.0.3

## 2.0.0

### Patch Changes

- Updated dependencies [[`7323f34`](https://github.com/geekmidas/toolbox/commit/7323f34176d63170dd53450889ac0b5959420c3c), [`79e2929`](https://github.com/geekmidas/toolbox/commit/79e292978d3dbc8927e25814bdb051d1c380600a)]:
  - @geekmidas/envkit@1.1.0

## 1.1.1

### Patch Changes

- 🐛 [`9f02e9c`](https://github.com/geekmidas/toolbox/commit/9f02e9c8419db1e41692e996e177f2473237ca76) Thanks [@geekmidas](https://github.com/geekmidas)! - fix(services): bind `this` when invoking request-scoped logger methods

  The request-scoped logger proxy re-resolved log methods at call time but
  invoked them unbound. Pino's log methods read internal state off the
  receiver (`this[Symbol(pino.msgPrefix)]`), so calling them without `this`
  threw "Cannot read properties of undefined (reading 'Symbol(pino.msgPrefix)')"
  in production (pino), while dev/test console & spy loggers were unaffected.
  The proxy now invokes the resolved method with the current request's logger
  as `this`.

## 1.1.0

### Minor Changes

- [#5](https://github.com/geekmidas/toolbox/pull/5) [`811d740`](https://github.com/geekmidas/toolbox/commit/811d740ae3875d59ad1b0dc50261266963c8cb76) Thanks [@geekmidas](https://github.com/geekmidas)! - Move the tRPC and Middy service integrations from `@geekmidas/constructs` to `@geekmidas/services`, where they belong — they depend only on `@geekmidas/services`, not on any construct.

  - ✨ **`@geekmidas/constructs`:** the `@geekmidas/constructs/trpc` and `@geekmidas/constructs/middy` entry points are removed (they were only just added). Import from `@geekmidas/services/trpc` and `@geekmidas/services/middy` instead. (`@trpc/server` is no longer a peer dependency of `@geekmidas/constructs`.)
  - ✨ **`@geekmidas/services`:** adds `/trpc` (`createServicesMiddleware`, `createRequestContextMiddleware`) and `/middy` (`requestContext`, `addServices`, `withServices`, `EventServices`) exports.

  The Middy middlewares were also tightened:

  - `requestContext` / `withServices` now require an explicit `logger` (no `ConsoleLogger` default) and are generic over `TLogger extends Logger`, so a custom logger type is preserved.
  - `addServices` / `withServices` now require an `envParser` (no implicit `process.env` default).
  - 🐛 Resolved services are attached to `event.services` (matching the `Function`/`Cron` constructs).

## 1.0.4

### Patch Changes

- 🐛 [#3](https://github.com/geekmidas/toolbox/pull/3) [`42fda53`](https://github.com/geekmidas/toolbox/commit/42fda532bdf4489a3352f6a684f5f30beafccedd) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix stale logger from service initialization

## 1.0.3

### Patch Changes

- ✨ [`351f73b`](https://github.com/geekmidas/toolbox/commit/351f73b032bc0742b7f611a9fbcdfc85bbfd69a8) Thanks [@geekmidas](https://github.com/geekmidas)! - Update request context and add support for trpc

## 1.0.2

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

- Updated dependencies [[`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651)]:
  - @geekmidas/envkit@1.0.7
  - @geekmidas/logger@1.0.2

## 1.0.1

### Patch Changes

- 🔥 [`4bed570`](https://github.com/geekmidas/toolbox/commit/4bed57049db24417ef81279bc88fa0e1255f7b9a) Thanks [@geekmidas](https://github.com/geekmidas)! - Remove singleton enforcement so people can use it how they see fit

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release

### Patch Changes

- Updated dependencies [[`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8)]:
  - @geekmidas/envkit@1.0.0
  - @geekmidas/logger@1.0.0
