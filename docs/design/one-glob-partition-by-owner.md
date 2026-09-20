# One glob, partition by owner

Handover for the work behind PRs #24, #25 and #26. Written 2026-09-20, with #26
unfinished and said so.

## Where things stand

`10.0.0-alpha.0` is on npm under the `alpha` tag; `latest` is still `9.0.2`.
Changesets is in **pre mode**, so every release from here is `alpha.N` until
someone runs `changeset pre exit`.

Three PRs, each based on the previous. Merge in order.

| PR | branch | state |
|---|---|---|
| #24 | `feat/init-scaffolds-constructs` | green — carries the changeset that publishes `alpha.1` |
| #25 | `feat/worker-construct` | green |
| #26 | `feat/one-glob-partition-by-owner` | **draft, 17 tests failing**, typechecks |

## The idea

One glob finds everything. Which *kind* a module exports is decided by the
value, not by which pattern matched it — every generator already filters with a
type predicate (`Endpoint.isEndpoint`, `Cron.isCron`, `Subscriber.isSubscriber`).
So six globs per app was six things to keep in step, and a handler in the wrong
directory silently never loaded.

Which *process* runs a thing is decided by its owner, not its directory.
`Construct.owner` carries the id of the `RestApi` or `Worker` whose factory
built it. That is what makes the globs deletable: nothing needs a directory to
infer ownership any more.

## What each PR does

**#24** — `gkm init --monorepo` stops scaffolding an `apps` block. The generated
config is `name`, `constructs`, `secrets`. Apps come from a root `constructs/`
directory. `apps/auth` loses 146 lines of hand-written Hono server, because the
`BetterAuth` construct declares it and the build generates the entry.

**#25** — `Worker`, the process with no port, and `Construct.owner` on every
runnable. See `packages/constructs/src/worker.ts` for the reasoning; the short
version is that a `CronDeclaration` is `{ kind, schedule }` and nothing on it
said which container ran it.

**#26** — removes `routes`, `envParser`, `logger` and the five per-kind globs
from `GkmConfig` and `AppSpec`; makes `constructs` required; deletes
`runtimeFor`'s path-printing fallback; adds `BuildContext.owners` so a generated
cron imports the worker that runs it; cuts one OpenAPI spec per surface.

## Resuming #26

Seventeen failures, all fixture migration except two that are environmental.

- **10 in `packages/cli/src/__tests__/openapi.spec.ts`.** `openapiCommand` now
  always takes the workspace path, which needs a *discoverable* app — so the
  fixtures need one shared **exported** surface. Exporting it inside the shared
  `createMockEndpointFile` helper does not work: every fixture file then
  declares `RestApi('Test')` and discovery fails with `DuplicateConstruct`.
  Write one `constructs/api.ts` per temp dir and have the endpoint files import
  it.
- **6 in `packages/cli/src/build/__tests__/index-new.spec.ts`.** Same shape.
- **1 in `packages/cli/src/workspace/__tests__/derive.spec.ts`.**
- **2 in `HonoEndpointAdaptor.pgboss-publisher.spec.ts`** — not this work. The
  suite hardcodes port 5432; set `GKM_TEST_PG_PORT` and bring the stack up on a
  free port if something else owns it.

## Then two follow-ons

**The turbo root-package guard.** `turboFilters` maps each derived app to the
`package.json` at its path. When the app *is* the repo root, that is the root
package — whose `build` script is `gkm build`, which re-enters the build. The
existing `isAtWorkspaceRoot` check guards turbo-descending-into-a-subdirectory;
it has no answer when there is no subdirectory. Fix: if every derived app
resolves to the root package, build directly instead of routing through turbo.

A `MisplacedApp` error was tried for this and removed — it threw inside
discovery, which is caught, so one app with a missing directory lost the entire
manifest and every other app with it. The guard belongs in the build, where
throwing is actionable.

**Delete `isWorkspaceConfig`'s discrimination.** It reads:

```ts
if ('apps' in config) return true;
return 'constructs' in config && !('routes' in config) && !('envParser' in config);
```

With `constructs` required and `routes`/`envParser` gone, it is unconditionally
true — so the single-app branches behind it in `build`, `dev`, `docker` and
`openapi` are unreachable. `wrapSingleAppAsWorkspace` already proves the two
shapes are one thing.

## Known unresolved

**`services.events` answers two questions** — whether events exist, and which
broker carries them. That is why it cannot be given a target default the way
`cache`, `storage` and `mail` have: defaulting it asserts events exist, and a
project with no topic then needs pgboss credentials it never asked for. It is
the one `services` key a scaffolded config still writes, and only when it is not
`pgboss`. Separating the two meanings is real work nobody has done.

**Crons have no server runtime.** `CronGenerator` targets `aws-lambda` only, and
`.gkm/server/` has no crons file. A `Worker` is where a scheduler would live,
but there isn't one — so a `Worker` with crons deploys nothing on a server
target. This is the gap that makes `Worker` worth more than bookkeeping.

**`worker.function()`'s server invocation story is undecided.** A `Function` is
Lambda-shaped: something else invokes it. On a server, nothing does. It has
ownership so it gets a logger and a home; that is all.
