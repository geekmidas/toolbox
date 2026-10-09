# @geekmidas/cli

## 10.0.0-alpha.93

### Minor Changes

- [#225](https://github.com/geekmidas/toolbox/pull/225) [`8b8e529`](https://github.com/geekmidas/toolbox/commit/8b8e529fa1018ca37ff5ac88b3b7fc6f1ba2f33e) Thanks [@geekmidas](https://github.com/geekmidas)! - Deploy state v3: a compose shape of its own, who wrote it, and no state on a CI runner

  A compose stage's state is now `provider: 'compose'` — its releases, identity
  and last deploy, and none of the empty Dokploy fields it used to carry. The DNS
  records gkm writes are resource records, `dns-record:<fqdn>:<type>`, written
  through `recordDnsResource()` / `recordDnsChanges()` from
  `deploy/dnsResources.ts`; `dnsVerified` is gone for compose, the check being made
  on every deploy. Release recording and rollback work on the core every target
  shares.

  Every write says who made it: `updatedBy` on the document and on each resource
  record, `releasedBy` on each release — a GitHub Actions run (actor, run URL,
  workflow) or `user@host` — and `history` keeps the last 20 runs that wrote the
  stage. `gkm state:history --stage <stage>` prints them newest first with each
  app's current release (`--json` too).

  State documents are schema version 3. A v2 document whose Dokploy fields are all
  empty was written by compose and is read as the compose shape (its `dnsRecords`
  becoming `dns-record` resources); a Dokploy document is read unchanged. Either
  is written as v3 by its next write. `gkm state:push` moves a laptop's v2 state
  into SSM or S3 as v3.

  :boom: **A deploy or `gkm deploy:rollback` of a deployed stage now fails in CI
  with `LocalStateInCi` while the workspace keeps its state locally.** The runner,
  and the `.gkm/` on it, is discarded when the job ends, so the next run would
  start with no releases and no record of what was created. Set
  `state: { provider: 'ssm', region: '<region>' }` in `gkm.config.ts` and run
  `gkm state:push --stage <stage>` from the machine that holds the state. The
  local stage, and local state outside CI, are unaffected.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.93
  - @geekmidas/constructs@10.0.0-alpha.93
  - @geekmidas/db@10.0.0-alpha.93
  - @geekmidas/envkit@10.0.0-alpha.93
  - @geekmidas/errors@10.0.0-alpha.93
  - @geekmidas/logger@10.0.0-alpha.93
  - @geekmidas/manifest@10.0.0-alpha.93
  - @geekmidas/schema@10.0.0-alpha.93
  - @geekmidas/services@10.0.0-alpha.93
  - @geekmidas/storage@10.0.0-alpha.93
  - @geekmidas/telescope@10.0.0-alpha.93

## 10.0.0-alpha.92

### Patch Changes

- [#224](https://github.com/geekmidas/toolbox/pull/224) [`75f4304`](https://github.com/geekmidas/toolbox/commit/75f4304d00348ffde6da92a7c8d5d6849d4e8f1b) Thanks [@geekmidas](https://github.com/geekmidas)! - Named errors print without a stack, and missing AWS credentials are named in every command

  An error gkm raises on purpose now extends `GkmError`, and every command prints it as `Name: message` (and what caused it, by message), without a stack trace, and exits 1. Any other error keeps its stack, and `--debug` or `GKM_DEBUG=1` shows the stack of both.

  The SSM and Secrets Manager stores raise `StageSecretsUnreadable` themselves, on a read or a write, when there are no AWS credentials or AWS refuses them as expired. Every command that touches a deployed stage's secrets (`secrets:add`, `secrets:set`, `secrets:show`, `secrets:unset`, `secrets:migrate`, `setup`, `deploy`, `compose`) says so by name instead of printing the SDK's `CredentialsProviderError`. With a profile, the message says `aws sso login --profile <profile>`. The class lives in `secrets/awsStore.ts` and is still exported from `setup`.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.92
  - @geekmidas/constructs@10.0.0-alpha.92
  - @geekmidas/db@10.0.0-alpha.92
  - @geekmidas/envkit@10.0.0-alpha.92
  - @geekmidas/errors@10.0.0-alpha.92
  - @geekmidas/logger@10.0.0-alpha.92
  - @geekmidas/manifest@10.0.0-alpha.92
  - @geekmidas/schema@10.0.0-alpha.92
  - @geekmidas/services@10.0.0-alpha.92
  - @geekmidas/storage@10.0.0-alpha.92
  - @geekmidas/telescope@10.0.0-alpha.92

## 10.0.0-alpha.91

### Minor Changes

- ✨ [#223](https://github.com/geekmidas/toolbox/pull/223) [`15180b3`](https://github.com/geekmidas/toolbox/commit/15180b3b11c1620e2cb72ae20e611de4a75bb0b7) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm secrets:add` walks the stage's keys as checkpoints, unset ones first:
  at each, **Set it now**, **Skip** or **Stop here**. A key is saved to the
  stage's store as soon as it is built, so stopping, Ctrl-C or a failure keeps
  everything set before it, and the run ends with what was saved, skipped and
  still missing — `--missing` picks up the rest. A key a provider on the stage
  creates (a bucket under `deploy.objects.<stage>`, written by `gkm setup`) is
  no longer offered: it is listed with what creates it, and marked
  `"provisioned": true` in `--json`. Mail asks for the service first — Resend,
  Amazon SES, Postmark and Mailgun ask only for their secrets.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.91
  - @geekmidas/constructs@10.0.0-alpha.91
  - @geekmidas/db@10.0.0-alpha.91
  - @geekmidas/envkit@10.0.0-alpha.91
  - @geekmidas/errors@10.0.0-alpha.91
  - @geekmidas/logger@10.0.0-alpha.91
  - @geekmidas/manifest@10.0.0-alpha.91
  - @geekmidas/schema@10.0.0-alpha.91
  - @geekmidas/services@10.0.0-alpha.91
  - @geekmidas/storage@10.0.0-alpha.91
  - @geekmidas/telescope@10.0.0-alpha.91

## 10.0.0-alpha.90

### Patch Changes

- [#222](https://github.com/geekmidas/toolbox/pull/222) [`8ac4b61`](https://github.com/geekmidas/toolbox/commit/8ac4b61355ed85e4bd11733c540f21a6a433efb6) Thanks [@geekmidas](https://github.com/geekmidas)! - Local ports: a saved port in `.gkm/ports.json` that another stack has bound since — another checkout of the same project hashes to the same block — is moved to a free one with a one-line notice, instead of failing `docker compose up` with "port is already allocated". A port this project's own container holds is kept. The free-port probe also checks `127.0.0.1`, which a wildcard bind on macOS does not see.

- 🐛 [#221](https://github.com/geekmidas/toolbox/pull/221) [`c9f94cc`](https://github.com/geekmidas/toolbox/commit/c9f94cce43ac3e424826cac76917dfa7af1cc83c) Thanks [@geekmidas](https://github.com/geekmidas)! - :bug: A test's own savepoints survive the per-statement savepoint, and a dry run with no AWS credentials says what it needs

  - **Savepoints a test or the code opens are left alone.** Since the bound test connection began wrapping each statement in `SAVEPOINT test_statement … RELEASE`, a test's own `savepoint refused` was wrapped too. The `RELEASE` that followed destroyed it, so a later `rollback to savepoint refused` failed with `savepoint "refused" does not exist`. `SAVEPOINT x`, `RELEASE [SAVEPOINT] x` and `ROLLBACK [WORK|TRANSACTION] TO [SAVEPOINT] x` now pass straight through, with quoted names matched as Postgres matches them. While one is open, statements run unwrapped, as they do inside a `begin`. A deliberate `select 1 / 0` therefore aborts the transaction until the test rolls back to its savepoint. The open names are tracked per connection the way Postgres tracks them: `RELEASE x` ends x and everything opened after it, and `ROLLBACK TO x` keeps x open. With none open, a failing statement still fails alone.
  - **`gkm setup --stage <deployed> --dry-run` with no AWS credentials** now fails with `StageSecretsUnreadable` before any provider runs. Previously it failed with the SDK's bare `CredentialsProviderError`. The message says where the stage's secrets are kept (SSM Parameter Store or Secrets Manager) and how to name the account's profile (`--profile <profile>` or `AWS_PROFILE=<profile>`). It also explains that a dry run still reads the secrets, because its plan needs the stage's server (`GKM_SERVER_IPV4`). Every other failure from the store passes through unchanged.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.90
  - @geekmidas/constructs@10.0.0-alpha.90
  - @geekmidas/db@10.0.0-alpha.90
  - @geekmidas/envkit@10.0.0-alpha.90
  - @geekmidas/errors@10.0.0-alpha.90
  - @geekmidas/logger@10.0.0-alpha.90
  - @geekmidas/manifest@10.0.0-alpha.90
  - @geekmidas/schema@10.0.0-alpha.90
  - @geekmidas/services@10.0.0-alpha.90
  - @geekmidas/storage@10.0.0-alpha.90
  - @geekmidas/telescope@10.0.0-alpha.90

## 10.0.0-alpha.89

### Minor Changes

- [#220](https://github.com/geekmidas/toolbox/pull/220) [`e23749e`](https://github.com/geekmidas/toolbox/commit/e23749eb1c212ebdb17b415e812e6d1797072246) Thanks [@geekmidas](https://github.com/geekmidas)! - GoDaddy DNS, DNS records for compose stages, and `domains`/`dns` at the root of the config

  - ✨ :boom: **`domains` and `dns` are at the root of `defineWorkspace`**, not under `deploy`: `defineWorkspace({ domains: { prod: 'shop.com' }, dns: { 'shop.com': { provider: 'godaddy' } }, deploy: { … } })`. A config that still has `deploy.domains` or `deploy.dns` fails to load with `DomainsMoved` or `DnsMoved`, which show the value at its new place. `dns` is keyed by root domain only; the single-domain `{ provider, domain }` shape is gone.
  - :boom: **Per-stage maps are typed from the deployed stages.** `defineWorkspace` infers `stages.deployed` literally (no `as const`), and `domains`, `deploy.objects`, `deploy.telemetry`, `deploy.compose.proxy`/`tls` and a CNAME `target` map take only those stages: any other key, the local stage included, is a type error. A JavaScript config with one fails to load with `UnknownStageKey`, listing the deployed stages.
  - ✨ :boom: **A compose stage with a domain needs `GKM_SERVER_IPV4`** in its secrets — the public address of its server. `gkm setup --stage <stage>` and every compose deploy stop first with `ServerAddressMissing` and the `gkm secrets:set GKM_SERVER_IPV4 '<ip>' --stage <stage>` line; `GKM_SERVER_IPV6` is optional (AAAA records). A malformed value fails with `ServerAddressInvalid`. `gkm secrets:add` lists the key as required (`requiredStageKeys`), and asks for both with validation. Neither key is ever written into an app's or worker's env, a bundle's embedded secrets, or a Dokploy app's variables. Stages with no domain, or a `*.localhost` one, are not affected; Dokploy finds its server from its endpoint and needs neither.
  - ⬆️ **`provider: 'godaddy'`** in `dns`: GoDaddy's v1 records API, one name and type at a time (`GET`/`PUT /v1/domains/{domain}/records/{type}/{name}`) — never a zone-wide or type-wide replace. Authenticated with a Personal Access Token (`Authorization: Bearer`) scoped to `domains.dns:update`, from `GODADDY_API_TOKEN` or `gkm login --provider godaddy`. Only A, AAAA and CNAME records of the requested names are written (`GoDaddyRecordNotAllowed` otherwise). A token that cannot read records falls back to writing each one, idempotently. Named errors: `GoDaddyApiAccessDenied` (GoDaddy's API is limited to accounts with 10+ domains or a Discount Domain Club Premier membership — move DNS to Route53 or Cloudflare, or use `manual`), `GoDaddyScopeMissing`, `GoDaddyCredentialsInvalid`, `GoDaddyDomainNotFound`, `GoDaddyRateLimited` (429s and 504s are retried with backoff). TTLs are at least GoDaddy's 600 seconds. The Dokploy target uses it through the same `DnsProvider` interface.
  - ✨ **`gkm setup --stage <stage>` writes a compose stage's DNS records**: every public host its stack serves — the apex, each app, each file server, the public log UI — gets an A record (and AAAA) for `GKM_SERVER_IPV4`, through the root domain's provider, with this machine's DNS credentials. `dns['<domain>'].records: { mode: 'cname', target }` (one name, or one per stage) writes one A record for the target and a CNAME for every other host; the apex is always an A record. `--dry-run` prints each record and what would change; a record with the right value is left alone, one with another is replaced (`old → new`). `manual` prints the records and writes none.
  - 🐛 **Every compose deploy checks DNS first**: each public host is resolved with the system resolver before the stack starts and certificates are requested; one that does not resolve to the server stops `validate` with `HostNotPointingAtServer`, naming each host, what it resolves to, and the fix. `--skip-dns-check` (on `gkm deploy` and `gkm compose`) turns it off for a CDN or proxy in front of the server. The local stage is never checked.
  - `DnsProviderNotImplemented` and `DnsProviderUnknown` replace two unnamed errors from `createDnsProvider`.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.89
  - @geekmidas/constructs@10.0.0-alpha.89
  - @geekmidas/db@10.0.0-alpha.89
  - @geekmidas/envkit@10.0.0-alpha.89
  - @geekmidas/errors@10.0.0-alpha.89
  - @geekmidas/logger@10.0.0-alpha.89
  - @geekmidas/manifest@10.0.0-alpha.89
  - @geekmidas/schema@10.0.0-alpha.89
  - @geekmidas/services@10.0.0-alpha.89
  - @geekmidas/storage@10.0.0-alpha.89
  - @geekmidas/telescope@10.0.0-alpha.89

## 10.0.0-alpha.88

### Minor Changes

- [#219](https://github.com/geekmidas/toolbox/pull/219) [`06047cc`](https://github.com/geekmidas/toolbox/commit/06047cc82da9076a73e60d706612a2e25eadf08d) Thanks [@geekmidas](https://github.com/geekmidas)! - Stage names are typed from the declared stages

  A stage name written outside `gkm.config.ts` was a bare `string`, so a typo
  was never caught: an `ExternalApi` keyed `prodution` silently fell back to
  `default`, and a seed's `stage === 'prodution'` branch silently never ran.

  `gkm dev`, `gkm build` and `gkm test --prepare` now write `.gkm/stages.d.ts`
  from the loaded workspace:

  ```ts
  declare module "@geekmidas/constructs" {
    interface Stages {
      local: "dev";
      deployed: "staging" | "prod";
    }
  }
  ```

  `@geekmidas/constructs` exports the `Stages` interface and the types read
  from it: `LocalStage`, `DeployedStage`, `TestStage` (`'test'`) and `AnyStage`.
  Without the file, before the first run, each of them is `string`, so nothing
  fails to compile for want of it.

  What they type:

  - `ExternalApi`'s `url` map (`ExternalApiUrl`): keys are the local and
    deployed stages plus `default`.
  - A seed's second argument, `SeedContext` (now exported from
    `@geekmidas/constructs`): `stage` is `AnyStage`.
  - The test manifest's `stage`, `TestStage`.

  TypeScript never matches a dot folder with a wildcard, so the tsconfig names
  the file: `gkm init` adds `.gkm/stages.d.ts` to each API's (and the root's)
  `include`. An existing project adds it by hand. Nothing changes at runtime.

### Patch Changes

- Updated dependencies [[`06047cc`](https://github.com/geekmidas/toolbox/commit/06047cc82da9076a73e60d706612a2e25eadf08d)]:
  - @geekmidas/constructs@10.0.0-alpha.88
  - @geekmidas/cache@10.0.0-alpha.88
  - @geekmidas/db@10.0.0-alpha.88
  - @geekmidas/envkit@10.0.0-alpha.88
  - @geekmidas/errors@10.0.0-alpha.88
  - @geekmidas/logger@10.0.0-alpha.88
  - @geekmidas/manifest@10.0.0-alpha.88
  - @geekmidas/schema@10.0.0-alpha.88
  - @geekmidas/services@10.0.0-alpha.88
  - @geekmidas/storage@10.0.0-alpha.88
  - @geekmidas/telescope@10.0.0-alpha.88

## 10.0.0-alpha.87

### Patch Changes

- 🐛 [#218](https://github.com/geekmidas/toolbox/pull/218) [`8bcea8e`](https://github.com/geekmidas/toolbox/commit/8bcea8eb2a8c6f70210e9b77236f3f72aef50ae8) Thanks [@geekmidas](https://github.com/geekmidas)! - :bug: A feature test's session checks keep each browser's address again

  - **In-process requests present a loopback peer.** `featureTest` hands each request to a surface's or auth server's Hono app with no socket, so the auth server, which only believes `x-gkm-client-ip` from an internal caller, dropped it, and every session check in every test counted against one `rateLimit` row. Two checks in one test raced to insert it, and one aborted the test's transaction. Tests running at the same time queued on each other's uncommitted rows until they timed out. `featureTest` and `createMswHandlers` now dispatch with the bindings `@hono/node-server` gives a request from this machine (`incoming.socket.remoteAddress = '127.0.0.1'`), exported as `inProcessBindings()` from `@geekmidas/constructs/testing`. The browser's `x-forwarded-for` still marks its own requests as outside traffic, and the API's session check passes that address on as `x-gkm-client-ip`, intact. A request with no peer outside a test, such as on Lambda or Bun, is still not an internal caller.
  - **A failed statement in a test fails alone.** Outside a transaction, the bound test connection now wraps each statement in a savepoint. A duplicate key from two concurrent requests then fails only that insert, as it would deployed, instead of aborting everything after it in the test. Better Auth's rate limiter depends on this behaviour, so two parallel session checks from one browser in one test now succeed. Code that opens its own transaction behaves as before.
  - **`gkm setup --stage <deployed>`** names the stage it is provisioning (`Provisioning the 'prod' stage (dry run)...`). It no longer says it is setting up the local environment.

- Updated dependencies [[`8bcea8e`](https://github.com/geekmidas/toolbox/commit/8bcea8eb2a8c6f70210e9b77236f3f72aef50ae8)]:
  - @geekmidas/constructs@10.0.0-alpha.87
  - @geekmidas/cache@10.0.0-alpha.87
  - @geekmidas/db@10.0.0-alpha.87
  - @geekmidas/envkit@10.0.0-alpha.87
  - @geekmidas/errors@10.0.0-alpha.87
  - @geekmidas/logger@10.0.0-alpha.87
  - @geekmidas/manifest@10.0.0-alpha.87
  - @geekmidas/schema@10.0.0-alpha.87
  - @geekmidas/services@10.0.0-alpha.87
  - @geekmidas/storage@10.0.0-alpha.87
  - @geekmidas/telescope@10.0.0-alpha.87

## 10.0.0-alpha.86

### Minor Changes

- [#216](https://github.com/geekmidas/toolbox/pull/216) [`aeddb75`](https://github.com/geekmidas/toolbox/commit/aeddb7566a6e958602e8d9fbf76d2b22856f01c0) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: **Providers: `deploy.objects.<stage>: { provider: 's3' }` creates the stage's buckets.**
  `deploy.<kind>.<stage>` says what backs a kind of construct on a deployed
  stage, keyed by the manifest kind — `objects` first: `'external'` (the
  default, today's behaviour), `{ provider: 's3', region?, versioning? }`, or
  `false` (the stage has none; a declared bucket is refused with
  `StageProviderDisabled`). Anything else, `'minio'` included, fails to load
  with `UnknownStageProvider`. The local stage ignores it.

  `gkm setup --stage <deployed stage>` runs each configured provider's
  `ensure()` in the stage's account — found by `--profile`, `AWS_PROFILE`,
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` or the SDK's default chain — and
  starts no container. For each bucket construct the `s3` provider creates
  `<namespace>-<project>-<stage>-<id>` (a random suffix on `BucketAlreadyExists`,
  reused on `BucketAlreadyOwnedByYou`, the name recorded in the stage's state and
  reused forever) with Block Public Access, SSE-S3, a TLS-only policy, optional
  versioning and CORS for the stage's sites that call an API using it; an IAM
  user `gkm-<project>-<stage>-<id>` under `/gkm/`, tagged, with a policy for that
  bucket alone; and a key, written into the stage's secrets as
  `<ID>_URL=s3://KEY:SECRET@bucket?region=…`. A `FileServer`'s URL becomes the
  bucket's regional endpoint, and its `open` paths are public on exactly those
  prefixes. Re-runs fix drift and never delete. `--dry-run` prints the plan and
  writes nothing; `--rotate-keys` issues a second key and deletes the old one on
  the first run after the next deploy (or now, with `--retire-old-keys`).
  Without provisioning credentials the stage stays `external`, and a missing
  key's line in `ExternalServicesNotConfigured` and `gkm secrets:add` names the
  command that writes it. Every compose and Dokploy deploy runs the provider's
  `verify()` — `HeadBucket` with the app's key — and stops with
  `ProvisionedBucketUnreachable` when it fails.

  :boom: **`--allow-dev-services` no longer takes a list.** It is a switch on
  `gkm deploy` and `gkm compose` (`deploy({ allowDevServices: true })`;
  `ctx.allowDevServices` is a boolean): every construct a deployed stage does
  not account for — no key in its secrets, no provider for its kind — gets its
  dev service, MinIO for a bucket and Mailpit for mail. A value
  (`--allow-dev-services minio`) fails with `AllowDevServicesTakesNoValue`;
  `UnknownDevService` is gone.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.86
  - @geekmidas/constructs@10.0.0-alpha.86
  - @geekmidas/db@10.0.0-alpha.86
  - @geekmidas/envkit@10.0.0-alpha.86
  - @geekmidas/errors@10.0.0-alpha.86
  - @geekmidas/logger@10.0.0-alpha.86
  - @geekmidas/manifest@10.0.0-alpha.86
  - @geekmidas/schema@10.0.0-alpha.86
  - @geekmidas/services@10.0.0-alpha.86
  - @geekmidas/storage@10.0.0-alpha.86
  - @geekmidas/telescope@10.0.0-alpha.86

## 10.0.0-alpha.85

### Minor Changes

- 🐛 [#214](https://github.com/geekmidas/toolbox/pull/214) [`46f3d3d`](https://github.com/geekmidas/toolbox/commit/46f3d3d57682cae53ce315598fb9eeb6c3df8f2a) Thanks [@geekmidas](https://github.com/geekmidas)! - :bug: An API's session check joins the request's trace, and queries carry their `traceparent`

  - ✨ **`@geekmidas/constructs`: the auth client's `getSession` is part of the caller's trace.** It writes the active trace context through the global propagator (unless a `fetch` instrumentation is listening, which writes the request's own CLIENT span — two `traceparent` headers would be read as none), and sends the client's address as **`x-gkm-client-ip`** instead of `x-forwarded-for`. A forwarding header made the auth server treat the call as outside traffic and start a new, linked trace; without one the call passes the internal-caller rule and the auth server's `get-session` span is the child of the API's call. **Visible change:** the auth server no longer receives `x-forwarded-for` from an API's session check.
  - ✨ **`@geekmidas/constructs`: `BetterAuth` reads `x-gkm-client-ip` first** — `advanced.ipAddress.ipAddressHeaders` is `['x-gkm-client-ip', ...]` followed by the app's own list, or `x-forwarded-for` — so `/get-session` is still rate-limited per client. Its server drops the header from any request that is not an internal caller's (no `Origin`, no forwarding header, a loopback or private peer), so it cannot be spoofed where no gkm edge stands in front. New export `withTrustedClientIp`.
  - **`@geekmidas/constructs`: query tags carry `traceparent`.** Inside a trace, each query's sqlcommenter tag ends in `traceparent='00-<trace id>-<span id>-<flags>'` — the query's own span — so `pg_stat_activity`, slow-query and `auto_explain` logs join to traces. Without an active span the tag is unchanged.
  - **`@geekmidas/cli`: every edge strips `x-gkm-client-ip`** — `request_header -x-gkm-client-ip` in each compose Caddy site block and each `gkm dev` edge site, and a `<project>-strip-gkm-headers` middleware first in every router of the shared Traefik edge.
  - **`@geekmidas/manifest`: `CLIENT_IP_HEADER`**, the reserved header's name, shared by the constructs and the edges.
  - **`@geekmidas/client`: the trace headers are left to a `fetch` instrumentation** when one is listening in the process (a server with OpenTelemetry's undici instrumentation), instead of being written twice.
  - **`@geekmidas/cli`: a local deploy lock is taken atomically with its holder written** (written to a temporary file, then linked into place), so a runner that loses a race is always told who holds the lock instead of `null`.

### Patch Changes

- Updated dependencies [[`46f3d3d`](https://github.com/geekmidas/toolbox/commit/46f3d3d57682cae53ce315598fb9eeb6c3df8f2a)]:
  - @geekmidas/constructs@10.0.0-alpha.85
  - @geekmidas/manifest@10.0.0-alpha.85
  - @geekmidas/cache@10.0.0-alpha.85
  - @geekmidas/db@10.0.0-alpha.85
  - @geekmidas/envkit@10.0.0-alpha.85
  - @geekmidas/errors@10.0.0-alpha.85
  - @geekmidas/logger@10.0.0-alpha.85
  - @geekmidas/schema@10.0.0-alpha.85
  - @geekmidas/services@10.0.0-alpha.85
  - @geekmidas/storage@10.0.0-alpha.85
  - @geekmidas/telescope@10.0.0-alpha.85

## 10.0.0-alpha.84

### Minor Changes

- ✨ [#212](https://github.com/geekmidas/toolbox/pull/212) [`cbfe22e`](https://github.com/geekmidas/toolbox/commit/cbfe22e6cfa354c649a583ac6cc16ef8c524aeba) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: **Telemetry is a construct.** `new Telemetry('Telemetry', { ignorePaths?, attributes? })`
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

### Patch Changes

- Updated dependencies [[`cbfe22e`](https://github.com/geekmidas/toolbox/commit/cbfe22e6cfa354c649a583ac6cc16ef8c524aeba)]:
  - @geekmidas/constructs@10.0.0-alpha.84
  - @geekmidas/manifest@10.0.0-alpha.84
  - @geekmidas/cache@10.0.0-alpha.84
  - @geekmidas/db@10.0.0-alpha.84
  - @geekmidas/envkit@10.0.0-alpha.84
  - @geekmidas/errors@10.0.0-alpha.84
  - @geekmidas/logger@10.0.0-alpha.84
  - @geekmidas/schema@10.0.0-alpha.84
  - @geekmidas/services@10.0.0-alpha.84
  - @geekmidas/storage@10.0.0-alpha.84
  - @geekmidas/telescope@10.0.0-alpha.84

## 10.0.0-alpha.83

### Minor Changes

- ✨ [#209](https://github.com/geekmidas/toolbox/pull/209) [`af900b8`](https://github.com/geekmidas/toolbox/commit/af900b86812e08120c6e7fdeb68353c3ee681d35) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm stages` prints the workspace's stages from `gkm.config.ts` (`--json` for `{"local","deployed","protected"}`), and `gkm stages --github-output` writes which stages a GitHub workflow run builds and deploys. The new `geekmidas/toolbox/actions/stages` action runs it, and the deploy workflow `gkm init` scaffolds is built on it: no stage is named and nothing parses TypeScript. `gkm init --deploy compose` scaffolds a Docker Compose server deploy: CI builds and pushes each stage's images and keeps their digests, and the deploy job resolves the release's commit and runs `gkm compose` on the server over SSH, pinned to those digests. A config without `stages` now fails with `InvalidStages`, and a config the schema refuses fails with `InvalidWorkspaceConfig`.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.83
  - @geekmidas/constructs@10.0.0-alpha.83
  - @geekmidas/db@10.0.0-alpha.83
  - @geekmidas/envkit@10.0.0-alpha.83
  - @geekmidas/errors@10.0.0-alpha.83
  - @geekmidas/logger@10.0.0-alpha.83
  - @geekmidas/manifest@10.0.0-alpha.83
  - @geekmidas/schema@10.0.0-alpha.83
  - @geekmidas/services@10.0.0-alpha.83
  - @geekmidas/storage@10.0.0-alpha.83
  - @geekmidas/telescope@10.0.0-alpha.83

## 10.0.0-alpha.82

### Minor Changes

- [#210](https://github.com/geekmidas/toolbox/pull/210) [`7b7732a`](https://github.com/geekmidas/toolbox/commit/7b7732aae2d094f53a0da66527851ec112820cde) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: One trace from the browser to the API: the client propagates W3C trace context, and the API decides whose to trust

  - ✨ **`@geekmidas/client`: `telemetry` on `createTypedFetcher`, the auth-aware fetcher and the generated `createApi`** — off unless set. With it on, every request to the client's own API origin (never another) carries `traceparent`/`tracestate`: through the global OpenTelemetry propagator when a span is active (a browser SDK, or a server-side caller inside a request span), otherwise a page-view trace id (one per page load in a browser, per client in Node), a fresh span id per request, and a sampled flag decided once per page view at `sampleRate` (default 1) by the trace-id rule OpenTelemetry's ratio sampler uses. `@opentelemetry/api` is not imported: its globals are read from `globalThis`, so the feature adds about 0.7 kB gzipped. A `traceparent` the caller sets is kept. New export `@geekmidas/client/telemetry`; a bad rate throws `InvalidClientSampleRate`.
  - 💥 **`@geekmidas/telescope`: incoming trace context is trusted only from the API's own sites and internal callers.** `honoTelemetryMiddleware` takes `trustedOrigins` (an array, or a function read per request) and `internalCallers` (default: no `Origin`, no proxy forwarding header, and a loopback or private peer address). Any other caller's `traceparent` is no longer continued: the request starts a new trace with a link to it. The Lambda `telemetryMiddleware` takes `trustedOrigins` and `trustRequest`. **Breaking for direct users:** a middleware mounted with no options continues only internal callers.
  - **`@geekmidas/telescope`: the stage's rate caps a caller's sampled flag.** `traceSampler(rate)` is `parentbased_traceidratio` with the ratio applied to a remote sampled parent as well, so a request cannot force a trace the stage would not keep; `setupTelemetry` uses it for `sampleRatio` and for `OTEL_TRACES_SAMPLER=parentbased_traceidratio`. Also exported: `traceSamplerFromEnv`, `incomingTraceContext`, `isTrustedOrigin`, `isInternalCaller`, `isPrivateAddress`.
  - **`@geekmidas/cli`: the API's derived CORS always allows `traceparent` and `tracestate`,** and a built server hands the same origins its CORS allows to the request spans (`createApp()` returns `trustedOrigins`).
  - **`@geekmidas/cli`: `gkm openapi --telemetry [sampleRate]`** writes clients whose `createApi` propagates by default (`telemetryDefault`); off otherwise. A site's Dockerfile passes it to its in-image `gkm openapi --app` when the client's `telemetry` is set.

### Patch Changes

- Updated dependencies [[`7b7732a`](https://github.com/geekmidas/toolbox/commit/7b7732aae2d094f53a0da66527851ec112820cde)]:
  - @geekmidas/telescope@10.0.0-alpha.82
  - @geekmidas/constructs@10.0.0-alpha.82
  - @geekmidas/cache@10.0.0-alpha.82
  - @geekmidas/db@10.0.0-alpha.82
  - @geekmidas/envkit@10.0.0-alpha.82
  - @geekmidas/errors@10.0.0-alpha.82
  - @geekmidas/logger@10.0.0-alpha.82
  - @geekmidas/manifest@10.0.0-alpha.82
  - @geekmidas/schema@10.0.0-alpha.82
  - @geekmidas/services@10.0.0-alpha.82
  - @geekmidas/storage@10.0.0-alpha.82

## 10.0.0-alpha.81

### Minor Changes

- 🐛 [#211](https://github.com/geekmidas/toolbox/pull/211) [`b0b6d5c`](https://github.com/geekmidas/toolbox/commit/b0b6d5c1a558795e040654a596d97ad5e27e42b3) Thanks [@geekmidas](https://github.com/geekmidas)! - Local services run with logins generated per machine, not a fixed shared one

  :boom: Every container `gkm dev`, `gkm test` and the local `gkm compose` stage
  run used to sign in with the same fixed word on every laptop. Each password,
  token and secret key — Postgres, MinIO, Redis (which now requires one), the
  cache proxy's token, RabbitMQ, the AWS emulator's secret key and the local
  OpenObserve root — is now generated the first time it is needed, in the shape
  the service accepts, and kept encrypted with the local stage's key in the CLI's
  home, shared by every checkout of the project. User names are neutral:
  `<workspace>_admin` for the Postgres superuser, `minio`, `rabbitmq`. A seed
  kept with them salts each database role's password. The Postgres superuser on
  a deployed `gkm compose` stack is renamed the same way.

  `gkm dev` prints each service's address and login with its other URLs, and
  `gkm dev:credentials [--json]` prints them without starting anything. The
  discovery endpoint never carries them.

  Existing volumes are migrated on the first run, data kept: a Postgres made with
  the old login gets the generated superuser and the old one stops logging in
  (reset from inside the container where no known login opens it); MinIO is
  recreated with its new root login; RabbitMQ's user is updated with
  `rabbitmqctl`. A service that cannot be moved keeps its login and gkm says how
  to reset it.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.81
  - @geekmidas/constructs@10.0.0-alpha.81
  - @geekmidas/db@10.0.0-alpha.81
  - @geekmidas/envkit@10.0.0-alpha.81
  - @geekmidas/errors@10.0.0-alpha.81
  - @geekmidas/logger@10.0.0-alpha.81
  - @geekmidas/manifest@10.0.0-alpha.81
  - @geekmidas/schema@10.0.0-alpha.81
  - @geekmidas/services@10.0.0-alpha.81
  - @geekmidas/storage@10.0.0-alpha.81
  - @geekmidas/telescope@10.0.0-alpha.81

## 10.0.0-alpha.80

### Minor Changes

- ✨ [#207](https://github.com/geekmidas/toolbox/pull/207) [`a3eed1a`](https://github.com/geekmidas/toolbox/commit/a3eed1a20f731570ea5487659657dcc28bfe309b) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm deploy:github` trusts the OIDC subject GitHub actually sends. It reads the repository's subject settings (`gh api repos/<repo>/actions/oidc/customization/sub`) and builds the role's trust from them: the default `repo:<owner>/<name>:environment:<stage>`, the immutable `repo:<owner>@<ownerId>/<name>@<repoId>:environment:<stage>`, or a custom template made of claims known before the run. A template that includes a run-dependent claim (`job_workflow_ref`, `ref`, `sha`, …) is refused with `OidcSubjectNotSupported`; unreadable settings fall back to the default with a warning naming the endpoint. Re-running it rewrites an existing role's trust and prints old → new, which repairs a role that failed with "Not authorized to perform sts:AssumeRoleWithWebIdentity". `--dry-run` prints the subject.

  A stage that only the `compose` target deploys now gets an inline `gkm-deploy` policy scoped to its own secrets (the SSM parameter or Secrets Manager secret) and, when the deploy state is in AWS, its state, in place of `AdministratorAccess`. SST and other targets keep `AdministratorAccess`, and `--policy-arn` still overrides both. gkm now tags the role with the managed policy it attached (`gkm:policy-arn`), so a re-run detaches only what gkm put there; an older role's `AdministratorAccess` is left attached, with the command to detach it printed.

### Patch Changes

- [#208](https://github.com/geekmidas/toolbox/pull/208) [`f3638fb`](https://github.com/geekmidas/toolbox/commit/f3638fb116f7aeebbbb29c8f06deaa7813cc760e) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: One trace from a request through a queue to the worker: every events driver
  (pg-boss, SNS, SQS, RabbitMQ, basic) wraps each publish in a PRODUCER span and
  carries its W3C trace context in the message — SQS/SNS message attributes,
  RabbitMQ headers, or pg-boss job data under the reserved key `__gkmTrace`,
  which is removed before a handler sees the payload. Consumers run each job in a
  CONSUMER span that continues it (a message without context starts a new
  trace), Lambda queue and subscriber adaptors do the same from their records,
  and each cron run is a root trace of its own. The constructs record their own
  spans: a span per database query (`select orders`, with `db.system`, `db.name`,
  `db.operation`, never parameter values), `cache.get`/`set`/`delete` with
  hit/miss on the Redis and Postgres drivers, `storage.presign`/`put`/`delete`,
  `email.send`, and a span per `ExternalApi` client call. Everything goes through
  the global `@opentelemetry/api` and is a no-op without a registered provider.
- Updated dependencies [[`f3638fb`](https://github.com/geekmidas/toolbox/commit/f3638fb116f7aeebbbb29c8f06deaa7813cc760e)]:
  - @geekmidas/constructs@10.0.0-alpha.80
  - @geekmidas/cache@10.0.0-alpha.80
  - @geekmidas/storage@10.0.0-alpha.80
  - @geekmidas/db@10.0.0-alpha.80
  - @geekmidas/envkit@10.0.0-alpha.80
  - @geekmidas/errors@10.0.0-alpha.80
  - @geekmidas/logger@10.0.0-alpha.80
  - @geekmidas/manifest@10.0.0-alpha.80
  - @geekmidas/schema@10.0.0-alpha.80
  - @geekmidas/services@10.0.0-alpha.80
  - @geekmidas/telescope@10.0.0-alpha.80

## 10.0.0-alpha.79

### Patch Changes

- [#205](https://github.com/geekmidas/toolbox/pull/205) [`d5defa1`](https://github.com/geekmidas/toolbox/commit/d5defa1b7c22c1e652600729a9de8160f323e955) Thanks [@geekmidas](https://github.com/geekmidas)! - Deploys now seed. `gkm compose` (and `gkm deploy --target compose`) and the Dokploy target migrated a stage but never ran its seeds, so reference data such as roles and permissions was missing on every deployed stage. Both now run every seed (`db/<construct>/seeds`) after the migrations and before any app starts — every deploy, every stage, as `gkm seed --help` always said — so seeds must be idempotent upserts. Dokploy runs them in the deploy's sandbox, beside the migrations. A failing seed stops the release with `DeploySeedsFailed`, naming the construct and the seed and keeping the cause. Each run reports `🌱 db/<construct>/seeds: ran N` and `migration.applied` / `seed.ran` events; a dry run lists the seeds it would run. `gkm compose --build --push` still runs neither.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.79
  - @geekmidas/constructs@10.0.0-alpha.79
  - @geekmidas/db@10.0.0-alpha.79
  - @geekmidas/envkit@10.0.0-alpha.79
  - @geekmidas/errors@10.0.0-alpha.79
  - @geekmidas/logger@10.0.0-alpha.79
  - @geekmidas/manifest@10.0.0-alpha.79
  - @geekmidas/schema@10.0.0-alpha.79
  - @geekmidas/services@10.0.0-alpha.79
  - @geekmidas/storage@10.0.0-alpha.79
  - @geekmidas/telescope@10.0.0-alpha.79

## 10.0.0-alpha.78

### Minor Changes

- [#204](https://github.com/geekmidas/toolbox/pull/204) [`6552c85`](https://github.com/geekmidas/toolbox/commit/6552c85bbed04ee8e1be04930dd7621aeec1c151) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm compose` can register a deployed stage with a shared Traefik edge

  `gkm compose` can serve a deployed stage through a shared Traefik edge: `deploy.compose.proxy: 'traefik'` (for every deployed stage, or per stage) registers the stack's hosts with one Traefik per server — compose project and network `gkm-edge`, configured through its file provider from `$GKM_HOME/edge`, no Docker socket — which owns 80/443, Let's Encrypt and the redirect to HTTPS, so several stacks can share a server. `'caddy'` stays the default, and the local stage always uses Caddy. Both proxies render one route model. Only a stack's public services join the edge's network, each under a project-prefixed alias. `--down` unregisters a stack and leaves the edge and other stacks running. `deploy.compose.tls.<stage>` gives a stage its own certificate on either proxy. A clash over 80/443 between a stack's own Caddy and the edge is refused with `ComposeProxyClash`.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.78
  - @geekmidas/constructs@10.0.0-alpha.78
  - @geekmidas/db@10.0.0-alpha.78
  - @geekmidas/envkit@10.0.0-alpha.78
  - @geekmidas/errors@10.0.0-alpha.78
  - @geekmidas/logger@10.0.0-alpha.78
  - @geekmidas/manifest@10.0.0-alpha.78
  - @geekmidas/schema@10.0.0-alpha.78
  - @geekmidas/services@10.0.0-alpha.78
  - @geekmidas/storage@10.0.0-alpha.78
  - @geekmidas/telescope@10.0.0-alpha.78

## 10.0.0-alpha.77

### Patch Changes

- 🔥 [#203](https://github.com/geekmidas/toolbox/pull/203) [`8ce2e24`](https://github.com/geekmidas/toolbox/commit/8ce2e248f1c18bf8b3348ee200f4de20fb44a905) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: Starting a stage no longer stores the addresses constructs derive; a deploy refuses a stage holding a stale one, and `gkm secrets:unset` removes it

  - ✨ **No per-app database URLs or passwords.** `gkm setup`, `gkm test --auto-setup` and `gkm secrets:reconcile` stored `<APP>_DATABASE_URL` (a `postgresql://…@localhost:5432/…` URL) and `<APP>_DB_PASSWORD` for each backend app, and `http://localhost:<port>` as `<APP>_URL` for each site. `gkm init` stored `AUTH_URL` the same way. Those keys can be a construct's — `database.schema('AuthDatabase')` provides `AUTH_DATABASE_URL`, `new BetterAuth('Auth', …)` provides `AUTH_URL`, `new StaticSite('Web', …)` provides `WEB_URL` — and a stored value wins over a derived one, so `gkm compose` handed the auth server `localhost` with a password no role had: `ECONNREFUSED 127.0.0.1:5432` on every session check while `/health` still passed. None of them is written now.
  - 🐛 **A stage holding one is refused, not silently fixed.** `gkm compose` and a Dokploy deploy fail validate with `StaleStageSecrets` when a stored key that a database, tenant, API or site provides holds a `localhost`/`127.0.0.1` URL, naming each key and the `gkm secrets:unset <KEY> --stage <stage>` that removes it. Nothing is deleted for you. A managed database set with its real host still wins, as before. `gkm dev` and `gkm test` need nothing: there the derived address already wins.
  - 🔥 **`gkm secrets:unset <KEY> --stage <stage>`** removes one custom secret from the stage's own store (file, SSM or Secrets Manager), keeping the rest; a key the stage does not hold fails with `SecretNotSet`.
  - **No stored pg-boss credential.** The `pgboss` service credential, the `EVENT_PUBLISHER_CONNECTION_STRING` composed from it, and the `PGBOSS_DB_*` keys it injected are gone: the broker URL is derived from the declared database's role, and the stored password matched none.
  - **No `docker/.env`.** `gkm setup` wrote the `*_DB_PASSWORD` keys there for a Postgres init script nothing generates any more; reconcile creates each role from the stage's credential. The scaffold no longer gitignores it.
  - **A stored `<APP>_DATABASE_URL` is no longer renamed onto `DATABASE_URL`** when an app's secrets are loaded (`gkm dev`, `gkm exec`, `gkm test`); `loadSecretsForApp` takes no app name.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.77
  - @geekmidas/constructs@10.0.0-alpha.77
  - @geekmidas/db@10.0.0-alpha.77
  - @geekmidas/envkit@10.0.0-alpha.77
  - @geekmidas/errors@10.0.0-alpha.77
  - @geekmidas/logger@10.0.0-alpha.77
  - @geekmidas/manifest@10.0.0-alpha.77
  - @geekmidas/schema@10.0.0-alpha.77
  - @geekmidas/services@10.0.0-alpha.77
  - @geekmidas/storage@10.0.0-alpha.77
  - @geekmidas/telescope@10.0.0-alpha.77

## 10.0.0-alpha.76

### Minor Changes

- [#201](https://github.com/geekmidas/toolbox/pull/201) [`5871150`](https://github.com/geekmidas/toolbox/commit/5871150c12decdbd22e245035a5d7ee5eec1f051) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: Secrets Manager as a secrets store, and SSM stages past 4 KB

  - `secrets.store: { provider: 'secrets-manager', region, kmsKeyId? }` keeps each deployed stage in one AWS Secrets Manager secret, `gkm/<project>/<stage>/secrets`, holding the same JSON as the SSM parameter: up to 64 KB, encrypted with `aws/secretsmanager` or the key given. Every `secrets:*` command, `gkm setup`, `build`, `exec` and every deploy target read and write it as they do SSM, with the same `AWS_PROFILE` / `--profile` handling.
  - The SSM store writes in the Intelligent-Tiering tier, so a stage between 4 KB and 8 KB (a service-account JSON key, say) is accepted instead of failing with `ValidationException`. It stays free under 4 KB.
  - A stage too large for its store — 8 KB for SSM, 64 KB for Secrets Manager — fails with `StageSecretsTooLarge` (stage, store, bytes, limit) before AWS is called; on SSM it points at Secrets Manager.
  - `gkm secrets:migrate --stage <stage> --to <file|ssm|secrets-manager>` copies a deployed stage, whole, from the configured store to another.
  - A `secrets.store` provider name gkm does not ship fails with `UnknownSecretsStoreProvider`, never falling back to the file.

### Patch Changes

- 🐛 [#200](https://github.com/geekmidas/toolbox/pull/200) [`c6005cb`](https://github.com/geekmidas/toolbox/commit/c6005cb79031222875545946cc6afe3f94c5e3c9) Thanks [@geekmidas](https://github.com/geekmidas)! - :bug: A site's image generates the API client it imports, and its build can run through `gkm exec`

  `gkm compose --build` (and every image `gkm docker` writes) could not build a site that imports the typed client gkm generates (`@<name>/client/<surface>`): the client lives in the workspace root's `.gkm/client/`, which `.dockerignore` keeps out of every build context, and nothing generated it in the image — `next build` failed with `Cannot find module '<scope>/client/api'`, and a `gkm exec -- next build` script found no config or constructs.

  - **A site's image carries the gkm workspace**, as a backend's does: the config and the construct directories (sources only), the workspace's own package when nested in a monorepo, and the package of each backend the site depends on.
  - **The client is generated inside the builder**, before the site is built: `gkm openapi --app <backend>` for each backend the site depends on, written where the site's tsconfig paths expect it. Offline — no secret, no stage, no container. Nothing generated on the host is copied in.
  - 🐛 **`gkm` is on the builder's `PATH`**, resolved from the workspace, so a site build script that is `gkm exec -- next build` runs in the image. There `GKM_IMAGE_BUILD=1` makes `gkm exec` inject only the public build args (`NEXT_PUBLIC_*`, `VITE_*`, `EXPO_PUBLIC_*`) — never a stage's secrets, and never the `localhost` URLs a workspace resolves on a developer's machine. Sites build with `turbo run build --env-mode=loose` so those values reach the task.
  - **`gkm openapi --app <name>` reads endpoints through the workspace's constructs globs**, as `gkm build` does, instead of importing every `.ts` under the app — which loaded its tests and gkm's generated test harness, and failed.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.76
  - @geekmidas/constructs@10.0.0-alpha.76
  - @geekmidas/db@10.0.0-alpha.76
  - @geekmidas/envkit@10.0.0-alpha.76
  - @geekmidas/errors@10.0.0-alpha.76
  - @geekmidas/logger@10.0.0-alpha.76
  - @geekmidas/manifest@10.0.0-alpha.76
  - @geekmidas/schema@10.0.0-alpha.76
  - @geekmidas/services@10.0.0-alpha.76
  - @geekmidas/storage@10.0.0-alpha.76
  - @geekmidas/telescope@10.0.0-alpha.76

## 10.0.0-alpha.75

### Minor Changes

- [#199](https://github.com/geekmidas/toolbox/pull/199) [`a37f147`](https://github.com/geekmidas/toolbox/commit/a37f147e46668548d89c5b29baf81787394928eb) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: `gkm compose` builds and pushes from CI, and its images no longer embed a stage's credentials

  - **`gkm compose --stage <s> --build --push --tag <t>`** builds every image the stack needs exactly as a deploy of the stage would — each backend and worker at `<t>`, each site at `<t>-<s>` with the stage's public URLs — pushes each to `deploy.registry`, and prints every pushed ref with the digest the registry stored. It starts nothing: no stage lock, no infrastructure, no provisioning or migrations, no `up`, no generated secret kept and nothing recorded in the stage's state, so a CI runner needs only Docker, a registry login and the stage's secrets store. `--push` without `--build`, or with `--pull`, throws `ComposePushNeedsBuild`. `deploy()` takes `buildOnly` for the same run: validate and build only, with no lock (`TargetBuildsNothing` for a target with no build phase). `ComposeDocker` gains `push(stack, ref)`, which returns the pushed digest (`PushDigestUnknown` when docker does not report one).
  - **`--digests-file <path>`** writes each pushed image as JSON, `{ "api": "<ref>@sha256:…" }`. Given to a pull (`--tag`/`--pull`), each image is pulled, run and recorded at that digest, so a moved tag cannot change a release. A file missing an app throws `ImageDigestMissing`, an entry for another image or tag `ImageDigestMismatch`, a malformed file `ImageDigestsInvalid`, and the flag on a build that neither pushes nor pulls `ComposePinNeedsPull`.
  - **`RegistryRequired`.** Pushing (`--push`) or pulling (`--tag`, `--pull`) with no `deploy.registry` now fails at `validate`, before anything is built or a registry is asked, instead of naming the images for Docker Hub. A build with no tag still needs no registry.
  - 🔥 **:boom: Compose images embed no credentials.** A backend's or worker's image built by `gkm compose` no longer carries the stage's environment encrypted through the `gkm_credentials` BuildKit secret: the compose file has no build secrets and no `GKM_CIPHERTEXT_HASH` arg, no `<app>.credentials` file is written beside the stack (one an earlier version left is removed), and the env files no longer hold `GKM_MASTER_KEY`. Each container reads every secret from its own `0600` env file at runtime, as it already could. So the image built at a commit is the same for every stage — two stages built at one commit no longer overwrite each other's `<app>:<tag>` with different credentials, and rotating a secret needs a restart, not a rebuild. Sites keep `<tag>-<stage>`. Dokploy and SST are unchanged.
  - **An image never runs the workspace root's `build` script.** Every generated Dockerfile — backend, entry, worker, Next.js, Vite, Node SSR — ran `<pm> run --if-present build` at the root of the app's pruned slice. A root `build` of `gkm build`, which `gkm init` scaffolds for a fullstack workspace, built every app the workspace declares inside a slice holding one, and failed with `No package.json for workspace app(s): …`. The workspace packages an app depends on are built by turbo's `^build` alone, so each needs its own `build` script; the app itself is built by `gkm build` or its framework, as before.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.75
  - @geekmidas/constructs@10.0.0-alpha.75
  - @geekmidas/db@10.0.0-alpha.75
  - @geekmidas/envkit@10.0.0-alpha.75
  - @geekmidas/errors@10.0.0-alpha.75
  - @geekmidas/logger@10.0.0-alpha.75
  - @geekmidas/manifest@10.0.0-alpha.75
  - @geekmidas/schema@10.0.0-alpha.75
  - @geekmidas/services@10.0.0-alpha.75
  - @geekmidas/storage@10.0.0-alpha.75
  - @geekmidas/telescope@10.0.0-alpha.75

## 10.0.0-alpha.74

### Minor Changes

- [#198](https://github.com/geekmidas/toolbox/pull/198) [`0a1ce80`](https://github.com/geekmidas/toolbox/commit/0a1ce80620aa5f2be4c38ecd2f6a140b09b84505) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm compose` keeps every cache in a Redis of its own

  A workspace that declares a cache now gets a Redis in its compose stack, on
  every stage, local and deployed — and every cache lives in it, one declared
  from a database (`database.cache('Sessions')`) included. Until now a stack
  kept the cache in a Postgres table, competing with the app for the database's
  connections.

  The service is `redis:8-alpine` (reconcile's pin), on the compose network only
  with no published port, bounded at `maxmemory 256mb` with `allkeys-lru`,
  persisted to an append-only file on the `redis-data` volume (kept by
  `--down`), health-checked and log-rotated. A deployed stage's password is
  generated on the first run and kept in its secrets as `REDIS_PASSWORD`, read
  back on every later run; the local stage uses a fixed one. The password is in
  `redis.env` (`0600`), never in the compose file, the server's command line or
  the health check.

  Each backend and worker that reads a cache gets its URL —
  `SESSIONS_URL=redis://:<password>@redis:6379/0`, a logical database per cache
  — and each image is built with `gkm build --cache redis`, so its entry
  registers the Redis cache driver (`redis://` and `rediss://`) rather than the
  Postgres one. The project needs `ioredis`; a build without it stops with
  `RedisClientMissing` before anything is touched. No cache table is created.

  A cache whose URL the stage's secrets set — a managed Redis — is used as
  given, and a stack whose every cache is set that way runs no Redis.

  `gkm dev`, `gkm test` and Dokploy are unchanged: they keep the target's
  default, a table in the declared database on a server target.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.74
  - @geekmidas/constructs@10.0.0-alpha.74
  - @geekmidas/db@10.0.0-alpha.74
  - @geekmidas/envkit@10.0.0-alpha.74
  - @geekmidas/errors@10.0.0-alpha.74
  - @geekmidas/logger@10.0.0-alpha.74
  - @geekmidas/manifest@10.0.0-alpha.74
  - @geekmidas/schema@10.0.0-alpha.74
  - @geekmidas/services@10.0.0-alpha.74
  - @geekmidas/storage@10.0.0-alpha.74
  - @geekmidas/telescope@10.0.0-alpha.74

## 10.0.0-alpha.73

### Minor Changes

- [#196](https://github.com/geekmidas/toolbox/pull/196) [`5db7b84`](https://github.com/geekmidas/toolbox/commit/5db7b84aba6455989163abcd2c203b6dc28b7cb3) Thanks [@geekmidas](https://github.com/geekmidas)! - A Worker is its own deploy unit on a server target

  `gkm build --provider server --production` now writes an entry for each `Worker` that has crons, queue consumers or topic subscribers, in the app whose directory holds that work, and bundles it to `.gkm/server/dist/worker-<worker>.mjs`. It registers the drivers its target needs, starts every cron (through pg-boss), consumer and subscriber the worker owns, and serves only `GET /health` on `PORT`: `200` when every consumer started and every broker connection answers, `503` otherwise. On `SIGTERM` it stops pulling messages and scheduling crons, lets the handlers in flight finish, closes its broker connections and database pools, and exits `0` within `GKM_SHUTDOWN_TIMEOUT_MS` (default 8000), or `1` at the deadline.

  `gkm docker` writes a Dockerfile per worker (`.gkm/docker/Dockerfile.<worker>`), built inside Docker like a backend's, with credentials from the `gkm_credentials` BuildKit secret; the runner is the bundle on `node` with `tini` and a `HEALTHCHECK` on `/health`.

  `gkm compose` runs each worker as a service with no Caddy route and no published port, `restart: unless-stopped`, log rotation, its own `0600` env file holding exactly the keys its constructs read, and `depends_on` the stack's infrastructure; it starts after migrations, the plan lists it, and `verify` waits for its Docker health check. Dokploy deploys each worker as an application with no domain after the backends, checked by Dokploy's status and rolled back like any app. A worker with topic subscribers in a build whose broker is SNS fails with `WorkerSubscribersNeedPush`.

  The generated `queues.ts`, `subscribers.ts` and `crons.ts` no longer install their own `SIGTERM` handlers; they export `stopQueues`, `stopSubscribers` and `stopCrons`, and a status function each, for the entry that runs them. pg-boss connections name themselves to Postgres with `GKM_APP_NAME` when it is set.

### Patch Changes

- Updated dependencies [[`5db7b84`](https://github.com/geekmidas/toolbox/commit/5db7b84aba6455989163abcd2c203b6dc28b7cb3)]:
  - @geekmidas/constructs@10.0.0-alpha.73
  - @geekmidas/manifest@10.0.0-alpha.73
  - @geekmidas/cache@10.0.0-alpha.73
  - @geekmidas/db@10.0.0-alpha.73
  - @geekmidas/envkit@10.0.0-alpha.73
  - @geekmidas/errors@10.0.0-alpha.73
  - @geekmidas/logger@10.0.0-alpha.73
  - @geekmidas/schema@10.0.0-alpha.73
  - @geekmidas/services@10.0.0-alpha.73
  - @geekmidas/storage@10.0.0-alpha.73
  - @geekmidas/telescope@10.0.0-alpha.73

## 10.0.0-alpha.72

### Minor Changes

- [#195](https://github.com/geekmidas/toolbox/pull/195) [`b55a94c`](https://github.com/geekmidas/toolbox/commit/b55a94ceb3d07f1e0b336fb34503a1566177e624) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: Event brokers are drivers, registered by the entry point, so a bundle carries only its own broker

  - 🐛 **`registerEventsDriver(driver)`.** `Publisher`, `Subscriber` and `EventConnectionFactory` pick a broker by the connection string's scheme from a registry instead of a literal `import()` per broker. esbuild followed every one of those, so `gkm build --provider server --production` failed with `Could not resolve "pg-boss"` / `"amqplib"` for a project that had not installed every broker (#192). Each broker's subpath exports its driver and is the only module that imports its peer dependency: `basicEventsDriver` (`/basic`), `pgbossEventsDriver` (`/pgboss`), `rabbitmqEventsDriver` (`/rabbitmq`), `snsEventsDriver` (`/sns`), `sqsEventsDriver` (`/sqs`). `eventsDriverFor(scheme)` and `registeredEventsSchemes()` look them up.
  - ✨ **An unregistered broker throws `UnregisteredEventsScheme`**, carrying the `scheme`, the `subpath` and `driver` to register, and what is `registered`. A script that builds its own publisher adds `registerEventsDriver(pgbossEventsDriver)` (or its broker's) once before the first call. A scheme no broker implements still throws `UnsupportedEventTransport`.
  - 🐛 **Generated entries register their target's broker** — `EVENTS_DRIVERS` beside the cache and storage drivers: pg-boss on a server, SNS and SQS on AWS, the local stage's broker in `gkm dev` and `gkm test`. Only when the app declares a `Topic` or a `Queue` (or, on pg-boss, a worker whose crons it schedules), so a project without events resolves nothing. The production and dev servers, and every Lambda handler — endpoint, function, cron, queue consumer and subscriber — register them; the function, cron, queue and subscriber handlers now register the storage and cache drivers too.
  - A server's SNS push subscriptions are generated only when its broker is SNS, and its crons reach pg-boss through the registered driver, so neither drags the other broker's client into the bundle. An app that declares no crons gets a crons file that imports nothing.
  - `Publisher.fromConnection(connection, options)` takes the publisher options, as `fromConnectionString` does.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.72
  - @geekmidas/constructs@10.0.0-alpha.72
  - @geekmidas/db@10.0.0-alpha.72
  - @geekmidas/envkit@10.0.0-alpha.72
  - @geekmidas/errors@10.0.0-alpha.72
  - @geekmidas/logger@10.0.0-alpha.72
  - @geekmidas/manifest@10.0.0-alpha.72
  - @geekmidas/schema@10.0.0-alpha.72
  - @geekmidas/services@10.0.0-alpha.72
  - @geekmidas/storage@10.0.0-alpha.72
  - @geekmidas/telescope@10.0.0-alpha.72

## 10.0.0-alpha.71

### Minor Changes

- [#191](https://github.com/geekmidas/toolbox/pull/191) [`6a7258d`](https://github.com/geekmidas/toolbox/commit/6a7258dec09b7faea6550f6c9e4ac4d0f5b0b744) Thanks [@geekmidas](https://github.com/geekmidas)! - A production server serves endpoints the way `gkm dev` does

  - **One handler path.** `gkm build --production` generated its own per-tier handlers (`minimal`, `standard`, `full`), hand copies of the adaptor that had drifted from it: an endpoint from an `.auditor(...)` router was handed `auditor: undefined`, so `auditor.audit(...)` threw; cookies and headers a handler set were dropped; `res.status(...)` threw on a minimal endpoint; query arrays and output-validation status differed. Every endpoint is now registered with `HonoEndpoint`, as under `gkm dev` and in a feature test. The tier analyzer, the templates and the internal `optimizedHandlers` flag are gone.
  - 🤕 **Errors are logged with their message and stack.** The generated entries (server, crons, queues, subscribers, shutdown hooks) logged `{ error }`, which pino writes as `"error":{}`; they log `{ err: error }`.
  - **An app that calls a surface is given its URL and nothing else.** The API's environment held the auth server's `AUTH_TRUSTED_ORIGINS` and `AUTH_COOKIE_DOMAIN` along with `AUTH_URL`; those are the surface's own settings. Its secret, tenant URL and mail keys were already the auth app's alone.
  - **An app that uses a file server's bucket is given the file server's URL.** `.dependsOn([uploads])` points at the bucket node, so the API got `UPLOADS_URL` but not `UPLOADS_SERVER_URL`, which the client reads: every `POST /uploads` in a `gkm compose` stack answered 500.
  - **A minified bundle keeps its names** (`--keep-names`), so an error's `type` in a log line and `name` in a response read `UnauthorizedError` rather than `_6`.

### Patch Changes

- Updated dependencies [[`5b5cc7b`](https://github.com/geekmidas/toolbox/commit/5b5cc7bf2141558b03418d4338de4f5ac6b4be6c), [`20264e6`](https://github.com/geekmidas/toolbox/commit/20264e62b0fcd1f9e3c523197cf4bf9828c8ced1)]:
  - @geekmidas/constructs@10.0.0-alpha.71
  - @geekmidas/logger@10.0.0-alpha.71
  - @geekmidas/cache@10.0.0-alpha.71
  - @geekmidas/db@10.0.0-alpha.71
  - @geekmidas/envkit@10.0.0-alpha.71
  - @geekmidas/errors@10.0.0-alpha.71
  - @geekmidas/manifest@10.0.0-alpha.71
  - @geekmidas/schema@10.0.0-alpha.71
  - @geekmidas/services@10.0.0-alpha.71
  - @geekmidas/storage@10.0.0-alpha.71
  - @geekmidas/telescope@10.0.0-alpha.71

## 10.0.0-alpha.70

### Minor Changes

- [#189](https://github.com/geekmidas/toolbox/pull/189) [`42e6e4e`](https://github.com/geekmidas/toolbox/commit/42e6e4ef52b465df702c927758be58120b9a5976) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm compose` can run a log UI, every target passes `OTEL_*` to its backends, and Docker logs are rotated

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
  deploy: {
    compose: {
      logs: true;
    }
  }
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

  **Request spans and logs from a bundled server.** A production server is one
  bundled file, where OpenTelemetry's load-time hooks see neither pino nor
  `node:http`, so only DNS, TCP and `fetch` spans arrived. The server now mounts
  telescope's `honoTelemetryMiddleware` ahead of every route: a SERVER span per
  request named `GET /users/:id`, with method, route, status code, `url.path`,
  `url.scheme` and user agent — never the query string or headers — `ERROR` on a
  5xx or a thrown error (the exception recorded; a 4xx is not an error), an
  incoming `traceparent` continued, and the handler run inside it. Logs come from
  `@geekmidas/logger`'s own bridge, in the request's trace. The generated setup
  turns `@opentelemetry/instrumentation-pino` and the http instrumentation's
  incoming spans off, so nothing is sent twice where they can hook. `pg` is
  bundled too, so there are no query spans yet.

  The middleware itself changed to fit: it names the span after the matched
  route once the handler has run (it used the raw path), drops `url.full`, sets
  `ERROR` only on a 5xx, and records the error Hono hands `onError`.
  `setupTelemetry` takes `incomingHttpSpans: false`. An endpoint whose handler
  fails with a 5xx leaves the error on `c.error` for middleware.

### Patch Changes

- Updated dependencies [[`42e6e4e`](https://github.com/geekmidas/toolbox/commit/42e6e4ef52b465df702c927758be58120b9a5976), [`f3114d7`](https://github.com/geekmidas/toolbox/commit/f3114d70a385d28908167d42e29cd846bb3f4fcc)]:
  - @geekmidas/telescope@10.0.0-alpha.70
  - @geekmidas/constructs@10.0.0-alpha.70
  - @geekmidas/logger@10.0.0-alpha.70
  - @geekmidas/cache@10.0.0-alpha.70
  - @geekmidas/db@10.0.0-alpha.70
  - @geekmidas/envkit@10.0.0-alpha.70
  - @geekmidas/errors@10.0.0-alpha.70
  - @geekmidas/manifest@10.0.0-alpha.70
  - @geekmidas/schema@10.0.0-alpha.70
  - @geekmidas/services@10.0.0-alpha.70
  - @geekmidas/storage@10.0.0-alpha.70

## 10.0.0-alpha.69

### Minor Changes

- ✨ [#188](https://github.com/geekmidas/toolbox/pull/188) [`44caa61`](https://github.com/geekmidas/toolbox/commit/44caa61ef2092127f7ee71dcfbdb6f67056cbccf) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm secrets:add --stage <stage>`: a guided builder for the keys a stage must be given, across every app in the workspace.

  - It offers exactly what a deploy would refuse the stage without — each bucket's, mail server's and file server's keys on a deployed stage, and every external API's and `Credential`'s `<ID>_CREDENTIALS` on any stage — each once, with its construct, kind, the apps that read it, and whether it is set. Derived values (database URLs, generated secrets, the seed) are never offered. The list is `requiredStageKeys`, the same one `ExternalServicesNotConfigured` is built from.
  - Each key is built by kind: a bucket from AWS S3, Cloudflare R2, an S3-compatible endpoint or a pasted URL, with an optional key of its own written percent-encoded into the URL (or the stage's shared `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`); mail as an `smtp://`/`smtps://` URL and a validated from address; a file server's `https://` address; credentials field by field from the construct's schema, re-asked with each issue's path until the schema accepts them. A set key asks before it is replaced. Values are saved through the stage's own store and never printed.
  - `--missing --json` prints the keys (`key`, `kind`, `construct`, `apps`, `set`) and asks nothing. Without a terminal and without `--json` it fails with `SecretsAddNeedsTerminal`.
  - `gkm secrets:set` checks a `<ID>_CREDENTIALS` value against its construct's schema and fails with `CredentialsInvalid`, saving nothing. A `dokploy` or `compose` deploy checks every stored credential the same way in `validate`, before anything is built. Neither message carries the value.
  - ✨ `ExternalServicesNotConfigured` now ends with `Or run: gkm secrets:add --stage <stage>`.

### Patch Changes

- Updated dependencies [[`f209d09`](https://github.com/geekmidas/toolbox/commit/f209d09a763538fdb843833a7519f744647239e4)]:
  - @geekmidas/constructs@10.0.0-alpha.69
  - @geekmidas/cache@10.0.0-alpha.69
  - @geekmidas/db@10.0.0-alpha.69
  - @geekmidas/envkit@10.0.0-alpha.69
  - @geekmidas/errors@10.0.0-alpha.69
  - @geekmidas/logger@10.0.0-alpha.69
  - @geekmidas/manifest@10.0.0-alpha.69
  - @geekmidas/schema@10.0.0-alpha.69
  - @geekmidas/services@10.0.0-alpha.69
  - @geekmidas/storage@10.0.0-alpha.69
  - @geekmidas/telescope@10.0.0-alpha.69

## 10.0.0-alpha.68

### Minor Changes

- [#187](https://github.com/geekmidas/toolbox/pull/187) [`c3e09a2`](https://github.com/geekmidas/toolbox/commit/c3e09a24b101ffc4fa9802cc4336d0c51793bd82) Thanks [@geekmidas](https://github.com/geekmidas)! - A deployed stage's mail and object storage are real services; Mailpit and MinIO run there only when asked for

  On a server target (`dokploy`, `compose`), a stage that is not the workspace's local stage takes its mail and buckets from its secrets: each `Email`'s `<ID>_URL` and `<ID>_FROM`, each bucket's `<ID>_URL` with one `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` pair, and each file server's `<ID>_URL`. A stage missing any of them fails in `validate`, before anything is built, provisioned, generated or written.

  - A bucket's credentials are optional and never required by `validate`. They come from the bucket's URL (`s3://KEY:SECRET@bucket?region=…`, a key for that bucket alone, which wins) or from the stage's shared `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, which every app that reads a bucket is handed when the stage set it; with neither, the S3 client's default chain (a role) signs. Per-bucket keys are the least-privilege choice. The shared pair is no longer required on a deployed stage.
  - `--allow-dev-services minio,mailpit` on `gkm deploy` and `gkm compose`, and `allowDevServices: ['minio', 'mailpit']` on `deploy()`, run the dev services instead, for a preview or a demo. The phase context carries it to every target as `ctx.allowDevServices`. Keys the stage set still win over a dev service. Every run that uses one prints a warning saying which runs and that it is not production-grade, and emits a `dev-service.used` event. An unknown value fails with `UnknownDevService`. On an `aws` target the flag fails with `DevServicesNeedServerTarget`.
  - `gkm compose` runs MinIO on the local stage, as it runs Mailpit, and creates each bucket and its file servers' open paths before any app starts, so the local stage needs no bucket URL. Each file server over the stack's MinIO answers on a host of its own through the stack's Caddy. With `--allow-dev-services`, a deployed stage gets the same: MinIO's root credential is derived from the stage's seed unless the stage set its own key pair, and Mailpit sends from `noreply@<stage domain>` unless `<ID>_FROM` is set.
  - On Dokploy, mail is now provisioned: from the stage's secrets, or as a Mailpit compose service named like every other service with `--allow-dev-services mailpit`. Before this, a declared `Email` was skipped and its keys never reached the app.

  :boom: Dokploy no longer provisions MinIO for a bucket on a deployed stage by default. A bucket is the stage's own: set its URL (with its key in the URL, or the shared S3 key pair beside it) in the stage's secrets, or pass `--allow-dev-services minio` to keep the MinIO compose stack it ran before.

  :boom: A deployed stage missing a mail or storage key fails with one `ExternalServicesNotConfigured` that lists every missing key across every app, each with its `gkm secrets:set … --stage <stage>` line, and names `--allow-dev-services`. It replaces `gkm compose`'s per-key `BucketNotConfigured`, which is removed, and its `StageSecretMissing` for mail. A third party's credentials are still reported one key at a time, by `StageSecretMissing` and `MissingSuppliedSecret`.

  :boom: `gkm compose` requires `--stage`. It no longer defaults to the local stage, so which stage a stack is for, and whether its mail and storage must be external, is always written on the command line. The generated compose file's header names the stage in its commands for every stage.

### Patch Changes

- Updated dependencies [[`871ba05`](https://github.com/geekmidas/toolbox/commit/871ba057aa0a0f69cf8233366b5f4c311359a7cc)]:
  - @geekmidas/logger@10.0.0-alpha.68
  - @geekmidas/cache@10.0.0-alpha.68
  - @geekmidas/constructs@10.0.0-alpha.68
  - @geekmidas/db@10.0.0-alpha.68
  - @geekmidas/envkit@10.0.0-alpha.68
  - @geekmidas/errors@10.0.0-alpha.68
  - @geekmidas/manifest@10.0.0-alpha.68
  - @geekmidas/schema@10.0.0-alpha.68
  - @geekmidas/services@10.0.0-alpha.68
  - @geekmidas/telescope@10.0.0-alpha.68

## 10.0.0-alpha.67

### Minor Changes

- [#186](https://github.com/geekmidas/toolbox/pull/186) [`22caa20`](https://github.com/geekmidas/toolbox/commit/22caa2041c107dec51b54db7680b0bcdb46adefb) Thanks [@geekmidas](https://github.com/geekmidas)! - Every app image is built inside Docker, from a pruned slice of the build root

  `gkm docker`, `gkm compose` (and `--target compose`) and the Dokploy target now generate the same Dockerfiles and build them the same way: `turbo prune` cuts the app's slice of the repository, the image installs it, builds the workspace packages it depends on, and builds the app — `gkm build --provider server --production` for a backend, the framework's build for a site. Nothing is built on the host first, and `docker build` on a clean checkout is all an image needs.

  - The build context is the build root: the directory holding the lockfile or `pnpm-workspace.yaml` at or above the gkm workspace. In a project of its own that is the workspace's root; a gkm workspace nested in a monorepo is built from the monorepo's root, with every path in its Dockerfiles relative to it.
  - The build root's `.dockerignore` is created, or has the missing lines appended, so no context holds `node_modules`, `.git`, anything built on the host (`dist`, `.next`, `.gkm`), or a stack's env files under `.gkm/compose`.
  - 🐛 pnpm, yarn, npm and bun are pinned to the build root's `packageManager`, and turbo to the version it resolves (its lockfile or installed copy; a constant in the CLI when it has none).
  - A backend's encrypted credentials reach the image as the `gkm_credentials` BuildKit secret, and are now embedded: the bundle reads them, and a `GKM_CIPHERTEXT_HASH` build arg rebuilds the layer when they change. `gkm compose` builds each backend with its environment this way, its env file holding the `GKM_MASTER_KEY`.
  - A Next.js image fails its build, saying so, when `output: 'standalone'` is missing.
  - `gkm build --stage` embedded its credentials quoted twice, so they never decrypted; they decrypt now.

  :boom: `gkm compose` no longer bundles backends on the host: each is bundled in its image. `gkm docker --slim`, `--turbo` and `--turbo-package`, and `gkm prepack --slim` / `--skip-bundle`, are gone.

  :boom: A Vite site's image serves its files with Caddy (`caddy:2.10-alpine`, as a non-root user) instead of nginx: hashed `/assets/*` are `Cache-Control: public, max-age=31536000, immutable`, everything else — `index.html` and every client-side route that falls back to it — `no-cache`.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.67
  - @geekmidas/constructs@10.0.0-alpha.67
  - @geekmidas/db@10.0.0-alpha.67
  - @geekmidas/envkit@10.0.0-alpha.67
  - @geekmidas/errors@10.0.0-alpha.67
  - @geekmidas/logger@10.0.0-alpha.67
  - @geekmidas/manifest@10.0.0-alpha.67
  - @geekmidas/schema@10.0.0-alpha.67
  - @geekmidas/services@10.0.0-alpha.67
  - @geekmidas/telescope@10.0.0-alpha.67

## 10.0.0-alpha.66

### Minor Changes

- [#184](https://github.com/geekmidas/toolbox/pull/184) [`ea5abcf`](https://github.com/geekmidas/toolbox/commit/ea5abcf2fd3f7006469ac3f1774b5d0d434e7217) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: A Dokploy deploy waits for its deployments, checks each app's health, rolls back what fails, and applies migrations

  - **Waits for Dokploy.** `application.deploy` only queues a deployment, and success used to be recorded right after it. Each app is now released once `DokployApi.waitForDeployment(applicationId, { since, timeoutMs, signal })` sees the deployment created after `since` (Dokploy's clock) finish: it polls `deployment.all` and the application's `applicationStatus` with backoff, for 10 minutes by default, and throws `DeploymentFailed` or `DeploymentTimedOut`.
  - **Checks health.** An app with a domain counts as released after `healthyAfter` (3) consecutive 2xx from `https://<host><healthCheckPath>` (`/health` for a backend, `/` for a site), each check a `health.checked` event; `HealthCheckTimedOut` when it does not happen within `healthTimeoutMs` (5 minutes). An app without a domain gets the deployment check only. Tune it with `deploy.dokploy.verify: { deploymentTimeoutMs, healthCheckPath, healthyAfter, intervalMs, healthTimeoutMs }`.
  - **Backends first, and checked.** Backends are released and their health checked before any site is released; a backend that fails either stops the run with `BackendDeployFailed`. :boom: A site that fails no longer leaves the run successful: every site is attempted, then the run fails with `FrontendDeployFailed`. Sites are checked in `verify`. DNS records are written for the backends' hosts before their check, then for the sites'.
  - **Rollback.** :boom: The stage's state records `releases: { [app]: { current, previous, history } }` in place of `images`. The `dokploy` target now has `capabilities.rollback`: when `release` or `verify` fails, the apps that failed are pointed back at the image they ran before and redeployed; `gkm deploy --atomic` (`deploy({ atomic: true })`) rolls back every app the run released instead. An app's first release has nothing to go back to and is left as it is. `gkm deploy:rollback --stage <stage> --app <app>` puts one app back on its previous release, `--atomic` every app (`rollbackStage()` from `@geekmidas/cli/deploy`; `RollbackNeedsApp`, `NothingToRollBack`, `StageNeverDeployed`). A rolled-back release is marked in the history and never restored.
  - **Migrations.** `capabilities.migrations` is `'target'`: `release` applies each database construct's pending migrations — the migrator `gkm migrate` runs — before any app is switched. They run in the deploy's sandbox, against the cluster published on an external port for the purpose (the one the role DDL already uses, kept open from `provision` rather than published twice), with each owner URL mounted as a secret file and never set as a variable. A failure stops the release with `DeployMigrationsFailed`. Nothing is published for a project with no migration to apply.
  - **Health in the image.** Site Dockerfiles (Next.js, Node SSR, Vite) get a `HEALTHCHECK` on their root, as backend ones have on `/health`, which every production server build serves.
  - 🐛 **Fixed:** in a `defineWorkspace` project the deploy built from `<app>/.gkm/docker/Dockerfile`, which nothing writes, while `gkm docker` writes `.gkm/docker/Dockerfile.<app>` at the root. It now builds from what `gkm docker` writes (`dockerfileOf`), from the project root.
  - The Dokploy engine moved to `src/target/dokploy/` (`engine`, `dokploy-api`, `fromManifest`, `declared`, `backup-provisioner`, `env-resolver`, `domain`, `dns/`); the old `src/deploy/` paths re-export it for one alpha.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.66
  - @geekmidas/constructs@10.0.0-alpha.66
  - @geekmidas/db@10.0.0-alpha.66
  - @geekmidas/envkit@10.0.0-alpha.66
  - @geekmidas/errors@10.0.0-alpha.66
  - @geekmidas/logger@10.0.0-alpha.66
  - @geekmidas/manifest@10.0.0-alpha.66
  - @geekmidas/schema@10.0.0-alpha.66
  - @geekmidas/services@10.0.0-alpha.66
  - @geekmidas/telescope@10.0.0-alpha.66

## 10.0.0-alpha.65

### Minor Changes

- [#181](https://github.com/geekmidas/toolbox/pull/181) [`05f77bf`](https://github.com/geekmidas/toolbox/commit/05f77bfebb2492a851c57b7a28de5238755d5dfe) Thanks [@geekmidas](https://github.com/geekmidas)! - `compose` is a built-in deploy target, and the registry is `deploy.registry`

  - :boom: **`deploy.dokploy.registry` is now `deploy.registry`**, read by every target. A config that still sets `deploy.dokploy.registry` fails to load with `DokployRegistryMoved`, which names the value; move it up one level: `deploy: { registry: 'ghcr.io/acme', dokploy: { endpoint: … } }`. `deploy.dokploy.registryId` stays where it is.
  - 🔥 **`gkm deploy --target compose --stage <stage> [--tag <tag>]`** brings a stage up as one Docker Compose stack behind Caddy, on the machine that deploys. `validate` works out the stack and, for a tag, looks up every image in the registry (`ImageTagNotFound` before anything changes); `provision` keeps the stage's generated secrets, writes the files, starts the infrastructure and applies its databases, roles, grants and migrations; `build` bundles each backend in the deploy's sandbox and builds every image, or pulls the tag; `release` runs `up --wait --remove-orphans`; `verify` asks each app through Caddy over HTTPS with the certificate verified (`ComposeAppsUnhealthy` names any that do not answer). It emits `artifact.built`, `resource.applied`, `app.deployed` and `health.checked`, and records each app's image ref, tag and digest in the stage's state under `images`, as Dokploy does (no more `compose:<app>` records). Without `--tag`, images are built and named after the commit.
  - **`gkm compose` runs through it**: the same `deploy()`, with `--build`, `--pull` and `--down` on top and the local stage as its default. Its order is now infrastructure and migrations, then images, then the apps.
  - **Targets**: `capabilities.localStage` lets a target that runs on this machine deploy the project's local stage (only `compose` does; every other target still refuses it with `UndeclaredStage`); a target's optional `tag()` names a run's images when no `--tag` is given; `ctx.tagGiven` says whether one was.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.65
  - @geekmidas/constructs@10.0.0-alpha.65
  - @geekmidas/db@10.0.0-alpha.65
  - @geekmidas/envkit@10.0.0-alpha.65
  - @geekmidas/errors@10.0.0-alpha.65
  - @geekmidas/logger@10.0.0-alpha.65
  - @geekmidas/manifest@10.0.0-alpha.65
  - @geekmidas/schema@10.0.0-alpha.65
  - @geekmidas/services@10.0.0-alpha.65
  - @geekmidas/telescope@10.0.0-alpha.65

## 10.0.0-alpha.64

### Minor Changes

- [#180](https://github.com/geekmidas/toolbox/pull/180) [`43a43b2`](https://github.com/geekmidas/toolbox/commit/43a43b2a5d30f1db457af69cde2a530a91ab7607) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm deploy` deploys an SST workspace: `sst` is a built-in deploy target

  - **`gkm deploy --stage <stage>` on `deploy: { default: 'sst' }`** runs `gkm build --provider aws --stage <stage>` and then `sst deploy --stage <stage>` in the deploy's sandbox, and health-checks each surface URL `run()` returns in `sst.config.ts` (read from `.sst/outputs.json`: an API's `/health`, a site's `/`), emitting `health.checked`. It used to refuse SST with "run `gkm build && sst deploy`". Capabilities: no rollback, migrations by the target, no images.
  - **An `aws` credential kind.** `CredentialProvider` answers `{ kind: 'aws', stage }` with a profile or keys (`AwsCredential`). From the environment: `AWS_PROFILE` alone when set, else `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`. Only `sst deploy` is handed them, in its own environment; the build and every other sandboxed step see no `AWS_*`. Missing ones fail validation with `MissingCredential`; a workspace with no `sst.config.ts` fails with `SstConfigNotFound`; a surface that never answers fails verify with `SurfacesUnhealthy`.
  - **Scaffolds deploy through `gkm deploy`.** `gkm init --deploy sst` writes `deploy:<stage>` scripts as `gkm deploy --stage <stage>`, and an `sst.config.ts` whose `run()` returns each surface's URL. The scaffolded GitHub deploy workflow runs `gkm deploy --stage "$STAGE"` for every target.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.64
  - @geekmidas/constructs@10.0.0-alpha.64
  - @geekmidas/db@10.0.0-alpha.64
  - @geekmidas/envkit@10.0.0-alpha.64
  - @geekmidas/errors@10.0.0-alpha.64
  - @geekmidas/logger@10.0.0-alpha.64
  - @geekmidas/manifest@10.0.0-alpha.64
  - @geekmidas/schema@10.0.0-alpha.64
  - @geekmidas/services@10.0.0-alpha.64
  - @geekmidas/telescope@10.0.0-alpha.64

## 10.0.0-alpha.63

### Minor Changes

- [#179](https://github.com/geekmidas/toolbox/pull/179) [`b63c253`](https://github.com/geekmidas/toolbox/commit/b63c2538036b5fa4a577819be650889395cb55e6) Thanks [@geekmidas](https://github.com/geekmidas)! - A deploy runs the project's own code in a sandbox, never with the deploy's credentials

  - **`Sandbox`** (`@geekmidas/cli/deploy`): `exec(command, args, { cwd, env, timeoutMs, secrets?, output?, signal? })` — an argument array, the command's whole environment, a required timeout, secrets mounted as files (`GKM_SECRETS_DIR`), and a `cwd` confined to the project (`SandboxCwdEscape`). `isolating` says whether only data comes back.
  - **`LocalSandbox`** is the default: a child process with `shell: false` and an allowlisted environment (`PATH`, `HOME`, `USER`, temp directories, locale, terminal, `NODE_ENV`, `NODE_EXTRA_CA_CERTS`, package-manager homes, proxies). No `AWS_*`, `DOKPLOY_*`, `DOCKER_*`, `NODE_AUTH_TOKEN`, `GITHUB_TOKEN` or `NODE_OPTIONS`. `home` points it at a scratch home; `passEnv` passes named variables on.
  - **`deploy({ sandbox })`** runs the config load, construct discovery (the engine's too) and every sniff in it. A host deploying untrusted repositories passes its own, isolating one. Credentials only reach the provision, push and release steps, through the `CredentialProvider`.
  - **The config loads in a child**, with the CLI's own tsx, and comes back as Zod-checked JSON — so a program calling `deploy()` no longer needs `tsx` loaded. Under an isolating sandbox a live object in the config (a custom state store, an inline target) fails with `ConfigObjectNotSerializable`; under the local sandbox such a config is still imported in-process, as before. `loadWorkspaceConfig(cwd, { sandbox })` does the same for other callers.
  - **The env sniffer** runs every app's entry, routes and envParser in the sandbox with a 30s timeout (`SNIFF_TIMEOUT_MS`); a hung sniff is killed and reported. The envParser sniff used to import the module into the deploy itself.
  - **`gkm build`** runs turbo in a `LocalSandbox` (passing `TURBO_TOKEN` on for a remote cache), or in `BuildOptions.sandbox`.
  - **`installDependencies(sandbox, { ignoreScripts: true, allowScripts: ['esbuild'] })`** installs without lifecycle scripts and rebuilds only the allowed packages (pnpm, npm, Yarn 2+; `InstallScriptsAllowlistUnsupported` for Yarn 1 and bun).
  - Named errors: `ConfigLoadFailed` (was a plain `Error`), `ConstructDiscoveryFailed`, `ConstructsNotSerializable`, `SandboxWorkerFailed`, `SecretNameInvalid`, `InstallAllowlistNameInvalid`.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.63
  - @geekmidas/constructs@10.0.0-alpha.63
  - @geekmidas/db@10.0.0-alpha.63
  - @geekmidas/envkit@10.0.0-alpha.63
  - @geekmidas/errors@10.0.0-alpha.63
  - @geekmidas/logger@10.0.0-alpha.63
  - @geekmidas/manifest@10.0.0-alpha.63
  - @geekmidas/schema@10.0.0-alpha.63
  - @geekmidas/services@10.0.0-alpha.63
  - @geekmidas/telescope@10.0.0-alpha.63

## 10.0.0-alpha.62

### Minor Changes

- 🔥 [#178](https://github.com/geekmidas/toolbox/pull/178) [`262051c`](https://github.com/geekmidas/toolbox/commit/262051c2bcbdcca4b1ab402ed82f7ef621887929) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: `gkm deploy` deploys through a `DeployTarget`; `--provider docker` and `--provider aws-lambda` are removed

  - **`@geekmidas/cli/target`.** A target implements `validate → plan` (a dry run) or `validate → provision → build → release → verify`, plus `rollback` when its `capabilities` say it can. Each phase gets the `DeployIdentity`, the workspace and manifest, an explicit `cwd`, the `CredentialProvider`, the stage's `StateStore` (locked for a real run), the stage's secrets (masked in every line once read), a logger, the `AbortSignal`, an event emitter and `name()` for namespaced resource names. A target declares its `runtime` (`server` | `aws`), `capabilities` (`rollback`, who runs `migrations`, whether it builds `images`), an `options` schema (any Standard Schema) and the `credentials` it asks for. `defineTarget()` infers the options and run-state types. `CredentialKinds` can be augmented for a target's own credentials.
  - 🔧 **Config.** `deploy.default` (and an app's `deploy`) accepts any target name. `deploy.targets` maps names to a package, a target object, or `[package or target, options]`; a built-in's name cannot be taken. A package declares `"gkm": { "runtime": … }` in its `package.json`, which `gkm dev` and `gkm build` read without loading it.
  - **Resolution.** The host's targets (`deploy({ targets })`), then the built-ins, then `deploy.targets`; anything else is `UnknownDeployTarget`. A package is never guessed from a name. `sst`, `vercel` and `cloudflare` raise `DeployTargetNotYetSupported`.
  - **`gkm deploy --target <name>`.** `--provider dokploy` still works as `--target dokploy`, with a deprecation warning. `--provider docker` and `--provider aws-lambda` raise `ProviderRemoved`, pointing to `gkm docker`/`gkm compose` and SST. Scaffolded deploy scripts are `gkm deploy --stage <stage>`.
  - **Dokploy is the built-in `dokploy` target**, with unchanged requests and output. Its image builds stay in `release`, beside each application.
  - ✨ **Events.** `phase.failed`, `health.checked`, and the `build` and `rollback` phases are new; `deploy.started` carries `target`. `deploy.started` is emitted once the target has validated. `NoDeployableApps` names the target. `DeployProviderUnsupported` is gone. `providerOf` reads each target's declared runtime and no longer treats `deploy.default: 'server'` as a target.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.62
  - @geekmidas/constructs@10.0.0-alpha.62
  - @geekmidas/db@10.0.0-alpha.62
  - @geekmidas/envkit@10.0.0-alpha.62
  - @geekmidas/errors@10.0.0-alpha.62
  - @geekmidas/logger@10.0.0-alpha.62
  - @geekmidas/manifest@10.0.0-alpha.62
  - @geekmidas/schema@10.0.0-alpha.62
  - @geekmidas/services@10.0.0-alpha.62
  - @geekmidas/telescope@10.0.0-alpha.62

## 10.0.0-alpha.61

### Minor Changes

- [#177](https://github.com/geekmidas/toolbox/pull/177) [`c40ae4b`](https://github.com/geekmidas/toolbox/commit/c40ae4b86207a8bf0982b05a57f80fcbcd8c5b79) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm compose` runs a workspace's APIs and sites for a stage as one Docker Compose stack behind Caddy

  `gkm compose [--stage <stage>] [--tag <tag>] [--build | --pull] [--dry-run] [--down]` writes `.gkm/compose/<stage>/` — a compose file, a Caddyfile and one env file per backend holding only the keys that app reads (mode 0600) — and starts it: Postgres first, then its databases, roles and migrations, then the apps, with one Caddy serving every app on its own host over HTTPS (the stage's domains with Let's Encrypt; `*.localhost` with Caddy's own CA locally). An auth server trusts the internal origin of every service that calls it across the compose network as well as the public ones.

  With `--tag`, every app's image is looked up in the registry first and nothing is pulled or started unless all of them exist (`ImageTagNotFound` names each missing one); a site's image is tagged `<tag>-<stage>`, since its public URLs are build args. Without a tag the stack is built from the checkout and tagged with the commit. Each run records the tag and digest per app in the stage's deploy state. Workers and object storage are not run yet; a bucket's URL comes from the stage's secrets.

### Patch Changes

- [#177](https://github.com/geekmidas/toolbox/pull/177) [`7aece20`](https://github.com/geekmidas/toolbox/commit/7aece20749fef144a790a8f3077dc3de2055e0de) Thanks [@geekmidas](https://github.com/geekmidas)! - Production images: an auth server gets a server, a session reaches its endpoint, an HttpError keeps its status, and a site gets its URLs at build time

  - `gkm build --production` for a surface that serves itself — a `BetterAuth` server — now writes and bundles a server that listens on `PORT`, answers `/health` and drains on SIGTERM. It wrote only the dev entry, so its image had no bundle to run.
  - ⚡️ An endpoint built from a factory's `.session()` with no authorizer was handed `undefined` for its session in a production build, and its session under `gkm dev`. The optimized handlers now read the session whenever one is configured (`Endpoint.hasSession`).
  - An `HttpError` thrown by a handler or a session callback answered 500 from a production server; it now answers with its own status, as under `gkm dev`, without the stack.
  - `gkm docker`: a site's public URLs (`VITE_*`, `NEXT_PUBLIC_*`) are build args in `docker-compose.constructs.yml` rather than runtime environment, which a built bundle never reads, and its Dockerfile declares an `ARG` for every one its declaration implies. A site gets no server environment and waits on no infrastructure, and the app services address each other on the compose network rather than through the local edge's hostnames.

- Updated dependencies [[`7aece20`](https://github.com/geekmidas/toolbox/commit/7aece20749fef144a790a8f3077dc3de2055e0de)]:
  - @geekmidas/constructs@10.0.0-alpha.61
  - @geekmidas/cache@10.0.0-alpha.61
  - @geekmidas/db@10.0.0-alpha.61
  - @geekmidas/envkit@10.0.0-alpha.61
  - @geekmidas/errors@10.0.0-alpha.61
  - @geekmidas/logger@10.0.0-alpha.61
  - @geekmidas/manifest@10.0.0-alpha.61
  - @geekmidas/schema@10.0.0-alpha.61
  - @geekmidas/services@10.0.0-alpha.61
  - @geekmidas/telescope@10.0.0-alpha.61

## 10.0.0-alpha.60

### Minor Changes

- [#176](https://github.com/geekmidas/toolbox/pull/176) [`17a5290`](https://github.com/geekmidas/toolbox/commit/17a5290fc3ed7315ebf6d07a452d860bceda03bc) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: `deploy()` from `@geekmidas/cli/deploy`: a deploy that never prompts, prints or exits, and stage keys kept by project identity

  - ✨ **`deploy(input)`** (new subpath `@geekmidas/cli/deploy`) takes an explicit `cwd`, a `CredentialProvider`, a `logger` and an `AbortSignal`, and returns a run: iterate it for plain-JSON events (`phase.started`/`finished`, `log`, `resource.applied`/`planned`, `artifact.built`, `app.deployed`, `app.failed`, `deploy.finished`, `deploy.failed`), and await `result` for a structured `DeployResult`. Nothing below the CLI prompts or calls `process.exit`; a credential no provider has raises `MissingCredential`, naming it and how to supply it.
  - ✨ **`gkm deploy` is a thin wrapper** that owns the prompts, the stored login and the exit code. Its human output is unchanged. New flags: `--json` (events as JSON lines on stdout; never prompts) and `--dry-run` (read-only Dokploy calls, no lock, no state, no generated secrets, nothing built or pushed).
  - **Builds run in each app's own directory**, not the process's working directory.
  - ✨ :boom: **Stage keys move** from `~/.gkm/<folder>/<stage>.key` to `~/.gkm/keys/<namespace>/<project>/<stage>.key` — the `<namespace>/<project>` a deploy claims its Dokploy project by — so two projects in folders with the same name no longer share (and overwrite) keys. An existing key is copied to the new place the first time it is read, and the old file is kept. `GKM_HOME` moves the whole home (keys and `credentials.json`). A workspace that sets `deploy.namespace` takes its default-namespace key along; changing from one namespace to another needs the key copied by hand. Generated GitHub workflows write the key to the new place.
  - Without a terminal, a missing Dokploy or registry login is `MissingCredential` rather than `Interactive input required`. The registry login can also come from `DOCKER_REGISTRY_USERNAME` / `DOCKER_REGISTRY_PASSWORD`, and the Dokploy endpoint from `deploy.dokploy.endpoint` when only the token is in the environment.
  - ✨ `workspaceDeployCommand` and `deployCommand` are `@deprecated` wrappers for one alpha and return the new `DeployResult` (a superset of `WorkspaceDeployResult`). The old single-image `DeployResult` type is now `DockerDeployResult`.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.60
  - @geekmidas/constructs@10.0.0-alpha.60
  - @geekmidas/db@10.0.0-alpha.60
  - @geekmidas/envkit@10.0.0-alpha.60
  - @geekmidas/errors@10.0.0-alpha.60
  - @geekmidas/logger@10.0.0-alpha.60
  - @geekmidas/manifest@10.0.0-alpha.60
  - @geekmidas/schema@10.0.0-alpha.60
  - @geekmidas/services@10.0.0-alpha.60
  - @geekmidas/telescope@10.0.0-alpha.60

## 10.0.0-alpha.59

### Minor Changes

- [#172](https://github.com/geekmidas/toolbox/pull/172) [`7888702`](https://github.com/geekmidas/toolbox/commit/78887029e5510c1a8bf69a43b3a1b65864a4a5e0) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm deploy` holds the stage's lock for the whole run and journals every resource it creates

  - **One deploy per stage at a time.** Deploy reads and writes state through `createStateStore` and takes `lock(stage, { operation: 'deploy' })` before it generates or provisions anything, releasing it when the run ends, however it ends. A second run gets `StateLocked`, naming the holder; a killed run's lock is released with `gkm state:unlock --stage <stage>`.
  - **A journal instead of one write at the end.** The project, the stage's environment, each application and each domain are recorded `pending` before the create call and `ready` with their id after, and the state is written after every app. A run that dies part way keeps the ids it got back; the next one looks up anything left `pending` before creating it, so nothing is created twice. `gkm state:show` lists what a deploy stopped while creating.
  - **Every write is conditional** on the version the run last wrote, so a writer that skipped the lock raises `StateVersionConflict` instead of being overwritten.
  - **`state:pull`, `state:push` and `state:diff` go through the stores.** They copy and compare resource records as well as the state, migrate v1 on the way, and a push takes the remote stage's lock, so it cannot replace state a running deploy is writing.
  - 🔥 **Removed:** `CachedStateProvider`, `LocalStateProvider`, `SSMStateProvider`, `createStateProvider` and the `StateStoreProvider` bridge — nothing reads state through them any more. SSM state is read from SSM directly; a custom `StateProvider` in `state.provider` still works behind `LegacyStateStore`.

- [#175](https://github.com/geekmidas/toolbox/pull/175) [`ebed122`](https://github.com/geekmidas/toolbox/commit/ebed122350c6462aac8a14173f10f938f373671b) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm dev` serves a discovery endpoint on `127.0.0.1:4983`

  A tool can now find what `gkm dev` is running without being told any ports.
  `GET /__gkm` lists every running workspace on the machine — name, stage,
  construct manifest, and each app with its port, URL, status and data APIs
  (Telescope's JSON API, `/__gkm/db`, `/__docs`). `GET /__gkm/events` streams
  apps starting, stopping and reloading as server-sent events, and
  `/__gkm/workspaces/<id>/apps/<app>/…` forwards to an app's data APIs so a
  client needs one origin. `gkm dev` prints a connect URL carrying the token.

  Every `gkm dev` registers in `~/.gkm/dev`; the first to bind the port serves
  it, and another takes over when it exits. It is loopback-only, needs the token
  on every request, checks the `Host` header against DNS rebinding, answers only
  browser origins listed in the new `dev.allowedOrigins` (empty by default), and
  is read-only. `dev.discoveryPort` or `GKM_DISCOVERY_PORT` moves it. The
  response types are exported from `@geekmidas/cli/config`.

### Patch Changes

- Updated dependencies [[`57eea44`](https://github.com/geekmidas/toolbox/commit/57eea445c114acbb398d4dfedc86f1c22dab3f10)]:
  - @geekmidas/logger@10.0.0-alpha.59
  - @geekmidas/cache@10.0.0-alpha.59
  - @geekmidas/constructs@10.0.0-alpha.59
  - @geekmidas/db@10.0.0-alpha.59
  - @geekmidas/envkit@10.0.0-alpha.59
  - @geekmidas/errors@10.0.0-alpha.59
  - @geekmidas/manifest@10.0.0-alpha.59
  - @geekmidas/schema@10.0.0-alpha.59
  - @geekmidas/services@10.0.0-alpha.59
  - @geekmidas/telescope@10.0.0-alpha.59

## 10.0.0-alpha.58

### Minor Changes

- [#170](https://github.com/geekmidas/toolbox/pull/170) [`d0bfbfd`](https://github.com/geekmidas/toolbox/commit/d0bfbfd78e56d65e0f2ba5442e904b311b7df96f) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: Dokploy deploys are identified by namespace, project and stage, and never adopt a project they did not create

  - ✨ **`deploy.namespace`.** A deploy's identity is `<namespace>/<project>` plus its stage. The namespace defaults to the kebab-cased workspace name; set it when two workspaces with one name deploy to one server. A chosen namespace is in the Dokploy project name (`acme-shop`), every application and service name (`production-acme-shop-api`) and the image path. The default adds nothing to the names a workspace was already deployed under.
  - **Projects are claimed, not matched by name.** A project created by a deploy carries `gkm:<namespace>/<project>` in its description. Deploy uses the project its stage state names, then one with its name and its marker, then creates one. A project with the same name in any case and no marker (or another identity's) raises `ProjectNotOwned` and is never deployed into. Existing stages: the project id in state is trusted and the marker is written on the next deploy.
  - ✨ **Images are `<registry>/<namespace>/<project>-<app>:<tag>`** (was `<registry>/<name>-<app>:<tag>`), and each app's ref and pushed digest are recorded in the stage state (`images`). Registry permissions scoped to the old repository names need the new path.
  - **The registry is the one configured.** `deploy.dokploy.registry` is required (`RegistryNotConfigured`); Dokploy's registry is `deploy.dokploy.registryId`, else the one in the stage state, else the one Dokploy has for that registry's host and path (`RegistryAmbiguous` when several match, `RegistryNotFound` for a wrong id). It is never "the first registry Dokploy lists", and its id is kept in the stage state (`registryId`) rather than once per machine in `~/.gkm/credentials.json`.

- [#167](https://github.com/geekmidas/toolbox/pull/167) [`476aeda`](https://github.com/geekmidas/toolbox/commit/476aedab3128ec29948df93f9776dae4e42d3488) Thanks [@geekmidas](https://github.com/geekmidas)! - Production defaults: OpenTelemetry wired into the production entry, and logger redaction on

  - :boom: `createLogger` from `@geekmidas/logger/pino` now redacts `DEFAULT_REDACT_PATHS` when `redact` is left out. Pass `redact: false` for the old behaviour. It also takes a `destination` to write to.
  - `gkm build --production` writes a `telemetry.ts` beside `server.ts`, and the entry awaits it before importing the app. When `OTEL_EXPORTER_OTLP_ENDPOINT` is set it calls `setupTelemetry` with `service.name` (the surface id), `service.namespace` (the workspace) and `deployment.environment` (`STAGE`). Unset, nothing is imported. An app without `@geekmidas/telescope` and the `@opentelemetry/*` peers still builds and starts, and warns `TelemetryUnavailable` if the endpoint is set.
  - `setupTelemetry` gains `sampleRatio` (parent-based ratio sampling, `InvalidSampleRatio` outside 0–1), `serviceNamespace`, `deploymentEnvironment` and `handleSignals`. Without an `endpoint` it now follows the standard `OTEL_EXPORTER_OTLP_*` variables instead of writing to the console, and `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` apply when no ratio is passed.
  - 🐛 Fixed: OTLP log export never sent anything — the log processor went to a `LoggerProvider` nothing registered. It is now handed to the SDK. `shutdownTelemetry` also removes its `SIGTERM` listener.

### Patch Changes

- Updated dependencies [[`476aeda`](https://github.com/geekmidas/toolbox/commit/476aedab3128ec29948df93f9776dae4e42d3488)]:
  - @geekmidas/telescope@10.0.0-alpha.58
  - @geekmidas/logger@10.0.0-alpha.58
  - @geekmidas/constructs@10.0.0-alpha.58
  - @geekmidas/cache@10.0.0-alpha.58
  - @geekmidas/db@10.0.0-alpha.58
  - @geekmidas/envkit@10.0.0-alpha.58
  - @geekmidas/errors@10.0.0-alpha.58
  - @geekmidas/manifest@10.0.0-alpha.58
  - @geekmidas/schema@10.0.0-alpha.58
  - @geekmidas/services@10.0.0-alpha.58

## 10.0.0-alpha.57

### Patch Changes

- [#171](https://github.com/geekmidas/toolbox/pull/171) [`9a0ee0b`](https://github.com/geekmidas/toolbox/commit/9a0ee0b78cfa8b57aa6047e78c1f03142fe2d6ae) Thanks [@geekmidas](https://github.com/geekmidas)! - The SSM deploy lock is verified after it is taken

  After creating the lock parameter, the SSM state store reads it back and holds the lock only if it is at version 1 with its own holder recorded. SSM's create-only put is atomic, so on AWS this changes nothing. On a backend where two racing creates can both succeed (the local AWS emulator does), the later one no longer gives a stage two concurrent deploys: both runners see `StateLocked`.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.57
  - @geekmidas/constructs@10.0.0-alpha.57
  - @geekmidas/db@10.0.0-alpha.57
  - @geekmidas/envkit@10.0.0-alpha.57
  - @geekmidas/errors@10.0.0-alpha.57
  - @geekmidas/logger@10.0.0-alpha.57
  - @geekmidas/manifest@10.0.0-alpha.57
  - @geekmidas/schema@10.0.0-alpha.57
  - @geekmidas/services@10.0.0-alpha.57
  - @geekmidas/telescope@10.0.0-alpha.57

## 10.0.0-alpha.56

### Minor Changes

- 🔥 [#169](https://github.com/geekmidas/toolbox/pull/169) [`efd9019`](https://github.com/geekmidas/toolbox/commit/efd9019cd2d8ec93dea462675da3ded175e732ee) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: Toolbox is headless: `@geekmidas/ui` and `@geekmidas/studio` are removed, Telescope serves JSON only, and `gkm dev` serves the declared database as a read-only JSON API

  - ✨ **`@geekmidas/ui` and `@geekmidas/studio` are deprecated and no longer published.** Their last versions are `@geekmidas/ui@9.0.2` and `@geekmidas/studio@9.0.2` (`latest`), and `@geekmidas/ui@10.0.0-alpha.55` and `@geekmidas/studio@10.0.0-alpha.55` on `alpha`. Pin those to keep using them; nothing in toolbox depends on them any more. Studio's data layer lives on in `@geekmidas/db/introspect`; for components, run `npx shadcn@latest add` in your app.
  - **Telescope has no dashboard.** The embedded React UI and its assets are gone, and `createUI` is renamed `createApi`: it serves the same JSON routes under `/api/*` (requests, exceptions, logs, stats, metrics) and nothing else, so the mount point's root and the old dashboard routes now 404. Recorders, storage adapters, the OTLP receiver and the WebSocket feed are unchanged. Replace `createUI(telescope)` with `createApi(telescope)`.
  - ✨ **`@geekmidas/db/introspect`** (new): `listSchemas`, `introspectSchema`, `introspectTable`, a `DataBrowser` for cursor-paged, filtered and sorted rows, and `createIntrospectionHandler`, a fetch-style `(Request) => Promise<Response>` JSON API over them (`/schemas`, `/tables`, `/tables/:name`, `/tables/:name/rows`), read-only and with no HTTP framework dependency. A table with no configured cursor pages by its single-column primary key. Mistakes are named errors: `TableNotFound`, `ColumnNotFound`, `UnsupportedFilterOperator`, `InvalidCursor`.
  - **`decodeCursor` throws `InvalidCursor`** (exported from `@geekmidas/db/pagination`, `/kysely/pagination` and `/objection/pagination`) instead of a plain `Error`; match on the class rather than the message.
  - **`gkm dev` serves the database API at `/__gkm/db`** for the app's declared database, through the client its handlers use, and prints `db /__gkm/db` on the ready line. It replaces the Studio mount at `/__studio`. `gkm build` never includes it. The app needs `@geekmidas/db` installed, which a scaffold with a database already has.
  - 🔥 **The `studio` config option is removed** from `gkm.config.ts` and workspace app config, along with `StudioConfig`. Delete it; there is nothing to configure.
  - **`gkm init` scaffolds no UI package.** Fullstack projects get shadcn/ui components written into the web app (`apps/web/src/components/ui/`, `components.json`, `src/lib/utils.ts`, the theme in its global stylesheet) instead of a `packages/ui` workspace package with Storybook. No template writes `src/config/studio.ts` or depends on `@geekmidas/studio`.

### Patch Changes

- Updated dependencies [[`efd9019`](https://github.com/geekmidas/toolbox/commit/efd9019cd2d8ec93dea462675da3ded175e732ee)]:
  - @geekmidas/telescope@10.0.0-alpha.56
  - @geekmidas/db@10.0.0-alpha.56
  - @geekmidas/constructs@10.0.0-alpha.56
  - @geekmidas/cache@10.0.0-alpha.56
  - @geekmidas/envkit@10.0.0-alpha.56
  - @geekmidas/errors@10.0.0-alpha.56
  - @geekmidas/logger@10.0.0-alpha.56
  - @geekmidas/manifest@10.0.0-alpha.56
  - @geekmidas/schema@10.0.0-alpha.56
  - @geekmidas/services@10.0.0-alpha.56

## 10.0.0-alpha.55

### Minor Changes

- [#162](https://github.com/geekmidas/toolbox/pull/162) [`6cdaa36`](https://github.com/geekmidas/toolbox/commit/6cdaa36e0a9263f4b249ef2276d47375802c9707) Thanks [@geekmidas](https://github.com/geekmidas)! - A RestApi's production server serves HTTP only

  `gkm build --production` (what `gkm docker`'s images run) wired every queue consumer, cron and topic subscriber into the server it built, because they sat in the API's directory. They belong to a `Worker`, so a production server that serves a RestApi now leaves them out, SNS push routes included, and the build says what it left out (`Serving Api only: leaving out 1 cron, 1 queue consumer, 1 subscriber`). Publishing (`.event(...)`, sending to a queue) is unchanged. `gkm dev` still runs everything in one process. Workers get their own deploy unit separately; until then, background work does not run in a server deploy.

- ✨ [#168](https://github.com/geekmidas/toolbox/pull/168) [`5b13af5`](https://github.com/geekmidas/toolbox/commit/5b13af5996c3e9883f02368804b2f6c8f7ed6b68) Thanks [@geekmidas](https://github.com/geekmidas)! - ✨ A deploy state store with locks, versions and per-resource records: `createStateStore` returns a `LocalStateStore` (atomic temp-file writes, `open('wx')` lock), `SSMStateStore` (create-if-absent lock, parameter-version checks) or the new `S3StateStore` (`state: { provider: 's3', bucket, region }`, `If-Match` / `If-None-Match` writes). A second run of a stage gets `StateLocked`; a write based on a stale version gets `StateVersionConflict`.

  State is now stored as schema version 2. A version 1 state is migrated the first time a store reads it, and the original is kept as `.gkm/deploy-<stage>.v1.json` (`state.v1` beside the SSM parameter, `state.v1.json` beside the S3 object). Local state files are mode 0600, `gkm state:show` masks database passwords, generated secrets and IAM keys, and `gkm state:unlock --stage <stage>` releases a lock a crashed run left behind. A custom `StateProvider` keeps working but warns `StateStoreWithoutLocking`; `CachedStateProvider` is deprecated for deploys.

### Patch Changes

- [#142](https://github.com/geekmidas/toolbox/pull/142) [`eedac53`](https://github.com/geekmidas/toolbox/commit/eedac53aeec2d88d46a74ec9f3d4a55e2845b2b2) Thanks [@geekmidas](https://github.com/geekmidas)! - Database connections say who holds them, and queries say what ran them

  - **`application_name` on every connection** — the Lambda function's name, or the surface's id on a server (`GKM_APP_NAME`, set by the generated entry), or the app under `gkm dev`. A fallback: `PGAPPNAME` or `?application_name=` in the URL still win. `pg_stat_activity` can now say which function or app is holding connections.
  - ✨ **Query tags.** A query run inside an endpoint, subscriber, queue or cron ends in a sqlcommenter comment, `/*operation='POST /orders',request_id='…'*/`, visible in `pg_stat_activity` and the server's logs. `pg_stat_statements` ignores it. Off with `new KyselyDatabase(id, { queryTags: false })`.
  - **An idle connection ended by the server no longer crashes the process.** Pools had no `'error'` listener, so `idle_session_timeout` or a failover surfaced as an uncaught exception.
  - ✨ **Production servers close their pools on shutdown.** On `SIGTERM` the server stops taking requests, lets in-flight ones finish, and runs `runShutdownHooks()` (new, from `@geekmidas/constructs`) before exiting, instead of waiting 30s with every connection still open. It exits by `GKM_SHUTDOWN_TIMEOUT_MS` (8s by default, under Docker's 10s stop timeout), with code 1 if it had to cut a request off.
  - `@geekmidas/services`: the request context carries the `operation` it is for; `currentRequestContext()` reads it without throwing outside a request.

- [#165](https://github.com/geekmidas/toolbox/pull/165) [`d4b5c78`](https://github.com/geekmidas/toolbox/commit/d4b5c786419665d03b8c6ea7d42bfd59db1373ba) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm build`, `gkm docker` and `gkm deploy` run commands as argument arrays and never print the master key

  `docker build`, `docker push` and the workspace's turbo build are started with
  an argument array and no shell, so a package name, image ref or tag holding
  `;`, `$()` or spaces stays one argument. Image refs are checked against
  Docker's grammar first and refused as `ImageRefInvalid`; a failing or hung
  command raises `CommandFailed` or `CommandTimedOut`.

  The master key is no longer printed. Output names it by fingerprint (the first
  8 hex characters of its SHA-256). If you copied `GKM_MASTER_KEY` from
  `gkm build --stage` output, read it from `.gkm/server/master.key` instead
  (owner-only, kept out of the Docker build context); `gkm deploy` still sets it
  in the container's runtime environment. `DeployResult.masterKey` is deprecated.

  Encrypted credentials reach the image build as a BuildKit secret
  (`--secret id=gkm_credentials`) rather than the `GKM_ENCRYPTED_CREDENTIALS` /
  `GKM_CREDENTIALS_IV` build args, which `ps` and `docker history` recorded. The
  generated multi-stage Dockerfiles read them with
  `RUN --mount=type=secret,id=gkm_credentials`; regenerate yours with `gkm docker`.

- [#164](https://github.com/geekmidas/toolbox/pull/164) [`c66fe5c`](https://github.com/geekmidas/toolbox/commit/c66fe5ce466d13990dd13eb883773f6ed59df46a) Thanks [@geekmidas](https://github.com/geekmidas)! - Dokploy requests time out instead of hanging

  A Dokploy server that accepted the connection and never answered held
  `gkm deploy` until the CI runner's own limit. Each `DokployApi` request now
  has a deadline — `timeoutMs`, 30 seconds by default — and rejects with
  `DokployRequestTimedOut`, which is not retried, since the request may have
  arrived. A `signal` option aborts every request and any retry still waiting,
  rejecting with the caller's own reason.

- [#161](https://github.com/geekmidas/toolbox/pull/161) [`2cd7b8c`](https://github.com/geekmidas/toolbox/commit/2cd7b8c2366960a4dab6ecce62831b9c47b28195) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm trust` asks for your password once on macOS, not twice

  It ran `sudo security add-trusted-cert -d … -k /Library/Keychains/System.keychain`. `sudo` asked for the password in the terminal to write the System keychain, and then macOS asked again in a dialog, because changing trust settings needs its own authorization that `sudo` does not cover. The local authority is now trusted in your login keychain for your user, without `sudo`, so macOS asks once (your password or Touch ID). Browsers and Node's system store both honour a user's trust settings. Linux is unchanged: its trust store is system-wide and needs `sudo`.

- Updated dependencies [[`eedac53`](https://github.com/geekmidas/toolbox/commit/eedac53aeec2d88d46a74ec9f3d4a55e2845b2b2)]:
  - @geekmidas/constructs@10.0.0-alpha.55
  - @geekmidas/services@10.0.0-alpha.55
  - @geekmidas/cache@10.0.0-alpha.55
  - @geekmidas/db@10.0.0-alpha.55
  - @geekmidas/envkit@10.0.0-alpha.55
  - @geekmidas/errors@10.0.0-alpha.55
  - @geekmidas/logger@10.0.0-alpha.55
  - @geekmidas/manifest@10.0.0-alpha.55
  - @geekmidas/schema@10.0.0-alpha.55
  - @geekmidas/telescope@10.0.0-alpha.55

## 10.0.0-alpha.54

### Patch Changes

- [#163](https://github.com/geekmidas/toolbox/pull/163) [`dc4187f`](https://github.com/geekmidas/toolbox/commit/dc4187fff4e9120eb02178583bf41c156cfbdf34) Thanks [@geekmidas](https://github.com/geekmidas)! - Pin the local AWS emulator to floci 2.1.0

  The compose file `gkm dev` and `gkm test` generate ran `floci/floci:latest`. floci 2.2.0 (published under `latest` on 2026-10-06) answers a KMS decrypt under the wrong encryption context with `UnknownError` instead of `InvalidCiphertextException`, so a project's KMS behaviour locally changed under it. It is pinned to 2.1.0, as MinIO already is.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.54
  - @geekmidas/constructs@10.0.0-alpha.54
  - @geekmidas/db@10.0.0-alpha.54
  - @geekmidas/envkit@10.0.0-alpha.54
  - @geekmidas/errors@10.0.0-alpha.54
  - @geekmidas/logger@10.0.0-alpha.54
  - @geekmidas/manifest@10.0.0-alpha.54
  - @geekmidas/schema@10.0.0-alpha.54
  - @geekmidas/services@10.0.0-alpha.54
  - @geekmidas/telescope@10.0.0-alpha.54

## 10.0.0-alpha.53

### Patch Changes

- [#140](https://github.com/geekmidas/toolbox/pull/140) [`eaab95a`](https://github.com/geekmidas/toolbox/commit/eaab95a905751f609be96d5bd742c77b1558c577) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm dev` on macOS no longer moves a Next.js app off its port because of its own leftover server

  The process that holds a Next.js app's port is `next-server`, which renames itself. On macOS that overwrites what `ps eww` reads, so gkm couldn't see the app tag it inherited, treated the holder as another project's, and moved the app to a new port for good in `.gkm/app-ports.json`. When the holder's own tag can't be read, gkm now uses the tag of its nearest parent (here the `next dev` it started), so a leftover server is refused as running rather than moved around.

- [#139](https://github.com/geekmidas/toolbox/pull/139) [`6fb1ce4`](https://github.com/geekmidas/toolbox/commit/6fb1ce4406c4dc8517b65923190af169c2aa70a7) Thanks [@geekmidas](https://github.com/geekmidas)! - SNS topic subscribers start under `gkm dev` without `@middy/core`

  `SnsPushSubscriberAdaptor` handed each pushed notification to `AWSLambdaSubscriber`, which imports `@middy/core`. middy is an optional peer that only Lambda needs, so a project that doesn't deploy to Lambda didn't install it, and every SNS subscriber logged `Failed to set up subscriber` with `ERR_MODULE_NOT_FOUND`. The push adaptor now runs the subscriber directly, with the same parsing, services, database and error handling as the Lambda adaptor. middy stays in the Lambda wrapper only.

  - 💥 **Breaking (alpha):** `SnsPushSubscriberAdaptor` moved from `@geekmidas/constructs/aws` to `@geekmidas/constructs/subscribers`. Every other export of `/aws` loads middy.
  - A subscriber that fails to set up now logs the error's message, which names the missing module.
  - A subscriber whose output fails its `.output()` schema throws `SubscriberOutputInvalid` instead of a bare `Error`.

- Updated dependencies [[`6fb1ce4`](https://github.com/geekmidas/toolbox/commit/6fb1ce4406c4dc8517b65923190af169c2aa70a7)]:
  - @geekmidas/constructs@10.0.0-alpha.53
  - @geekmidas/cache@10.0.0-alpha.53
  - @geekmidas/db@10.0.0-alpha.53
  - @geekmidas/envkit@10.0.0-alpha.53
  - @geekmidas/errors@10.0.0-alpha.53
  - @geekmidas/logger@10.0.0-alpha.53
  - @geekmidas/manifest@10.0.0-alpha.53
  - @geekmidas/schema@10.0.0-alpha.53
  - @geekmidas/services@10.0.0-alpha.53
  - @geekmidas/telescope@10.0.0-alpha.53

## 10.0.0-alpha.52

### Patch Changes

- [#136](https://github.com/geekmidas/toolbox/pull/136) [`0eb2628`](https://github.com/geekmidas/toolbox/commit/0eb2628f0fc00dc65543f6c6fe64400cd3bbd6b5) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm dev` runs crons and queue consumers it was silently skipping

  - ✨ **Crons under `gkm dev` on the SST target.** Server crons are scheduled through pg-boss. A project that deploys to AWS has no pg-boss locally, so `setupCrons` logged one error and scheduled nothing. Under `gkm dev`, which is one process, crons now run in-process on their schedule, in UTC, via the new `scheduleInProcess` in `@geekmidas/constructs/crons`. Outside `gkm dev` it is still an error, because a timer in each deployed replica would fire every job once per replica.
  - ✨ **Server-target crons never ran their handler.** The generated `run` called `cron.handler()`, which a `Cron` doesn't have, so every firing logged "Cron failed", on pg-boss too. Crons now run through the new `runCron`, with the same steps as the Lambda adaptor: services, the worker's database as `db`, an auditor if declared, parsed output, and published events.
  - 🐛 **The S3 driver for a workspace that installs `@geekmidas/storage` at its root.** The entry registered the S3 driver only when the app's own `package.json` listed storage. In a workspace that lists it once at the root, any service that injected a bucket threw `UnregisteredStorageScheme`. A queue consumer that depended on a bucket logged that once and was never polled, so its messages sat on the queue. The dependency is now found the way Node resolves it: the app's `package.json` or any directory above it.

- Updated dependencies [[`0eb2628`](https://github.com/geekmidas/toolbox/commit/0eb2628f0fc00dc65543f6c6fe64400cd3bbd6b5)]:
  - @geekmidas/constructs@10.0.0-alpha.52
  - @geekmidas/cache@10.0.0-alpha.52
  - @geekmidas/db@10.0.0-alpha.52
  - @geekmidas/envkit@10.0.0-alpha.52
  - @geekmidas/errors@10.0.0-alpha.52
  - @geekmidas/logger@10.0.0-alpha.52
  - @geekmidas/manifest@10.0.0-alpha.52
  - @geekmidas/schema@10.0.0-alpha.52
  - @geekmidas/services@10.0.0-alpha.52
  - @geekmidas/telescope@10.0.0-alpha.52

## 10.0.0-alpha.51

### Minor Changes

- [#133](https://github.com/geekmidas/toolbox/pull/133) [`1aa7b43`](https://github.com/geekmidas/toolbox/commit/1aa7b434e28ef24e4bdf057847b510fa9cfa1fcf) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: `deploy.domains` for every target, a `subdomain` on each surface, and each `RestApi` on its own host
  - ✨ **`deploy.dokploy.domains` is now `deploy.domains`.** A stage's base domain is a fact about the deployment, not about Dokploy, so every target reads it. Move the block up one level: `deploy: { domains: { production: 'myapp.com' }, dokploy: { endpoint, registry } }`. A stage with no domain fails with `NoDomainForStage`, naming the stage and where to add it.
  - ✨ **`subdomain` on `RestApi`, `BetterAuth` and `StaticSite`.** A surface answers on `{subdomain}.{domain}` — `new RestApi('Api', { path: 'apps/api', subdomain: 'v1' })` is `v1.myapp.com` — and on the same label locally, `v1.shop.localhost`. Absent, the id kebab-cased, as before.
  - **Each `RestApi` on its own host.** A deploy handed every surface the first backend's address, so a workspace with two APIs pointed both at one. Each now gets its own app's URL.

### Patch Changes

- [#134](https://github.com/geekmidas/toolbox/pull/134) [`c0279b9`](https://github.com/geekmidas/toolbox/commit/c0279b98545445b1eceedc314d92d0fbd91953e3) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: `fromManifest`'s overrides are typed from the manifest

  The overrides were `Record<string, Record<string, unknown>>`, so a misspelt id or a prop nothing reads went through without complaint, and a missing database `vpc` or mail `from` only showed up at synth, partway through a deploy. They are now `ManifestOverrides<typeof constructs, typeof backends>`:

  - **Keys:** only the manifest's own construct ids.
  - **Values:** what each construct's kind actually takes. Props the declaration already decides are left out, such as a database's `schema`, a queue's `fifo` or a site's `path`.
  - **Required:** what the synth won't guess. That means a database's `vpc` and mail's `from`. Some depend on the backend: ElastiCache needs `vpc`, and Resend or SMTP mail needs `url`.
  - **No key:** kinds with nothing to override, such as a database's reader or schema, a cache that lives in a database, functions and crons.

  `ComponentOverrides` is removed, and `overrides` is now a required argument (pass `{}` when there is nothing to say). A manifest typed only as `ConstructManifest` still accepts the untyped record. The synth-time checks stay for anything that isn't typed.

- Updated dependencies [[`1aa7b43`](https://github.com/geekmidas/toolbox/commit/1aa7b434e28ef24e4bdf057847b510fa9cfa1fcf)]:
  - @geekmidas/constructs@10.0.0-alpha.51
  - @geekmidas/manifest@10.0.0-alpha.51
  - @geekmidas/cache@10.0.0-alpha.51
  - @geekmidas/db@10.0.0-alpha.51
  - @geekmidas/envkit@10.0.0-alpha.51
  - @geekmidas/errors@10.0.0-alpha.51
  - @geekmidas/logger@10.0.0-alpha.51
  - @geekmidas/schema@10.0.0-alpha.51
  - @geekmidas/services@10.0.0-alpha.51
  - @geekmidas/telescope@10.0.0-alpha.51

## 10.0.0-alpha.50

### Minor Changes

- [#132](https://github.com/geekmidas/toolbox/pull/132) [`1e2a05c`](https://github.com/geekmidas/toolbox/commit/1e2a05caa63b9ef83ffab8f57c807b6975b5d517) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: `gkm dev` moves an app off a port another project holds, and refuses only when the holder is the same app

  An app's port was fixed (3000, 3001, …) and `gkm dev` refused to start if anything held one — so two projects that both default to 3000 could not run at once. Now the holder is asked who it is: every process gkm starts is tagged with `GKM_DEV_APP=<workspace>#<app>`, inherited by whatever binds the port, and read back from the holder (`lsof`, then `ps eww` / `/proc/<pid>/environ`).

  - **Held by this same app** — left by a previous `gkm dev` — it still refuses, naming the pid (`WorkspacePortsInUse`), since moving would start a second copy.
  - **Held by anything else** — untagged, another workspace's, or unreadable — the app moves to the next free port past its siblings', says so, and keeps it in `.gkm/app-ports.json`. The edge routes, every address an app or a phone is handed, and the ready lines follow it.

  `gkm exec` applies the same rule but never refuses, since the command may bind nothing. Deploys never read the file.

### Patch Changes

- [#130](https://github.com/geekmidas/toolbox/pull/130) [`2341496`](https://github.com/geekmidas/toolbox/commit/234149689cc3e47a8e8b6c706ef0e677adf6b88f) Thanks [@geekmidas](https://github.com/geekmidas)! - :loud_sound: `gkm dev` says what it is doing while it starts

  A first `gkm dev` pulled every image, waited on each health check and created every database with nothing on screen — minutes that read as a hang. It now names each step as it begins: reading `gkm.config.ts` and the constructs, starting the containers (with Docker's own progress shown — the pulls, each container created and turning healthy), creating the databases, roles, buckets and topics, checking or applying migrations, building each app, and starting the apps. A converged start says none of the reconcile steps, and `gkm test` and other background reconciles stay silent.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.50
  - @geekmidas/constructs@10.0.0-alpha.50
  - @geekmidas/db@10.0.0-alpha.50
  - @geekmidas/envkit@10.0.0-alpha.50
  - @geekmidas/errors@10.0.0-alpha.50
  - @geekmidas/logger@10.0.0-alpha.50
  - @geekmidas/manifest@10.0.0-alpha.50
  - @geekmidas/schema@10.0.0-alpha.50
  - @geekmidas/services@10.0.0-alpha.50
  - @geekmidas/telescope@10.0.0-alpha.50

## 10.0.0-alpha.49

### Minor Changes

- [#129](https://github.com/geekmidas/toolbox/pull/129) [`a13c3b7`](https://github.com/geekmidas/toolbox/commit/a13c3b730156be2aeb896fc9646260cff9eb9d16) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: Each API's typed client is the application's: written to the root's `.gkm/client/<surface>.ts`, imported as `@<name>/client/<surface>`

  A root `gkm build` builds every backend from the workspace root, so a client written relative to the working directory landed at the root — where the `@<name>/api/client` export, pointing into `apps/api/.gkm/openapi/`, could not find it, and a Next.js site failed to build. The location was right and the reference was wrong: like the manifest, the client belongs to the application, so it is always written at the root — by `gkm build`, `gkm dev` and `gkm openapi` alike, whichever directory they run in — under `.gkm/client/` rather than `.gkm/openapi/`.

  `gkm init` maps `@<name>/client/*` in the root tsconfig and in each frontend's own (an app's `paths` replaces the root's), and the templates import `@<name>/client/api`. What the client imports — `@geekmidas/client`, React Query and React — is installed at the root, where the client resolves it from, rather than in the api package, which no longer has a `./client` export (nor the frontends a dependency on it). The root's React is the workspace's: every frontend that imports a client runs that one, or its hooks see two.

  An existing project: replace `@<name>/api/client` with `@<name>/client/api`, map `"@<name>/client/*": ["../../.gkm/client/*"]` in each frontend's tsconfig, and add `@geekmidas/client` and `@tanstack/react-query` to the root package.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.49
  - @geekmidas/constructs@10.0.0-alpha.49
  - @geekmidas/db@10.0.0-alpha.49
  - @geekmidas/envkit@10.0.0-alpha.49
  - @geekmidas/errors@10.0.0-alpha.49
  - @geekmidas/logger@10.0.0-alpha.49
  - @geekmidas/manifest@10.0.0-alpha.49
  - @geekmidas/schema@10.0.0-alpha.49
  - @geekmidas/services@10.0.0-alpha.49
  - @geekmidas/telescope@10.0.0-alpha.49

## 10.0.0-alpha.48

### Patch Changes

- [#127](https://github.com/geekmidas/toolbox/pull/127) [`126400d`](https://github.com/geekmidas/toolbox/commit/126400de20096150da2bd5001461c9bc54e54545) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm dev` compiles a construct's `.tsx` with its own tsconfig's JSX settings

  `gkm dev` runs each app with tsx from the app's directory, and tsx applies that
  tsconfig only to the files its `include` covers. An email template in the
  workspace's `constructs/` was outside it, so tsx compiled it with esbuild's
  defaults — the classic runtime — and a template that, under the root
  tsconfig's `"jsx": "react-jsx"`, imports no React threw `React is not defined`
  at render. `gkm test` compiles it with the root tsconfig, where it rendered.

  A hook now sits between tsx and each `.tsx`/`.jsx` file and appends the JSX
  settings of the tsconfig that owns it — the nearest one above it, as Vitest
  chooses — as esbuild pragmas, so each file is compiled the way its own tsconfig
  says, under `gkm dev` and `gkm test` alike. It is installed by `bin/gkm.mjs`
  and by every process that runs app code through tsx (`gkm dev`'s app and server
  processes, the env sniffer). Pointing tsx at the root tsconfig instead would
  have broken an app that sets its own `jsx` or `jsxImportSource`, for the same
  reason one tsconfig per process was wrong for path aliases. A file with its own
  JSX pragma, or whose tsconfig sets `preserve`, is left as it is.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.48
  - @geekmidas/constructs@10.0.0-alpha.48
  - @geekmidas/db@10.0.0-alpha.48
  - @geekmidas/envkit@10.0.0-alpha.48
  - @geekmidas/errors@10.0.0-alpha.48
  - @geekmidas/logger@10.0.0-alpha.48
  - @geekmidas/manifest@10.0.0-alpha.48
  - @geekmidas/schema@10.0.0-alpha.48
  - @geekmidas/services@10.0.0-alpha.48
  - @geekmidas/telescope@10.0.0-alpha.48

## 10.0.0-alpha.47

### Minor Changes

- [#124](https://github.com/geekmidas/toolbox/pull/124) [`10ef53d`](https://github.com/geekmidas/toolbox/commit/10ef53d921d519afa62c773a6682581e19c06b1e) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: `Encryption` — a key that encrypts what the application stores

  `new Encryption('Pii')` gives a handler that `.dependsOn([pii])` `services.pii.encrypt`, `decrypt`, `index` (a blind index, so an encrypted column can still be looked up) and `reencrypt`. The app names no cipher: the construct provides one `PII_URL` whose scheme picks the backend.

  - **Locally and in tests**, an `aes256gcm://` keyring derived from the project and stage, like a secret — nothing to set.
  - **On a server stage**, a keyring generated into the stage's secrets on its first deploy and never replaced by a redeploy.
  - **On AWS**, envelope encryption under a KMS key that rotates yearly, and a KMS HMAC key for the index, each granted to exactly the functions that depend on the construct (`kms:GenerateDataKey`/`kms:Decrypt`, `kms:GenerateMac`). `@aws-sdk/client-kms` is an optional peer, loaded only for a `kms://` URL.

  Every ciphertext names the key that wrote it and is bound to its construct. `gkm encryption:rotate <Id> --stage <stage>` adds a key and keeps the old ones; after a `reencrypt` sweep, `gkm encryption:retire <Id> <key> --stage <stage>` removes one, and a value still under an old key warns the first time it is decrypted. The index key never rotates.

### Patch Changes

- [#126](https://github.com/geekmidas/toolbox/pull/126) [`f1fc3e7`](https://github.com/geekmidas/toolbox/commit/f1fc3e7e9a8fdc995e3a4b957e29ce451f6fd959) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: `gkm dev` says where every service is, and an app can open Mailpit's inbox

  - **`gkm dev` lists every published port on every start**, labelled — `postgres`, `smtp`, `mailpit inbox`, `minio console`, … — with the pages as `http://` links. It used to print only on the start that changed a container, and only each container's primary port, so Mailpit's inbox was never shown at all. `gkm setup` lists the same when it converges.
  - **An `Email`'s inbox is a public role.** A `MobileApp` or `StaticSite` that `.dependsOn([mailer])` is built with `EXPO_PUBLIC_MAILER_INBOX_URL` (`VITE_`/`NEXT_PUBLIC_`) on a local stage — Mailpit's web inbox, so an "Open email app" button can open a sign-in link from the app. Deployed mail has no inbox and nothing sets it; the SMTP URL, which carries credentials, is never public. Closes #125.

- Updated dependencies [[`f1fc3e7`](https://github.com/geekmidas/toolbox/commit/f1fc3e7e9a8fdc995e3a4b957e29ce451f6fd959), [`10ef53d`](https://github.com/geekmidas/toolbox/commit/10ef53d921d519afa62c773a6682581e19c06b1e)]:
  - @geekmidas/manifest@10.0.0-alpha.47
  - @geekmidas/constructs@10.0.0-alpha.47
  - @geekmidas/envkit@10.0.0-alpha.47
  - @geekmidas/cache@10.0.0-alpha.47
  - @geekmidas/db@10.0.0-alpha.47
  - @geekmidas/errors@10.0.0-alpha.47
  - @geekmidas/logger@10.0.0-alpha.47
  - @geekmidas/schema@10.0.0-alpha.47
  - @geekmidas/services@10.0.0-alpha.47
  - @geekmidas/telescope@10.0.0-alpha.47

## 10.0.0-alpha.46

### Minor Changes

- [#122](https://github.com/geekmidas/toolbox/pull/122) [`31585c5`](https://github.com/geekmidas/toolbox/commit/31585c55f294520ce77483c653c543a835133d6e) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: `gkm build` builds for where the project deploys; the legacy providers are gone, and an SST deploy mounts its routes
  - **No legacy providers.** `aws-apigatewayv1`, `aws-apigatewayv2` and `aws-lambda` are gone, along with `--providers` and the `providers` block in `gkm.config.ts` (`providers.server.port`/`production`/`enableOpenApi` and `providers.dokploy` included). A bare `gkm build` follows `deploy.default`; `--provider aws|server` remains only as an override, which is what a Dockerfile's `gkm build --provider server` is.
  - 🐛 **`sst` is a deploy target.** `deploy: { default: 'sst' }` builds one Lambda per construct and resolves the AWS backends (cache, storage, events) everywhere, `gkm dev` included. Without it an SST project was normalised into a Dokploy one. `gkm init --deploy sst` writes it, and its deploy scripts are `gkm build && sst deploy --stage <stage>`.
  - **One manifest, the application's, written by the root.** A root `gkm build` builds every backend app in its own process, then writes one `.gkm/manifest/aws.ts` (or `server.ts`) from everything the workspace declares, with each app's routes folded into its own surface; turbo builds only the frontends. An app's own `gkm build` writes its handlers (`<app>/.gkm/aws/{routes,functions,crons,queues,subscribers}`) and no manifest. Handler paths are measured from the root, where `sst.config.ts` runs. A build clears what it superseded: the per-provider trees, an app-level manifest, and the other target's manifest. `gkm init` maps `@<name>/manifest` to it in the root tsconfig, and no longer exports a `./endpoints` the AWS build never writes.
  - **The manifest is the declarations, and nothing else.** `.gkm/manifest/<target>.ts` exports `constructs` and `backends`; the `export const manifest = { routes, functions, crons, … }` table and its derived types (`Route`, `Cron`, `RoutePartition`, …) are gone, as are partitioned manifests and the `{ paths, partition }` form of `constructs`, which only shaped them — `constructs` is a glob or a list of globs. Every endpoint is on its surface on both targets — its own Lambda on AWS, the app's entry on a server — functions and crons are declarations of their own, and a queue's worker and a topic's subscribers sit inside them. `@geekmidas/manifest` drops `Manifest`, `ManifestField` and `flattenManifestField`; `@geekmidas/cli/reconcile` drops `writeManifestModule` and `MANIFEST_PATH`.
  - 🔥 **`fromManifest` deploys functions and crons.** Each is a Lambda linked to its own edges, in the database's VPC when it reaches one; a function gets an IAM-authorized URL, a cron its schedule. `Api.fromManifest`, `Function.fromManifest` and `Cron.fromManifest`, which read the deleted table, are removed.
  - **`fromManifest` mounts each surface's endpoints.** An API Gateway used to deploy with no routes. Each endpoint is now its own Lambda, linked only to what it depends on, in the database's VPC when it reaches one (queue consumers too). `iam` is enforced by the gateway; every other authorizer runs in the handler.
  - **A `--production` server runs its background work.** Queues, crons and subscribers are wired into the production entry. They used to be left out unless `providers.server.production.subscribers` said `'include'`, so a Docker deploy never ran its worker.
  - **`gkm deploy:init` writes nothing into `gkm.config.ts`.** The `providers.dokploy` block it wrote was never read; the ids are rediscovered by name and kept in the state file.

### Patch Changes

- Updated dependencies [[`31585c5`](https://github.com/geekmidas/toolbox/commit/31585c55f294520ce77483c653c543a835133d6e)]:
  - @geekmidas/manifest@10.0.0-alpha.46
  - @geekmidas/cache@10.0.0-alpha.46
  - @geekmidas/constructs@10.0.0-alpha.46
  - @geekmidas/db@10.0.0-alpha.46
  - @geekmidas/envkit@10.0.0-alpha.46
  - @geekmidas/errors@10.0.0-alpha.46
  - @geekmidas/logger@10.0.0-alpha.46
  - @geekmidas/schema@10.0.0-alpha.46
  - @geekmidas/services@10.0.0-alpha.46
  - @geekmidas/telescope@10.0.0-alpha.46

## 10.0.0-alpha.45

### Patch Changes

- Updated dependencies [[`8dbf325`](https://github.com/geekmidas/toolbox/commit/8dbf325495de962ea5889459b31e2700dc4d6726)]:
  - @geekmidas/constructs@10.0.0-alpha.45
  - @geekmidas/cache@10.0.0-alpha.45
  - @geekmidas/db@10.0.0-alpha.45
  - @geekmidas/envkit@10.0.0-alpha.45
  - @geekmidas/errors@10.0.0-alpha.45
  - @geekmidas/logger@10.0.0-alpha.45
  - @geekmidas/manifest@10.0.0-alpha.45
  - @geekmidas/schema@10.0.0-alpha.45
  - @geekmidas/services@10.0.0-alpha.45
  - @geekmidas/telescope@10.0.0-alpha.45

## 10.0.0-alpha.44

### Patch Changes

- [#120](https://github.com/geekmidas/toolbox/pull/120) [`067b7a9`](https://github.com/geekmidas/toolbox/commit/067b7a9b3ede9e2de4f52b9d4fdf5af008abc269) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: `featureTest`: a `services` fixture — assert through the client a handler gets, with the fake behind it hidden (#119)

  `await services.get('shipping')` returns what a handler depending on that construct is handed, resolved the way the test's endpoints resolve it: an external API's client aimed at whatever the test stage resolved (its fake, which the test never sees), a topic or queue as its recorder, a database as the test's transaction. The generated harness types it per service name (`ClientOf<typeof shipping>`); a name the app does not declare is a type error, and `UnknownService` at runtime.

  A test asserts on an external API through the provider's own contract — the fake implements the provider's read endpoints too — so the same assertion holds against the provider's sandbox. Fakes stay hidden: tests no longer import a fake's module to read its state.

  The delivery errors from #115 (`DeliveryFailed`, `MessageRejected`, `DeliveryDidNotSettle`) are now exported from `@geekmidas/constructs/testing`.

- Updated dependencies [[`067b7a9`](https://github.com/geekmidas/toolbox/commit/067b7a9b3ede9e2de4f52b9d4fdf5af008abc269)]:
  - @geekmidas/constructs@10.0.0-alpha.44
  - @geekmidas/cache@10.0.0-alpha.44
  - @geekmidas/db@10.0.0-alpha.44
  - @geekmidas/envkit@10.0.0-alpha.44
  - @geekmidas/errors@10.0.0-alpha.44
  - @geekmidas/logger@10.0.0-alpha.44
  - @geekmidas/manifest@10.0.0-alpha.44
  - @geekmidas/schema@10.0.0-alpha.44
  - @geekmidas/services@10.0.0-alpha.44
  - @geekmidas/telescope@10.0.0-alpha.44

## 10.0.0-alpha.43

### Patch Changes

- 🐛 [#118](https://github.com/geekmidas/toolbox/pull/118) [`5aa1b52`](https://github.com/geekmidas/toolbox/commit/5aa1b52be04d6479d77c06da227e5700c00877be) Thanks [@geekmidas](https://github.com/geekmidas)! - :bug: `gkm test` reliability: subscribers load in the harness, a dropped test database is recreated, and no two services share a port

  - The generated harness imports every topic subscriber module itself. Delivery loads subscribers, and left to Node's own `import()` one importing a tsconfig alias (`~/…`) failed every test file that delivered.
  - Reconcile's fast path checks the plan's Postgres databases still exist. Every checkout shares one Postgres, so another checkout's test teardown could drop `<name>_test` while this one's recorded state still claimed it — and the suite started with no database.
  - Saved and observed ports are merged without collisions (`keptPorts`). An observed port overrode its own key but left a different saved key on the same number, so two services shared a port — Mailpit's inbox answered by an external API's fake.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.43
  - @geekmidas/constructs@10.0.0-alpha.43
  - @geekmidas/db@10.0.0-alpha.43
  - @geekmidas/envkit@10.0.0-alpha.43
  - @geekmidas/errors@10.0.0-alpha.43
  - @geekmidas/logger@10.0.0-alpha.43
  - @geekmidas/manifest@10.0.0-alpha.43
  - @geekmidas/schema@10.0.0-alpha.43
  - @geekmidas/services@10.0.0-alpha.43
  - @geekmidas/telescope@10.0.0-alpha.43

## 10.0.0-alpha.42

### Patch Changes

- [#116](https://github.com/geekmidas/toolbox/pull/116) [`9917e96`](https://github.com/geekmidas/toolbox/commit/9917e9608582a11170d289f14476c5ed72d18d3b) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: `featureTest` delivers what a test publishes to its consumers, end to end without a broker (#115)

  Once each request a test makes has answered, what it published reaches the consumers that would receive it deployed: a queue's messages its one consumer, a topic's events every subscriber that named them, and only those. Each payload is checked against the consumer's schema first (`MessageRejected`); consumers run in the test's transaction, so they see the endpoint's rows and their writes roll back; what they publish is delivered in turn until nothing is left (`DeliveryDidNotSettle`); and a consumer that throws fails the test (`DeliveryFailed`). `published(...)` still records, and `queue(q).invoke()` / `subscriber(s).invoke()` deliver what they publish too.

  `gkm test` now records each topic subscriber in the test manifest (`subscribers`).

- [#117](https://github.com/geekmidas/toolbox/pull/117) [`9d96389`](https://github.com/geekmidas/toolbox/commit/9d9638977a5b24dd64bb8135d6bcdc1ed182b594) Thanks [@geekmidas](https://github.com/geekmidas)! - `worker.database(db)` is now the default database for everything built from the worker: crons, queues, subscribers and functions receive it as `db`, typed from the construct, and it still names where a server keeps cron schedules. `.database(other)` on a cron, queue or subscriber overrides it — retyping `db` and replacing the manifest edge rather than adding to it. Queues and subscribers gain `.database()`, carry `databaseService`, and contribute the database's env; the Lambda, test and generated server runtimes (`queues.ts`, `subscribers.ts`, SNS push) pass `db` to their handlers.

- Updated dependencies [[`9917e96`](https://github.com/geekmidas/toolbox/commit/9917e9608582a11170d289f14476c5ed72d18d3b), [`9d96389`](https://github.com/geekmidas/toolbox/commit/9d9638977a5b24dd64bb8135d6bcdc1ed182b594)]:
  - @geekmidas/constructs@10.0.0-alpha.42
  - @geekmidas/cache@10.0.0-alpha.42
  - @geekmidas/db@10.0.0-alpha.42
  - @geekmidas/envkit@10.0.0-alpha.42
  - @geekmidas/errors@10.0.0-alpha.42
  - @geekmidas/logger@10.0.0-alpha.42
  - @geekmidas/manifest@10.0.0-alpha.42
  - @geekmidas/schema@10.0.0-alpha.42
  - @geekmidas/services@10.0.0-alpha.42
  - @geekmidas/telescope@10.0.0-alpha.42

## 10.0.0-alpha.41

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.41
  - @geekmidas/constructs@10.0.0-alpha.41
  - @geekmidas/db@10.0.0-alpha.41
  - @geekmidas/envkit@10.0.0-alpha.41
  - @geekmidas/errors@10.0.0-alpha.41
  - @geekmidas/logger@10.0.0-alpha.41
  - @geekmidas/manifest@10.0.0-alpha.41
  - @geekmidas/schema@10.0.0-alpha.41
  - @geekmidas/services@10.0.0-alpha.41
  - @geekmidas/telescope@10.0.0-alpha.41

## 10.0.0-alpha.40

### Minor Changes

- [#113](https://github.com/geekmidas/toolbox/pull/113) [`e8d29dd`](https://github.com/geekmidas/toolbox/commit/e8d29dd29084e59b40a3b5bd1a2806c3b9c93f6d) Thanks [@geekmidas](https://github.com/geekmidas)! - :sparkles: Topic subscribers on SNS are pushed to over HTTP; each consumer reaches its own topic or queue; topics fan out on pg-boss (#112)
  - ⬆️ **SNS push.** On SNS a topic subscriber is no longer polled. The server mounts `POST /__gkm/subscribers/<name>` and, once listening, subscribes it to the topic with a filter policy of the events the subscriber names, so SNS fans out to each subscriber. Confirmations are handled, signatures verified (skipped only against an emulator), and startup converges: a stuck-pending subscription is replaced and a changed event list updates the filter. The route runs the subscriber through the same adaptor as Lambda. `GKM_SUBSCRIBER_PUSH_URL` is where SNS pushes; locally it defaults to `host.docker.internal`.
  - **`@geekmidas/events/sns`**: `verifySnsMessage`, `confirmSnsSubscription`, `subscribeHttpEndpoint`, `toSnsEvent`. **`@geekmidas/constructs/aws`**: `SnsPushSubscriberAdaptor`.
  - 🔥 **Each consumer reaches what it consumes**, through that topic's or queue's own `<ID>_PUBLISHER_CONNECTION_STRING`. `EVENT_SUBSCRIBER_CONNECTION_STRING` is deleted: it was built from the first queue or topic in the plan, so every other consumer polled the wrong place. Crons schedule through `EVENT_PUBLISHER_CONNECTION_STRING`.
  - **pg-boss fans out.** A topic's message is published as `<topic>/<type>` and each subscriber drains a queue of its own, so every subscriber sees every message; replicas of one subscriber share it. Subscribers used to compete for one queue per event type, and two topics with an event of the same name shared it. `Publisher.fromConnectionString(url, { topic })`, `Subscriber.fromConnection(connection, { topic, subscription })`.
  - **Local SNS works.** On an AWS target `gkm dev` creates each topic and queue on the floci emulator and composes their addresses, instead of throwing `UnprovisionedEventsBackend`. The emulator's healthcheck no longer calls `curl`, which the image does not ship.
  - **`gkm dev --no-subscribers`** runs no topic subscribers. Fan-out is the default.
  - A queue consumer that fails now leaves its message for a retry instead of acknowledging it.

### Patch Changes

- Updated dependencies [[`e8d29dd`](https://github.com/geekmidas/toolbox/commit/e8d29dd29084e59b40a3b5bd1a2806c3b9c93f6d)]:
  - @geekmidas/constructs@10.0.0-alpha.40
  - @geekmidas/cache@10.0.0-alpha.40
  - @geekmidas/db@10.0.0-alpha.40
  - @geekmidas/envkit@10.0.0-alpha.40
  - @geekmidas/errors@10.0.0-alpha.40
  - @geekmidas/logger@10.0.0-alpha.40
  - @geekmidas/manifest@10.0.0-alpha.40
  - @geekmidas/schema@10.0.0-alpha.40
  - @geekmidas/services@10.0.0-alpha.40
  - @geekmidas/telescope@10.0.0-alpha.40

## 10.0.0-alpha.39

### Patch Changes

- [#111](https://github.com/geekmidas/toolbox/pull/111) [`087444c`](https://github.com/geekmidas/toolbox/commit/087444c16591656ab7d85b7713939982231cb1f2) Thanks [@geekmidas](https://github.com/geekmidas)! - :boom: Queues and topics are constructs, and events name their topic (#110)

  - A queue is built from a worker, `worker.queue('Emails').message(schema).handle(…)`: the queue and its one consumer, one construct. `q` and the public `QueueBuilder` export are gone. A producer depends on it, `.dependsOn([emails])`, and sends through `services.emails`.
  - ✨ A topic is `new Topic('Users', { events })`. `t` and `TopicBuilder` are gone.
  - 🔥 `.publisher(service)` is gone everywhere: from `RestApi`, endpoint, function, cron and subscriber builders, and `Worker`. A construct publishes with `.event(users, { type, payload, when? })`, repeatable across topics; each event goes through its own topic's publisher, and the topic lands in `services` exactly as `.dependsOn([users])` would put it. `Topic.publisher`, `Queue.publisher`, `derivedFrom` and `edgesWith` are deleted.
  - `TestEndpointAdaptor` / `TestFunctionAdaptor` / the MSW adaptor lose their `publisher` option: pass a recorder under the topic's name in `services`.
  - Discovery records what a worker-owned queue's consumer depends on under the worker.
  - SST: `fromManifest` subscribes each queue's consumer Lambda (`Queue.consume`), and skips `worker`, `cron` and `function` declarations instead of throwing `UnknownDeclarationKind`.

- Updated dependencies [[`087444c`](https://github.com/geekmidas/toolbox/commit/087444c16591656ab7d85b7713939982231cb1f2)]:
  - @geekmidas/constructs@10.0.0-alpha.39
  - @geekmidas/manifest@10.0.0-alpha.39
  - @geekmidas/cache@10.0.0-alpha.39
  - @geekmidas/db@10.0.0-alpha.39
  - @geekmidas/envkit@10.0.0-alpha.39
  - @geekmidas/errors@10.0.0-alpha.39
  - @geekmidas/logger@10.0.0-alpha.39
  - @geekmidas/schema@10.0.0-alpha.39
  - @geekmidas/services@10.0.0-alpha.39
  - @geekmidas/telescope@10.0.0-alpha.39

## 10.0.0-alpha.38

### Patch Changes

- [#107](https://github.com/geekmidas/toolbox/pull/107) [`5475a96`](https://github.com/geekmidas/toolbox/commit/5475a96d1d8ee0c99109c65cba76f7e269f42265) Thanks [@geekmidas](https://github.com/geekmidas)! - `ExternalApi` for third-party HTTP APIs, `<ID>_CREDENTIALS`, and `faker` and `signIn()` in feature tests

  - **`ExternalApi`** (`@geekmidas/constructs/external-api`) declares an API
    somebody else runs: a `url`, one string or one per stage name with a
    `default`, a `credentials` schema, and the `client` a handler is given. It
    provides `<ID>_URL` and `<ID>_CREDENTIALS` (kind `external-api`).
  - **Its fake lives at `test/fakes/<id>.ts`**, never in the construct, so it
    cannot reach a deployed bundle. The file default-exports
    `fake.app(handler, { credentials })` or
    `fake.image('stripe/stripe-mock', { port, credentials })`.
    - **Fakes are opt-in:** only `gkm test` and `gkm dev --fake` use them.
      Plain `gkm dev` calls the real API at its `url` for the local stage, with
      that stage's own credentials.
    - ✨ **Feature tests** serve an app fake in-process through MSW, and
      `gkm dev --fake` serves it on an allocated port.
    - **An image fake** runs as a container on an allocated host port.
    - **No fake:** an external API without one fails `gkm test` or
      `gkm dev --fake` with `NoFake`.
  - 🐛 **Deploying** resolves the URL for the stage (`NoUrlForStage` when it has
    none) and the credentials from the stage's secrets, on Dokploy and on AWS.
  - **`Credential` provides `<ID>_CREDENTIALS`**, renamed from `<ID>_CREDENTIAL`.
  - **AWS `Credential` links under `<ID>_CREDENTIALS`.** It reported SST's
    secret type, which resolves to the bare `<ID>`, so a function that declared
    `STRIPE_CREDENTIALS` was linked to nothing. It now has its own type
    (`gkm:aws:Credential`) and resolver, and holds the `sst.Secret` under the
    same name, so values already set with `sst secret set Stripe …` still apply.
  - 🐛 **Dokploy now resolves credentials.** A stage missing `<ID>_CREDENTIALS` for
    a `Credential` or an `ExternalApi` fails `gkm deploy` with
    `MissingSuppliedSecret`, naming the `gkm secrets:set` command. Before this,
    Dokploy never resolved a credential at all.
  - ✨ **Feature tests get `faker`**, testkit's faker seeded from the test's name.
    `browser.signIn()` with no address signs in as a new, unique user. testkit's
    `faker` regains `seed()`, which the spread had dropped.
  - **Every command reads and writes the stage's own secrets store.** `gkm
deploy`, `build`, `dev`, `test`, `exec`, `setup` and `secrets:*` resolve the
    store for the stage they act on: the file for the local stage, and
    `secrets.store` for a deployed one. A stage kept in SSM is set with
    `gkm secrets:set` and read by the deploy, with nothing pushed or pulled in
    between. `secrets:push` and `secrets:pull` are removed. `gkm setup` no
    longer offers to push, `deploy:github` no longer pushes, and the generated
    SST workflow has no pull step.
  - **`SecretsStore` is `{ name, read(stage), write(stage, secrets) }`.** The
    file store is `FileSecretsStore` (`name: 'file'`), and SSM is
    `AwsSecretsStore` (`name: 'ssm'`), renamed from `SsmSecretsStore`. The free
    functions `readStageSecrets`, `writeStageSecrets`, `setCustomSecret`,
    `secretsExist` and `getSecretsPath` are gone.
  - 🔒 **Security: Dokploy no longer derives secrets from repo facts.** An auth
    server's signing secret, and every Dokploy database and bucket password,
    were a SHA-256 of the project name, stage and construct id, all of which
    are in the repo. Now:
    - **Signing secrets** are random, generated on the stage's first deploy and
      kept in its secrets store.
    - **Derived passwords** are salted with a random per-stage seed kept in the
      same store.
    - **Role passwords** are set on every apply (`ALTER ROLE … PASSWORD`), so an
      existing database moves to the new passwords rather than locking the app
      out.
  - **An app is found by its configured path, never by a `package.json`
    name.**
    - **`gkm dev`, `test` and `exec`** run the app whose `path` in
      `gkm.config.ts` holds the current directory, and anywhere else `gkm dev`
      hands the workspace to turbo. A folder no app lives in fails with
      `NotInAnApp`.
    - **`gkm docker`** names its default image after the config's `name`.
    - 🔥 **Removed:** `getAppNameFromCwd` and `getAppNameFromPackageJson`.

  **Moving an existing app:**

  - Rename every `<ID>_CREDENTIAL` secret to `<ID>_CREDENTIALS` and set it on
    each deployed stage: `gkm secrets:set STRIPE_CREDENTIALS '{…}' --stage production`.
  - A custom `secrets.store` provider renames `pull` to `read` and `push` to
    `write`, and adds a `name`.
  - A deployed stage whose secrets were only in this machine's file: set
    `secrets.store`, then write its values to the store with
    `gkm secrets:import --stage <stage> --file …` or `gkm secrets:set`.
  - An existing Dokploy stage's next deploy generates its seed and signing
    secret: live sessions end once, the database roles take their new passwords,
    and a bucket's root user is reset.

- Updated dependencies [[`5475a96`](https://github.com/geekmidas/toolbox/commit/5475a96d1d8ee0c99109c65cba76f7e269f42265)]:
  - @geekmidas/manifest@10.0.0-alpha.38
  - @geekmidas/constructs@10.0.0-alpha.38
  - @geekmidas/envkit@10.0.0-alpha.38
  - @geekmidas/cache@10.0.0-alpha.38
  - @geekmidas/db@10.0.0-alpha.38
  - @geekmidas/errors@10.0.0-alpha.38
  - @geekmidas/logger@10.0.0-alpha.38
  - @geekmidas/schema@10.0.0-alpha.38
  - @geekmidas/services@10.0.0-alpha.38
  - @geekmidas/telescope@10.0.0-alpha.38

## 10.0.0-alpha.37

### Patch Changes

- [#105](https://github.com/geekmidas/toolbox/pull/105) [`b28b095`](https://github.com/geekmidas/toolbox/commit/b28b09555fe463cdd3164f00214177b800382d75) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm test` drops the test stage's databases when the suite ends

  The Vitest global setup (`@geekmidas/cli/vitest`) now returns a teardown that
  runs `gkm test --teardown` once, when the suite ends (in watch mode, when the
  watcher exits). The teardown drops the test databases the setup created and
  forgets the test stage's reconcile state. The next run then creates, migrates
  and seeds them from nothing, so an edited migration is applied again instead of
  being skipped because it already ran.

  - **What gets dropped:** setup records the databases it provisioned, and the
    Postgres port, in `.gkm/test-ready.json`. Only those are dropped, and any name
    without the `_test` suffix is refused (`NotATestDatabase`), because the
    container is shared with the local stage.
  - **Open connections:** the drop uses `WITH (FORCE)`, so a connection the suite
    left open doesn't keep the database alive.
  - **A killed run:** a run killed before its teardown leaves its record behind,
    and the next `gkm test` drops those databases before reconciling.
  - **Buckets** in the test stage are not touched.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.37
  - @geekmidas/constructs@10.0.0-alpha.37
  - @geekmidas/db@10.0.0-alpha.37
  - @geekmidas/envkit@10.0.0-alpha.37
  - @geekmidas/errors@10.0.0-alpha.37
  - @geekmidas/logger@10.0.0-alpha.37
  - @geekmidas/manifest@10.0.0-alpha.37
  - @geekmidas/schema@10.0.0-alpha.37
  - @geekmidas/services@10.0.0-alpha.37
  - @geekmidas/telescope@10.0.0-alpha.37

## 10.0.0-alpha.36

### Patch Changes

- ✨ [#103](https://github.com/geekmidas/toolbox/pull/103) [`95cef66`](https://github.com/geekmidas/toolbox/commit/95cef66e07893be917b5d560a06618c60504b94e) Thanks [@geekmidas](https://github.com/geekmidas)! - `MobileApp`: one scheme for every stage, and the app adds `expo()` itself

  - **One scheme.** A mobile app's scheme is the project's name (`shop`), or the
    one its construct gives, on every stage: local, test and deployed. It was
    suffixed locally (`shop-dev`). `appScheme` is gone from `@geekmidas/manifest`,
    and `schemeBase` is the scheme.
  - **`@geekmidas/constructs` no longer depends on `@better-auth/expo`.** The
    auth construct imported it as an optional peer, and pnpm gives
    `@geekmidas/constructs` a separate copy for every workspace package that
    resolves that peer differently. A construct from one copy is not an instance
    of the other, so the test harness found none of an app's databases and every
    feature test failed with `UnknownFactory`.
  - ✨ **The app adds `expo()` to its auth server's plugins.** When the graph says a
    mobile app calls the auth server (a scheme among its derived trusted
    origins) and the plugin is missing, the server refuses to start with
    `ExpoPluginRequired`, naming the scheme. It finds the plugin by its `id`
    without importing the package. An origin the app trusts by hand is not
    checked. `gkm init` with Expo writes `expo()` into `constructs/auth.ts`.

  **Moving an existing app:**

  - ✨ add `import { expo } from '@better-auth/expo'` and `options: { plugins: [expo()] }`
    to the auth construct;
  - 🐛 install `@better-auth/expo` where that file resolves its imports;
  - rebuild the app with the scheme without its stage suffix.

- Updated dependencies [[`95cef66`](https://github.com/geekmidas/toolbox/commit/95cef66e07893be917b5d560a06618c60504b94e)]:
  - @geekmidas/manifest@10.0.0-alpha.36
  - @geekmidas/constructs@10.0.0-alpha.36
  - @geekmidas/cache@10.0.0-alpha.36
  - @geekmidas/db@10.0.0-alpha.36
  - @geekmidas/envkit@10.0.0-alpha.36
  - @geekmidas/errors@10.0.0-alpha.36
  - @geekmidas/logger@10.0.0-alpha.36
  - @geekmidas/schema@10.0.0-alpha.36
  - @geekmidas/services@10.0.0-alpha.36
  - @geekmidas/telescope@10.0.0-alpha.36

## 10.0.0-alpha.35

### Patch Changes

- [#102](https://github.com/geekmidas/toolbox/pull/102) [`78d87ac`](https://github.com/geekmidas/toolbox/commit/78d87ace5e9a6027c8bba74e0bb40260431f7912) Thanks [@geekmidas](https://github.com/geekmidas)! - `MobileApp`: an Expo app declared as a construct

  ```ts
  // constructs/app.ts
  export const app = new MobileApp("App", { path: "apps/app" }).dependsOn([
    api,
    auth,
  ]);
  ```

  Like a `StaticSite`, its `.dependsOn()` is the single fact everything a mobile
  app otherwise writes down by hand is derived from:

  - **Shaped like `StaticSite`:** `path`, `port?`, `config?` and
    `variant?` (`'expo'`), plus `scheme?`. A mobile app is given a port in the
    same stable order, and `gkm exec` hands it to Expo as `RCT_METRO_PORT`.
  - **A scheme per stage:** the project's name deployed (`shop`), suffixed
    locally (`shop-dev`), so a development build and the store build on one
    phone never answer each other's links. It arrives as `APP_SCHEME`.
  - **URLs a phone can reach:** `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_AUTH_URL`.
    Locally they're each server's own port, which the app points at the LAN
    address Metro served it from on a phone, or `10.0.2.2` on the Android
    emulator, instead of an edge hostname that only resolves on this machine.
  - **Trusted origins:** the scheme, in every surface it depends on. Locally that
    also covers the `exp://` origins Expo Go sends from, for this machine's exact
    LAN address and `localhost` on Metro's port, never a subnet.
  - ✨ **Better Auth's Expo plugin:** `BetterAuth` adds `expo()` itself when a
    mobile app depends on it. `@better-auth/expo` is an optional peer, and
    `ExpoPluginMissing` says to install it.
  - **Sign-in links a phone can open:** locally, a magic link the app asked for
    (its `callbackURL` is the scheme) is built on the auth server's LAN address,
    `AUTH_DEVICE_URL`. A browser's link is left alone.
  - **Signing in from the emailed link:** the server's Expo plugin carries the
    session back into the app as `?cookie=` (tested for the dev build's scheme
    and Expo Go). The scaffold's `useSessionFromLink()` stores it, merged with
    the client's `getSetCookie`, since the Expo client only does this for social
    sign-in.
  - **Deployed:** Dokploy and AWS trust the bare scheme. Neither builds the app;
    EAS and the stores do.

  `gkm init` with Expo scaffolds on Expo SDK 57 (React Native 0.86, with
  `react-native-worklets` for Reanimated 4), declares the app in
  `constructs/app.ts` and installs
  `@better-auth/expo` at the root. Its `app.config.ts` parses `APP_SCHEME` and
  both URLs into `extra.config`, which `config.ts` reads at runtime. `eas.json`
  no longer hard-codes local URLs. `gkm dev` lists the app with its scheme and
  the address devices reach.

  `@geekmidas/manifest` adds the `mobile-app` declaration kind, and
  `schemeBase`, `appScheme`, `mobileOrigins` and `isWebOrigin` for the rules all
  three targets share.

  See `docs/design/mobile-app.md`.

- [#100](https://github.com/geekmidas/toolbox/pull/100) [`4445c15`](https://github.com/geekmidas/toolbox/commit/4445c15c113a51ba3872d46375c00aa31bc3bd50) Thanks [@geekmidas](https://github.com/geekmidas)! - Reconcile provisions again when the role DDL changes

  Reconcile skips provisioning when its hash matches the last run's and the
  containers are healthy. That hash covered the plan, the compose file and the
  Caddyfile, but not the Postgres statements provisioning runs. So a toolbox
  upgrade that changed only the role DDL looked converged, and an existing local
  database never received the change. The last one was the owner's
  `CREATE ON DATABASE` grant from the previous release.

  The hash now includes those statements, so the first `gkm dev`, `gkm test` or
  `gkm migrate` after such an upgrade provisions again. The statements are
  idempotent, so this re-run is safe.

- Updated dependencies [[`78d87ac`](https://github.com/geekmidas/toolbox/commit/78d87ace5e9a6027c8bba74e0bb40260431f7912)]:
  - @geekmidas/manifest@10.0.0-alpha.35
  - @geekmidas/constructs@10.0.0-alpha.35
  - @geekmidas/cache@10.0.0-alpha.35
  - @geekmidas/db@10.0.0-alpha.35
  - @geekmidas/envkit@10.0.0-alpha.35
  - @geekmidas/errors@10.0.0-alpha.35
  - @geekmidas/logger@10.0.0-alpha.35
  - @geekmidas/schema@10.0.0-alpha.35
  - @geekmidas/services@10.0.0-alpha.35
  - @geekmidas/telescope@10.0.0-alpha.35

## 10.0.0-alpha.34

### Patch Changes

- [#98](https://github.com/geekmidas/toolbox/pull/98) [`8297710`](https://github.com/geekmidas/toolbox/commit/8297710a8e8c0e055fbc9b9ef14039c6f3a33a1e) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm init` installs what the root test factory imports, at the root

  A monorepo's `test/factories/database.ts` sits at the workspace root. It
  resolves its imports from the root `node_modules`, but testkit and faker were
  only installed for the API app, so a freshly scaffolded monorepo's tests failed
  with `Cannot find package '@geekmidas/testkit'`.

  - ✨ **Root dependencies:** with a database, the root `package.json` now adds
    `@geekmidas/testkit` and `@faker-js/faker`, plus `kysely` in an API
    monorepo, whose root installs nothing for constructs.
  - **The factory's import:** an API monorepo's factory imports the database
    construct from the app (`../../apps/api/src/constructs/database.ts`). Its root
    has no `@<name>/constructs` alias; only a fullstack workspace maps one.

  **Existing monorepo:** add `@geekmidas/testkit` and `@faker-js/faker` to the
  root `devDependencies`.

- [#99](https://github.com/geekmidas/toolbox/pull/99) [`1e71b33`](https://github.com/geekmidas/toolbox/commit/1e71b33cf55a6eff0f458b3b8e80ab98d1058acc) Thanks [@geekmidas](https://github.com/geekmidas)! - A database's owner role can create trusted extensions

  A migration running `create extension if not exists citext` failed with
  `permission denied to create extension "citext"`. The extension is trusted, so
  a role without superuser may create it, but Postgres also requires `CREATE` on
  the database itself. Each construct's owner role (the one migrations run as)
  was confined to its own schema, and nothing granted that.

  `roleStatements` now takes `database` for a database construct's roles and
  adds `GRANT CREATE ON DATABASE <database> TO <owner>`. All three provisioners
  pass it for a database, and only for a database:

  - reconcile (`gkm dev`, `gkm test`, `gkm migrate`);
  - the Dokploy deploy;
  - the AWS bootstrap Lambda.

  A schema tenant's owner (`.schema('AuthDatabase')`) is unchanged and stays
  confined to its own schema. The app's runtime role is untouched.

  **Existing databases** get the grant on the next reconcile or deploy. The
  statement is idempotent.

- Updated dependencies [[`1e71b33`](https://github.com/geekmidas/toolbox/commit/1e71b33cf55a6eff0f458b3b8e80ab98d1058acc)]:
  - @geekmidas/db@10.0.0-alpha.34
  - @geekmidas/cache@10.0.0-alpha.34
  - @geekmidas/constructs@10.0.0-alpha.34
  - @geekmidas/envkit@10.0.0-alpha.34
  - @geekmidas/errors@10.0.0-alpha.34
  - @geekmidas/logger@10.0.0-alpha.34
  - @geekmidas/manifest@10.0.0-alpha.34
  - @geekmidas/schema@10.0.0-alpha.34
  - @geekmidas/services@10.0.0-alpha.34
  - @geekmidas/telescope@10.0.0-alpha.34

## 10.0.0-alpha.33

### Patch Changes

- [#97](https://github.com/geekmidas/toolbox/pull/97) [`e7178a8`](https://github.com/geekmidas/toolbox/commit/e7178a8d804b7f9ffbffd2df3f6974d8f65feeb5) Thanks [@geekmidas](https://github.com/geekmidas)! - Feature tests: `db.get`, `factories.get` and `browser.signIn`

  A feature test is handed the app's own databases by name, a factory for each,
  and a way to sign in, with nothing to import:

  ```ts
  it("lets a member join a tournament", async ({ browser, db, factories }) => {
    const factory = await factories.get("database");
    const tournament = await factory.insert("tournaments", {});

    const { user } = await browser.signIn("ada@example.com");
    await browser.api.post("/tournaments/{id}/join", {
      params: { id: tournament.id },
    });

    const app = await db.get("database");
    const members = await app
      .selectFrom("tournamentMembers")
      .selectAll()
      .execute();
    expect(members).toMatchObject([{ userId: user.id }]);
  });
  ```

  - **`db.get(name)`:** a database's transaction for this test, by service name
    and typed by its schema. It opens on first use by whatever reaches it first
    (the test, a factory or an endpoint), and they all share it.
  - **The app's own databases only:** a schema tenant an auth server owns is
    reached through that server, as the app reaches it, and a reader is the same
    database through a read-only role. Neither is handed to a test.
    `db.get('authDb')` throws `UnknownDatabase` and doesn't compile.
  - **`factories.get(name)`:** one per database, from
    `test/factories/<construct>.ts` at the project root (`database.ts` for
    `Database`), exporting `createFactory(db)`. It's built once on that
    database's transaction for the test, so endpoints see the rows and they're
    rolled back with everything else.
    - A file named after no database of the app's, the auth tenant included,
      throws `UnknownFactoryFile`.
    - A file without `createFactory` throws `FactoryHasNoCreate`.
    - ✅ `test: { factories: '…' }` in `gkm.config.ts` moves the folder.
  - **`browser.signIn(email)`:** generated when one auth server has the
    magic-link plugin and the app sends mail. It requests the link, reads it
    from the inbox (cleared first, so it's this request's), follows it, and
    returns the session the auth server reports. `SignInFailed` says which step
    failed.
  - **`gkm init`** scaffolds `test/factories/database.ts` at the project root, in
    both layouts.

  **Breaking:** `db` used to be one transaction, inferred from whichever database
  the endpoints named first, and opened before every test. Nothing is inferred
  now, and nothing opens before it's used. `featureTest({ database })` is gone.

  **Moving an existing project:**

  - move the factory to `test/factories/database.ts` at the root, keeping its
    `createFactory(db)` export;
  - replace `createFactory(db)` with `await factories.get('database')`;
  - replace `db.selectFrom(…)` with `(await db.get('database')).selectFrom(…)`;
  - replace a hand-written magic-link helper with `browser.signIn(email)`;
  - replace `FeatureContext<Browser, unknown>` with `FeatureContext<Browser>`.

- Updated dependencies [[`e7178a8`](https://github.com/geekmidas/toolbox/commit/e7178a8d804b7f9ffbffd2df3f6974d8f65feeb5)]:
  - @geekmidas/constructs@10.0.0-alpha.33
  - @geekmidas/cache@10.0.0-alpha.33
  - @geekmidas/db@10.0.0-alpha.33
  - @geekmidas/envkit@10.0.0-alpha.33
  - @geekmidas/errors@10.0.0-alpha.33
  - @geekmidas/logger@10.0.0-alpha.33
  - @geekmidas/manifest@10.0.0-alpha.33
  - @geekmidas/schema@10.0.0-alpha.33
  - @geekmidas/services@10.0.0-alpha.33
  - @geekmidas/telescope@10.0.0-alpha.33

## 10.0.0-alpha.32

### Patch Changes

- [#96](https://github.com/geekmidas/toolbox/pull/96) [`9b647d0`](https://github.com/geekmidas/toolbox/commit/9b647d09e28ba095178d33613ee4a9e91b8eb47d) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm seed`, `gkm dev --migrate`/`--seed`, and `db/<construct>/migrations/` + `seeds/`

  A database construct's folder now holds two folders, and nothing else:

  ```
  db/database/
    migrations/   # the schema's history, applied once each
    seeds/        # reference data the app needs, run on every pass
  ```

  **Moving an existing project:** move every file in `db/<construct>/` into
  `db/<construct>/migrations/`. History is recorded by name, not path, so nothing
  re-runs. A file left at the old level is refused with `MigrationsOutsideFolder`
  rather than silently never running, and any other folder beside the two with
  `UnknownDatabaseFolder`.

  - **Seeds are reference data:** a permission catalogue, roles and their grants,
    lookup tables. A `.ts` exporting `seed(db, { stage })`, or `.sql`, run in name order,
    each in its own transaction, as the construct's owner. There is no history:
    every seed runs every time, so a seed is an upsert and a changed one is
    applied by running it again. A failure rolls that seed back and throws
    `SeedFailed`; a script with no `seed` export throws `SeedHasNoSeed`.
  - **Seeds run on every stage, production included,** and each is handed the
    stage it is seeding, so one that belongs only somewhere decides for itself
    (`if (stage === 'production') return;`). `seedDatabases` and
    `migrateAndSeed` take the stage, so a deploy runs them the same way.
  - **Seeds always run after migrations.** `gkm seed [construct]` migrates, then
    seeds — for one construct, the database it lives in is migrated too.
    `gkm migrate` still only migrates.
  - **`gkm dev --migrate`** applies pending migrations before the apps start;
    **`gkm dev --seed`** migrates and seeds. Once, at startup, never on a save,
    and a failure stops `dev`. Without either, `dev` only reports what is pending.
  - ✅ **Tests migrate and seed:** `gkm test` and `@geekmidas/cli/vitest` do both,
    and a watch-mode rerun applies an edited seed.
  - `MigrationTarget` gains `migrations` and `seeds`; `databaseFolder()` and
    `seedFolder()` join `migrationFolder()`, which now names
    `db/<construct>/migrations`.
  - The scaffolded AGENTS.md says where reference data goes: a seed, written from
    the typed constant, never a migration.

- Updated dependencies [[`9b647d0`](https://github.com/geekmidas/toolbox/commit/9b647d09e28ba095178d33613ee4a9e91b8eb47d)]:
  - @geekmidas/manifest@10.0.0-alpha.32
  - @geekmidas/cache@10.0.0-alpha.32
  - @geekmidas/constructs@10.0.0-alpha.32
  - @geekmidas/db@10.0.0-alpha.32
  - @geekmidas/envkit@10.0.0-alpha.32
  - @geekmidas/errors@10.0.0-alpha.32
  - @geekmidas/logger@10.0.0-alpha.32
  - @geekmidas/schema@10.0.0-alpha.32
  - @geekmidas/services@10.0.0-alpha.32
  - @geekmidas/telescope@10.0.0-alpha.32

## 10.0.0-alpha.31

### Patch Changes

- [#94](https://github.com/geekmidas/toolbox/pull/94) [`48b3ab4`](https://github.com/geekmidas/toolbox/commit/48b3ab471c242b9fb63cf20b4220e15bf0580ee4) Thanks [@geekmidas](https://github.com/geekmidas)! - The scaffolded AGENTS.md sets database hygiene

  Migrations hold schema, never data. Data the code defines — a permission
  catalogue, system roles — lives in the code, once, typed and in a shared
  package every app imports; the database stores only what users create. A rule
  ("every user is a member") is logic, not a row; nothing needs seeding to run;
  a backfill is the one exception; and a test that only keeps two copies in step
  means one copy should go.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.31
  - @geekmidas/constructs@10.0.0-alpha.31
  - @geekmidas/db@10.0.0-alpha.31
  - @geekmidas/envkit@10.0.0-alpha.31
  - @geekmidas/errors@10.0.0-alpha.31
  - @geekmidas/logger@10.0.0-alpha.31
  - @geekmidas/manifest@10.0.0-alpha.31
  - @geekmidas/schema@10.0.0-alpha.31
  - @geekmidas/services@10.0.0-alpha.31
  - @geekmidas/telescope@10.0.0-alpha.31

## 10.0.0-alpha.30

### Patch Changes

- [#93](https://github.com/geekmidas/toolbox/pull/93) [`58eba5c`](https://github.com/geekmidas/toolbox/commit/58eba5cd5bc0e76565668bd9a48d836dd622ef98) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm migrate`, `gkm migration`, and a Vitest setup that migrates

  Every database construct — and every schema tenant — has its own migrations
  folder, named after it: `Database` is `db/database/`, `AuthDatabase` is
  `db/auth-database/`. Which constructs those are, in what order, from which
  folder, is `migrationTargets(manifest)` in `@geekmidas/manifest`, and nothing
  else decides it.

  - `gkm migrate [construct] [--stage test]` reconciles the stage (containers,
    roles, grants) and applies each folder as that construct's **owner** role —
    never the runtime one, never a fallback — parents before tenants. Each
    construct's history lives in its own schema. `.ts` files export `up`/`down`;
    `.sql` files run whole. Unordered migrations are allowed, so a branch merged
    late still applies. Deployed stages are refused: their deploy migrates them.
  - `gkm migration <construct> [name]` writes the next file, stamped
    `YYYYMMDDHHmmss` UTC: an empty `up`/`down` for a database, or — for a
    `BetterAuth` construct — the SQL its tenant is missing.
  - `globalSetup: ['@geekmidas/cli/vitest']` in the root Vitest config readies
    the test stage and migrates every construct before any test runs, however
    the suite starts: `gkm test`, plain `vitest`, an editor. `gkm test` does the
    same before starting Vitest; `gkm test --setup` does it and stops.
  - `gkm dev` reports pending migrations and applies none.
  - The scaffold writes its migration to `db/database/`, the root Vitest config
    carries the setup, and `kysely.config.ts`, `test/globalSetup.ts` and
    `kysely-ctl` are gone. AGENTS.md has a Migrations section.

- Updated dependencies [[`58eba5c`](https://github.com/geekmidas/toolbox/commit/58eba5cd5bc0e76565668bd9a48d836dd622ef98), [`58eba5c`](https://github.com/geekmidas/toolbox/commit/58eba5cd5bc0e76565668bd9a48d836dd622ef98)]:
  - @geekmidas/constructs@10.0.0-alpha.30
  - @geekmidas/manifest@10.0.0-alpha.30
  - @geekmidas/cache@10.0.0-alpha.30
  - @geekmidas/db@10.0.0-alpha.30
  - @geekmidas/envkit@10.0.0-alpha.30
  - @geekmidas/errors@10.0.0-alpha.30
  - @geekmidas/logger@10.0.0-alpha.30
  - @geekmidas/schema@10.0.0-alpha.30
  - @geekmidas/services@10.0.0-alpha.30
  - @geekmidas/telescope@10.0.0-alpha.30

## 10.0.0-alpha.29

### Patch Changes

- [#92](https://github.com/geekmidas/toolbox/pull/92) [`83fc04a`](https://github.com/geekmidas/toolbox/commit/83fc04a7c4889d39141783a5b0565d098ed68058) Thanks [@geekmidas](https://github.com/geekmidas)! - The scaffolded AGENTS.md sets standards for Kysely queries and relations

  A project with a database gets a "Writing queries and relations" section:
  camelCase in TypeScript through `CamelCasePlugin` (snake_case in Postgres and in
  migrations; `sql.ref` in raw fragments), `Generated`/`Selectable`/`Insertable`
  types, every `*_id` a foreign key with its `onDelete` written out (`restrict`
  by default, `cascade` for owned rows, `set null` for optional links) and an
  index, related rows nested in one query with `jsonArrayFrom`/`jsonObjectFrom`
  rather than a query per row, multi-table writes in `withTransaction`, and
  cursor pagination with `paginatedSearch`.

  The scaffold follows it: `constructs/database.ts` passes
  `plugins: [new CamelCasePlugin()]` to the construct — written out, the
  project's to keep or change — with a camelCase schema, and a single-app
  project's tests connect through the construct (`connection: database`) so they
  use the same plugins the app does.

- [#92](https://github.com/geekmidas/toolbox/pull/92) [`0bad964`](https://github.com/geekmidas/toolbox/commit/0bad9649b6316fbaf40e7fb5ea46c64de2509e72) Thanks [@geekmidas](https://github.com/geekmidas)! - The scaffold writes no hand-rolled services

  - A workspace API's `src/services/database.ts` (its own pool, its own snake_case
    copy of the schema) is gone. Its tests connect through the root database
    construct, and Studio builds its client from `database.clientConfig`.
  - A workspace API's `src/services/auth.ts` (fetching `AUTH_URL` by hand) is
    gone. The router's session comes from the auth construct the API already
    names: `router.session(async ({ auth }) => auth.getSession())`.
  - A worker's `src/events/` (a publisher service reading `RABBITMQ_URL`) is
    gone. It declares a topic in `src/constructs/topics.ts`, and its subscriber
    binds with `.topic(users)`.

- [#92](https://github.com/geekmidas/toolbox/pull/92) [`b0cfa80`](https://github.com/geekmidas/toolbox/commit/b0cfa801fc868acc03bd0be9a1fc61faa0c517ab) Thanks [@geekmidas](https://github.com/geekmidas)! - `RABBITMQ_URL` and the rabbitmq credentials behind it are gone

  A RabbitMQ container got a generated password, and from it `RABBITMQ_URL`
  and `RABBITMQ_USER`/`_PASSWORD`/`_HOST`/`_PORT`/`_VHOST`. The container runs
  as the local user, so none of them could connect. A topic's broker URL is its
  own key — `USERS_PUBLISHER_CONNECTION_STRING` for a `users` topic — which
  reconcile derives from the declaration, `rabbitmq://` or `pgboss://` by target.

  The stored `eventsBackend` goes with it: nothing passed one any more, and it
  was the other way an `amqp://` URL built from those credentials got in.

- Updated dependencies [[`cf82cef`](https://github.com/geekmidas/toolbox/commit/cf82cefb1aa19cc551c61e58a5c4d8ed608c85b3), [`a8632d3`](https://github.com/geekmidas/toolbox/commit/a8632d33f5e3acd8e84a5714602da5e6b85c9094)]:
  - @geekmidas/constructs@10.0.0-alpha.29
  - @geekmidas/cache@10.0.0-alpha.29
  - @geekmidas/db@10.0.0-alpha.29
  - @geekmidas/envkit@10.0.0-alpha.29
  - @geekmidas/errors@10.0.0-alpha.29
  - @geekmidas/logger@10.0.0-alpha.29
  - @geekmidas/manifest@10.0.0-alpha.29
  - @geekmidas/schema@10.0.0-alpha.29
  - @geekmidas/services@10.0.0-alpha.29
  - @geekmidas/telescope@10.0.0-alpha.29

## 10.0.0-alpha.28

### Patch Changes

- [#91](https://github.com/geekmidas/toolbox/pull/91) [`376b2ce`](https://github.com/geekmidas/toolbox/commit/376b2ce470ee919e2f30a0eebd9ba229d37112af) Thanks [@geekmidas](https://github.com/geekmidas)! - An app's compose environment is its edges, not the whole workspace

  `docker-compose.constructs.yml` gave every app every key the workspace
  resolved — a web app got the database's owner URL and the auth server's
  signing secret, the API got the auth server's database. Each app's service now
  holds what its own declaration provides and requires, and what each construct
  it has an edge to provides: a site also gets the public variants its bundle
  inlines, and the generated API server the edges of the workers whose crons it
  runs.

  Found with it, in `@geekmidas/constructs`:

  - `api.database(db)` (and a function's or cron's `.database(db)`) wired the
    database's service but never recorded the edge, so nothing composed from the
    edges — a container's environment, a deploy's grants — knew the endpoint
    reached a database. It is recorded like any `.dependsOn()`.
  - `BetterAuth` had no way to declare what its `options` use — the mailer a
    magic link goes through, usually — so that edge was invisible, and `options`
    imported and registered the construct by hand. Its config takes
    `dependsOn: [...]` now: each construct is an edge on the server's handler,
    and `options` receives a client for each in `services`, typed as an
    endpoint's are — `options: async ({ services }) => …services.mail…`.

- [#89](https://github.com/geekmidas/toolbox/pull/89) [`6b7d566`](https://github.com/geekmidas/toolbox/commit/6b7d566e5ea9da2cbe94180aa2991a9892cc3515) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm dev` says each thing once, at the address you use

  - Each app is listed once: `api  https://api.shop.localhost:28006 -> http://localhost:3000` — the address it is reached at behind the edge, and the local port the edge forwards to. The per-app banner that printed `Local: http://localhost:3000` as if that were the address is one line now: `✓ api ready in 1.0s  https://… -> http://localhost:3000`, followed by the dev tools it actually mounts (none, for an auth server).
  - The build dev runs is quiet — its counts, generated files, manifest and OpenAPI output are `gkm build`'s. So are the watcher's globs and file counts, the secrets count (mostly addresses), and the warning that no local-stage secrets exist: reconcile derives them.
  - Servers start through the app's own tsx rather than `npx tsx`, which printed the developer's npm config warnings on every start.
  - A browser trusts the edge's HTTPS addresses once its authority is in the system store. `gkm dev` now asks once (or says to run `gkm trust`) for any workspace with apps behind the edge, and `gkm setup` does too — it only did for a workspace with a file server. The trust check reads the system store (`--use-system-ca`), so a root `gkm trust` installed no longer reads as untrusted.

- [#90](https://github.com/geekmidas/toolbox/pull/90) [`3d6af9d`](https://github.com/geekmidas/toolbox/commit/3d6af9d522cfe87323d26881f033e3d1a5bbc892) Thanks [@geekmidas](https://github.com/geekmidas)! - The root site answers on the project's bare host locally, as it does deployed

  A deploy points the base domain at one site — the only one, else the one named
  `web`, else the one declaring `root: true` — but the local edge put every site
  on a subdomain, so `web` was `https://web.shop.localhost` in dev and the bare
  domain in production. Both now use one rule (`rootSite`), and locally the root
  site is `https://shop.localhost`; every other app stays a subdomain of it. A
  stage other than the local one keeps a label (`test.shop.localhost`), because
  one edge serves every stage.

- Updated dependencies [[`376b2ce`](https://github.com/geekmidas/toolbox/commit/376b2ce470ee919e2f30a0eebd9ba229d37112af)]:
  - @geekmidas/constructs@10.0.0-alpha.28
  - @geekmidas/cache@10.0.0-alpha.28
  - @geekmidas/db@10.0.0-alpha.28
  - @geekmidas/envkit@10.0.0-alpha.28
  - @geekmidas/errors@10.0.0-alpha.28
  - @geekmidas/logger@10.0.0-alpha.28
  - @geekmidas/manifest@10.0.0-alpha.28
  - @geekmidas/schema@10.0.0-alpha.28
  - @geekmidas/services@10.0.0-alpha.28
  - @geekmidas/telescope@10.0.0-alpha.28

## 10.0.0-alpha.27

### Patch Changes

- [#88](https://github.com/geekmidas/toolbox/pull/88) [`bf9a2bd`](https://github.com/geekmidas/toolbox/commit/bf9a2bdb8c5e8eff4b237b4b2506f1747e139fa9) Thanks [@geekmidas](https://github.com/geekmidas)! - Every workspace declares constructs; the hand-written path is gone

  A workspace with no `constructs` glob now fails at load with
  `WorkspaceDeclaresNoConstructs`. Its apps, containers and every address —
  databases, the broker, each app behind the edge on its own HTTPS host — come
  from what it declares, and there is no second way to get them.

  Removed with it: reading ports out of a hand-written `docker-compose.yml`
  (`resolveServicePorts`, `rewriteUrlsWithPorts`, `startWorkspaceServices` and
  the rest of that family), the `http://localhost:<port>` dependency URLs built
  from an `apps` block (`getDependencyEnvVars`), `gkm exec`'s `resolveDockerPorts`
  option, the pg-boss URL built from old `PGBOSS_DB_*` secrets, and `gkm test`'s
  `_test` rewrite of `DATABASE_URL` — reconcile's test stage names its own
  databases.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.27
  - @geekmidas/constructs@10.0.0-alpha.27
  - @geekmidas/db@10.0.0-alpha.27
  - @geekmidas/envkit@10.0.0-alpha.27
  - @geekmidas/errors@10.0.0-alpha.27
  - @geekmidas/logger@10.0.0-alpha.27
  - @geekmidas/manifest@10.0.0-alpha.27
  - @geekmidas/schema@10.0.0-alpha.27
  - @geekmidas/services@10.0.0-alpha.27
  - @geekmidas/telescope@10.0.0-alpha.27

## 10.0.0-alpha.26

### Patch Changes

- [#87](https://github.com/geekmidas/toolbox/pull/87) [`ff05e7c`](https://github.com/geekmidas/toolbox/commit/ff05e7c99720e80996ca0ae4caa7f86dd0305f0c) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm dev` keeps every app on its provisioned port, on its HTTPS address

  - An app in a workspace no longer drifts to the next free port when its own
    is taken. Every other app's URL, CORS origins and cookie domain name that
    port, and the next free one was usually another app's — two backends ended
    up fighting over the web app's. It now fails with `DevPortInUse`, naming
    what holds the port.
  - `gkm dev` at a workspace root checks every app's port before starting
    anything, and fails with `WorkspacePortsInUse` listing each one held.
  - A dev server exits when the `gkm dev` that started it is gone, even when
    that process was killed outright. Before, the server kept its port and the
    next run found it taken.
  - 🐛 The addresses reconcile resolves — each app behind the edge on its own HTTPS
    host — are no longer overwritten by `http://localhost:<port>` dependency
    URLs. Those now only fill in what reconcile did not resolve. A frontend was
    calling the API on a host its CORS origins did not list.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.26
  - @geekmidas/constructs@10.0.0-alpha.26
  - @geekmidas/db@10.0.0-alpha.26
  - @geekmidas/envkit@10.0.0-alpha.26
  - @geekmidas/errors@10.0.0-alpha.26
  - @geekmidas/logger@10.0.0-alpha.26
  - @geekmidas/manifest@10.0.0-alpha.26
  - @geekmidas/schema@10.0.0-alpha.26
  - @geekmidas/services@10.0.0-alpha.26
  - @geekmidas/telescope@10.0.0-alpha.26

## 10.0.0-alpha.25

### Patch Changes

- [#86](https://github.com/geekmidas/toolbox/pull/86) [`6b4e1b9`](https://github.com/geekmidas/toolbox/commit/6b4e1b9190eef542099952d80e9b9001a8939621) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm dev` runs the build's own pipeline, and starts an auth server

  `gkm dev` had its own copy of the steps from constructs to a server entry, and
  each time `gkm build` learned something about constructs, dev did not. An auth
  app (`BetterAuth`, whose routes are a wildcard no glob finds) crashed on start
  with `Cannot find module '.gkm/server/app.js'`. Dev now calls the same
  `buildApp` the build does, so the two generate the same entry.

  Whether a surface serves itself is now asked of the construct (it has a
  `server()`), not inferred from a glob that found nothing.

  Also fixed on the way, each found by running `gkm dev` against a real app:

  - The generated `subscribers.ts` and `queues.ts` imported `@geekmidas/events`
    even when the app declared no Topic or Queue, so any app without that package
    installed crashed in dev.
  - Restarting or stopping the dev server ran `kill -9` on every process with a
    socket on its port — the browser, the web app's server — not only the one
    listening on it.
  - `gkm dev` at a workspace root ran turbo with no filter, so turbo also ran the
    root package's own `dev` — `gkm dev` again — and every app started twice,
    fighting over its port. Dev now names each app's package, as `gkm build` does.
  - Every app in a workspace asked for port 3000, because the CLI turned a
    missing `--port` into 3000 before the workspace's port was consulted.
  - A `Worker`'s crons never scheduled on a server. They are now scheduled
    through the events broker — the app's one pg-boss, as the broker's role, in
    its schema — rather than a second pg-boss on the worker's database as the
    runtime role, which could neither create a schema nor use the broker's.
    Reconcile resolves the broker's connection strings for a declared worker on
    pg-boss even when no queue or topic is declared.
  - From an app with its own tsconfig — a Vite or Next frontend — every `gkm`
    command failed to load another app's constructs through the root tsconfig's
    path aliases. The hook that resolves them was installed with
    `module.register()`, and tsx 4.23's in-thread resolver threw before it was
    asked; it is now installed with `module.registerHooks()` when Node has it.

- Updated dependencies [[`6b4e1b9`](https://github.com/geekmidas/toolbox/commit/6b4e1b9190eef542099952d80e9b9001a8939621)]:
  - @geekmidas/constructs@10.0.0-alpha.25
  - @geekmidas/cache@10.0.0-alpha.25
  - @geekmidas/db@10.0.0-alpha.25
  - @geekmidas/envkit@10.0.0-alpha.25
  - @geekmidas/errors@10.0.0-alpha.25
  - @geekmidas/logger@10.0.0-alpha.25
  - @geekmidas/manifest@10.0.0-alpha.25
  - @geekmidas/schema@10.0.0-alpha.25
  - @geekmidas/services@10.0.0-alpha.25
  - @geekmidas/telescope@10.0.0-alpha.25

## 10.0.0-alpha.24

### Patch Changes

- [#85](https://github.com/geekmidas/toolbox/pull/85) [`3016bfb`](https://github.com/geekmidas/toolbox/commit/3016bfb2b6815804355f1e6ae0f373da1776e25c) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm dev` starts again

  Every `gkm dev` failed with `No owner to take a logger and an environment parser
from`. The generated entry reads its logger and env parser off the `RestApi` it
  serves, and `gkm build` discovered that `RestApi` before generating, but dev
  never did. Both now derive it the same way, and dev serves only the endpoints
  built from its own `RestApi`, as build already did.

  A `RestApi` declared without a `telescope` no longer fails every request once
  Telescope is on: the entry falls back to the in-memory Telescope that
  `telescope` config describes.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.24
  - @geekmidas/constructs@10.0.0-alpha.24
  - @geekmidas/db@10.0.0-alpha.24
  - @geekmidas/envkit@10.0.0-alpha.24
  - @geekmidas/errors@10.0.0-alpha.24
  - @geekmidas/logger@10.0.0-alpha.24
  - @geekmidas/manifest@10.0.0-alpha.24
  - @geekmidas/schema@10.0.0-alpha.24
  - @geekmidas/services@10.0.0-alpha.24
  - @geekmidas/telescope@10.0.0-alpha.24

## 10.0.0-alpha.23

### Patch Changes

- [#84](https://github.com/geekmidas/toolbox/pull/84) [`7c7e0ef`](https://github.com/geekmidas/toolbox/commit/7c7e0efac3b655a20c9eb8f3a4ff4e3e9e4deea9) Thanks [@geekmidas](https://github.com/geekmidas)! - The generated test harness imports the app's modules itself

  `featureTest` imported each construct and endpoint by path. From a published
  `@geekmidas/constructs` — inside `node_modules` — Vitest leaves that dynamic
  import to Node, which knows nothing of the app's tsconfig paths, so the first
  endpoint importing `~/router.ts` failed with `Cannot find package '~'`. (In this
  repo the packages are linked sources, which Vite processes, so it never showed.)

  The generated `index.ts` now imports every module the manifest records,
  statically, from inside the app, and hands them to `featureTest` as `modules`
  keyed by the recorded path — resolving the way the app's own code does. A
  module not handed over is still imported by path.

- Updated dependencies [[`31a4ed5`](https://github.com/geekmidas/toolbox/commit/31a4ed57b5c962bc5b961e734b20249b3c64f3d6), [`7c7e0ef`](https://github.com/geekmidas/toolbox/commit/7c7e0efac3b655a20c9eb8f3a4ff4e3e9e4deea9)]:
  - @geekmidas/constructs@10.0.0-alpha.23
  - @geekmidas/cache@10.0.0-alpha.23
  - @geekmidas/db@10.0.0-alpha.23
  - @geekmidas/envkit@10.0.0-alpha.23
  - @geekmidas/errors@10.0.0-alpha.23
  - @geekmidas/logger@10.0.0-alpha.23
  - @geekmidas/manifest@10.0.0-alpha.23
  - @geekmidas/schema@10.0.0-alpha.23
  - @geekmidas/services@10.0.0-alpha.23
  - @geekmidas/telescope@10.0.0-alpha.23

## 10.0.0-alpha.22

### Minor Changes

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

### Patch Changes

- Updated dependencies [[`ba670bf`](https://github.com/geekmidas/toolbox/commit/ba670bfde5db17f89a4f59d73ca63a09ef449a0c)]:
  - @geekmidas/constructs@10.0.0-alpha.22
  - @geekmidas/cache@10.0.0-alpha.22
  - @geekmidas/db@10.0.0-alpha.22
  - @geekmidas/envkit@10.0.0-alpha.22
  - @geekmidas/errors@10.0.0-alpha.22
  - @geekmidas/logger@10.0.0-alpha.22
  - @geekmidas/manifest@10.0.0-alpha.22
  - @geekmidas/schema@10.0.0-alpha.22
  - @geekmidas/services@10.0.0-alpha.22
  - @geekmidas/telescope@10.0.0-alpha.22

## 10.0.0-alpha.21

### Patch Changes

- [#81](https://github.com/geekmidas/toolbox/pull/81) [`d505053`](https://github.com/geekmidas/toolbox/commit/d505053ef116d609a8fac6dec85dfcb091d6ac5e) Thanks [@geekmidas](https://github.com/geekmidas)! - `featureTest`: drive an app the way it runs deployed

  `@geekmidas/constructs/testing` gains `featureTest`: a browser signs in and calls
  the API, the API asks the auth server who is calling, each over its URL, and
  every database is in its own transaction, rolled back after the test.

  - Each surface's endpoints and each `BetterAuth` server are served in-process
    through MSW, from the real handler, for the test a request was made for —
    found from the `x-test-context-id` header, including on a request the code
    under test made while handling another.
  - 🐛 Each database construct — the app's and each schema tenant — resolves, inside
    a test, to that test's own transaction on its own connection.
  - Fixtures: `browser` (already the global `fetch`), `db`, `mailbox(address)`.
  - A request belonging to no running test is refused (`UnknownTestContext`).

  `gkm test` and `gkm dev` publish `<ID>_INBOX_URL` beside an `Email` construct's
  URL: Mailpit's inbox, where the mail it sent is read back. Local only.

  `@geekmidas/testkit` is an optional peer of `@geekmidas/constructs`, needed by
  `./testing` alone.

  Part 3b of #77.

- Updated dependencies [[`d505053`](https://github.com/geekmidas/toolbox/commit/d505053ef116d609a8fac6dec85dfcb091d6ac5e)]:
  - @geekmidas/constructs@10.0.0-alpha.21
  - @geekmidas/cache@10.0.0-alpha.21
  - @geekmidas/db@10.0.0-alpha.21
  - @geekmidas/envkit@10.0.0-alpha.21
  - @geekmidas/errors@10.0.0-alpha.21
  - @geekmidas/logger@10.0.0-alpha.21
  - @geekmidas/manifest@10.0.0-alpha.21
  - @geekmidas/schema@10.0.0-alpha.21
  - @geekmidas/telescope@10.0.0-alpha.21

## 10.0.0-alpha.20

### Patch Changes

- Updated dependencies [[`6ee966c`](https://github.com/geekmidas/toolbox/commit/6ee966c1ea27d25720ac6767c9f2e7ffe63b3f7f), [`59e3fab`](https://github.com/geekmidas/toolbox/commit/59e3fabaec37ac7ffd9c26c2927daf0cc8f406c8)]:
  - @geekmidas/constructs@10.0.0-alpha.20
  - @geekmidas/cache@10.0.0-alpha.20
  - @geekmidas/db@10.0.0-alpha.20
  - @geekmidas/envkit@10.0.0-alpha.20
  - @geekmidas/errors@10.0.0-alpha.20
  - @geekmidas/logger@10.0.0-alpha.20
  - @geekmidas/manifest@10.0.0-alpha.20
  - @geekmidas/schema@10.0.0-alpha.20
  - @geekmidas/telescope@10.0.0-alpha.20

## 10.0.0-alpha.19

### Patch Changes

- [#76](https://github.com/geekmidas/toolbox/pull/76) [`8533bac`](https://github.com/geekmidas/toolbox/commit/8533baca5b4771281cdb017e44719d925bdcd883) Thanks [@geekmidas](https://github.com/geekmidas)! - Branch from the surface: `api.database(db)`; `api.endpoints` is gone

  `api.get()` was already sugar for `api.endpoints.get()`, but a group had to
  reach through the factory — `api.endpoints.database(database)`. The branching
  methods now live on the surface like the verbs do: `api.database()`,
  `api.session()`, `api.auditor()`, `api.actor()`, `api.publisher()`,
  `api.authorizer()`, `api.authorize()`, `api.rls()` and `api.route()`. Each
  returns a new factory and leaves the surface untouched, so a route built
  straight from `api` gets none of what a group opted into. The factory itself is
  private.

  Two methods deliberately stay off the surface. `dependsOn` is per endpoint —
  `api.post('/x').dependsOn([uploads])`. `services` is replaced by `dependsOn` on
  constructs. `logger` is the surface's config (`new RestApi(id, { logger })`),
  and `api.logger` is that logger.

  **Migrating:** `api.endpoints.database(db)` → `api.database(db)`;
  `api.endpoints.get(…)` → `api.get(…)`; `api.endpoints.dependsOn([x]).get(p)` →
  `api.get(p).dependsOn([x])`.

  The scaffold's `AGENTS.md` now shows what the scaffold generates: handlers
  read `db` (not `services.database`), the router is imported from
  `~/router.ts`, and a single endpoint can name its own database with
  `.database(other)`.

- [#75](https://github.com/geekmidas/toolbox/pull/75) [`a8ab67c`](https://github.com/geekmidas/toolbox/commit/a8ab67c1c63e2613b44809ed4190a9a472216c30) Thanks [@geekmidas](https://github.com/geekmidas)! - A scaffolded `CLAUDE.md` imports `AGENTS.md` instead of linking to it

  It pointed at the conventions with `[AGENTS.md](./AGENTS.md)`, and Claude Code
  follows no links: it loaded the pointer and none of what it pointed at. It now
  reads `@AGENTS.md`, which Claude Code loads into context with the file. The
  conventions still live only in `AGENTS.md`.

- [#74](https://github.com/geekmidas/toolbox/pull/74) [`769a4a0`](https://github.com/geekmidas/toolbox/commit/769a4a0b866a58900c5b47aaf66b5c2abd538e3c) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm setup` no longer stores `NODE_ENV` in a stage's secrets

  `gkm exec` injects secrets over the environment, so a stored
  `NODE_ENV=development` made every `gkm exec -- next build` a development
  build, and Next fails to prerender one (`Cannot read properties of null
(reading 'useContext')` on `/_global-error`). `gkm init` already left it out
  for this reason; `gkm setup` — which a developer runs after cloning, and which
  regenerates the stage — still wrote it, on both its single-app and its
  fullstack path. The command decides `NODE_ENV`.

  A stage generated before this keeps the key until it is removed from it.

- Updated dependencies [[`8533bac`](https://github.com/geekmidas/toolbox/commit/8533baca5b4771281cdb017e44719d925bdcd883)]:
  - @geekmidas/constructs@10.0.0-alpha.19
  - @geekmidas/cache@10.0.0-alpha.19
  - @geekmidas/db@10.0.0-alpha.19
  - @geekmidas/envkit@10.0.0-alpha.19
  - @geekmidas/errors@10.0.0-alpha.19
  - @geekmidas/logger@10.0.0-alpha.19
  - @geekmidas/manifest@10.0.0-alpha.19
  - @geekmidas/schema@10.0.0-alpha.19
  - @geekmidas/telescope@10.0.0-alpha.19

## 10.0.0-alpha.18

### Patch Changes

- [#73](https://github.com/geekmidas/toolbox/pull/73) [`f1db506`](https://github.com/geekmidas/toolbox/commit/f1db506b9450628ccdb07f33f8fdda5bb5d006a8) Thanks [@geekmidas](https://github.com/geekmidas)! - A fresh fullstack scaffold's `pnpm test` runs

  Found by moving a real project onto v10: every fault below stood between a
  newly scaffolded workspace and its first green test run.

  `gkm test` from the workspace root skipped the reconcile. The root is not an
  app, so loading the app failed and the command fell back to the pre-constructs
  path: no container started, and every URL was whatever the stored secrets said,
  on ports nothing listened on. The root is exactly where the scaffold's own
  `pnpm test` runs it from. The workspace is now loaded there too, and what it
  declares is reconciled the same as from inside an app.

  The monorepo scaffold migrated as the wrong role. Its `test/globalSetup.ts` and
  `kysely.config.ts` rendered `Credentials.DATABASE_URL ?? Credentials.DATABASE_URL`
  — a branch from before the root declared the database — so migrations connected
  as the runtime role, which may create nothing, and failed on the first table.
  Both layouts now read `DATABASE_OWNER_URL`.

  `PostgresMigrator`'s cleanup dropped a database it had not created. `gkm test`
  provisions the test database before the suite starts, with an owner role that
  may migrate it but not drop it, so an otherwise green run ended in "must be
  owner of database". The cleanup now drops only a database `start()` created.

  Renaming a stage broke the local edge. Caddy imports every file under
  `.gkm/caddy-sites/`, and the old stage's file declared the same hosts as the
  new one's, so Caddy refused the config as ambiguous and never became healthy.
  Files for stages that are neither the local stage nor `test` are now removed
  when the routes are written.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.18
  - @geekmidas/constructs@10.0.0-alpha.18
  - @geekmidas/db@10.0.0-alpha.18
  - @geekmidas/envkit@10.0.0-alpha.18
  - @geekmidas/errors@10.0.0-alpha.18
  - @geekmidas/logger@10.0.0-alpha.18
  - @geekmidas/manifest@10.0.0-alpha.18
  - @geekmidas/schema@10.0.0-alpha.18
  - @geekmidas/telescope@10.0.0-alpha.18

## 10.0.0-alpha.17

### Patch Changes

- [#71](https://github.com/geekmidas/toolbox/pull/71) [`b3e2081`](https://github.com/geekmidas/toolbox/commit/b3e20817d4dfd32852acdf40a644720f5e8eceb1) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm` starts again

  Every command failed at startup with "Cannot add option '--region <region>'
  to command 'init' due to conflicting flag '--region'": `init` registered
  `--region` twice. CI now starts the built CLI and runs `--help` for every
  command (`pnpm check:cli`), so a broken command registration fails the build
  instead of shipping.

- [#72](https://github.com/geekmidas/toolbox/pull/72) [`c83944a`](https://github.com/geekmidas/toolbox/commit/c83944a7ac552e6c20b49bc48f6a81811028a466) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm init` scaffolds on TypeScript 7, and every `gkm` command starts again

  **The CLI could not start.** `init` registered `--region` twice, so commander
  threw while building the program and every `gkm` command — `build`, `dev`,
  `--help` — failed on 10.0.0-alpha.16. A test now runs the built program.

  **Scaffolds move to the toolchain the packages are built with:** TypeScript 7,
  Vitest 5, Vite 8, tsx 4.23, esbuild 0.28 and Storybook 10. Storybook's config
  follows Storybook 10 — `addon-docs` in place of essentials and interactions,
  stories typed from `@storybook/react-vite`, backgrounds as a global — and uses
  `react-docgen`, since the TypeScript-based docgen needs the compiler API that
  TypeScript 7 no longer ships. Generated tsconfigs drop `baseUrl`.

  `vite-tsconfig-paths` is gone: Vite resolves tsconfig `paths` itself
  (`resolve.tsconfigPaths`), and the plugin's `tsconfck` declares a TypeScript 5
  peer.

  **A standalone app installs and typechecks.** It had no `packageManager`, so
  Corepack took pnpm 11, which fails the first install on esbuild's build
  script; it now pins the same pnpm as the workspace scaffold. And its endpoints
  imported `./router.ts` from `src/endpoints/…`, a file that is not there — every
  layout imports through `~/` now.

- [#70](https://github.com/geekmidas/toolbox/pull/70) [`149f539`](https://github.com/geekmidas/toolbox/commit/149f539a8d4d12fec096af71619d7da8d93267b5) Thanks [@geekmidas](https://github.com/geekmidas)! - A deployed stage's secrets live in a store: `secrets.store` in gkm.config.ts

  `.gkm/` is gitignored, so the encrypted secrets file a deploy decrypts was
  never on a CI runner. `secrets.store` says where a deployed stage's secrets
  live instead:

  - `'file'` (default) — the encrypted `.gkm/secrets/<stage>.json`, as before.
  - `{ provider: 'ssm', region }` — one `SecureString` per stage,
    `/gkm/<name>/<stage>/secrets`, in the AWS account of the active credentials.
  - `{ provider: store }` — any object with `pull(stage)` and `push(stage, secrets)`.

  The local stage always stays in the file.

  `gkm secrets:push --stage <stage> [--profile <p>]` and `gkm secrets:pull`
  move a deployed stage's secrets to and from its store; `--profile` resolves
  only that profile, never `AWS_*` from the environment. The generated
  `deploy.yml` for SST runs `gkm secrets:pull --stage "$STAGE"` after assuming
  the stage's role, and no longer needs `GKM_SECRETS_KEY`; `gkm deploy:github`
  pushes the stage's secrets to SSM with the same profile instead of setting the
  key. `gkm init --deploy sst` writes the SSM store with the chosen region.

  Breaking: `state: { provider: 'ssm' }` no longer carries secrets (it still
  holds deploy state), and `gkm setup` no longer shares the local stage's
  secrets through SSM. Move secrets to `secrets.store` and push each deployed
  stage once.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.17
  - @geekmidas/constructs@10.0.0-alpha.17
  - @geekmidas/db@10.0.0-alpha.17
  - @geekmidas/envkit@10.0.0-alpha.17
  - @geekmidas/errors@10.0.0-alpha.17
  - @geekmidas/logger@10.0.0-alpha.17
  - @geekmidas/manifest@10.0.0-alpha.17
  - @geekmidas/schema@10.0.0-alpha.17
  - @geekmidas/telescope@10.0.0-alpha.17

## 10.0.0-alpha.16

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.16
  - @geekmidas/constructs@10.0.0-alpha.16
  - @geekmidas/db@10.0.0-alpha.16
  - @geekmidas/envkit@10.0.0-alpha.16
  - @geekmidas/errors@10.0.0-alpha.16
  - @geekmidas/logger@10.0.0-alpha.16
  - @geekmidas/manifest@10.0.0-alpha.16
  - @geekmidas/schema@10.0.0-alpha.16
  - @geekmidas/telescope@10.0.0-alpha.16

## 10.0.0-alpha.15

### Patch Changes

- [#67](https://github.com/geekmidas/toolbox/pull/67) [`fa7433f`](https://github.com/geekmidas/toolbox/commit/fa7433f1d396cece6ab4f5736c2835de4e3b3591) Thanks [@geekmidas](https://github.com/geekmidas)! - React 19.3, React Query 5.104, Tailwind 4.3 and lucide-react 1.x

  `@geekmidas/ui` moves to lucide-react 1.48; its `Spinner` props follow
  lucide's narrower `LucideProps`. `gkm init` scaffolds lucide-react 1.48. Peer
  ranges for React, React Query and Tailwind are unchanged.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.15
  - @geekmidas/constructs@10.0.0-alpha.15
  - @geekmidas/db@10.0.0-alpha.15
  - @geekmidas/envkit@10.0.0-alpha.15
  - @geekmidas/errors@10.0.0-alpha.15
  - @geekmidas/logger@10.0.0-alpha.15
  - @geekmidas/manifest@10.0.0-alpha.15
  - @geekmidas/schema@10.0.0-alpha.15
  - @geekmidas/telescope@10.0.0-alpha.15

## 10.0.0-alpha.14

### Patch Changes

- 🔥 [#66](https://github.com/geekmidas/toolbox/pull/66) [`5235875`](https://github.com/geekmidas/toolbox/commit/52358754906af071a40d29dcbd4c28e25887d5e1) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm generate:react-query` is removed, and with it the `openapi-typescript` dependency

  It read an `openapi.json` and shelled out to `npx openapi-typescript`. Each
  surface's typed client is written by `gkm build` (and kept current by
  `gkm dev`) to `.gkm/openapi/<surface>.ts`, built from the endpoints
  themselves: its `createApi()` returns a typed fetcher with React Query hooks.
  Verified against openapi-typescript on kitchen-sink's endpoints, its types
  match. Import that file instead. The `@geekmidas/cli/openapi-react-query`
  export is gone too.

- [#62](https://github.com/geekmidas/toolbox/pull/62) [`db9cc57`](https://github.com/geekmidas/toolbox/commit/db9cc57ce5fa0ec5529ec5a01b33fbedf8848493) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm init` installs `pino` only for the pino logger

  The API, minimal, serverless and worker templates listed `pino` among their
  dependencies whatever logger was chosen, so a console-logger project installed
  a logging library it never imports. `pino` is now added only when the pino
  logger is picked, beside the `@geekmidas/logger/pino` import it serves.

- Updated dependencies [[`9602a19`](https://github.com/geekmidas/toolbox/commit/9602a19a9b4fb9cecd2641d108976f73272df55e)]:
  - @geekmidas/schema@10.0.0-alpha.14
  - @geekmidas/constructs@10.0.0-alpha.14
  - @geekmidas/cache@10.0.0-alpha.14
  - @geekmidas/db@10.0.0-alpha.14
  - @geekmidas/envkit@10.0.0-alpha.14
  - @geekmidas/errors@10.0.0-alpha.14
  - @geekmidas/logger@10.0.0-alpha.14
  - @geekmidas/manifest@10.0.0-alpha.14
  - @geekmidas/telescope@10.0.0-alpha.14

## 10.0.0-alpha.13

### Patch Changes

- [#58](https://github.com/geekmidas/toolbox/pull/58) [`07d1827`](https://github.com/geekmidas/toolbox/commit/07d1827bb0a2a76d04a0fc25a7517df282004137) Thanks [@geekmidas](https://github.com/geekmidas)! - The build and test toolchain moves to its latest versions (tranche 2)

  - **tsx 4.23, tsdown 0.23.** The CLI runs TypeScript through tsx, so its
    `tsx` dependency moves with it.
  - **Vite 8, `@vitejs/plugin-react` 6** for the Studio and Telescope UIs, which
    ship inside those packages.
  - **Vitest 5.** `@geekmidas/testkit` and `@geekmidas/db` require `vitest ~5.0.2`,
    so a project on an older Vitest needs to move with them. A fresh `gkm init`
    already ships Vitest 4+; the scaffold's pin follows with #43.

- Updated dependencies [[`07d1827`](https://github.com/geekmidas/toolbox/commit/07d1827bb0a2a76d04a0fc25a7517df282004137)]:
  - @geekmidas/db@10.0.0-alpha.13
  - @geekmidas/telescope@10.0.0-alpha.13
  - @geekmidas/constructs@10.0.0-alpha.13
  - @geekmidas/cache@10.0.0-alpha.13
  - @geekmidas/envkit@10.0.0-alpha.13
  - @geekmidas/errors@10.0.0-alpha.13
  - @geekmidas/logger@10.0.0-alpha.13
  - @geekmidas/manifest@10.0.0-alpha.13
  - @geekmidas/schema@10.0.0-alpha.13

## 10.0.0-alpha.12

### Patch Changes

- 🔥 [#57](https://github.com/geekmidas/toolbox/pull/57) [`b4a95b6`](https://github.com/geekmidas/toolbox/commit/b4a95b68433c0906fcc06e6c5fdff1a80af06166) Thanks [@geekmidas](https://github.com/geekmidas)! - Delete the `services` block from `gkm.config`. Whether a resource exists is its
  construct; which backend serves it follows the deploy target (cache: a table on
  a server, Upstash on AWS; events: pg-boss on a server, SNS/SQS on AWS; storage:
  MinIO / S3); mail is whatever `MAIL_URL` names. The config schema is now strict,
  so a leftover `services` key — or any unknown key — fails to load instead of
  being ignored.

  Compose is now two files. `docker-compose.constructs.yml`, at the project root,
  is generated from the construct plan by `gkm dev`, `gkm test`, `gkm setup` and
  `gkm docker`, and is gitignored. The project's own `docker-compose.yml` is
  merged over it (`-f docker-compose.constructs.yml -f docker-compose.yml`), so
  image pins and extra services live there. `gkm docker` puts each app in the
  same file behind the `apps` profile, wired to every construct's own keys
  (`ORDERS_URL`, a schema tenant's URL) instead of a hardcoded `DATABASE_URL` /
  `REDIS_URL`. `docker.compose.services`, `generateDockerCompose` and
  `generateMinimalDockerCompose` are gone.

  `gkm init` asks which constructs to declare instead of which services to run,
  and writes no compose file. `trustLocalCa` is gone from the config: trusting
  the local CA is per machine — `gkm trust`, or `gkm setup --yes`.

  Migrating: delete `services` from `gkm.config.ts` and `docker.compose` from any
  app config; move image pins into a `docker-compose.yml`; add
  `docker-compose.constructs.yml` to `.gitignore`.

- [#56](https://github.com/geekmidas/toolbox/pull/56) [`abe60e1`](https://github.com/geekmidas/toolbox/commit/abe60e129feb34f1cb38e7bdf4de17e050bb7307) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm init` takes every third-party version from one place, and a construct edit invalidates cached builds

  Scaffold versions were hardcoded across the templates and generators and had
  never been reviewed against latest. They now all come from
  `init/dependencies.ts`, in three groups: current dependencies (inside every
  `@geekmidas` peer range), the build and test toolchain (held at its current
  versions until tranche 2, #40, moves it), and the Expo SDK 55 set. A scan test
  fails on any version literal outside that file.

  Scaffolds get Turbo 2.11. Turbo 2.3 ignored `$TURBO_ROOT# @geekmidas/cli, so the per-app
`turbo.json`files`gkm build`generated never hashed the root constructs:
editing`constructs/database.ts`replayed a stale cached build. The root`turbo.json`that`init`writes now declares those inputs once for every
package, and`gkm build`no longer writes`apps/\*/turbo.json`.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.12
  - @geekmidas/constructs@10.0.0-alpha.12
  - @geekmidas/db@10.0.0-alpha.12
  - @geekmidas/envkit@10.0.0-alpha.12
  - @geekmidas/errors@10.0.0-alpha.12
  - @geekmidas/logger@10.0.0-alpha.12
  - @geekmidas/manifest@10.0.0-alpha.12
  - @geekmidas/schema@10.0.0-alpha.12
  - @geekmidas/telescope@10.0.0-alpha.12

## 10.0.0-alpha.11

### Patch Changes

- [#52](https://github.com/geekmidas/toolbox/pull/52) [`e0762b2`](https://github.com/geekmidas/toolbox/commit/e0762b20d07014537952c99ae7e3691de353821c) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm deploy:github --stage <stage> --profile <aws-profile>`: GitHub Actions deploys a stage without AWS keys

  Run once per stage, with the profile for that stage's account. It creates
  GitHub's OIDC provider in the account if missing, and a role
  `<project>-github-<stage>` that only the repository's `<stage>` environment can
  assume (`AdministratorAccess` unless `--policy-arn`), then creates that GitHub
  environment with `AWS_ROLE_ARN` and `GKM_SECRETS_KEY`. The profile is resolved
  on its own — SSO included — and never replaced by `AWS_*` in the environment.
  `--dry-run` prints the plan.

  Stage and init failures are named errors now (`InvalidStages`,
  `UndeclaredStage`, `UnknownDeployTarget`, `NotAnAwsRegion`, `NoStageToTest`,
  `SsoSessionExpired`), not bare `Error`s.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.11
  - @geekmidas/constructs@10.0.0-alpha.11
  - @geekmidas/db@10.0.0-alpha.11
  - @geekmidas/envkit@10.0.0-alpha.11
  - @geekmidas/errors@10.0.0-alpha.11
  - @geekmidas/logger@10.0.0-alpha.11
  - @geekmidas/manifest@10.0.0-alpha.11
  - @geekmidas/schema@10.0.0-alpha.11
  - @geekmidas/telescope@10.0.0-alpha.11

## 10.0.0-alpha.10

### Patch Changes

- [#51](https://github.com/geekmidas/toolbox/pull/51) [`b7a16c9`](https://github.com/geekmidas/toolbox/commit/b7a16c9ab735dc32fb25588e394e99cf58d7243d) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm init` ships GitHub Actions: CI, a release drafter, and a deploy workflow

  Every scaffold gets `.github/workflows/ci.yml` (pull requests: install, build,
  lint, typecheck, `test:once` with `GKM_AUTO_SETUP=1`) and a release drafter
  that labels pull requests from their titles. With a deploy target it also gets
  `deploy.yml`: a push to main deploys the stages that are not protected, and
  publishing the drafted release deploys the protected ones. It reads `stages`
  from `gkm.config.ts` when it runs rather than naming any, deploys each stage in
  the GitHub environment of the same name — `GKM_SECRETS_KEY`, plus
  `AWS_ROLE_ARN` (OIDC) for SST or `DOKPLOY_API_TOKEN` / `DOKPLOY_ENDPOINT` for
  Dokploy — and follows the project's package manager.

- ⬆️ [#50](https://github.com/geekmidas/toolbox/pull/50) [`665ab5e`](https://github.com/geekmidas/toolbox/commit/665ab5e975359f787e5d14625088557db3ca3ff5) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm upgrade` follows the release line a project is on, and never goes backwards

  It read npm's `latest` tag, which is 9.x while 10 is in prerelease: it could
  not reach a 10 alpha, and on a project already on one it proposed 9.0.2 — a
  downgrade — because it compared version text rather than versions. It then ran
  `pnpm update --latest`, and never touched pnpm catalogs.

  Now the target is the dist-tag of the line the project is on (`alpha` for
  `10.0.0-alpha.x`), or `--tag`. A target behind what is installed is refused.
  Without `--all` only `@geekmidas/cli` moves; with it, every `@geekmidas`
  package moves to the one shared version, and third-party packages the project
  lists are raised to the floor of the peer ranges that version declares. Ranges
  keep their `^`/`~`/`>=`, pnpm `catalog:` entries are rewritten in place,
  `workspace:` references and hand-written ranges are left alone, and one
  install runs at the end.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.10
  - @geekmidas/constructs@10.0.0-alpha.10
  - @geekmidas/db@10.0.0-alpha.10
  - @geekmidas/envkit@10.0.0-alpha.10
  - @geekmidas/errors@10.0.0-alpha.10
  - @geekmidas/logger@10.0.0-alpha.10
  - @geekmidas/manifest@10.0.0-alpha.10
  - @geekmidas/schema@10.0.0-alpha.10
  - @geekmidas/telescope@10.0.0-alpha.10

## 10.0.0-alpha.9

### Patch Changes

- [#48](https://github.com/geekmidas/toolbox/pull/48) [`36f4586`](https://github.com/geekmidas/toolbox/commit/36f45865df512bf473469914b7a50c198e47135e) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm init` asks where the project deploys: Dokploy, AWS through SST, or later

  AWS (SST) was missing from the choices. Picking it asks for the AWS region
  and writes an `sst.config.ts` that hands the manifest `gkm build --provider
aws` writes to `@geekmidas/cloud`'s `fromManifest`, plus a `deploy` script,
  `sst`, and the packages `@geekmidas/cloud/sst` imports. The database gets a
  VPC, and a project that sends mail reads its SES sender from `MAIL_FROM`.

  `--deploy <dokploy|sst|none>` and `--region` answer the questions without
  prompting. `--yes` now picks no deploy target rather than Dokploy, and
  `eu-west-1` when `--deploy sst` is given without a region.

  **Stages are declared, not assumed.** `gkm.config.ts` now requires
  `stages: { local, deployed, protected? }`, and every command reads it: `gkm
dev`, `exec`, `setup` and `test` run as `stages.local` (it was `development`,
  after looking for `dev` secrets first), reconcile leaves only the local stage's
  resources unsuffixed, and `gkm deploy --stage` refuses a stage that is not in
  `deployed`. The config is checked: names fit a physical name, `test` is
  reserved for `gkm test`, the local stage is never also deployed (they would
  share secrets), and `protected` is a subset of `deployed`.

  `gkm init` asks for them by name — the deployed stages, which one is
  production, and the local stage (`--stages`, `--protected-stage`,
  `--local-stage`) — and derives from them the local secrets it seeds, a
  `deploy:<stage>` script per deployed stage, SST's retain/protect list, and the
  scaffolded `STAGE` enum.

  **Migrating:** add `stages` to `gkm.config.ts`. To keep existing local
  secrets, name the local stage after the file they are in — `local:
'development'` for `.gkm/secrets/development.json` — or rename that file and
  its key in `~/.gkm/<project>/` to the new name.

  `gkm init` formats what it writes. It ran `biome format --write --unsafe`,
  which Biome 2 rejects, and swallowed the error, so scaffolds kept the
  generators' double quotes; it now runs the project's own `biome check --write`
  and says so if that fails.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.9
  - @geekmidas/constructs@10.0.0-alpha.9
  - @geekmidas/db@10.0.0-alpha.9
  - @geekmidas/envkit@10.0.0-alpha.9
  - @geekmidas/errors@10.0.0-alpha.9
  - @geekmidas/logger@10.0.0-alpha.9
  - @geekmidas/manifest@10.0.0-alpha.9
  - @geekmidas/schema@10.0.0-alpha.9
  - @geekmidas/telescope@10.0.0-alpha.9

## 10.0.0-alpha.8

### Patch Changes

- [#47](https://github.com/geekmidas/toolbox/pull/47) [`e49677e`](https://github.com/geekmidas/toolbox/commit/e49677e31780d2f0d91c54d9cb7ecc750b97446e) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm init` names what it declares plainly: `Database`, `Cache`, `Uploads`, `Mail`

  The scaffold named them after the project — `new Cache('ShopCache')`,
  `new KyselyDatabase<Database, 'Shop'>('Shop')` — but the workspace
  `name` already scopes every physical name, so the cache deployed as
  `production-shop-shop-cache`. The ids are now plain, and so are the
  keys they publish: `DATABASE_URL`, `DATABASE_OWNER_URL`, `CACHE_URL`,
  `UPLOADS_URL`, `MAIL_URL`.

  Existing projects are unaffected; a project scaffolded before this keeps its
  ids until it renames them.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.8
  - @geekmidas/constructs@10.0.0-alpha.8
  - @geekmidas/db@10.0.0-alpha.8
  - @geekmidas/envkit@10.0.0-alpha.8
  - @geekmidas/errors@10.0.0-alpha.8
  - @geekmidas/logger@10.0.0-alpha.8
  - @geekmidas/manifest@10.0.0-alpha.8
  - @geekmidas/schema@10.0.0-alpha.8
  - @geekmidas/telescope@10.0.0-alpha.8

## 10.0.0-alpha.7

### Patch Changes

- [#39](https://github.com/geekmidas/toolbox/pull/39) [`960425f`](https://github.com/geekmidas/toolbox/commit/960425f73bc99ab0304c8ef2d22c7e98ca8313a4) Thanks [@geekmidas](https://github.com/geekmidas)! - A surface has no `app`, and `gkm init --template fullstack` builds

  `RestApi` and `BetterAuth` no longer take an `app` block, and the manifest's
  `rest-api` declaration loses it too. The one thing the block carried that the id
  does not — whether the surface streams into a Telescope — is `telescope: true`
  on the declaration itself.

  `RestApi`, `BetterAuth` and `StaticSite` take a required `path`: the app that
  serves them, relative to the workspace root (`'apps/api'`, or `'.'` in a
  single-app project). It was inferred from the id — `apps/<kebab-id>` if that
  directory existed, the root otherwise — so an app's home was whatever happened
  to be on disk. `BetterAuth`'s `basePath` is unchanged and still means the URL
  its routes are mounted at. `path` does not change discovery.

  Constructs, and the endpoints built from them, are loaded from the workspace's
  `constructs` glob. `gkm init` writes one that reaches every app laid out the
  way it was told — `'./apps/*/src/endpoints/**/*.ts'` for the default layout —
  rather than naming the API's directory. An endpoint belongs to the surface it
  was built from, not to the directory its file is in: each app's build now keeps only the endpoints
  built from the surface that app serves. Before this, every build in a workspace
  guessed the same surface and kept every endpoint the glob found — so an auth
  server's build would have served the API's routes.

  Every module's path aliases resolve through the tsconfig beside it. tsx applies
  the tsconfig of the directory a command ran from to the whole process, so a
  glob that reaches every app resolved `~/router.ts` in `apps/api` through
  `apps/web`'s `~` — silently, to the wrong file — when the command ran there.

  The fullstack scaffold did not build. What it gets now:

  - **The root `constructs/` folder's dependencies at the root**, where it
    resolves them: `@geekmidas/constructs` and the peers each declared construct
    needs. The root tsconfig allows the `.ts` imports they use.
  - **An API tsconfig that maps `@<name>/constructs/*`**. Only the `--monorepo`
    copy did; in the fullstack one it fell through to `packages/*/src`.
  - **An auth app built by `gkm`**, since its entry is generated from the
    `BetterAuth` construct — not `tsc` over a `src/` that no longer exists.
  - **Third-party ranges inside the packages' peer ranges**, kept in one place:
    Kysely 0.29, Hono 4.13, Better Auth 1.7 on the server and every client, pino
    10, Zod 4.6, kysely-ctl 0.21.
  - **A client the site can import**: `./client` points at the per-surface
    `.gkm/openapi/api.ts`, and the API depends on what that file imports.
  - 💄 **UI barrel imports that resolve** to `<name>/index.tsx`.
  - **A Next.js site that typechecks**: no project `references` to packages that
    are not `composite`, which made its `tsc --noEmit` fail with TS6306.
  - **A Biome config Biome 2 accepts**: `assist` and `files.includes` rather than
    the 1.x `organizeImports` and `files.ignore`, and Tailwind directives parsed.
  - ✅ **Tests that run**: the root Vitest config uses projects, so the API's own
    `globalSetup` runs; the API ships the `users` migration its endpoints and
    that setup expect; the example test asks for testkit's `trx` fixture, and
    hands testkit a connection function.
  - **No `NODE_ENV` among the development secrets.** `gkm exec` injects secrets
    over the environment, so every `gkm exec -- next build` was a development
    build, which Next refuses to prerender.

  `gkm build` in a workspace no longer runs an OpenAPI pass after every app has
  built: each surface's own build already writes its client before anything
  depending on it builds.

  `gkm init shop--monorepo` — a missing space — is refused with the command that
  was meant, instead of scoping every package and physical name under it.

  The release workflow syncs the scaffold's pinned versions after `changeset
version` bumps them, and rebuilds the CLI before publishing; `alpha.6`
  scaffolded `alpha.5`.

- Updated dependencies [[`960425f`](https://github.com/geekmidas/toolbox/commit/960425f73bc99ab0304c8ef2d22c7e98ca8313a4)]:
  - @geekmidas/constructs@10.0.0-alpha.7
  - @geekmidas/manifest@10.0.0-alpha.7
  - @geekmidas/cache@10.0.0-alpha.7
  - @geekmidas/db@10.0.0-alpha.7
  - @geekmidas/envkit@10.0.0-alpha.7
  - @geekmidas/errors@10.0.0-alpha.7
  - @geekmidas/logger@10.0.0-alpha.7
  - @geekmidas/schema@10.0.0-alpha.7
  - @geekmidas/telescope@10.0.0-alpha.7

## 10.0.0-alpha.6

### Major Changes

- [#37](https://github.com/geekmidas/toolbox/pull/37) [`0e99180`](https://github.com/geekmidas/toolbox/commit/0e991805d82c0affae5f12d6d7d31eddd82533fc) Thanks [@geekmidas](https://github.com/geekmidas)! - `c`, `s` and `f` are gone

  The free-standing builders produced a construct with no owner, and an unowned
  construct no longer builds: it has nothing to take a logger or an environment
  parser from, and nothing says which process runs it. Keeping them exported
  meant shipping an API whose only outcome was a build error.

  Everything runnable now comes from the process that runs it, and comes from it
  _directly_ — there is no `crons`, `subscribers` or `functions` namespace to
  reach through:

  ```ts
  export const worker = new Worker('Jobs', { logger }).database(database);

  export const cleanup = worker.cron('rate(1 day)').handle(…);
  export const onUserCreated = worker.topic(users).subscribe(['user.created']).handle(…);
  export const reindex = worker.input(schema).handle(…);
  ```

  The namespaces named a collection in order to reach one member of it, and only
  crons had sugar past them — `worker.cron(schedule)` existed while
  `worker.functions.input(…)` did not. Which kind is being built is decided by
  what is called first: a schedule makes a cron, a topic makes a subscriber, and
  anything else makes a function.

  A worker is not a container — it names which process runs a runnable and what
  logger it runs with — so declaring one costs nothing, and declaring several is
  several groupings rather than several deployments.

  Migration is mechanical: declare a `Worker`, then replace `c` with
  `worker.crons`, `s` with `worker.subscribers` and `f` with `worker.functions`.
  The `.logger(…)` call each of them used to need goes away, because the worker
  carries it.

### Minor Changes

- [#35](https://github.com/geekmidas/toolbox/pull/35) [`26fc832`](https://github.com/geekmidas/toolbox/commit/26fc832910fef9ed6adabfeb76cfb3712219f6e2) Thanks [@geekmidas](https://github.com/geekmidas)! - Crons run on a server target

  A cron used to run on AWS Lambda and nowhere else. `CronGenerator` returned an
  empty array for every other provider, and `.gkm/server/` held `endpoints.ts`,
  `queues.ts` and `subscribers.ts` but no crons — so a scheduled job on a server
  deploy built, deployed, and never fired.

  It now generates `crons.ts` exporting `setupCrons`, which the generated entry
  calls beside `setupSubscribers` and `setupQueues`. Same shape, same place: the
  process that serves the endpoints schedules the crons.

  **The schedule lives in Postgres**, in the database the worker names:

  ```ts
  export const jobs = new Worker("Jobs", { logger }).database(database);
  ```

  pg-boss holds it there, so a deployment running four replicas fires each job
  once — which is what a timer in every process gets wrong and never reports.

  Declared rather than discovered, and no connection string appears anywhere. The
  construct that owns the database is the only thing that knows its key; it is
  resolved through service discovery like any other dependency. Inferring the
  store from whatever database an app happened to declare would work until it
  declared a second, and then move the schedules without saying so.

  **A known limitation of workers.** A worker with crons and no `.database(…)`
  schedules nothing on a server target and reports why at startup. On AWS the
  question does not arise — a cron is an EventBridge rule. The store could as
  well be a cache or something the deploy target provisions; Postgres is what
  exists today.

  `toCronExpression` converts a `ScheduleExpression` to standard cron.
  `cron(…)` unwraps; `rate(n unit)` converts when it divides its unit evenly.
  When it does not — `rate(7 hours)`, whose `*/7` fires at 0, 7, 14, 21 and then
  restarts three hours later — it throws rather than rounding. A job at the wrong
  hour is harder to notice than one that refused to build.

### Patch Changes

- [#37](https://github.com/geekmidas/toolbox/pull/37) [`5492dea`](https://github.com/geekmidas/toolbox/commit/5492dea08655c60529fe4b8a25b7bee4e02ff2fc) Thanks [@geekmidas](https://github.com/geekmidas)! - Projects with storage could not start: the MinIO image needs a login

  MinIO put `quay.io/minio/minio` behind authentication, so every compose file
  the CLI writes (`gkm init`, `gkm setup`, `gkm docker`, deploy) failed at the
  pull with `unauthorized`. The default is now `pgsty/minio`, a community build
  of the same server, pinned at `RELEASE.2026-08-04T00-00-00Z`. It keeps the
  same entrypoint, `mc` and `curl`, so the healthchecks and bucket bootstrapping
  still work. If a project already pins its own MinIO image in config, that pin
  wins.

- 🐛 [#35](https://github.com/geekmidas/toolbox/pull/35) [`f3c5998`](https://github.com/geekmidas/toolbox/commit/f3c59982c992286659e7717c1093e509b2ea942f) Thanks [@geekmidas](https://github.com/geekmidas)! - A single-app scaffold could not resolve its own `~/` imports

  The monorepo and fullstack layouts mapped `~/*` to `./src/*`; a single app did
  not. Every `~/…` import the templates write — the api's `~/router.ts`, the
  worker's `~/constructs/worker.ts` — resolved to nothing, and the project failed
  on its first build with `Cannot find package '~'`.

  Found by building a scaffolded worker rather than by reading the generator,
  which is the only way this kind of thing is found.

- Updated dependencies [[`0e99180`](https://github.com/geekmidas/toolbox/commit/0e991805d82c0affae5f12d6d7d31eddd82533fc), [`26fc832`](https://github.com/geekmidas/toolbox/commit/26fc832910fef9ed6adabfeb76cfb3712219f6e2)]:
  - @geekmidas/constructs@10.0.0-alpha.6
  - @geekmidas/cache@10.0.0-alpha.6
  - @geekmidas/db@10.0.0-alpha.6
  - @geekmidas/envkit@10.0.0-alpha.6
  - @geekmidas/errors@10.0.0-alpha.6
  - @geekmidas/logger@10.0.0-alpha.6
  - @geekmidas/manifest@10.0.0-alpha.6
  - @geekmidas/schema@10.0.0-alpha.6
  - @geekmidas/telescope@10.0.0-alpha.6

## 10.0.0-alpha.5

### Patch Changes

- [#34](https://github.com/geekmidas/toolbox/pull/34) [`faf13c3`](https://github.com/geekmidas/toolbox/commit/faf13c3f3381bfda8fa3cb217d84303ebece5ad1) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm init --template worker` produced a project that did not compile

  Three faults, in a template described as "Background job processing":

  It scaffolded `src/crons/cleanup.ts` importing `{ cron }` from
  `@geekmidas/constructs/crons` — an export that does not exist. The generated
  project failed to resolve on first build.

  It declared a `RestApi` with no endpoints on it: an HTTP surface, in a project
  whose premise is that nothing calls it over HTTP. A surface was the only
  construct that made an app exist and the only way to get a logger into the
  generated runtime, so one was written for that reason alone. It is built from
  `Worker` now — no authorizer, no address, and its factories carry its logger,
  so a subscriber file opens with what it subscribes to.

  Its subscriber destructured `event` where the handler is passed `events`, a
  batch. Both transports deliver in batches.

  It also scaffolds no cron any more. `CronGenerator` emits handlers for
  `aws-lambda` only and `.gkm/server/` has no crons file, so a scheduled job on a
  server target deploys nothing at all — an example that teaches a feature which
  silently does not happen is worse than no example. Subscribers and queues do
  have a server runtime, and are what the template teaches until there is a
  scheduler to run a cron.

  `apps/example` is removed in the same change: it still declared `routes`,
  `envParser` and `logger`, a config shape v10 does not read, and nothing
  typechecked it because `apps/` is absent from the root tsconfig's references.

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.5
  - @geekmidas/constructs@10.0.0-alpha.5
  - @geekmidas/db@10.0.0-alpha.5
  - @geekmidas/envkit@10.0.0-alpha.5
  - @geekmidas/errors@10.0.0-alpha.5
  - @geekmidas/logger@10.0.0-alpha.5
  - @geekmidas/manifest@10.0.0-alpha.5
  - @geekmidas/schema@10.0.0-alpha.5
  - @geekmidas/telescope@10.0.0-alpha.5

## 10.0.0-alpha.4

### Patch Changes

- [`dce9588`](https://github.com/geekmidas/toolbox/commit/dce958803067a24ec3c9ecbba2c76fd00d971904) Thanks [@geekmidas](https://github.com/geekmidas)! - Every package now agrees on every dependency version

  One hundred dependencies were realigned so that each has a single range per
  field across the repo. Thirty had disagreed with themselves — `hono` carried
  four different peer ranges, `@types/pg` four dev ranges, `@middy/core` four of
  each — which meant two packages could install two copies of the same library
  and behave differently for reasons nobody had chosen.

  Twenty-three were major bumps, and three of them broke something real:

  **OpenTelemetry 1.x → 2.x** removed `addSpanProcessor` and
  `BasicTracerProvider.register()`. Processors are constructor-only now, because a
  provider whose pipeline could be re-plumbed after it had begun producing spans
  was never safe. `NodeTracerProvider.register()` survives and is still the right
  call where the async-hooks context manager is wanted.

  **Zod 4.1 → 4.6** exposed a generator bug rather than causing one. A schema that
  _is_ a registered schema now converts to a bare `$ref` where it used to be
  inlined, and `OpenApiTsGenerator` turned that into `export type User = User` — a
  circular alias that is not a type. The def it points at was already being
  emitted; the generator now leaves the declaration to it. 4.6 also collapses a
  union of primitives to a `type` array instead of `anyOf`, which is the 2020-12
  spelling this project already emits.

  **better-auth 1.7** removed `runAdapterTest`, the conformance harness
  `memoryAdapter` was tested with. There is nothing to repair — the API is gone —
  so that suite is skipped with the gap recorded rather than deleted, because a
  deleted file would not say that `memoryAdapter` now has no test.

  Not included: the build and test toolchain — TypeScript, Vitest, Vite,
  Storybook — and `expo-secure-store`, whose version tracks an Expo SDK release
  train. Those replace how every package compiles and runs, and belong where a
  failure has one candidate cause instead of twenty-eight.

- Updated dependencies [[`dce9588`](https://github.com/geekmidas/toolbox/commit/dce958803067a24ec3c9ecbba2c76fd00d971904)]:
  - @geekmidas/telescope@10.0.0-alpha.4
  - @geekmidas/schema@10.0.0-alpha.4
  - @geekmidas/constructs@10.0.0-alpha.4
  - @geekmidas/cache@10.0.0-alpha.4
  - @geekmidas/db@10.0.0-alpha.4
  - @geekmidas/envkit@10.0.0-alpha.4
  - @geekmidas/errors@10.0.0-alpha.4
  - @geekmidas/logger@10.0.0-alpha.4
  - @geekmidas/manifest@10.0.0-alpha.4

## 10.0.0-alpha.3

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.3
  - @geekmidas/constructs@10.0.0-alpha.3
  - @geekmidas/db@10.0.0-alpha.3
  - @geekmidas/envkit@10.0.0-alpha.3
  - @geekmidas/errors@10.0.0-alpha.3
  - @geekmidas/logger@10.0.0-alpha.3
  - @geekmidas/manifest@10.0.0-alpha.3
  - @geekmidas/schema@10.0.0-alpha.3
  - @geekmidas/telescope@10.0.0-alpha.3

## 10.0.0-alpha.2

### Patch Changes

- [#29](https://github.com/geekmidas/toolbox/pull/29) [`3426eae`](https://github.com/geekmidas/toolbox/commit/3426eaec72e0837a33dae873d7fe36282445158b) Thanks [@geekmidas](https://github.com/geekmidas)! - The published package could not be installed

  `10.0.0-alpha.1` crashed on `gkm init`. Three packaging faults, each of which
  made `@geekmidas/constructs` unloadable for anyone who was not inside this
  repository — where pnpm's workspace links hid all of them.

  **Statically imported packages were declared optional peers.** `queue/Queue.ts`
  imports `Publisher` from `@geekmidas/events` as a value, and `envkit`,
  `errors`, `logger`, `manifest`, `schema` and `services` are imported by entries
  that always load. All were `peerDependenciesMeta.optional`, so a consumer's
  install fetched none of them. Installing the tarball on its own produced a
  package where _no entry point loaded at all_ — `gkm init` only reached
  `@geekmidas/events` because the CLI happened to depend on the rest directly.
  They are dependencies now, which is what a static import means.

  **`@geekmidas/telescope` was a required peer of a type-only import.**
  `rest-api.ts` does `import type { Telescope }`, which has no runtime, yet the
  peer was non-optional and exactly pinned — so every install warned it was
  missing and pnpm reported `Conflicting peer dependencies` against the CLI's own
  range. Marked optional.

  **Declaring a cron required AWS Lambda middleware.** `crons/index.ts`
  re-exported `AWSScheduledFunction`, so importing the barrel to declare a cron
  pulled in `@middy/core`. The adaptor was already exported from
  `@geekmidas/constructs/aws`, the entry that admits it needs Lambda; the
  redundant re-export is gone and `CronGenerator` emits the `/aws` specifier.

  Verified by packing the tarballs, installing them into an empty project the way
  a consumer does, and running `gkm init --monorepo` to completion.

- Updated dependencies [[`3426eae`](https://github.com/geekmidas/toolbox/commit/3426eaec72e0837a33dae873d7fe36282445158b), [`96ec6a7`](https://github.com/geekmidas/toolbox/commit/96ec6a73efbfaaf5f17f378ac3647d3c970297a9), [`05ce914`](https://github.com/geekmidas/toolbox/commit/05ce91446ba29d5158a2a5c010f7bf9c00f761eb)]:
  - @geekmidas/constructs@10.0.0-alpha.2
  - @geekmidas/telescope@10.0.0-alpha.2
  - @geekmidas/logger@10.0.0-alpha.2
  - @geekmidas/cache@10.0.0-alpha.2
  - @geekmidas/db@10.0.0-alpha.2
  - @geekmidas/envkit@10.0.0-alpha.2
  - @geekmidas/errors@10.0.0-alpha.2
  - @geekmidas/manifest@10.0.0-alpha.2
  - @geekmidas/schema@10.0.0-alpha.2

## 10.0.0-alpha.1

### Major Changes

- [#24](https://github.com/geekmidas/toolbox/pull/24) [`979731e`](https://github.com/geekmidas/toolbox/commit/979731eec71ecd8519a339fd2a36d68c24140d22) Thanks [@geekmidas](https://github.com/geekmidas)! - `gkm init --monorepo` scaffolds constructs, not an `apps` block

  It was the last thing producing the shape v10 removed. A scaffolded workspace
  got a `gkm.config.ts` naming three apps — type, path, port, framework,
  dependencies — with `envParser` and `logger` as module paths beside them, which
  is precisely what the surface replaced.

  The generated config is three keys: the name, the constructs glob, and secrets.
  Everything else it used to write, it wrote twice. `services` is gone, because a
  declared database is why a Postgres exists. `deploy` is gone, because that is
  picked at deploy time and it was writing the default anyway. `shared` is gone
  because nothing reads it.

  In its place is a `constructs/` directory at the workspace root — the database
  and the auth server's schema in it, the surface, the auth server, the site —
  reached from the apps through the `@<name>/constructs/*` path the tsconfig maps.

  `apps/auth` loses its hand-written Hono server: the PORT read, the CORS list
  split out of `BETTER_AUTH_TRUSTED_ORIGINS`, the `/api/auth/*` mount and the
  Better Auth instance behind them. The `BetterAuth` construct declares all of it
  and the build generates the entry, because the routes are a wildcard no glob
  can find.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/cache@10.0.0-alpha.1
  - @geekmidas/constructs@10.0.0-alpha.1
  - @geekmidas/db@10.0.0-alpha.1
  - @geekmidas/envkit@10.0.0-alpha.1
  - @geekmidas/errors@10.0.0-alpha.1
  - @geekmidas/logger@10.0.0-alpha.1
  - @geekmidas/manifest@10.0.0-alpha.1
  - @geekmidas/schema@10.0.0-alpha.1
  - @geekmidas/telescope@10.0.0-alpha.1

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
  - @geekmidas/cache@10.0.0-alpha.0
  - @geekmidas/constructs@10.0.0-alpha.0
  - @geekmidas/db@10.0.0-alpha.0
  - @geekmidas/envkit@10.0.0-alpha.0
  - @geekmidas/errors@10.0.0-alpha.0
  - @geekmidas/logger@10.0.0-alpha.0
  - @geekmidas/manifest@10.0.0-alpha.0
  - @geekmidas/schema@10.0.0-alpha.0
  - @geekmidas/telescope@10.0.0-alpha.0

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
  - @geekmidas/envkit@9.0.2
  - @geekmidas/errors@9.0.2
  - @geekmidas/logger@9.0.2
  - @geekmidas/manifest@9.0.2
  - @geekmidas/schema@9.0.2
  - @geekmidas/telescope@9.0.2

## 2.0.2

### Patch Changes

- 🐛 [#11](https://github.com/geekmidas/toolbox/pull/11) [`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309) Thanks [@geekmidas](https://github.com/geekmidas)! - Patch release across all packages to realign published versions with the
  registry. The previous release only published the four packages that had
  version bumps; the remaining packages failed with "cannot publish over the
  previously published versions" because their versions were unchanged.
- Updated dependencies [[`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309)]:
  - @geekmidas/constructs@7.0.1
  - @geekmidas/envkit@1.1.1
  - @geekmidas/errors@1.0.2
  - @geekmidas/logger@1.0.3
  - @geekmidas/manifest@0.1.1
  - @geekmidas/schema@1.0.4
  - @geekmidas/telescope@1.1.1

## 2.0.1

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@7.0.0

## 2.0.0

### Patch Changes

- [#9](https://github.com/geekmidas/toolbox/pull/9) [`e31a60a`](https://github.com/geekmidas/toolbox/commit/e31a60a971366180a0e7bec6e7da56d8f36aa21f) Thanks [@geekmidas](https://github.com/geekmidas)! - Support kysely 0.29.

  kysely 0.29 moved `Migrator` and `FileMigrationProvider` from the root barrel
  (`'kysely'`) to the `'kysely/migration'` subpath. `@geekmidas/testkit`'s
  `PostgresKyselyMigrator` now imports `Migrator` from `'kysely/migration'` and
  its kysely peer becomes `~0.29.4` — consumers must be on kysely 0.29+.

  The library packages that only declare a kysely _peer_ (`db`, `audit`, `studio`,
  `telescope`) don't touch the moved symbols, so their peer range is _widened_ to
  `>=0.28.2 <0.30.0` — they now support both 0.28 and 0.29 (non-breaking).

  `@geekmidas/cli`'s scaffolded `test/globalSetup.ts` template now imports
  `FileMigrationProvider` from `'kysely/migration'` so generated projects work on
  kysely 0.29.

- Updated dependencies [[`e31a60a`](https://github.com/geekmidas/toolbox/commit/e31a60a971366180a0e7bec6e7da56d8f36aa21f)]:
  - @geekmidas/telescope@1.1.0
  - @geekmidas/constructs@6.0.0

## 1.12.0

### Minor Changes

- [#8](https://github.com/geekmidas/toolbox/pull/8) [`b004fd8`](https://github.com/geekmidas/toolbox/commit/b004fd8ee74b5f20a047260b16669d16d8fc03b4) Thanks [@geekmidas](https://github.com/geekmidas)! - feat: queue workers (`q`) — producer, runtime adaptors, and `gkm` discovery

  Adds end-to-end support for point-to-point queues, alongside subscribers (`s`):

  **`@geekmidas/constructs/queue`** — the `q` builder:

  ```ts
  import { q } from '@geekmidas/constructs/queue';

  export const orders = q
    .queue('orders')
    .services([db])              // array; sniffed for required env vars
    .message(z.object({ orderId: z.string() }))
    .handle(async ({ messages, services }) => { … }); // the single consumer
  ```

  Unlike `s` (topic fan-out, filtered by `subscribedEvents`), a queue drains
  _every_ message of its one typed `message`.

  - **Producer side** — `orders.publisher`, a ready-to-inject `Service` typed to
    the queue's message. Drop it into any `.services([...])` and call
    `services.ordersPublisher.publish([{ type: 'orders', payload }])`. It reads
    `<NAME>_PUBLISHER_CONNECTION_STRING` and picks its transport from the URL
    protocol — `pgboss://` locally, `sqs://` deployed — so the same code targets
    Postgres in dev and SQS in prod. The env requirement is sniffed into the
    manifest, so infra links exactly that queue with least privilege.
  - **Runtime adaptors** — `AWSLambdaQueue` (`@geekmidas/constructs/aws`, SQS
    event-source with partial-batch failures) and `TestQueueAdaptor`
    (`@geekmidas/constructs/testing`).

  **`@geekmidas/cli`** — `gkm build`/`gkm dev` discover `q` definitions:

  - ✨ New `queues: './src/queues/**/*.ts'` config glob.
  - Server / `gkm dev`: an in-process pg-boss poller (`setupQueues()`) runs
    alongside the Hono server — each queue subscribes by its name on the shared
    `EVENT_SUBSCRIBER_CONNECTION_STRING`. Queues are background workers, not HTTP
    routes.
  - AWS: one `AWSLambdaQueue` handler per queue.
  - Queues are recorded in the manifest's `queues` field (`QueueInfo`).

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`0dad77e`](https://github.com/geekmidas/toolbox/commit/0dad77e574000e4018033b956ed4bb95935911a5) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(topic): add the `t` topic construct + derived publisher (closes the topic/queue asymmetry)

  Topics now have the same app-driven story queues already had — declare the topic
  in the app, get a typed publisher for free, and let `gkm build` capture it. This
  removes the need to hand-write a publisher `Service` (e.g. `EventsService`) to
  fan events out.

  **`@geekmidas/constructs/topic`** — the `t` builder:

  ```ts
  import { t } from "@geekmidas/constructs/topic";

  export const userTopic = t.topic("users").events({
    "user.created": z.object({ userId: z.string(), email: z.string() }),
    "user.updated": z.object({
      userId: z.string(),
      changes: z.array(z.string()),
    }),
  });
  ```

  - A `Topic` is a _resource_ construct (`ConstructType.Topic`) — fan-out, owned by
    no single handler. It declares the event contract and derives a publisher.
  - **`userTopic.publisher`** — a derived `Service` typed to the union of the topic's
    events, reading `<NAME>_PUBLISHER_CONNECTION_STRING` (transport by protocol:
    `sns://` deployed, `pgboss://` local). Replaces hand-written publisher services.
    Inject via `.publisher(userTopic.publisher)` (declarative `.event(...)`) or
    `.services([userTopic.publisher])`.
  - **`s.topic(userTopic)`** — binds a subscriber to a topic: supplies the
    subscribable event types/payloads _and_ records the binding for the manifest.
    A consumer doesn't publish, so this requires **no** publisher connection string
    (least privilege) — unlike typing via `.publisher(...)`.

  **`@geekmidas/manifest`** — new `TopicInfo` + `manifest.topics`; `SubscriberInfo`
  gains `topic` (the bound topic name).

  **`@geekmidas/cli`** — `TopicGenerator` discovers `t` topics into `manifest.topics`
  (a topic has no handler to generate); new `topics` config glob; wired through
  `gkm build`/`gkm dev` and both manifest writers.

  Hand-written publisher services still work; `t` is the encouraged path.

### Patch Changes

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`b42e96b`](https://github.com/geekmidas/toolbox/commit/b42e96b9dd28d8926a1253a97aa553bd0e08bf56) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(cloud): add `fromManifest` integrators backed by a shared `@geekmidas/manifest` package

  Introduces `@geekmidas/manifest` — a dependency-free package holding the
  deployment manifest types (`RouteInfo`/`FunctionInfo`/`CronInfo`/`SubscriberInfo`
  and their `*Manifest` containers) that `gkm build` emits. `@geekmidas/cli`
  re-exports these from the shared package (no behaviour change), so producer and
  consumers share one contract.

  `@geekmidas/cloud/sst` constructs gain static `fromManifest` factories that map
  a manifest straight into infrastructure:

  - `Api.fromManifest(stack, id, routesManifest, props)` — one route per
    `RouteInfo` (env vars, authorizer, timeout/memory mapped); supply
    `authorizers`/`links`/native args via `props`.
  - `Function.fromManifest(stack, functionsManifest, props)` — one `Function` per
    entry.
  - `Cron.fromManifest(stack, cronsManifest, { links, ... })` — one `Cron` per
    entry; each handler becomes a validated `Function` the cron triggers.

  `Api` routes also gain per-route `timeout`/`memory` passthrough.

- ✨ [#8](https://github.com/geekmidas/toolbox/pull/8) [`03b08fe`](https://github.com/geekmidas/toolbox/commit/03b08feba2e735539c43f95b77792c18a627b07d) Thanks [@geekmidas](https://github.com/geekmidas)! - refactor(manifest): model the unified `gkm build` manifest and add `QueueInfo`

  `gkm build` emits a single TypeScript module per provider
  (`export const manifest = { routes, functions, crons, subscribers } as const`),
  not separate JSON files. `@geekmidas/manifest` now models that:

  - a unified `Manifest` type plus `ManifestField<T>` (a field is a flat
    `readonly T[]` or a partitioned `Record<string, readonly T[]>`) and a
    `flattenManifestField` helper;
  - the item types (`RouteInfo`/`FunctionInfo`/`CronInfo`/`SubscriberInfo`) gain a
    new `QueueInfo`, `SubscriberInfo.transport`, and readonly array fields so the
    `as const` manifest assigns cleanly;
  - 🔥 the per-unit `*Manifest` wrapper types are removed.

  `@geekmidas/cloud/sst`'s `Api`/`Function`/`Cron` `fromManifest` now take the
  manifest **field** (`Api.fromManifest(stack, id, manifest.routes, …)`) and
  flatten the flat-or-partitioned shape. `@geekmidas/cli` re-exports the updated
  types.

  Also fixes `@geekmidas/events` to externalise `pg-boss` (it was the one
  transport dep being bundled).

- Updated dependencies [[`b42e96b`](https://github.com/geekmidas/toolbox/commit/b42e96b9dd28d8926a1253a97aa553bd0e08bf56), [`b004fd8`](https://github.com/geekmidas/toolbox/commit/b004fd8ee74b5f20a047260b16669d16d8fc03b4), [`7323f34`](https://github.com/geekmidas/toolbox/commit/7323f34176d63170dd53450889ac0b5959420c3c), [`79e2929`](https://github.com/geekmidas/toolbox/commit/79e292978d3dbc8927e25814bdb051d1c380600a), [`03b08fe`](https://github.com/geekmidas/toolbox/commit/03b08feba2e735539c43f95b77792c18a627b07d), [`0dad77e`](https://github.com/geekmidas/toolbox/commit/0dad77e574000e4018033b956ed4bb95935911a5)]:
  - @geekmidas/manifest@0.1.0
  - @geekmidas/constructs@5.0.0
  - @geekmidas/envkit@1.1.0

## 1.11.0

### Minor Changes

- ✨ [#6](https://github.com/geekmidas/toolbox/pull/6) [`86a7967`](https://github.com/geekmidas/toolbox/commit/86a7967332a437c73177d06f6a2ed709e42c7060) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(cli): add `gkm test --auto-setup` to self-provision a stage in CI

  `gkm test` previously required a local secrets file and the matching `~/.gkm`
  encryption key, so it could not run on a fresh CI checkout (where `.env` and
  `.gkm/` are gitignored).

  With `--auto-setup` (or the `GKM_AUTO_SETUP` env var), `gkm test` now
  regenerates a fresh stage from the committed `gkm.config.ts` when no secrets
  exist — minting service credentials and a local key, then starting Docker with
  those values. For tests this is safe because the credentials are ephemeral local
  service passwords used to bring up the matching containers. The behavior is a
  no-op when secrets already exist and is scoped to `gkm test` only.

## 1.10.41

### Patch Changes

- Updated dependencies [[`811d740`](https://github.com/geekmidas/toolbox/commit/811d740ae3875d59ad1b0dc50261266963c8cb76)]:
  - @geekmidas/constructs@4.0.0

## 1.10.40

### Patch Changes

- Updated dependencies [[`a20be2f`](https://github.com/geekmidas/toolbox/commit/a20be2faa4795600358904b751fa947d3cbb4c45), [`07093f5`](https://github.com/geekmidas/toolbox/commit/07093f5f911bf1ee48e53275da3cce398cc78ff6)]:
  - @geekmidas/constructs@3.1.0

## 1.10.39

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

- Updated dependencies [[`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651)]:
  - @geekmidas/constructs@3.0.12
  - @geekmidas/envkit@1.0.7
  - @geekmidas/errors@1.0.1
  - @geekmidas/logger@1.0.2
  - @geekmidas/schema@1.0.2
  - @geekmidas/telescope@1.0.1

## 1.10.38

### Patch Changes

- 🐛 [`54b8743`](https://github.com/geekmidas/toolbox/commit/54b87433ba969a03afe56de0dba7c0173d15dbc9) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `gkm openapi` workspace-mode generation when invoked from a directory other than the workspace root. The command now derives the workspace root from the loaded config, so subprocess-per-app generation works regardless of where the command is invoked from (previously the subprocess used CWD and silently no-op'd or failed with `spawn node ENOENT`).

## 1.10.37

### Patch Changes

- 🐛 [`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix schema, openapi generation and events testkit

- Updated dependencies [[`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553)]:
  - @geekmidas/constructs@3.0.10
  - @geekmidas/schema@1.0.1

## 1.10.36

### Patch Changes

- [`2b83833`](https://github.com/geekmidas/toolbox/commit/2b83833758dce93e37104e7f4a83653000ab027b) Thanks [@geekmidas](https://github.com/geekmidas)! - Support custom environment variables for frontends

- 🐛 [`017e93a`](https://github.com/geekmidas/toolbox/commit/017e93aeaa1edc55a7f1f0520b08e8823e26343c) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `gkm openapi` failing on workspace builds when an app uses tsconfig path aliases (e.g. `~/*`) defined only in that app's `tsconfig.json`.

  Workspace mode now spawns one subprocess per backend app with `cwd` set to the app's directory, giving each generation its own tsx instance whose tsconfig discovery picks up the app's `paths` aliases. Adds a `--app <name>` flag to `gkm openapi` that the workspace flow uses internally to target a single app.

## 1.10.35

### Patch Changes

- ✨ [`b1de1e0`](https://github.com/geekmidas/toolbox/commit/b1de1e01e1181ea5c3edcf7e23dcf3a5128fc0f3) Thanks [@geekmidas](https://github.com/geekmidas)! - Add different framework support

## 1.10.34

### Patch Changes

- 🐛 [`b8a17e3`](https://github.com/geekmidas/toolbox/commit/b8a17e33de415a5d749297f7840564e824609a92) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix global zod registry and fix this reference on test extensions

## 1.10.33

### Patch Changes

- ✨ [`363c67f`](https://github.com/geekmidas/toolbox/commit/363c67fb3c3406bac6823326ab80ba55bff29e31) Thanks [@geekmidas](https://github.com/geekmidas)! - Add dynamic return types

- Updated dependencies [[`363c67f`](https://github.com/geekmidas/toolbox/commit/363c67fb3c3406bac6823326ab80ba55bff29e31)]:
  - @geekmidas/constructs@3.0.9

## 1.10.32

### Patch Changes

- ✨ [`0830c6e`](https://github.com/geekmidas/toolbox/commit/0830c6e0d60842526788e0e1f0e78827514ea7b3) Thanks [@geekmidas](https://github.com/geekmidas)! - Add optional sniff support

- Updated dependencies [[`0830c6e`](https://github.com/geekmidas/toolbox/commit/0830c6e0d60842526788e0e1f0e78827514ea7b3)]:
  - @geekmidas/constructs@3.0.8
  - @geekmidas/logger@1.0.1

## 1.10.31

### Patch Changes

- ✨ [`56e71bc`](https://github.com/geekmidas/toolbox/commit/56e71bcb57a5305270909f695a4539fa504a463b) Thanks [@geekmidas](https://github.com/geekmidas)! - Add optional params support and open api on build

- Updated dependencies [[`56e71bc`](https://github.com/geekmidas/toolbox/commit/56e71bcb57a5305270909f695a4539fa504a463b)]:
  - @geekmidas/envkit@1.0.5

## 1.10.30

### Patch Changes

- ✨ [`79e17a8`](https://github.com/geekmidas/toolbox/commit/79e17a84e630f102023005994d9d45b37f7d9d8f) Thanks [@geekmidas](https://github.com/geekmidas)! - Add msw support for construct testing for ui

- Updated dependencies [[`79e17a8`](https://github.com/geekmidas/toolbox/commit/79e17a84e630f102023005994d9d45b37f7d9d8f)]:
  - @geekmidas/constructs@3.0.7

## 1.10.29

### Patch Changes

- ✨ [`3941ae6`](https://github.com/geekmidas/toolbox/commit/3941ae6c9027fddb32999b9f98af813a12867877) Thanks [@geekmidas](https://github.com/geekmidas)! - Add db to authorizer

- Updated dependencies [[`3941ae6`](https://github.com/geekmidas/toolbox/commit/3941ae6c9027fddb32999b9f98af813a12867877)]:
  - @geekmidas/constructs@3.0.6

## 1.10.28

### Patch Changes

- 🔥 [`9e8f923`](https://github.com/geekmidas/toolbox/commit/9e8f9239798649bedeb16906ed83d0b71065c917) Thanks [@geekmidas](https://github.com/geekmidas)! - Remove client generation from cli

## 1.10.27

### Patch Changes

- 🐛 [`bead80b`](https://github.com/geekmidas/toolbox/commit/bead80b78437f616c593c521a39a22155de3c498) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix recociliation to have pg boss

## 1.10.26

### Patch Changes

- 🐛 [`5691cdf`](https://github.com/geekmidas/toolbox/commit/5691cdfc8298e8f943de8b3541b8e79ce64edccd) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix subsciber defaults

## 1.10.25

### Patch Changes

- 🐛 [`26765a3`](https://github.com/geekmidas/toolbox/commit/26765a3d1ce6a568e609011ab218455a1062dd2c) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix node options on exec

## 1.10.24

### Patch Changes

- 🐛 [`b3565b8`](https://github.com/geekmidas/toolbox/commit/b3565b89e57f100157faf82d89077c3d24df78fd) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix exec script to load mjs instead of ts

## 1.10.23

### Patch Changes

- 🐛 [`61ae404`](https://github.com/geekmidas/toolbox/commit/61ae404061a1061c4a724d0f187764475903b625) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix tsx import

## 1.10.22

### Patch Changes

- 🐛 [`acfc00a`](https://github.com/geekmidas/toolbox/commit/acfc00a0ec99691e978c3d0978f3ec63e1ec9869) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix tsx loader for loading extentionless typescript files

## 1.10.21

### Patch Changes

- ✨ [`9b56519`](https://github.com/geekmidas/toolbox/commit/9b5651989ccd1ca55c8b7150647c850eda056213) Thanks [@geekmidas](https://github.com/geekmidas)! - Add debugging and complete traces

## 1.10.20

### Patch Changes

- 🐛 [`02991d4`](https://github.com/geekmidas/toolbox/commit/02991d410c4f2fab5fbaa568300e5d8943b3ba45) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix dev command port credentials resolution

## 1.10.19

### Patch Changes

- ✨ [`ac041cc`](https://github.com/geekmidas/toolbox/commit/ac041cc459e87107ffb4e508e85c04c3079bf040) Thanks [@geekmidas](https://github.com/geekmidas)! - Add objection pagination and fix secret loading for server apps

## 1.10.18

### Patch Changes

- 🐛 [`70a63e5`](https://github.com/geekmidas/toolbox/commit/70a63e57e1867c88b79c66fe979c613ce2272d54) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix exec command to resolve the correct credentials

## 1.10.17

### Patch Changes

- 🐛 [`94a25c0`](https://github.com/geekmidas/toolbox/commit/94a25c01ee2a0313eb01260055e4988b20c64dc4) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix exec command credentials resolution

## 1.10.16

### Patch Changes

- ✨ [`9607c5e`](https://github.com/geekmidas/toolbox/commit/9607c5e6045bf0a4df3bee81437df2b3d7a34513) Thanks [@geekmidas](https://github.com/geekmidas)! - Add events support on root config

## 1.10.15

### Patch Changes

- ✨ [`619e4e6`](https://github.com/geekmidas/toolbox/commit/619e4e6e3de73c0266008e9747d7bd735e214216) Thanks [@geekmidas](https://github.com/geekmidas)! - Add default MAIL_FROM and SMTP_SECURE

## 1.10.14

### Patch Changes

- 🐛 Fix smtp resolution ports

## 1.10.13

### Patch Changes

- ✨ [`a2738e2`](https://github.com/geekmidas/toolbox/commit/a2738e23c47ab4291284d7c1abffb97f9665cfe5) Thanks [@geekmidas](https://github.com/geekmidas)! - Add mailpit credentails to reconsiliation

## 1.10.12

### Patch Changes

- ✨ [`3c920fe`](https://github.com/geekmidas/toolbox/commit/3c920feb4aca4ec3b1a3bab2c88a35be5c986ddd) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix service start on test and also add mailpit env

## 1.10.11

### Patch Changes

- 🐛 [`a0917af`](https://github.com/geekmidas/toolbox/commit/a0917af20fce16ae7482dd3712d11d2d9351c714) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix minio credentials mapping

## 1.10.10

### Patch Changes

- 🐛 [`71cb452`](https://github.com/geekmidas/toolbox/commit/71cb45209123fdca32ad6aa2e2995daae307848a) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix docker service reconsiliation

## 1.10.9

### Patch Changes

- 🐛 [`4010c0d`](https://github.com/geekmidas/toolbox/commit/4010c0dae742b725c036801a4a5d8b42432fbbfe) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix bug when running gkm dev and test to run all docker services

## 1.10.8

### Patch Changes

- 🐛 [`ef1754d`](https://github.com/geekmidas/toolbox/commit/ef1754dd96cfc0f6e79a04ac9eaff56e37023f0f) Thanks [@geekmidas](https://github.com/geekmidas)! - fix test and dev commands to inject correct creds on compose

## 1.10.7

### Patch Changes

- [`4a65756`](https://github.com/geekmidas/toolbox/commit/4a6575647cb91b8782182ef0d09cfb685565b6ae) Thanks [@geekmidas](https://github.com/geekmidas)! - Phantom push

## 1.10.6

### Patch Changes

- 🐛 [`d77b70e`](https://github.com/geekmidas/toolbox/commit/d77b70ebf8f68ae39a6daec02023703c2025167b) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix credentials for tests

## 1.10.5

### Patch Changes

- 🐛 [`c97b9db`](https://github.com/geekmidas/toolbox/commit/c97b9db7cb66040b461cd3682f0b82ae2f24bd14) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix credentials embedding

## 1.10.4

### Patch Changes

- 🐛 [`6123575`](https://github.com/geekmidas/toolbox/commit/6123575f05ba5c8563413fffdad67d0e2880fb08) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix config hosts

- 🐛 [`96618ff`](https://github.com/geekmidas/toolbox/commit/96618ff36fd3248bfc29f4517fda79eea4a66dda) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix credentials loading for tests

## 1.10.3

### Patch Changes

- 🐛 [`6a92fa7`](https://github.com/geekmidas/toolbox/commit/6a92fa737057d77178a4d31480505013fbe033af) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix dev scripts and spawns also when canceling prcocess.

## 1.10.2

### Patch Changes

- 🐛 [`fefefe0`](https://github.com/geekmidas/toolbox/commit/fefefe0e7825d95c333375ea280e9aba23599bf0) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix issue with env loading on docker during setup

## 1.10.1

### Patch Changes

- ✨ [`bfc5a4f`](https://github.com/geekmidas/toolbox/commit/bfc5a4f656445bb389b0532e9d3385d2e66a28fe) Thanks [@geekmidas](https://github.com/geekmidas)! - Add function context and suport for partitions

- Updated dependencies [[`bfc5a4f`](https://github.com/geekmidas/toolbox/commit/bfc5a4f656445bb389b0532e9d3385d2e66a28fe)]:
  - @geekmidas/constructs@3.0.1

## 1.10.0

### Minor Changes

- ✨ [`be4f7a9`](https://github.com/geekmidas/toolbox/commit/be4f7a9bd5de7f08adbca582916d6902e0c24de2) Thanks [@geekmidas](https://github.com/geekmidas)! - Add partition support for manifest generation. Users can now group constructs (routes, functions, crons, subscribers) into named partitions by providing a `partition` callback per construct type in the config. Manifests output partitioned fields as `Record<string, T[]>` while remaining flat `T[]` arrays when no partitions are configured.

  Fix mutation type inference in endpoint hooks by using `UseMutationResult` and `UseQueryResult` types directly instead of `ReturnType<typeof useMutation>`, which could resolve to `never` for complex path definitions.

  Add `FileCache` implementation that persists cache entries to a JSON file on disk. Default location is `process.cwd()/.gkm/cache.json`. Uses an in-process mutex combined with `proper-lockfile` for safe concurrent and cross-process writes.

### Patch Changes

- Updated dependencies []:
  - @geekmidas/constructs@3.0.0

## 1.9.1

### Patch Changes

- ✨ [`3d20e46`](https://github.com/geekmidas/toolbox/commit/3d20e46aa2454c322ffa9e482f23c12c9e9686d4) Thanks [@geekmidas](https://github.com/geekmidas)! - Add secret reconsilation and fix bug with dev loading credentials

## 1.9.0

### Minor Changes

- ✨ [`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661) Thanks [@geekmidas](https://github.com/geekmidas)! - Add pg-boss event publisher/subscriber, CLI setup and upgrade commands, and secrets sync via AWS SSM
  - ✨ **@geekmidas/events**: Add pg-boss backend for event publishing and subscribing with connection string support
  - ✨ **@geekmidas/cli**: Add `gkm setup` command for dev environment initialization, `gkm upgrade` command with workspace detection, and secrets push/pull via AWS SSM Parameter Store
  - 🐛 **@geekmidas/testkit**: Fix database creation race condition in PostgresMigrator
  - ✨ **@geekmidas/constructs**: Add integration tests for pg-boss with HonoEndpoint

### Patch Changes

- Updated dependencies [[`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661)]:
  - @geekmidas/constructs@2.0.0

## 1.8.0

### Minor Changes

- ⬆️ [`5c5d844`](https://github.com/geekmidas/toolbox/commit/5c5d8447d0bab29397879bcd723bf1f44c50e61c) Thanks [@geekmidas](https://github.com/geekmidas)! - Bump version to capture latest version of constructs

## 1.7.0

### Minor Changes

- 🔥 [`66a0eac`](https://github.com/geekmidas/toolbox/commit/66a0eacfb2aa711da5d67ec10f28a8fa8bcbdf1e) Thanks [@geekmidas](https://github.com/geekmidas)! - Remove test adaptor from subscriber exports

## 1.6.0

### Minor Changes

- ⚡️ [`73511d9`](https://github.com/geekmidas/toolbox/commit/73511d912062eb0776935168c9f72d42c7c854a6) Thanks [@geekmidas](https://github.com/geekmidas)! - Improve dev script experience and export function tester

### Patch Changes

- Updated dependencies [[`73511d9`](https://github.com/geekmidas/toolbox/commit/73511d912062eb0776935168c9f72d42c7c854a6)]:
  - @geekmidas/constructs@1.1.0

## 1.5.1

### Patch Changes

- 🐛 [`1a74469`](https://github.com/geekmidas/toolbox/commit/1a744694de77cdcc030ad5a5d99d6fc9800c0533) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix function adaptor for lambda

## 1.5.0

### Minor Changes

- ✨ [`36166de`](https://github.com/geekmidas/toolbox/commit/36166defde0a66e68cb9ac5c6a6856ea23e2da62) Thanks [@geekmidas](https://github.com/geekmidas)! - Add sniffing and config for frontend apps. Also ensure next.js apps get args at build time.

## 1.4.0

### Minor Changes

- 🐛 [`bebf821`](https://github.com/geekmidas/toolbox/commit/bebf821ce4534e314d3d536e9956260c4230a183) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix dependecy output injecttion for urls

## 1.3.0

### Minor Changes

- 🐛 [`bee0e64`](https://github.com/geekmidas/toolbox/commit/bee0e64367dc937869556de516fedfea64f2a438) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix route53 profile setting for state management, fix web templates on init.

## 1.2.3

### Patch Changes

- 🐛 [`11c96af`](https://github.com/geekmidas/toolbox/commit/11c96af896fa5355f37edd276fc96010cd177ccc) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix cli client generation for monorepos

## 1.2.2

### Patch Changes

- 🐛 [`ab91786`](https://github.com/geekmidas/toolbox/commit/ab917864eaf64793e5bc93818a98caeb5b766324) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix env var injection for dev, and make sure openapi generation for client apps

## 1.2.1

### Patch Changes

- 🐛 [`e4ab724`](https://github.com/geekmidas/toolbox/commit/e4ab724fc044bbcab9e4a1426e55b515a4185a2b) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix bug when running gkm exec so tsx is importted correctly

## 1.2.0

### Minor Changes

- 🔥 [`43d4451`](https://github.com/geekmidas/toolbox/commit/43d44510f1077ecdf0c64ae56c8d2d97d446cea2) Thanks [@geekmidas](https://github.com/geekmidas)! - Remove projectId from workspace config and move to state

## 1.1.0

### Minor Changes

- ✨ [`3b6d7d9`](https://github.com/geekmidas/toolbox/commit/3b6d7d9ed41dc08675395d937248a8ab754af9e1) Thanks [@geekmidas](https://github.com/geekmidas)! - Add state provider configuration to workspace config

## 1.0.2

### Patch Changes

- 🐛 [`159e365`](https://github.com/geekmidas/toolbox/commit/159e36572adb2b489629d4ab2a0142f8ff59b7a8) Thanks [@geekmidas](https://github.com/geekmidas)! - Resolve correct cli version at runtime

## 1.0.1

### Patch Changes

- [`169ccd6`](https://github.com/geekmidas/toolbox/commit/169ccd62ada0dfd23f47434b57b967213d1538e5) Thanks [@geekmidas](https://github.com/geekmidas)! - Use the correct version for cli dependencies

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release

### Patch Changes

- Updated dependencies [[`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8)]:
  - @geekmidas/constructs@1.0.0
  - @geekmidas/envkit@1.0.0
  - @geekmidas/errors@1.0.0
  - @geekmidas/logger@1.0.0
  - @geekmidas/schema@1.0.0
  - @geekmidas/telescope@1.0.0
