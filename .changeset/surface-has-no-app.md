---
'@geekmidas/cli': patch
'@geekmidas/constructs': patch
'@geekmidas/manifest': patch
---

A surface has no `app`, and `gkm init --template fullstack` builds

`RestApi` and `BetterAuth` no longer take an `app` block. Everything it held
follows from the id: `Api` is `apps/api`, its handlers are the ones in
`apps/api/{endpoints,functions,crons,queues,topics,subscribers}/`, and ports are
assigned in a stable order. The manifest's `rest-api` declaration loses `app`
too; the one thing it carried that the id does not — whether the surface
streams into a Telescope — is `telescope: true` on the declaration itself.

That convention had been removed along with the per-kind globs, and nothing
replaced it, so a scaffolded workspace built its API with no endpoints at all.
It is back, read only by the app's own build: discovery runs from wherever a
command started, and a handler imports through its own app's path aliases.

The fullstack scaffold did not build. What it gets now, verified by
scaffolding, installing, and running `build`, `typecheck`, `test:once` and
`lint` to completion:

- **Handlers in `apps/api/endpoints/`**, where the build looks, and no routes
  structure question — a workspace surface has one layout.
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
- **UI barrel imports that resolve** to `<name>/index.tsx`.
- **A Next.js site that typechecks**: no project `references` to packages that
  are not `composite`, which made its `tsc --noEmit` fail with TS6306.
- **A Biome config Biome 2 accepts**: `assist` and `files.includes` rather than
  the 1.x `organizeImports` and `files.ignore`, which made it refuse to run, and
  Tailwind directives parsed. No unused import left in the router it lints.
- **Tests that run**: the root Vitest config uses projects, so the API's own
  `globalSetup` runs; the API ships the `users` migration its endpoints and
  that setup expect; the example test asks for testkit's `trx` fixture, and
  hands testkit a connection function rather than an instance it mistook for
  a construct.
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
