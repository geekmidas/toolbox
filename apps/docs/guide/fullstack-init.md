# Fullstack Init

A detailed walkthrough of everything `gkm init` does when scaffolding a fullstack application.

::: warning This path has not moved to constructs yet
A single-app project scaffolds `src/constructs/`, gets a `constructs` glob in
its config, and has its containers reconciled from what it declares. The
fullstack workspace does not: its per-app database roles are created by
`docker/postgres/init.sh` and its URLs come from per-app secrets, neither of
which reconcile knows about — so declaring only the API's half would leave the
auth app pointing at a container that is no longer the one running.

It moves once the auth app declares its own half, most likely as a
`database.schema()` tenant of the API's database. Until then this page describes
what `gkm init --template fullstack` actually produces. For the constructs
model, see [Getting Started](/guide/getting-started).
:::

## Overview

The fullstack template creates a production-ready monorepo with three applications and two shared packages. It sets up authentication, database isolation, encrypted secrets, Docker services, and development tooling — all wired together and ready to run with a single `gkm dev` command.

## Interactive Prompts

Running `gkm init my-app` walks you through these prompts in order:

| # | Prompt | Options | Default |
|---|--------|---------|---------|
| 1 | Project name | Free text (npm naming rules) | `my-app` |
| 2 | Template | **API**, **Fullstack** | API |
| 3 | Services | PostgreSQL, Redis, Mailpit (multi-select) | All selected |
| 4 | Package manager | pnpm, npm, yarn, bun | Auto-detected |
| 5 | Deployment target | Dokploy, AWS (SST), Configure later | Configure later |
| 6 | AWS region *(SST only)* | Free text, e.g. `eu-west-1` | — |
| 7 | Deployed stages | Free text, comma-separated, e.g. `staging, prod` | — |
| 8 | Which stage is production *(when there are several)* | One of the deployed stages | — |
| 9 | Local stage | Free text, e.g. `dev`; never one of the deployed stages | — |
| 10 | Telescope | Yes / No | Yes |
| 11 | Logger | Pino (recommended), Console | Pino |
| 12 | Routes structure | Centralized (endpoints), Centralized (routes), Domain-based | Centralized (endpoints) |
| 13 | Frontend framework *(fullstack only)* | **Next.js**, **TanStack Start**, **Expo** | Next.js |

