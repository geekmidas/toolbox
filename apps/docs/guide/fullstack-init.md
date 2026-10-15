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

The fullstack template creates a monorepo for a product people sign in to: an API, an auth server, a web site and an admin panel — and, unless you say no, a mobile app and the site its App Store and Play Store reviewers sign in through. Signing in is a magic link, end to end: the auth server sends it, every app requests it and handles it coming back, and the admin panel lets in only the people whose role grants it. Encrypted secrets, the containers and the tooling are wired in, and the generated project's own feature tests run with `gkm test`.

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
| 13 | Web and admin framework *(fullstack only)* | **Next.js**, **TanStack Start** | Next.js |
| 14 | Include a mobile app? *(fullstack only)* | Yes / No — Expo, with its sign-in and the store-reviewer site | Yes |

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

## The Apps

| App | Path | What it is |
|-----|------|------------|
| API | `apps/api/` | `RestApi` — `GET /profiles/me` for whoever is signed in, and the admin panel's staff-only endpoints |
| Auth server | `apps/auth/` | `BetterAuth` with magic links; the entry is generated from `constructs/auth.ts` |
| Web site | `apps/web/` | Next.js or TanStack Start — sign-in page, the link landing at `/signing-in`, a signed-in home. Answers on the root domain |
| Admin panel | `apps/admin/` | Same framework as the site — sign-in, and a gate that lets in only roles granting `admin.access` |
| Mobile app *(optional)* | `apps/app/` | Expo SDK 57, expo-router, NativeWind — continue → check your email → link opens the app → signed in |
| Reviewer site *(with the app)* | `apps/reviewer/` | Where an App Store or Play Store reviewer, who has no inbox, finds their sign-in link — behind a generated password |

