---
'@geekmidas/cli': patch
---

`gkm init` scaffolds on TypeScript 7, and every `gkm` command starts again

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
