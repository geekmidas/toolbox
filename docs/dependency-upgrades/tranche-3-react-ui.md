# Tranche 3: the React/UI cluster

**Status: not started.** Tracked in #41.

Deferred from [tranche 1](./tranche-1-dependencies.md), which kept the React
cluster on `main`'s versions because every fix in `packages/ui` produced the
next one. This is a migration, not a version bump.

## Scope

Versions on `main` as of 2026-09-27, against the latest on npm:

| Package | On `main` | Latest |
|---|---|---|
| `react`, `react-dom` | `^19.0.0`, peers `>=18.0.0` | `19.3.0` |
| `@types/react` | `^19.0.0`, `~19.1.8` | `19.3.0` |
| `@tanstack/react-query` | `~5.90.16`, peer `>=5.0.0` | `5.104.0` |
| `tailwindcss` | `^4.0.0`, peer `>=4.0.0` | `4.3.3` |
| `lucide-react` | `^0.511.0`, `~0.562.0` | `1.48.0` (first 1.x) |

Where it lives:

- `packages/ui`: the shadcn/ui components, their Storybook stories, and the
  Tailwind styles.
- The React-facing packages: `@geekmidas/client` (React Query hooks), and the
  Telescope and Studio UIs (`packages/telescope/ui`, `packages/studio/ui`).
- The scaffold's frontend pins in `gkm init`: `next ~16.1.0` (latest `16.3.6`),
  `react`/`react-dom ~19.2.0`, and `@tanstack/react-query ~5.80.0`, now in
  `packages/cli/src/init/dependencies.ts`. Also the TanStack Start and Expo
  generators.

`lucide-react` crossing to 1.x is the likeliest source of component changes.
Expect API changes in the shadcn components as well as range bumps.

## Depends on

- [Tranche 2](./tranche-2-toolchain.md) for Storybook, Vite and
  `@vitejs/plugin-react`. The UI's build and stories run on them, so bumping
  React under the old toolchain and again after it doubles the work.
- The alignment script (#44).

## Done when

- `packages/ui` builds, its stories render, and its tests pass on the new
  versions.
- The Telescope and Studio UIs build.
- A fresh fullstack scaffold's web app builds and typechecks against them, for
  the Next.js and TanStack Start variants.