Stages are named by the project, not picked from a list. They are written to
`gkm.config.ts` as [`stages`](./workspaces.md#stages) and everything else is
derived from them: the local secrets it seeds, one `deploy:<stage>` script per
deployed stage, SST's retain/protect list, and the `STAGE` your env config
parses.

All prompts can be skipped with `--yes` to use defaults:

```bash
gkm init my-app --template fullstack --yes
```

::: info
Selecting **Fullstack** automatically enables monorepo mode. The `--monorepo` flag is not needed.
:::

## Frontend Framework Choice

Fullstack picks one frontend scaffold; the API + auth services stay the same regardless. Each framework gets its own conventions for client-bundled env vars, which the toolbox honors automatically when generating dependency URLs and Docker build args:

| Framework | App path | Port | Public env prefix | Notes |
|-----------|----------|------|-------------------|-------|
| **Next.js** | `apps/web/` | 3001 | `NEXT_PUBLIC_` | App router, React Server Components, standalone Docker output. |
| **TanStack Start** | `apps/web/` | 3001 | `VITE_` | File-based router on Vite + Nitro. |
| **Expo** | `apps/app/` | 8081 (Metro) | `EXPO_PUBLIC_` | iOS + Android via expo-router; NativeWind for styling; better-auth Expo client wired in. |

You can still use `framework: 'vite'` or `framework: 'remix'` by editing `gkm.config.ts` after init — the deploy/sniffer pipeline supports them — but `gkm init` only scaffolds the three above.

## What Gets Generated

### Directory Structure

```
my-app/
├── apps/
│   ├── api/                     # Backend API
│   │   ├── src/
│   │   │   ├── config/
│   │   │   │   ├── env.ts       # EnvironmentParser singleton
│   │   │   │   ├── logger.ts    # Logger instance (Pino or Console)
│   │   │   │   └── telescope.ts # Telescope setup
│   │   │   ├── services/
│   │   │   │   ├── database.ts  # Kysely database service
│   │   │   │   └── auth.ts      # Auth client service
│   │   │   ├── router.ts        # a branch of api, with session/auth
│   │   │   ├── endpoints/
│   │   │   │   ├── health.ts    # GET /health
│   │   │   │   ├── users/
│   │   │   │   │   ├── list.ts  # GET /users
│   │   │   │   │   └── get.ts   # GET /users/:id
│   │   │   │   └── profile.ts   # Protected endpoint
│   │   │   └── test/
│   │   │       ├── globalSetup.ts
│   │   │       └── fixtures/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── gkm.config.ts
│   ├── auth/                    # Authentication service
│   │   ├── src/
│   │   │   ├── config/
│   │   │   │   ├── env.ts
│   │   │   │   └── logger.ts
│   │   │   ├── auth.ts          # better-auth with magic link
│   │   │   └── index.ts         # Hono server entry
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/                     # Frontend (Next.js OR TanStack Start)
│       ├── src/
│       │   ├── app/             # (Next.js) Root layout, page, providers
│       │   ├── routes/          # (TanStack Start) __root.tsx, index.tsx, …
│       │   ├── api/index.ts     # Typed API client
│       │   ├── components/ui/   # shadcn/ui components — the app's own source
│       │   ├── config/
│       │   │   ├── client.ts    # NEXT_PUBLIC_* / VITE_* config
│       │   │   └── server.ts    # Server-side secrets
│       │   └── lib/
│       │       ├── query-client.ts
│       │       ├── auth-client.ts
│       │       └── utils.ts     # cn() class merging
│       ├── components.json      # shadcn/ui config
│       ├── next.config.ts       # (Next.js)
│       ├── vite.config.ts       # (TanStack Start)
│       ├── tsconfig.json
│       └── package.json
│
│   # …or, when frontendFramework=expo, instead of apps/web:
│   └── app/                     # Expo (React Native) app
│       ├── app/                 # expo-router screens (_layout, index, login)
│       ├── lib/                 # api, auth-client, query-client
│       ├── app.config.ts
│       ├── eas.json             # EAS build profiles + EXPO_PUBLIC_* env
│       ├── babel.config.js
│       ├── metro.config.js      # NativeWind integration
│       ├── tailwind.config.ts
│       ├── global.css
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   └── models/                  # Shared Zod schemas
│   │   ├── src/
│   │   │   ├── common.ts       # Id, Timestamps, Pagination
│   │   │   └── user.ts         # User, CreateUser, UpdateUser
│   │   ├── package.json
│   │   └── tsconfig.json
├── docker-compose.constructs.yml # written by gkm from the constructs (gitignored)
├── .gkm/
│   └── secrets/
│       └── development.json     # Encrypted development secrets
├── .vscode/
│   ├── settings.json            # Biome formatter, editor defaults
│   └── extensions.json          # Recommended extensions
├── package.json                 # Root workspace
├── pnpm-workspace.yaml
├── tsconfig.json                # Base TS config (ES2022, strict)
├── vitest.config.ts
├── turbo.json                   # Task orchestration with caching
├── biome.json                   # 2-space, single quotes, semicolons
├── gkm.config.ts                # defineWorkspace() config
└── .gitignore
```

## GitHub Actions

Every scaffold ships `.github/`:

| File | Runs on | Does |
|---|---|---|
| `workflows/ci.yml` | every pull request | install → build → lint → typecheck → `test:once` |
| `workflows/release-drafter.yml` + `release-drafter.yml` | pushes to main, pull requests | keeps a draft release, labelled from each PR title's `feat` / `fix` / `chore` prefix |
| `workflows/deploy.yml` *(when a deploy target was picked)* | push to main, a published release, or a manual run | deploys stages, as below |

Tests need no shared key: `gkm test` starts the containers the constructs
declare and, with `GKM_AUTO_SETUP=1`, generates throwaway test-stage secrets.

**Deploy** names no stage — it reads [`stages`](./workspaces.md#stages) from
`gkm.config.ts` when it runs:

| Event | Deploys |
|---|---|
| push to `main` | every deployed stage **not** in `protected` |
| publishing the drafted release | the `protected` stages |
| *Run workflow* | the one stage you type (refused if it is not deployed) |

Each stage deploys in the GitHub **environment** of the same name, so give
each one what it needs — and put a required reviewer on protected ones if a
release should also need approval:

| Environment setting | Target | Value |
|---|---|---|
| variable `AWS_ROLE_ARN` | SST | an IAM role that trusts GitHub's OIDC provider for this repo |
| the stage's secrets | SST | read from SSM in the stage's account by the deploy, with the role; written there by `gkm secrets:set … --stage <stage>` |
| secret `GKM_SECRETS_KEY` | Dokploy | the stage's key, from `~/.gkm/keys/<namespace>/<project>/<stage>.key` — the encrypted file itself is under the gitignored `.gkm/`, so set `secrets.store` to a store CI can reach |
| secret `DOKPLOY_API_TOKEN`, variable `DOKPLOY_ENDPOINT` | Dokploy | your Dokploy API token and URL |

## Step-by-Step Execution

Here's what happens internally, in order:

### 1. Validate Input

- Project name is validated against npm naming conventions (alphanumeric, hyphens, underscores)
- Target directory must not already exist
- Reserved names are blocked (`node_modules`, `.git`, `package.json`, `src`)

### 2. Generate Database Credentials

For fullstack projects with database enabled, two sets of credentials are generated:

- **api** user — random password, connects to `public` schema
- **auth** user — random password, connects to `auth` schema

Both users share the same database (`{project_name}_dev`) but are isolated by schema.

### 3. Generate Root Monorepo Files

| File | Purpose |
|------|---------|
| `package.json` | Root workspace with shared scripts (`dev`, `build`, `test`) |
| `pnpm-workspace.yaml` | Defines `apps/*` and `packages/*` as workspaces |
| `tsconfig.json` | Base config — target ES2022, module NodeNext, strict mode |
| `vitest.config.ts` | Test runner configuration |
| `turbo.json` | Task orchestration with caching rules |
| `biome.json` | Formatter and linter (2-space indent, single quotes, semicolons) |
| `.gitignore` | Standard Node.js ignores + `.gkm/` |
| `.vscode/settings.json` | Biome as default formatter, editor defaults |
| `.vscode/extensions.json` | Recommended VSCode extensions |
| `gkm.config.ts` | Workspace config with `defineWorkspace()` |

The workspace config says where the constructs live. The three apps come from
them — every `RestApi` is one, and so is every `StaticSite`:

```typescript
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'my-app',
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: './constructs/**/*.ts',
});
```

### 4. Generate Shared Models Package

Creates `packages/models/` with reusable Zod schemas:

**`common.ts`** — `IdSchema`, `IdParamsSchema`, `TimestampsSchema`, `PaginationSchema`, `PaginatedResponseSchema`

**`user.ts`** — `UserSchema`, `CreateUserSchema`, `UpdateUserSchema`, `UserResponseSchema`

All schemas export corresponding TypeScript types. Published as `@{projectName}/models` within the workspace.

### 5. No Docker files to write

`init` writes no compose file. The containers come from the constructs it
declared — `Database` and the auth tenant are why a Postgres runs — and `gkm
dev` writes `docker-compose.constructs.yml` from them, creating the roles and
schemas each needs. Put an image pin or an extra service in your own
`docker-compose.yml`; it is merged over the generated one.

### 6. Generate API App (`apps/api`)

The API app is built on `@geekmidas/constructs` with the Hono framework.

**Configuration files:**
- `gkm.config.ts` — endpoint routes, env parser, logger, Telescope
- `tsconfig.json` — inherits root config
- `package.json` — deps, scripts, exports

**Source files:**
- `config/env.ts` — `EnvironmentParser` singleton with database, cache, and auth config
- `config/logger.ts` — Pino or Console logger based on prompt selection
- `config/telescope.ts` — Telescope request recording (if enabled)
- `services/database.ts` — Kysely database service with PostgreSQL dialect
- `services/auth.ts` — Auth client for calling the auth service
- `router.ts` — a branch of `api` with a default JWT authorizer and session support
- `endpoints/health.ts` — basic health check
- `endpoints/users/list.ts` and `get.ts` — example CRUD endpoints
- `endpoints/profile.ts` — protected endpoint requiring authentication

**Test files:**
- `test/globalSetup.ts` — test database setup and teardown
- `test/fixtures/` — test helpers

**Key dependencies:**

| Package | Purpose |
|---------|---------|
| `@geekmidas/constructs` | `RestApi` and the endpoint builder it carries |
| `@geekmidas/services` | Service discovery |
| `@geekmidas/envkit` | Environment parsing |
| `@geekmidas/auth` | JWT verification |
| `@geekmidas/telescope` | Request debugging |
| `@geekmidas/audit` | Audit logging |
| `@geekmidas/rate-limit` | Rate limiting |
| `hono` | HTTP framework |
| `kysely` + `pg` | Database ORM |
| `pino` | Structured logging (if selected) |
| `zod` | Schema validation |

**Scripts:** `dev` → `gkm dev`, `build` → `gkm build`, `test` → `vitest`, `typecheck` → `tsc --noEmit`, `lint` → `biome lint .`, `fmt` → `biome format . --write`

### 7. Generate Auth App (`apps/auth`)

A standalone authentication service built with [better-auth](https://better-auth.com) and magic link authentication.

```typescript
// apps/auth/src/auth.ts
export const auth = betterAuth({
  database: new pg.Pool({ connectionString: process.env.DATABASE_URL }),
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(','),
  secret: process.env.BETTER_AUTH_SECRET,
  plugins: [
    magicLink({
      expiresIn: 300, // 5 minutes
      sendMagicLink: async ({ email, url }) => {
        // Logs to console in dev, integrate emailkit for production
        console.log('Magic link for', email, ':', url);
      },
    }),
  ],
});
```

The Hono entry point mounts auth routes at `/api/auth/*` with CORS for trusted origins and a `/health` endpoint.

**Key dependencies:** `better-auth`, `hono`, `@hono/node-server`, `kysely`, `pg`

**Scripts:** `dev` → `gkm dev --entry ./src/index.ts`, `db:migrate` → `npx @better-auth/cli migrate`, `db:generate` → `npx @better-auth/cli generate`

### 8. Generate Frontend App

The frontend scaffold depends on which `frontendFramework` you picked. All three share the same toolbox plumbing — typed API client (`@geekmidas/client`), `EnvironmentParser` for config, better-auth — but use different bundlers and env-var prefixes.

#### Next.js (`apps/web`, default)

A Next.js 16 frontend with React 19, React Query, and better-auth client.

- Path aliases: `~/*` → `./src/*`, `@{name}/models`
- Tailwind CSS v4 via PostCSS plugin
- React Query with 60s stale time
- better-auth client with magic link plugin
- Separate server and client config files (`NEXT_PUBLIC_*` for client)
- Transpiles workspace packages via `next.config.ts`

**Key dependencies:** `next`, `react`, `react-dom`, `@tanstack/react-query`, `better-auth`, `@geekmidas/client`, `@geekmidas/envkit`, `tailwindcss`

#### TanStack Start (`apps/web`)

A Vite + TanStack Start app with file-based routing via `@tanstack/react-router`.

- File-based routes under `src/routes/` (e.g. `__root.tsx`, `index.tsx`)
- Vite as the bundler — env vars use the `VITE_` prefix and are read via `import.meta.env`
- Tailwind CSS v4 via the `@tailwindcss/vite` plugin
- React Query, better-auth (magic link), typed API client
- Server-side secrets stay in `src/config/server.ts` (read via `process.env`)

**Key dependencies:** `@tanstack/react-start`, `@tanstack/react-router`, `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `@tanstack/react-query`, `better-auth`, `@geekmidas/client`, `@geekmidas/envkit`

#### Expo (`apps/app`)

A React Native mobile app on Expo SDK 57 with expo-router and NativeWind.

- expo-router screens under `app/` (`_layout.tsx`, `index.tsx`, `login.tsx`)
- NativeWind for Tailwind-style class names on React Native primitives
- `@better-auth/expo` client with magic link, backed by `expo-secure-store`
- React Query for data fetching against the `@{name}/api` typed client
- Public env vars use the `EXPO_PUBLIC_` prefix and are inlined into the bundle
- `eas.json` includes dev / preview / production build profiles, each with its own `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_AUTH_URL`

**Key dependencies:** `expo`, `expo-router`, `expo-secure-store`, `@better-auth/expo`, `nativewind`, `react-native`, `@tanstack/react-query`, `@geekmidas/client`

### 9. shadcn/ui Components in the Web App

The web app (Next.js or TanStack Start) gets shadcn/ui components written into
its own source — `apps/web/src/components/ui/` — rather than a shared package.
shadcn is copy-in by design: the components are yours to edit, and more come
from `npx shadcn@latest add <component>` run in `apps/web`, which reads the
generated `components.json`.

**Includes:**
- Button, Card, Input, Label, Badge, Separator, Tabs, Tooltip, Dialog
- Radix UI primitives for accessibility, Lucide React icons
- `cn()` in `src/lib/utils.ts` (clsx + tailwind-merge)
- Tailwind v4 with the theme's CSS variables in the app's global stylesheet
  (`src/app/globals.css` for Next.js, `src/styles/globals.css` for TanStack Start)

**Key dependencies:** `@radix-ui/*`, `tailwindcss`, `lucide-react`, `class-variance-authority`

::: info `@geekmidas/ui` is gone
Toolbox no longer publishes a component library. Projects scaffolded before
v10 that import `@geekmidas/ui` can stay on its last published version, or run
`npx shadcn@latest add` for the components they use.
:::

### 10. Initialize Encrypted Secrets

Secrets are encrypted and stored at `.gkm/secrets/dev.json`. The decryption key is stored outside the project at `~/.gkm/keys/{namespace}/{project}/development.key` (under `$GKM_HOME` when that is set).

**Auto-generated secrets:**

| Key | Value |
|-----|-------|
| `PORT` | `3000` |
| `LOG_LEVEL` | `debug` |
| `JWT_SECRET` | Random |
| `AUTH_PORT` | `3002` |
| `BETTER_AUTH_SECRET` | Random |
| `BETTER_AUTH_URL` | `http://localhost:3002` |
| `BETTER_AUTH_TRUSTED_ORIGINS` | `http://localhost:3000,http://localhost:3001` |

No address of anything a construct declares is stored: the database's and
the auth tenant's URLs, and the auth server's `AUTH_URL`, are derived from the
constructs wherever the apps run.

### 11. Install Dependencies

Unless `--skip-install` is passed, the CLI runs the package manager's install command:

```bash
pnpm install  # (or npm/yarn/bun based on selection)
```

### 12. Format Generated Code

After installation, all generated files are formatted with Biome:

```bash
npx @biomejs/biome format --write --unsafe .
```

### 13. Initialize Git Repository

A git repository is initialized with an initial commit:

```bash
git init
git branch -M main
git add .
git commit -m "🎉 Project created with @geekmidas/toolbox"
```

### 14. Print Next Steps

The CLI prints a summary with next steps:

```
──────────────────────────────────────────────────

✅ Project created successfully!

Next steps:

  cd my-app
  # Start PostgreSQL (if not running)
  docker compose up -d postgres
  pnpm dev

📁 Project structure:
  my-app/
  ├── apps/
  │   ├── api/          # Backend API
  │   ├── auth/         # Auth service (better-auth)
  │   └── web/          # Next.js frontend
  ├── packages/
  │   └── models/       # Shared Zod schemas
  ├── .gkm/secrets/     # Encrypted secrets
  ├── gkm.config.ts     # Workspace config
  └── turbo.json        # Turbo config

🔐 Secrets management:
  gkm secrets:show --stage dev  # View secrets
  gkm secrets:set KEY VALUE --stage dev  # Add secret
  gkm secrets:init --stage prod  # Create prod secrets

🚀 Deployment:
  pnpm deploy:prod

📚 Documentation: https://geekmidas.github.io/toolbox/
```

## CLI Options

All prompts can be overridden with command-line flags:

```bash
gkm init <project-name> [options]
```

| Option | Description |
|--------|-------------|
| `--template <name>` | Template: `api`, `fullstack`, `minimal`, `serverless`, `worker` |
| `--yes`, `-y` | Skip all prompts, use defaults |
| `--skip-install` | Skip dependency installation |
| `--monorepo` | Force monorepo setup (API template only, fullstack is always monorepo) |
| `--api-path <path>` | API app path in monorepo (default: `apps/api`) |
| `--pm <manager>` | Package manager: `pnpm`, `npm`, `yarn`, `bun` |
| `--deploy <target>` | Deploy target: `dokploy`, `sst`, `none` |
| `--region <region>` | AWS region for `--deploy sst`, e.g. `eu-west-1` |
| `--stages <names>` | Deployed stages, comma-separated, e.g. `staging,prod` |
| `--protected-stage <name>` | Which deployed stage is production (retained and protected) |
| `--local-stage <name>` | What `gkm dev`, `exec` and `test` run as, e.g. `dev` |

## Defaults with `--yes`

When running with `--yes`, these defaults are used:

| Setting | Default |
|---------|---------|
| Template | `api` (must pass `--template fullstack` explicitly) |
| Services | All enabled (PostgreSQL, Redis, Mailpit) |
| Package manager | `pnpm` |
| Deploy target | None (`--deploy` picks one) |
| AWS region *(with `--deploy sst`)* | `eu-west-1` |
| Stages | `local: 'local'`, `deployed: ['production']`, `protected: ['production']` |
| Telescope | Enabled |
| Logger | Pino |
| Routes structure | Centralized (endpoints) |
| Frontend framework *(fullstack only)* | Next.js |

## Team Onboarding

After pushing your project to git, team members can get up and running with:

```bash
git clone <repo-url>
cd my-app
pnpm install
gkm setup
gkm dev
```

See the [Development Server — Team Onboarding](/guide/dev-server#team-onboarding) guide for details on secret sharing, SSM sync, and troubleshooting.