The web site and the admin panel share the framework you pick. Each gets its own conventions for client-bundled env vars (`NEXT_PUBLIC_` or `VITE_`; the app's are `EXPO_PUBLIC_`), which the toolbox honors when generating dependency URLs and Docker build args. With a mobile app, every frontend runs Expo's React version, so the hooks they share resolve one React.

## Signing In

Everything about signing in lives in `packages/auth` (`@<name>/auth`), so the server and every app agree on it:

| Import | Used by | What it is |
|--------|---------|------------|
| `@<name>/auth/server` | `constructs/auth.ts` | Better Auth plugins: `magicLinkSignIn` (sends through the mailer), `magicLinkEmailLimit` (a per-address limit beside Better Auth's per-IP one) and, with a mobile app, `reviewerLinks` |
| `@<name>/auth/client` | web, admin, app | Headless React: `AuthProvider` takes the Better Auth client the app built; `useSession`, `useRequestSignInLink`, `useSignInLinkResult`, `useSignOut` |
| `@<name>/auth/magic-link` | both | How long a link lasts, the error an expired one comes back with, how an address is checked, the route a link lands on |

The link is a React Email template (`constructs/templates/MagicLink.tsx`) sent by the `Email` construct — Mailpit locally, so `gkm dev` and `gkm test` read it there. A link that has expired or was used comes back to the same page with the address, and the page offers to send a new one.

### Who gets into the admin panel

Roles are sets of permissions (`permissions`, `roles`, `role_permissions`, `user_roles`, migrated in `db/database/`), and the catalogue is `PERMISSIONS` in `@<name>/models/access` — the seeds write it, with the **Member** and **Super admin** roles. Whoever signs in becomes a Member on their first request to the API. The admin panel and every staff endpoint need `admin.access`, which the **Super admin** role grants.

`gkm init` asks for the first admin's email (`--admin-email`; with `--yes` it takes `git config user.email`) and writes it to `db/database/seeds/03_admins.ts`. That seed gives each address in `ADMINS` a `users` row and the Member and Super admin roles before they have ever signed in. When the person first signs in, their sign-in claims that row by email, so the admin panel lets them in at once. Someone who already has a row just gets the roles.

To add an admin later, add their address to `ADMINS` and run the seeds again (`gkm dev --seed`, `gkm test`, or the next deploy). Removing an address from the list does not take the role away.

### Store reviewers

A store reviewer can't receive email, so the reviewer accounts in `@<name>/auth/reviewers` never are: the auth server keeps their link in `reviewer_links`, and `reviewer.<domain>` shows it to whoever has the site's password — a `RandomPassword`, generated on a stage's first deploy (`gkm secrets:show --stage <stage>` reads it). Change the placeholder reviewer addresses to your own domain, and give the stores the address, the reviewer site and its password in the review notes.

### After `gkm init`

Better Auth's tables — and the rate-limit and reviewer-link tables its plugins add — are its tenant's first migration:

```bash
gkm migration auth   # writes db/auth-database/migrations/<stamp>_better_auth.sql
gkm test             # migrates, seeds, and runs the API's and reviewer site's feature tests
```

## What Gets Generated

### Directory Structure

```
my-app/
├── apps/
│   ├── api/                       # RestApi
│   │   ├── src/
│   │   │   ├── router.ts          # router → memberRouter → staffRouter
│   │   │   ├── access.ts          # can('users.view')
│   │   │   ├── users/members.ts   # the users row and permissions of whoever signed in
│   │   │   ├── endpoints/         # health, profiles/me, admin/users
│   │   │   └── __tests__/signing-in.spec.ts
│   │   └── test/                  # transaction-wrapped example
│   ├── auth/                      # BetterAuth — no src/, the entry is generated
│   ├── web/                       # Next.js or TanStack Start
│   │   └── src/                   # login, signing-in, home; auth/, lib/auth-client.ts
│   ├── admin/                     # same framework — login, signing-in, staff gate, dashboard
│   ├── app/                       # (mobile app) Expo: (auth)/continue, check-email,
│   │                              #   signing-in, +native-intent, lib/auth-client.ts
│   └── reviewer/                  # (mobile app) reviewer site and its feature tests
├── constructs/                    # every construct, shared by the apps
│   ├── api.ts  auth.ts  database.ts  email.ts  logger.ts
│   ├── site.ts  admin.ts  app.ts  reviewer.ts
│   └── templates/                 # MagicLink.tsx, layout.tsx (React Email)
├── db/database/
│   ├── migrations/                # users, access control
│   └── seeds/                     # permissions, system roles, admins
├── packages/
│   ├── auth/                      # @<name>/auth — server, client, magic-link (, reviewers)
│   └── models/                    # @<name>/models — common, user, access, profile
├── test/factories/database.ts     # the database's test factory
├── docker-compose.constructs.yml  # written by gkm from the constructs (gitignored)
├── .gkm/secrets/                  # encrypted local secrets
├── gkm.config.ts                  # defineWorkspace()
├── package.json  pnpm-workspace.yaml  turbo.json  tsconfig.json  biome.json
└── vitest.config.ts
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

**Deploy** names no stage. Its first job runs the
[stages action](./deployment.md#deploying-from-github-actions)
(`geekmidas/toolbox/actions/stages`), which asks the project's own
`gkm stages --github-output` which stages this run builds and deploys:

| Event | Builds (compose) | Deploys |
|---|---|---|
| push to `main` | every deployed stage | every deployed stage **not** in `protected` |
| publishing the drafted release | — | the `protected` stages |
| *Run workflow* | — | the one stage you type, at the `ref` you type (refused if it is not deployed) |

With `--deploy compose` the runner builds and pushes each stage's images and
the server pulls them over SSH; Dokploy and SST deploy with `gkm deploy` from a
checkout. The whole workflow for each is in
[Deploying from GitHub Actions](./deployment.md#deploying-from-github-actions).

Each stage deploys in the GitHub **environment** of the same name, so give
each one what it needs — and put a required reviewer on protected ones if a
release should also need approval:

| Environment setting | Target | Value |
|---|---|---|
| variable `AWS_ROLE_ARN` | SST; compose with an AWS `secrets.store` | an IAM role that trusts GitHub's OIDC provider for this repo (`gkm deploy:github`) |
| the stage's secrets | SST | read from SSM in the stage's account by the deploy, with the role; written there by `gkm secrets:set … --stage <stage>` |
| secret `DEPLOY_SSH_KEY`; variable `DEPLOY_KNOWN_HOSTS` | compose | the deploy user's key and the server's pinned host key: the deploy job drives the server's Docker over SSH (the user and host are `deploy.compose.server` and `GKM_SERVER_IPV4`) |
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

The API is the `Api` construct (`constructs/api.ts`), built with `.auth(auth)` so a handler can ask the auth server whose cookie it carries. `src/router.ts` branches it:

- `router` — `api.database(database)`, no session.
- `memberRouter` — someone signed in. Their first request makes their `users` row (linked to the auth server's user by `authUserId`) and gives them the Member role; handlers get `session.member` and `session.permissions`.
- `staffRouter` — a member whose roles grant `admin.access`, else a 403 with the code `staff_required`. Staff endpoints add `.authorize(can(…))`.

`GET /profiles/me` returns who is signed in and their permissions — what every frontend reads first. `GET /admin/users` is the admin panel's first page. `src/__tests__/signing-in.spec.ts` signs in through a real emailed link and checks the gate.

### 7. Generate Auth App (`apps/auth`)

Only a package: the `BetterAuth` construct in `constructs/auth.ts` is the server, and the build generates its entry. Its package is `@<name>/auth-server`, so `@<name>/auth` is free for the shared package every app imports.

```typescript
// constructs/auth.ts (abridged)
export const auth = new BetterAuth('Auth', {
  path: 'apps/auth',
  database: authDatabase,
  basePath: '/api/auth',
  dependsOn: [email],
  options: async ({ services }) => ({
    rateLimit: { enabled: true, storage: 'database' },
    plugins: [
      expo(), // with a mobile app
      magicLinkSignIn({
        sendMagicLink: ({ email: to, url }) =>
          services.mail.sendTemplate('magicLink', { to, subject: 'Sign in to my-app', props: { url, minutes: MAGIC_LINK_MINUTES } }),
      }),
      magicLinkEmailLimit(MAGIC_LINK_LIMITS.perEmail),
      reviewerLinks(), // with a mobile app
    ],
  }),
});
```

### 8. Generate the Frontends

The web site and the admin panel are generated by one generator, in the framework you picked. Both wrap their tree in `<AuthProvider client={authClient}>` and use the same pages: `/login` asks for a link with `useRequestSignInLink`, and `/signing-in` reads where it landed with `useSignInLinkResult`. The admin panel's home is a gate around a dashboard: no session sends you to `/login`; a session without `admin.access` gets "no access" and a sign-out button.

#### Next.js

App router, React Server Components, standalone Docker output, Tailwind CSS v4. `next.config.ts` transpiles `@<name>/models` and `@<name>/auth`. Public env vars use the `NEXT_PUBLIC_` prefix.

#### TanStack Start

File-based routes under `src/routes/` on Vite + Nitro, Tailwind CSS v4 via `@tailwindcss/vite`. Public env vars use the `VITE_` prefix. `src/routeTree.gen.ts` is written as the router plugin would write it, so a fresh checkout typechecks before the first `vite dev`; the plugin overwrites it from then on.

#### The mobile app (`apps/app`)

Expo SDK 57 with expo-router and NativeWind. `constructs/app.ts` depends on the API, the auth server and the mailer, which is what gives it its URLs, its scheme in the auth server's trusted origins, and — locally — Mailpit's inbox URL, so "Open your email" opens it.

The sign-in flow: `(auth)/continue` asks for the address, `(auth)/check-email` waits; the link opens in the phone's browser, the auth server's Expo plugin redirects back into the app with the session, `+native-intent.tsx` keeps the link exactly as it arrived, and `signing-in.tsx` stores the session in the secure store. An expired link offers to send a new one.

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
| `--web <framework>` | Fullstack: the web site's and admin panel's framework — `nextjs`, `tanstack-start` |
| `--mobile-app` / `--no-mobile-app` | Fullstack: include the Expo app and its reviewer site, or not |
| `--admin-email <email>` | Fullstack: the first Super admin, seeded by `03_admins.ts` |

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
| Web and admin framework *(fullstack only)* | Next.js |
| Mobile app *(fullstack only)* | Included, with its reviewer site |

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
