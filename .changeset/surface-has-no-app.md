---
'@geekmidas/cli': patch
'@geekmidas/constructs': patch
'@geekmidas/manifest': patch
---

A surface has no `app`, and `gkm init --template fullstack` builds

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
- **UI barrel imports that resolve** to `<name>/index.tsx`.
- **A Next.js site that typechecks**: no project `references` to packages that
  are not `composite`, which made its `tsc --noEmit` fail with TS6306.
- **A Biome config Biome 2 accepts**: `assist` and `files.includes` rather than
  the 1.x `organizeImports` and `files.ignore`, and Tailwind directives parsed.
- **Tests that run**: the root Vitest config uses projects, so the API's own
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
