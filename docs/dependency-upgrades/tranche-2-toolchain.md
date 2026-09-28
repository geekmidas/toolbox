# Tranche 2: the build and test toolchain

**Status: done** (#58, then TypeScript 7). Tracked in #40.

Deferred from [tranche 1](./tranche-1-dependencies.md) because the toolchain
changes how every package compiles and runs. Kept separate so that a failure
has one candidate cause.

## Scope

Versions on `main` as of 2026-09-27, against the latest on npm:

| Package | On `main` | Latest | Jump |
|---|---|---|---|
| `typescript` | `5.8.2` (root, exact), `^5.8.2`, `~5.8.2` | `7.0.2` | two majors |
| `vitest` | `~3.2.4` | `5.0.2` | two majors |
| `@vitest/coverage-v8` | `~3.2.4` | `5.0.2` | two majors, moves with Vitest |
| `vite` | `^6.0.0` | `8.3.1` | two majors |
| `@vitejs/plugin-react` | `^4.3.4` | `6.1.1` | two majors, moves with Vite |
| `storybook`, `@storybook/*` | `^8.4.7` | `10.6.0` | two majors |
| `tsdown` | `^0.9.1`, `~0.12.8` | `0.23.0` | pre-1.0, so every minor may break |
| `tsx` | `~4.19.4`, `~4.20.3` | `4.23.15` | minor, but disagrees with itself |

Every row is a major or pre-1.0 jump, and several are two majors. Read each
changelog before bumping, and don't assume one major's migration is the same
as the next.

Out of scope: `expo-secure-store` (tracks the Expo SDK).

## Include the scaffold

`gkm init` pins its own toolchain, and it's already out of step with the
packages:

- New projects get `vitest ~4.0.0`, while `@geekmidas/testkit` and
  `@geekmidas/db` declare a `vitest ~3.2.4` peer. Every fresh install warns
  `unmet peer vitest@~3.2.4: found 4.0.18`.
- New projects pin `typescript ~5.8.2`, `tsx ~4.20.0` and `esbuild ~0.27.0`.

Move the scaffold's toolchain pins, and testkit's and db's Vitest peers, in the
same change, so a fresh project installs with no toolchain peer warnings.
Keeping the scaffold's versions current in general is #43.

## Suggested order

One tool per step, each landing green before the next, so a failure has one
candidate cause:

1. ~~**The alignment script** (#44)~~ **Done.** Each step below is
   `node scripts/align-deps.mjs --latest <names…>`, then `--write`, then
   `pnpm install`. It also gave `tsx`, `tsdown`, `typescript`, `vite` and
   `vitest` one range each within their current majors.
2. ~~**`tsx` and `tsdown`.**~~ **Done:** tsx 4.23, tsdown 0.23. A directory
   is no longer an entry (the root `entry: ['src/']` became `src/**/*`), and
   `external` / `noExternal` became `deps.neverBundle` / `deps.alwaysBundle`.
3. ~~**Vite, with `@vitejs/plugin-react`.**~~ **Done:** Vite 8, plugin-react 6.
   No config used a removed option; the Telescope UI's config now imports its
   plugin with an extension, which Vite's native config loader needs.
4. ~~**Vitest, with `@vitest/coverage-v8`**, testkit's and db's Vitest peers~~
   **Done:** Vitest 5 (through 4). Benchmarks use the `bench` test fixture; a
   nested `vi.mock` moved to top level; kitchen-sink dropped `minWorkers`; the
   CLI's throwaway test projects get a `node_modules` beside them, since
   Vite's module runner no longer resolves their bare imports from the repo
   root. The scaffold's Vitest pin follows with #43.
5. ~~**Storybook.**~~ **Done:** Storybook 10 (through 9). Essentials and
   interactions are core now, so only `addon-docs` and `addon-a11y` remain;
   stories import types from `@storybook/react-vite`; backgrounds use
   `options` and `initialGlobals`.
6. **TypeScript 7.** First 6.0 (#58): the last JavaScript compiler, which moved
   `types` to default `[]` — so the base config names `node` — and deprecated
   `baseUrl`. Then 7.0, the native compiler, whose package ships a new
   `unstable/*` API instead of the classic compiler API. Three things on our
   path needed the classic one, and each went away first:
   - **`openapi-typescript`**, run by `gkm generate:react-query`: the command
     and the dependency were deleted (#66) once our own generator was verified
     against it (#65).
   - **Storybook's TypeScript docgen**, which skips 7.0: Storybook uses
     `react-docgen` instead (#67).
   - **Next.js 15**, which typechecked through the compiler API in
     `next build`: Next 16 runs the project's own `tsc` (#67).

   What 7 itself asked for: declarations go through tsgo (rolldown-plugin-dts
   0.28 picks it when 7 is installed), which emits nothing for a JSON entry —
   so `packages/client/src/openapi.json`, a stale file nothing used, was
   deleted; one `@types/react` for the workspace (an override on
   VitePress's `@docsearch/react`, held to the list by `check:deps`), because 7
   resolved the global `React` namespace to the hoisted 18 where 6 had picked
   19; and a cast in cloud's `fromManifest` that 7 checks and 6 did not. The
   20 errors 7 reports inside SST's own platform source stay outside
   `ts:check:sst`, as before.

## Done when

- `pnpm build`, `pnpm ts:check`, `pnpm lint` and `pnpm test:once` pass on the
  new toolchain, in CI.
- `pnpm check:exports` and `pnpm check:install` pass.
- A fresh `gkm init --template fullstack` installs with no toolchain peer
  warnings, and `build`, `typecheck`, `test:once` and `lint` pass in it.
