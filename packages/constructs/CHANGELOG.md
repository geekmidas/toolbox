# @geekmidas/constructs

## 10.0.0-alpha.20

### Minor Changes

- [#79](https://github.com/geekmidas/toolbox/pull/79) [`59e3fab`](https://github.com/geekmidas/toolbox/commit/59e3fabaec37ac7ffd9c26c2927daf0cc8f406c8) Thanks [@geekmidas](https://github.com/geekmidas)! - `session({ auth })`: the surface's authenticator is where a session is read

  `api.auth(auth)` declared an edge and nothing more — every project then
  re-implemented reading the session with a hand-written service. Now a session
  callback receives `auth`, the construct named in `.auth()`, bound to the request:

  ```ts
  export const sessionRouter = router.session(async ({ auth }) => {
    const session = await auth.getSession();
    if (!session) throw new UnauthorizedError("No active session");
    return session;
  });
  ```

  Handlers still get whatever `.session()` returned. Only a `.session()` branch
  asks the authenticator anything, so public routes pay nothing.
  - `RestApi.auth()` takes an `Authenticator` — a construct with
    `verify(headers, envParser) → session | null` — and keeps it.
  - `BetterAuth` implements it: `verify` asks the auth server for the session at
    the URL the `.auth()` edge injects, forwarding only `cookie` and
    `authorization`. A failing server throws `SessionCheckFailed` rather than
    reading as signed out. `AuthSession` is better-auth's session type.
  - `auth.getSession()` on a surface with no `.auth()` throws `NoAuthenticator`.

  Part 2 of #77.

### Patch Changes

- [#78](https://github.com/geekmidas/toolbox/pull/78) [`6ee966c`](https://github.com/geekmidas/toolbox/commit/6ee966c1ea27d25720ac6767c9f2e7ffe63b3f7f) Thanks [@geekmidas](https://github.com/geekmidas)! - Typed method calls: `api.post('/users', { body })`

  Every client — `createTypedFetcher`, `createAuthAwareFetcher`, and so the
  generated `createApi` — now answers by method as well as by
  `api('POST /users', …)`: `api.get`, `post`, `put`, `patch`, `delete`, `options`.
  The route autocompletes per method (only routes with a `POST` appear in
  `api.post`), the second argument has only the keys the endpoint declares, and it
  is required exactly when something in it is.

  Three typing fixes came out of testing it, and apply to `api('…')` too:
  - **Routes declared with `:param` were uncallable.** `InferOpenApi` keyed them by
    the declared form (`/users/:id`) instead of the served one (`/users/{id}`), so
    no path parameter was inferred and the documented `api('GET /users/{id}')` did
    not typecheck against an endpoint declared that way. Paths are now keyed with
    `ConvertRouteParams`, which `@geekmidas/constructs/endpoints` now exports.
  - **A GET accepted any body.** An absent body is `requestBody?: never`, which
    matched `{ content?: … }` with the body inferred as `unknown`.
  - **A required query was optional.** `query` was always optional and never made
    the argument required; now a query with a required key is required, and so is
    the argument.

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.20
  - @geekmidas/auth@10.0.0-alpha.20
  - @geekmidas/cache@10.0.0-alpha.20
  - @geekmidas/db@10.0.0-alpha.20
  - @geekmidas/emailkit@10.0.0-alpha.20
  - @geekmidas/envkit@10.0.0-alpha.20
  - @geekmidas/errors@10.0.0-alpha.20
  - @geekmidas/events@10.0.0-alpha.20
  - @geekmidas/logger@10.0.0-alpha.20
  - @geekmidas/manifest@10.0.0-alpha.20
  - @geekmidas/rate-limit@10.0.0-alpha.20
  - @geekmidas/schema@10.0.0-alpha.20
  - @geekmidas/services@10.0.0-alpha.20
  - @geekmidas/storage@10.0.0-alpha.20
  - @geekmidas/telescope@10.0.0-alpha.20

## 10.0.0-alpha.19

### Minor Changes

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

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.19
  - @geekmidas/auth@10.0.0-alpha.19
  - @geekmidas/cache@10.0.0-alpha.19
  - @geekmidas/db@10.0.0-alpha.19
  - @geekmidas/emailkit@10.0.0-alpha.19
  - @geekmidas/envkit@10.0.0-alpha.19
  - @geekmidas/errors@10.0.0-alpha.19
  - @geekmidas/events@10.0.0-alpha.19
  - @geekmidas/logger@10.0.0-alpha.19
  - @geekmidas/manifest@10.0.0-alpha.19
  - @geekmidas/rate-limit@10.0.0-alpha.19
  - @geekmidas/schema@10.0.0-alpha.19
  - @geekmidas/services@10.0.0-alpha.19
  - @geekmidas/storage@10.0.0-alpha.19
  - @geekmidas/telescope@10.0.0-alpha.19

## 10.0.0-alpha.18

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.18
  - @geekmidas/auth@10.0.0-alpha.18
  - @geekmidas/cache@10.0.0-alpha.18
  - @geekmidas/db@10.0.0-alpha.18
  - @geekmidas/emailkit@10.0.0-alpha.18
  - @geekmidas/envkit@10.0.0-alpha.18
  - @geekmidas/errors@10.0.0-alpha.18
  - @geekmidas/events@10.0.0-alpha.18
  - @geekmidas/logger@10.0.0-alpha.18
  - @geekmidas/manifest@10.0.0-alpha.18
  - @geekmidas/rate-limit@10.0.0-alpha.18
  - @geekmidas/schema@10.0.0-alpha.18
  - @geekmidas/services@10.0.0-alpha.18
  - @geekmidas/storage@10.0.0-alpha.18
  - @geekmidas/telescope@10.0.0-alpha.18

## 10.0.0-alpha.17

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.17
  - @geekmidas/auth@10.0.0-alpha.17
  - @geekmidas/cache@10.0.0-alpha.17
  - @geekmidas/db@10.0.0-alpha.17
  - @geekmidas/emailkit@10.0.0-alpha.17
  - @geekmidas/envkit@10.0.0-alpha.17
  - @geekmidas/errors@10.0.0-alpha.17
  - @geekmidas/events@10.0.0-alpha.17
  - @geekmidas/logger@10.0.0-alpha.17
  - @geekmidas/manifest@10.0.0-alpha.17
  - @geekmidas/rate-limit@10.0.0-alpha.17
  - @geekmidas/schema@10.0.0-alpha.17
  - @geekmidas/services@10.0.0-alpha.17
  - @geekmidas/storage@10.0.0-alpha.17
  - @geekmidas/telescope@10.0.0-alpha.17

## 10.0.0-alpha.16

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.16
  - @geekmidas/auth@10.0.0-alpha.16
  - @geekmidas/cache@10.0.0-alpha.16
  - @geekmidas/db@10.0.0-alpha.16
  - @geekmidas/emailkit@10.0.0-alpha.16
  - @geekmidas/envkit@10.0.0-alpha.16
  - @geekmidas/errors@10.0.0-alpha.16
  - @geekmidas/events@10.0.0-alpha.16
  - @geekmidas/logger@10.0.0-alpha.16
  - @geekmidas/manifest@10.0.0-alpha.16
  - @geekmidas/rate-limit@10.0.0-alpha.16
  - @geekmidas/schema@10.0.0-alpha.16
  - @geekmidas/services@10.0.0-alpha.16
  - @geekmidas/storage@10.0.0-alpha.16
  - @geekmidas/telescope@10.0.0-alpha.16

## 10.0.0-alpha.15

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.15
  - @geekmidas/auth@10.0.0-alpha.15
  - @geekmidas/cache@10.0.0-alpha.15
  - @geekmidas/db@10.0.0-alpha.15
  - @geekmidas/emailkit@10.0.0-alpha.15
  - @geekmidas/envkit@10.0.0-alpha.15
  - @geekmidas/errors@10.0.0-alpha.15
  - @geekmidas/events@10.0.0-alpha.15
  - @geekmidas/logger@10.0.0-alpha.15
  - @geekmidas/manifest@10.0.0-alpha.15
  - @geekmidas/rate-limit@10.0.0-alpha.15
  - @geekmidas/schema@10.0.0-alpha.15
  - @geekmidas/services@10.0.0-alpha.15
  - @geekmidas/storage@10.0.0-alpha.15
  - @geekmidas/telescope@10.0.0-alpha.15

## 10.0.0-alpha.14

### Patch Changes

- [#65](https://github.com/geekmidas/toolbox/pull/65) [`9602a19`](https://github.com/geekmidas/toolbox/commit/9602a19a9b4fb9cecd2641d108976f73272df55e) Thanks [@geekmidas](https://github.com/geekmidas)! - The OpenAPI document validates, and says who may call what

  Checked against kitchen-sink with Redocly, swagger-parser and openapi-typescript:
  - **A registered schema kept its definition.** A schema with `.meta({ id })`
    came out as `User: { $ref: '#/components/schemas/User' }` — a pointer to
    itself, so the document had no `User` and validators refused it. Zod 4.6
    already refers a registered schema to its `$defs` entry; that reference is no
    longer written over the definition.
  - **OpenAPI 3.1.0**, not 3.0.0: the schemas are JSON Schema 2020-12
    (`type: ['string', 'null']`, `const`), which is 3.1's dialect. The
    per-schema `$schema` markers are dropped.
  - 🔒 **Security is documented.** An endpoint behind an authorizer gets a
    `security` requirement and its scheme in `components.securitySchemes`;
    before, every endpoint read as public. `RestApi`'s `authorizers: ['iam']`
    now resolves built-in names to their scheme, as the factory's own
    `.authorizers()` did.
  - **The success status is the one the endpoint answers with**: `.status(201)`
    is documented as `201`, not `200`.

- Updated dependencies [[`ce969d3`](https://github.com/geekmidas/toolbox/commit/ce969d39a79811f36622f07a2f797cc493a87d1b), [`9602a19`](https://github.com/geekmidas/toolbox/commit/9602a19a9b4fb9cecd2641d108976f73272df55e)]:
  - @geekmidas/events@10.0.0-alpha.14
  - @geekmidas/schema@10.0.0-alpha.14
  - @geekmidas/audit@10.0.0-alpha.14
  - @geekmidas/auth@10.0.0-alpha.14
  - @geekmidas/cache@10.0.0-alpha.14
  - @geekmidas/db@10.0.0-alpha.14
  - @geekmidas/emailkit@10.0.0-alpha.14
  - @geekmidas/envkit@10.0.0-alpha.14
  - @geekmidas/errors@10.0.0-alpha.14
  - @geekmidas/logger@10.0.0-alpha.14
  - @geekmidas/manifest@10.0.0-alpha.14
  - @geekmidas/rate-limit@10.0.0-alpha.14
  - @geekmidas/services@10.0.0-alpha.14
  - @geekmidas/storage@10.0.0-alpha.14
  - @geekmidas/telescope@10.0.0-alpha.14

## 10.0.0-alpha.13

### Patch Changes

- Updated dependencies [[`07d1827`](https://github.com/geekmidas/toolbox/commit/07d1827bb0a2a76d04a0fc25a7517df282004137)]:
  - @geekmidas/db@10.0.0-alpha.13
  - @geekmidas/telescope@10.0.0-alpha.13
  - @geekmidas/audit@10.0.0-alpha.13
  - @geekmidas/auth@10.0.0-alpha.13
  - @geekmidas/cache@10.0.0-alpha.13
  - @geekmidas/emailkit@10.0.0-alpha.13
  - @geekmidas/envkit@10.0.0-alpha.13
  - @geekmidas/errors@10.0.0-alpha.13
  - @geekmidas/events@10.0.0-alpha.13
  - @geekmidas/logger@10.0.0-alpha.13
  - @geekmidas/manifest@10.0.0-alpha.13
  - @geekmidas/rate-limit@10.0.0-alpha.13
  - @geekmidas/schema@10.0.0-alpha.13
  - @geekmidas/services@10.0.0-alpha.13
  - @geekmidas/storage@10.0.0-alpha.13

## 10.0.0-alpha.12

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.12
  - @geekmidas/auth@10.0.0-alpha.12
  - @geekmidas/cache@10.0.0-alpha.12
  - @geekmidas/db@10.0.0-alpha.12
  - @geekmidas/emailkit@10.0.0-alpha.12
  - @geekmidas/envkit@10.0.0-alpha.12
  - @geekmidas/errors@10.0.0-alpha.12
  - @geekmidas/events@10.0.0-alpha.12
  - @geekmidas/logger@10.0.0-alpha.12
  - @geekmidas/manifest@10.0.0-alpha.12
  - @geekmidas/rate-limit@10.0.0-alpha.12
  - @geekmidas/schema@10.0.0-alpha.12
  - @geekmidas/services@10.0.0-alpha.12
  - @geekmidas/storage@10.0.0-alpha.12
  - @geekmidas/telescope@10.0.0-alpha.12

## 10.0.0-alpha.11

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.11
  - @geekmidas/auth@10.0.0-alpha.11
  - @geekmidas/cache@10.0.0-alpha.11
  - @geekmidas/db@10.0.0-alpha.11
  - @geekmidas/emailkit@10.0.0-alpha.11
  - @geekmidas/envkit@10.0.0-alpha.11
  - @geekmidas/errors@10.0.0-alpha.11
  - @geekmidas/events@10.0.0-alpha.11
  - @geekmidas/logger@10.0.0-alpha.11
  - @geekmidas/manifest@10.0.0-alpha.11
  - @geekmidas/rate-limit@10.0.0-alpha.11
  - @geekmidas/schema@10.0.0-alpha.11
  - @geekmidas/services@10.0.0-alpha.11
  - @geekmidas/storage@10.0.0-alpha.11
  - @geekmidas/telescope@10.0.0-alpha.11

## 10.0.0-alpha.10

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.10
  - @geekmidas/auth@10.0.0-alpha.10
  - @geekmidas/cache@10.0.0-alpha.10
  - @geekmidas/db@10.0.0-alpha.10
  - @geekmidas/emailkit@10.0.0-alpha.10
  - @geekmidas/envkit@10.0.0-alpha.10
  - @geekmidas/errors@10.0.0-alpha.10
  - @geekmidas/events@10.0.0-alpha.10
  - @geekmidas/logger@10.0.0-alpha.10
  - @geekmidas/manifest@10.0.0-alpha.10
  - @geekmidas/rate-limit@10.0.0-alpha.10
  - @geekmidas/schema@10.0.0-alpha.10
  - @geekmidas/services@10.0.0-alpha.10
  - @geekmidas/storage@10.0.0-alpha.10
  - @geekmidas/telescope@10.0.0-alpha.10

## 10.0.0-alpha.9

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.9
  - @geekmidas/auth@10.0.0-alpha.9
  - @geekmidas/cache@10.0.0-alpha.9
  - @geekmidas/db@10.0.0-alpha.9
  - @geekmidas/emailkit@10.0.0-alpha.9
  - @geekmidas/envkit@10.0.0-alpha.9
  - @geekmidas/errors@10.0.0-alpha.9
  - @geekmidas/events@10.0.0-alpha.9
  - @geekmidas/logger@10.0.0-alpha.9
  - @geekmidas/manifest@10.0.0-alpha.9
  - @geekmidas/rate-limit@10.0.0-alpha.9
  - @geekmidas/schema@10.0.0-alpha.9
  - @geekmidas/services@10.0.0-alpha.9
  - @geekmidas/storage@10.0.0-alpha.9
  - @geekmidas/telescope@10.0.0-alpha.9

## 10.0.0-alpha.8

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.8
  - @geekmidas/auth@10.0.0-alpha.8
  - @geekmidas/cache@10.0.0-alpha.8
  - @geekmidas/db@10.0.0-alpha.8
  - @geekmidas/emailkit@10.0.0-alpha.8
  - @geekmidas/envkit@10.0.0-alpha.8
  - @geekmidas/errors@10.0.0-alpha.8
  - @geekmidas/events@10.0.0-alpha.8
  - @geekmidas/logger@10.0.0-alpha.8
  - @geekmidas/manifest@10.0.0-alpha.8
  - @geekmidas/rate-limit@10.0.0-alpha.8
  - @geekmidas/schema@10.0.0-alpha.8
  - @geekmidas/services@10.0.0-alpha.8
  - @geekmidas/storage@10.0.0-alpha.8
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
  - @geekmidas/manifest@10.0.0-alpha.7
  - @geekmidas/audit@10.0.0-alpha.7
  - @geekmidas/auth@10.0.0-alpha.7
  - @geekmidas/cache@10.0.0-alpha.7
  - @geekmidas/db@10.0.0-alpha.7
  - @geekmidas/emailkit@10.0.0-alpha.7
  - @geekmidas/envkit@10.0.0-alpha.7
  - @geekmidas/errors@10.0.0-alpha.7
  - @geekmidas/events@10.0.0-alpha.7
  - @geekmidas/logger@10.0.0-alpha.7
  - @geekmidas/rate-limit@10.0.0-alpha.7
  - @geekmidas/schema@10.0.0-alpha.7
  - @geekmidas/services@10.0.0-alpha.7
  - @geekmidas/storage@10.0.0-alpha.7
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

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.6
  - @geekmidas/auth@10.0.0-alpha.6
  - @geekmidas/cache@10.0.0-alpha.6
  - @geekmidas/db@10.0.0-alpha.6
  - @geekmidas/emailkit@10.0.0-alpha.6
  - @geekmidas/envkit@10.0.0-alpha.6
  - @geekmidas/errors@10.0.0-alpha.6
  - @geekmidas/events@10.0.0-alpha.6
  - @geekmidas/logger@10.0.0-alpha.6
  - @geekmidas/manifest@10.0.0-alpha.6
  - @geekmidas/rate-limit@10.0.0-alpha.6
  - @geekmidas/schema@10.0.0-alpha.6
  - @geekmidas/services@10.0.0-alpha.6
  - @geekmidas/storage@10.0.0-alpha.6
  - @geekmidas/telescope@10.0.0-alpha.6

## 10.0.0-alpha.5

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.5
  - @geekmidas/auth@10.0.0-alpha.5
  - @geekmidas/cache@10.0.0-alpha.5
  - @geekmidas/db@10.0.0-alpha.5
  - @geekmidas/emailkit@10.0.0-alpha.5
  - @geekmidas/envkit@10.0.0-alpha.5
  - @geekmidas/errors@10.0.0-alpha.5
  - @geekmidas/events@10.0.0-alpha.5
  - @geekmidas/logger@10.0.0-alpha.5
  - @geekmidas/manifest@10.0.0-alpha.5
  - @geekmidas/rate-limit@10.0.0-alpha.5
  - @geekmidas/schema@10.0.0-alpha.5
  - @geekmidas/services@10.0.0-alpha.5
  - @geekmidas/storage@10.0.0-alpha.5
  - @geekmidas/telescope@10.0.0-alpha.5

## 10.0.0-alpha.4

### Patch Changes

- Updated dependencies [[`dce9588`](https://github.com/geekmidas/toolbox/commit/dce958803067a24ec3c9ecbba2c76fd00d971904)]:
  - @geekmidas/telescope@10.0.0-alpha.4
  - @geekmidas/schema@10.0.0-alpha.4
  - @geekmidas/audit@10.0.0-alpha.4
  - @geekmidas/auth@10.0.0-alpha.4
  - @geekmidas/cache@10.0.0-alpha.4
  - @geekmidas/db@10.0.0-alpha.4
  - @geekmidas/emailkit@10.0.0-alpha.4
  - @geekmidas/envkit@10.0.0-alpha.4
  - @geekmidas/errors@10.0.0-alpha.4
  - @geekmidas/events@10.0.0-alpha.4
  - @geekmidas/logger@10.0.0-alpha.4
  - @geekmidas/manifest@10.0.0-alpha.4
  - @geekmidas/rate-limit@10.0.0-alpha.4
  - @geekmidas/services@10.0.0-alpha.4
  - @geekmidas/storage@10.0.0-alpha.4

## 10.0.0-alpha.3

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.3
  - @geekmidas/auth@10.0.0-alpha.3
  - @geekmidas/cache@10.0.0-alpha.3
  - @geekmidas/db@10.0.0-alpha.3
  - @geekmidas/emailkit@10.0.0-alpha.3
  - @geekmidas/envkit@10.0.0-alpha.3
  - @geekmidas/errors@10.0.0-alpha.3
  - @geekmidas/events@10.0.0-alpha.3
  - @geekmidas/logger@10.0.0-alpha.3
  - @geekmidas/manifest@10.0.0-alpha.3
  - @geekmidas/rate-limit@10.0.0-alpha.3
  - @geekmidas/schema@10.0.0-alpha.3
  - @geekmidas/services@10.0.0-alpha.3
  - @geekmidas/storage@10.0.0-alpha.3
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

- Updated dependencies [[`96ec6a7`](https://github.com/geekmidas/toolbox/commit/96ec6a73efbfaaf5f17f378ac3647d3c970297a9), [`05ce914`](https://github.com/geekmidas/toolbox/commit/05ce91446ba29d5158a2a5c010f7bf9c00f761eb)]:
  - @geekmidas/telescope@10.0.0-alpha.2
  - @geekmidas/logger@10.0.0-alpha.2
  - @geekmidas/audit@10.0.0-alpha.2
  - @geekmidas/auth@10.0.0-alpha.2
  - @geekmidas/cache@10.0.0-alpha.2
  - @geekmidas/db@10.0.0-alpha.2
  - @geekmidas/emailkit@10.0.0-alpha.2
  - @geekmidas/envkit@10.0.0-alpha.2
  - @geekmidas/errors@10.0.0-alpha.2
  - @geekmidas/events@10.0.0-alpha.2
  - @geekmidas/manifest@10.0.0-alpha.2
  - @geekmidas/rate-limit@10.0.0-alpha.2
  - @geekmidas/schema@10.0.0-alpha.2
  - @geekmidas/services@10.0.0-alpha.2
  - @geekmidas/storage@10.0.0-alpha.2

## 10.0.0-alpha.1

### Patch Changes

- Updated dependencies []:
  - @geekmidas/audit@10.0.0-alpha.1
  - @geekmidas/auth@10.0.0-alpha.1
  - @geekmidas/cache@10.0.0-alpha.1
  - @geekmidas/db@10.0.0-alpha.1
  - @geekmidas/emailkit@10.0.0-alpha.1
  - @geekmidas/envkit@10.0.0-alpha.1
  - @geekmidas/errors@10.0.0-alpha.1
  - @geekmidas/events@10.0.0-alpha.1
  - @geekmidas/logger@10.0.0-alpha.1
  - @geekmidas/manifest@10.0.0-alpha.1
  - @geekmidas/rate-limit@10.0.0-alpha.1
  - @geekmidas/schema@10.0.0-alpha.1
  - @geekmidas/services@10.0.0-alpha.1
  - @geekmidas/storage@10.0.0-alpha.1
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
  - @geekmidas/audit@10.0.0-alpha.0
  - @geekmidas/auth@10.0.0-alpha.0
  - @geekmidas/cache@10.0.0-alpha.0
  - @geekmidas/db@10.0.0-alpha.0
  - @geekmidas/emailkit@10.0.0-alpha.0
  - @geekmidas/envkit@10.0.0-alpha.0
  - @geekmidas/errors@10.0.0-alpha.0
  - @geekmidas/events@10.0.0-alpha.0
  - @geekmidas/logger@10.0.0-alpha.0
  - @geekmidas/manifest@10.0.0-alpha.0
  - @geekmidas/rate-limit@10.0.0-alpha.0
  - @geekmidas/schema@10.0.0-alpha.0
  - @geekmidas/services@10.0.0-alpha.0
  - @geekmidas/storage@10.0.0-alpha.0
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
  - @geekmidas/audit@9.0.2
  - @geekmidas/cache@9.0.2
  - @geekmidas/db@9.0.2
  - @geekmidas/envkit@9.0.2
  - @geekmidas/errors@9.0.2
  - @geekmidas/events@9.0.2
  - @geekmidas/logger@9.0.2
  - @geekmidas/rate-limit@9.0.2
  - @geekmidas/schema@9.0.2
  - @geekmidas/services@9.0.2

## 7.0.1

### Patch Changes

- 🐛 [#11](https://github.com/geekmidas/toolbox/pull/11) [`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309) Thanks [@geekmidas](https://github.com/geekmidas)! - Patch release across all packages to realign published versions with the
  registry. The previous release only published the four packages that had
  version bumps; the remaining packages failed with "cannot publish over the
  previously published versions" because their versions were unchanged.
- Updated dependencies [[`40f4dc0`](https://github.com/geekmidas/toolbox/commit/40f4dc095911b2223a255029d8f776caf7781309)]:
  - @geekmidas/audit@2.2.1
  - @geekmidas/cache@1.1.2
  - @geekmidas/db@1.1.1
  - @geekmidas/envkit@1.1.1
  - @geekmidas/errors@1.0.2
  - @geekmidas/events@1.1.6
  - @geekmidas/logger@1.0.3
  - @geekmidas/rate-limit@4.0.1
  - @geekmidas/schema@1.0.4
  - @geekmidas/services@2.0.1

## 7.0.0

### Patch Changes

- Updated dependencies [[`ae678fe`](https://github.com/geekmidas/toolbox/commit/ae678fe6fbc89307d052335468f1b955b306a604)]:
  - @geekmidas/audit@2.2.0

## 6.0.0

### Patch Changes

- Updated dependencies [[`e31a60a`](https://github.com/geekmidas/toolbox/commit/e31a60a971366180a0e7bec6e7da56d8f36aa21f)]:
  - @geekmidas/db@1.1.0
  - @geekmidas/audit@2.1.0

## 5.0.0

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

- Updated dependencies [[`7323f34`](https://github.com/geekmidas/toolbox/commit/7323f34176d63170dd53450889ac0b5959420c3c), [`79e2929`](https://github.com/geekmidas/toolbox/commit/79e292978d3dbc8927e25814bdb051d1c380600a), [`03b08fe`](https://github.com/geekmidas/toolbox/commit/03b08feba2e735539c43f95b77792c18a627b07d)]:
  - @geekmidas/envkit@1.1.0
  - @geekmidas/events@1.1.5
  - @geekmidas/services@2.0.0
  - @geekmidas/rate-limit@4.0.0

## 4.0.1

### Patch Changes

- [#7](https://github.com/geekmidas/toolbox/pull/7) [`e0d06b3`](https://github.com/geekmidas/toolbox/commit/e0d06b38dfd275758f7955f5754900ab78779302) Thanks [@geekmidas](https://github.com/geekmidas)! - feat(constructs): allow endpoint handlers to return the output schema's input type

  Endpoint handlers previously had to return the output schema's _parsed_ type
  (`InferStandardSchema`). When an output schema coerces its value (e.g. a `Date`
  serialized to an ISO `string`, or an applied default), that forced handlers to
  pre-coerce values themselves even though the schema would do it on the way out.

  A new `InferStandardSchemaInput` type is added to `@geekmidas/schema`, exposing a
  Standard Schema's _input_ type (`StandardSchemaV1.InferInput`). `Endpoint`'s
  handler return type now uses it, so handlers may return the looser pre-coercion
  input while consumers (`EndpointOutput` and the generated client) still see the
  narrower parsed output type.

- Updated dependencies [[`e0d06b3`](https://github.com/geekmidas/toolbox/commit/e0d06b38dfd275758f7955f5754900ab78779302)]:
  - @geekmidas/schema@1.0.3

## 4.0.0

### Minor Changes

- [#5](https://github.com/geekmidas/toolbox/pull/5) [`811d740`](https://github.com/geekmidas/toolbox/commit/811d740ae3875d59ad1b0dc50261266963c8cb76) Thanks [@geekmidas](https://github.com/geekmidas)! - Move the tRPC and Middy service integrations from `@geekmidas/constructs` to `@geekmidas/services`, where they belong — they depend only on `@geekmidas/services`, not on any construct.
  - ✨ **`@geekmidas/constructs`:** the `@geekmidas/constructs/trpc` and `@geekmidas/constructs/middy` entry points are removed (they were only just added). Import from `@geekmidas/services/trpc` and `@geekmidas/services/middy` instead. (`@trpc/server` is no longer a peer dependency of `@geekmidas/constructs`.)
  - ✨ **`@geekmidas/services`:** adds `/trpc` (`createServicesMiddleware`, `createRequestContextMiddleware`) and `/middy` (`requestContext`, `addServices`, `withServices`, `EventServices`) exports.

  The Middy middlewares were also tightened:
  - `requestContext` / `withServices` now require an explicit `logger` (no `ConsoleLogger` default) and are generic over `TLogger extends Logger`, so a custom logger type is preserved.
  - `addServices` / `withServices` now require an `envParser` (no implicit `process.env` default).
  - 🐛 Resolved services are attached to `event.services` (matching the `Function`/`Cron` constructs).

### Patch Changes

- Updated dependencies [[`811d740`](https://github.com/geekmidas/toolbox/commit/811d740ae3875d59ad1b0dc50261266963c8cb76)]:
  - @geekmidas/services@1.1.0
  - @geekmidas/rate-limit@3.0.0

## 3.1.0

### Minor Changes

- ✨ [#4](https://github.com/geekmidas/toolbox/pull/4) [`07093f5`](https://github.com/geekmidas/toolbox/commit/07093f5f911bf1ee48e53275da3cce398cc78ff6) Thanks [@geekmidas](https://github.com/geekmidas)! - Add `@geekmidas/constructs/middy` — Middy middlewares that bring request context and service discovery to standalone Lambda handlers:
  - `requestContext(options?)` establishes a request context so `serviceContext.getLogger()` / `getRequestId()` / `getRequestStartTime()` work inside the handler and any service it calls.
  - 🐛 `addServices([...], options?)` resolves services via `ServiceDiscovery` and attaches the typed record to `event.services` (pair with `requestContext`, or use `withServices`, if your services read `serviceContext`).
  - `withServices([...], options?)` bundles both in a single `.use(...)`.

  Also exports an `EventServices<T>` helper type for typing the handler's event.

### Patch Changes

- ✨ [#4](https://github.com/geekmidas/toolbox/pull/4) [`a20be2f`](https://github.com/geekmidas/toolbox/commit/a20be2faa4795600358904b751fa947d3cbb4c45) Thanks [@geekmidas](https://github.com/geekmidas)! - Add and export `AWSScheduledFunction` from `@geekmidas/constructs/crons` (and `/aws`). The CLI's cron handler generator already imported this adaptor, but it was never implemented, so generated cron handlers failed to load. `AWSScheduledFunction` wraps a `Cron` (which extends `Function`) and reuses the Lambda function execution pipeline, including the `runWithRequestContext` wrapper that powers request-scoped logging.

## 3.0.14

### Patch Changes

- 🐛 [#3](https://github.com/geekmidas/toolbox/pull/3) [`42fda53`](https://github.com/geekmidas/toolbox/commit/42fda532bdf4489a3352f6a684f5f30beafccedd) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix stale logger from service initialization

- Updated dependencies [[`42fda53`](https://github.com/geekmidas/toolbox/commit/42fda532bdf4489a3352f6a684f5f30beafccedd)]:
  - @geekmidas/services@1.0.4

## 3.0.13

### Patch Changes

- ✨ [`351f73b`](https://github.com/geekmidas/toolbox/commit/351f73b032bc0742b7f611a9fbcdfc85bbfd69a8) Thanks [@geekmidas](https://github.com/geekmidas)! - Update request context and add support for trpc

- Updated dependencies [[`351f73b`](https://github.com/geekmidas/toolbox/commit/351f73b032bc0742b7f611a9fbcdfc85bbfd69a8)]:
  - @geekmidas/services@1.0.3

## 3.0.12

### Patch Changes

- 🐛 [`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.

- Updated dependencies [[`d70c6c0`](https://github.com/geekmidas/toolbox/commit/d70c6c0aeb8a79da2473ac77dbd8255a4a2f5651)]:
  - @geekmidas/audit@2.0.1
  - @geekmidas/cache@1.1.1
  - @geekmidas/db@1.0.2
  - @geekmidas/envkit@1.0.7
  - @geekmidas/errors@1.0.1
  - @geekmidas/events@1.1.3
  - @geekmidas/logger@1.0.2
  - @geekmidas/rate-limit@2.0.1
  - @geekmidas/schema@1.0.2
  - @geekmidas/services@1.0.2

## 3.0.11

### Patch Changes

- [`fb1e721`](https://github.com/geekmidas/toolbox/commit/fb1e721ec38c1b328d41466564c6fa1c9305e80b) Thanks [@geekmidas](https://github.com/geekmidas)! - Return 403 Forbidden instead of 401 Unauthorized when an endpoint's `.authorize()` returns false. Authorization runs after `getSession()`, so by the time it rejects, the caller is already identified — 403 is the correct semantic. Callers that want 401 for missing authentication should throw `UnauthorizedError` from `getSession()` (or `.authorize()`) directly.

## 3.0.10

### Patch Changes

- 🐛 [`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix schema, openapi generation and events testkit

- Updated dependencies [[`aeba918`](https://github.com/geekmidas/toolbox/commit/aeba918fc258f6ccdb96b8273b2bc01bd2190553)]:
  - @geekmidas/events@1.1.2
  - @geekmidas/schema@1.0.1

## 3.0.9

### Patch Changes

- ✨ [`363c67f`](https://github.com/geekmidas/toolbox/commit/363c67fb3c3406bac6823326ab80ba55bff29e31) Thanks [@geekmidas](https://github.com/geekmidas)! - Add dynamic return types

## 3.0.8

### Patch Changes

- ✨ [`0830c6e`](https://github.com/geekmidas/toolbox/commit/0830c6e0d60842526788e0e1f0e78827514ea7b3) Thanks [@geekmidas](https://github.com/geekmidas)! - Add optional sniff support

- Updated dependencies [[`0830c6e`](https://github.com/geekmidas/toolbox/commit/0830c6e0d60842526788e0e1f0e78827514ea7b3)]:
  - @geekmidas/logger@1.0.1

## 3.0.7

### Patch Changes

- ✨ [`79e17a8`](https://github.com/geekmidas/toolbox/commit/79e17a84e630f102023005994d9d45b37f7d9d8f) Thanks [@geekmidas](https://github.com/geekmidas)! - Add msw support for construct testing for ui

## 3.0.6

### Patch Changes

- ✨ [`3941ae6`](https://github.com/geekmidas/toolbox/commit/3941ae6c9027fddb32999b9f98af813a12867877) Thanks [@geekmidas](https://github.com/geekmidas)! - Add db to authorizer

## 3.0.5

### Patch Changes

- [`fba83f3`](https://github.com/geekmidas/toolbox/commit/fba83f3ceee1d058874e62b31e38a9da205a6742) Thanks [@geekmidas](https://github.com/geekmidas)! - Release constructs

## 3.0.4

### Patch Changes

- ✨ [`f005956`](https://github.com/geekmidas/toolbox/commit/f005956573aac6bcdfcc95d2a31c17cf5b9688d4) Thanks [@geekmidas](https://github.com/geekmidas)! - Add params to authorize and decode content type on routes

## 3.0.3

### Patch Changes

- [`a39b41f`](https://github.com/geekmidas/toolbox/commit/a39b41fae9c6cfbde8e6d78bf5a11fbb9e59f67d) Thanks [@geekmidas](https://github.com/geekmidas)! - Use qs to process query params instead of custom solution

## 3.0.2

### Patch Changes

- 🐛 [`317e53e`](https://github.com/geekmidas/toolbox/commit/317e53e91c07bbc23dad3ae81faf573be91cb992) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix v2 cookie loading

## 3.0.1

### Patch Changes

- ✨ [`bfc5a4f`](https://github.com/geekmidas/toolbox/commit/bfc5a4f656445bb389b0532e9d3385d2e66a28fe) Thanks [@geekmidas](https://github.com/geekmidas)! - Add function context and suport for partitions

## 3.0.0

### Patch Changes

- Updated dependencies [[`be4f7a9`](https://github.com/geekmidas/toolbox/commit/be4f7a9bd5de7f08adbca582916d6902e0c24de2)]:
  - @geekmidas/cache@1.1.0
  - @geekmidas/audit@2.0.0
  - @geekmidas/rate-limit@2.0.0

## 2.0.0

### Patch Changes

- ✨ [`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661) Thanks [@geekmidas](https://github.com/geekmidas)! - Add pg-boss event publisher/subscriber, CLI setup and upgrade commands, and secrets sync via AWS SSM
  - ✨ **@geekmidas/events**: Add pg-boss backend for event publishing and subscribing with connection string support
  - ✨ **@geekmidas/cli**: Add `gkm setup` command for dev environment initialization, `gkm upgrade` command with workspace detection, and secrets push/pull via AWS SSM Parameter Store
  - 🐛 **@geekmidas/testkit**: Fix database creation race condition in PostgresMigrator
  - ✨ **@geekmidas/constructs**: Add integration tests for pg-boss with HonoEndpoint

- Updated dependencies [[`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661)]:
  - @geekmidas/events@1.1.0

## 1.1.1

### Patch Changes

- 🔥 [`9ac81f2`](https://github.com/geekmidas/toolbox/commit/9ac81f25fbf3676e39580c916dc0085358af99cb) Thanks [@geekmidas](https://github.com/geekmidas)! - Remove subscriber adaptor from root exports

## 1.1.0

### Minor Changes

- ⚡️ [`73511d9`](https://github.com/geekmidas/toolbox/commit/73511d912062eb0776935168c9f72d42c7c854a6) Thanks [@geekmidas](https://github.com/geekmidas)! - Improve dev script experience and export function tester

## 1.0.5

### Patch Changes

- ⬆️ [`53c39a0`](https://github.com/geekmidas/toolbox/commit/53c39a0ed9244be6ca2ff6ec8e39138a0fc88692) Thanks [@geekmidas](https://github.com/geekmidas)! - Update RLS types

## 1.0.4

### Patch Changes

- 🐛 [`05a6302`](https://github.com/geekmidas/toolbox/commit/05a6302a37ef2285aaf07ee46eeb9135ed658a68) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix lambda function generator to use correct adaptor import

## 1.0.3

### Patch Changes

- 🐛 [`8bdda11`](https://github.com/geekmidas/toolbox/commit/8bdda11f5c0f7c2eaea605befb0eca38ecc56e44) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix iam resolution for authorizers and fixed exported types for envkit

- Updated dependencies [[`8bdda11`](https://github.com/geekmidas/toolbox/commit/8bdda11f5c0f7c2eaea605befb0eca38ecc56e44)]:
  - @geekmidas/envkit@1.0.1

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release

### Patch Changes

- Updated dependencies [[`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8)]:
  - @geekmidas/audit@1.0.0
  - @geekmidas/cache@1.0.0
  - @geekmidas/db@1.0.0
  - @geekmidas/envkit@1.0.0
  - @geekmidas/errors@1.0.0
  - @geekmidas/events@1.0.0
  - @geekmidas/logger@1.0.0
  - @geekmidas/rate-limit@1.0.0
  - @geekmidas/schema@1.0.0
  - @geekmidas/services@1.0.0
