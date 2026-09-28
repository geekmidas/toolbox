# Tranche 3: the React/UI cluster

**Status: done.** #41.

Deferred from [tranche 1](./tranche-1-dependencies.md), which kept the React
cluster on `main`'s versions because every fix in `packages/ui` produced the
next one. It waited on [tranche 2](./tranche-2-toolchain.md) for Vite 8 and
Storybook 10, which the UI builds on.

## What moved

| Package | Was | Now |
|---|---|---|
| `react`, `react-dom` | `^19.0.0` / `^19.1.0` | `^19.3.0` (peers stay `>=18.0.0`) |
| `@types/react`, `@types/react-dom` | `~19.1.x` | `~19.3.0` |
| `@tanstack/react-query` | `~5.90.16` | `~5.104.0` (peer stays `>=5.0.0`) |
| `tailwindcss` | `^4.0.0` | `^4.3.3` (peer stays `>=4.0.0`) |
| `tailwind-merge` | `~3.4.0` | `~3.7.0` |
| `lucide-react` | `~0.562.0` | `~1.48.0`, and the scaffold's pin with it |
| `next` (kitchen-sink admin) | `~15.1.3` | `~16.3.6` |

The peer ranges stay wide on purpose: they state what the packages work with,
not what this repo installs.

## What it forced

- **lucide-react 1.0 removed brand icons.** The one we used, `Github` in a
  dropdown story, became `GitBranch`. Every other icon name we import survives.
  Icons now render `aria-hidden="true"` by default.
- **lucide-react 1.x narrowed `LucideProps`** from every SVG attribute, so
  `Spinner`'s props extend `LucideProps` instead of `SVGAttributes`.
- **`prism-react-renderer` resolved the wrong `@types/react`.** Its
  declarations import React's types without declaring them, so they reached
  VitePress's `@types/react` 18 through the hoist, and `CodeBlock` mixed React
  18's `CSSProperties` with 19's. `pnpm-workspace.yaml` gives it the peer.
- **Next.js 16** needed no code changes in the admin app: it uses no
  synchronous request APIs, middleware or `next lint`.

## Toward TypeScript 7

- **Storybook** uses `react-docgen`, which parses components itself, instead of
  the TypeScript-based docgen that calls TypeScript's JavaScript API.
- **Next.js 16** runs the project's own `tsc` for `next build`'s type check
  by default (`experimental.useTypeScriptCli`, on unless set to `false`), which
  Next documents as supporting TypeScript 6 and enabling TypeScript 7.
