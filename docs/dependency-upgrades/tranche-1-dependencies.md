# Tranche 1: every package agrees on every version

**Status: done.** Released in `10.0.0-alpha.4`.

Recorded in commit `dce95880` (2026-09-22), `.changeset/align-deps-tranche-1.md`,
and the closing comment on #32.

## What it did

Aligned 90 dependencies across the packages to **one range per field**
(dependencies, devDependencies, peerDependencies), each on its latest version.
Thirty had disagreed with themselves. For example, `hono` carried four peer
ranges, and `@types/pg` and `@middy/core` four ranges each. Two packages could
install two copies of the same library.

The ranges were derived by a script from one list of latest versions. That's
also why the work could be re-derived on a new base when #32 conflicted with
the packaging fix, instead of being resolved by hand.

## Migrations it forced

Twenty-three of the bumps were majors. These needed code changes:

- **OpenTelemetry 1.x → 2.x.** `addSpanProcessor`,
  `BasicTracerProvider.register()` and `LoggerProvider.addLogRecordProcessor`
  are gone; processors are constructor-only. `NodeTracerProvider.register()`
  survives and still installs the async-hooks context manager.
- **Zod 4.1 → 4.6.** A schema that is a registered schema now converts to a
  bare `$ref`, which exposed a bug in `OpenApiTsGenerator`: it emitted
  `export type User = User`. The declaration is now left to the def.
- **better-auth 1.7.** `transformWhereClause` requires an `action`,
  `getMigrations` moved to its own entry, and `Auth<O>` is invariant. It also
  deleted `runAdapterTest` (see open items).
- **nodemailer 10.** `Address` moved into the `Mail` namespace, and
  `info.response` may be absent, so `SendResult` says so.

## Deliberately left out

- **The build and test toolchain** (TypeScript, Vitest, Vite, Storybook). Those
  change how every package compiles and runs, so they get their own tranche,
  where a failure has one candidate cause instead of twenty-eight. See
  [tranche 2](./tranche-2-toolchain.md).
- **The React/UI cluster.** Every fix in `packages/ui` produced the next one,
  which makes it a migration, not a version bump. See
  [tranche 3](./tranche-3-react-ui.md).
- **`expo-secure-store`**, whose version tracks an Expo SDK release.
- **The versions `gkm init` writes into new projects.** The tranche covered the
  toolbox's own packages only, so the scaffold drifted below the packages' peer
  ranges. #39 fixes the ranges that conflict with peers; the rest is #43.

## Open items

- ~~**`memoryAdapter` has no conformance test** since better-auth 1.7 removed
  `runAdapterTest`.~~ Resolved in #42: the harness moved to
  `@better-auth/test-utils/adapter`, and `memoryAdapter` runs its basic,
  auth-flow and case-insensitive suites again — which found two real gaps
  (`mode: 'insensitive'`, and `select` under renamed fields), now fixed.
- ~~**The alignment script was never committed**, and neither was its list of
  versions.~~ Recreated in #44: `scripts/align-deps.mjs` and
  `scripts/dependency-versions.json`, checked in CI by `pnpm check:deps`.
