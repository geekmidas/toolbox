# Epic 1: Workspace-First Full-Stack Framework

**Epic Goal:** Enable developers to define, develop, and deploy multiple apps (backends + Next.js frontends) from a single `gkm.config.ts` workspace configuration with unified CLI commands.

**Integration Requirements:**
- All existing single-app functionality must continue working unchanged
- New workspace features are additive, not replacement
- Dokploy deployment extends existing implementation
- Client generation integrates with existing OpenAPI generation

---

## Story 1.1: Workspace Configuration Foundation

> As a developer,
> I want to define multiple apps in a single `gkm.config.ts` using `defineWorkspace()`,
> so that I can manage my entire monorepo from one configuration file.

**Acceptance Criteria:**
1. `defineWorkspace()` function exported from `@geekmidas/cli`
2. Workspace config schema validated with Zod, providing clear error messages
3. Apps defined with `type: 'backend' | 'frontend'`, `path`, `port`, `dependencies`
4. `deploy.default` and per-app `deploy` override supported in schema
5. `shared.packages` glob pattern supported
6. Full TypeScript inference for config structure

**Integration Verification:**
- IV1: Existing single-app `gkm.config.ts` files load without errors
- IV2: `gkm dev` with single-app config behaves identically to current
- IV3: Invalid workspace configs produce actionable error messages

---

## Story 1.2: Backend App Handler

> As a developer,
> I want backend apps in my workspace to work exactly like current single-app backends,
> so that I can migrate existing projects without changes.

**Acceptance Criteria:**
1. Backend app handler extracts existing config properties (routes, services, envParser, logger)
2. Backend apps support all current `gkm.config.ts` options
3. Single-app configs internally represented as single-backend workspace
4. Backend app type is the default when `type` is omitted

**Integration Verification:**
- IV1: Existing backend dev server startup unchanged
- IV2: All current gkm.config.ts properties work in workspace backend apps
- IV3: No performance regression in single-backend scenarios

---

## Story 1.3: Multi-App Dev Server Orchestration

> As a developer,
> I want `gkm dev` to start all apps in my workspace concurrently,
> so that I can develop my full-stack application with one command.

**Acceptance Criteria:**
1. `gkm dev` spawns process for each app (tsx for backends)
2. Logs aggregated with `[app-name]` prefix and color-coding
3. Graceful shutdown terminates all processes on Ctrl+C
4. `{APP_NAME}_URL` environment variables injected based on dependencies
5. Port conflicts detected and reported with clear error message
6. Dev startup completes in <5 seconds for 2-app workspace

**Integration Verification:**
- IV1: Single-app `gkm dev` unchanged in behavior and performance
- IV2: Backend apps receive correct URLs for their dependencies
- IV3: Stopping dev server cleanly terminates all child processes

---

## Story 1.4: Next.js Frontend App Support

> As a developer,
> I want to add Next.js frontends to my workspace,
> so that I can develop full-stack applications with type-safe backends.

**Acceptance Criteria:**
1. `type: 'frontend', framework: 'nextjs'` recognized in workspace config
2. Next.js project detected via `next.config.js` or `next.config.ts`
3. `gkm dev` spawns `next dev` for frontend apps on configured port
4. Frontend apps receive `{DEPENDENCY}_URL` for each backend dependency
5. Missing Next.js installation produces helpful error message

**Integration Verification:**
- IV1: Backend-only workspaces work without Next.js installed
- IV2: Frontend receives correct backend URLs during development
- IV3: Frontend hot reload works independently of backend changes

---

## Story 1.5: Smart Client Generation

> As a developer,
> I want typed API clients automatically generated for my frontends,
> so that I maintain type safety between backend and frontend without manual steps.

**Acceptance Criteria:**
1. Frontend apps with `dependencies: ['api']` get client generated from `api`'s OpenAPI spec
2. Client regenerates on: new endpoint files, schema changes (.params, .query, .body, .output)
3. Client does NOT regenerate on: handler logic changes, non-endpoint file changes
4. Regeneration completes within 2 seconds
5. Generated client placed in frontend app's configured location
6. Multiple dependencies generate multiple clients (or merged client)

**Integration Verification:**
- IV1: Existing `gkm openapi` command works unchanged
- IV2: Manual `gkm openapi` still available as fallback
- IV3: File watcher doesn't trigger unnecessary regenerations

---

## Story 1.6: Workspace Build Command

> As a developer,
> I want `gkm build` to build all apps in dependency order,
> so that I can create production artifacts for my entire workspace.

**Acceptance Criteria:**
1. `gkm build` builds all apps in workspace
2. Independent apps build in parallel
3. Dependent apps build after their dependencies complete
4. Backend apps use existing build logic (Lambda/server output)
5. Frontend apps use `next build` with standalone output
6. Build outputs to per-app directories

**Integration Verification:**
- IV1: Single-app `gkm build` unchanged
- IV2: Build fails fast if any app build fails
- IV3: Build artifacts are correct for each app type

---

## Story 1.7: Dockerfile Generation

> As a developer,
> I want to generate optimized Dockerfiles for my apps,
> so that I can deploy to container-based platforms like Dokploy.

**Acceptance Criteria:**
1. `gkm docker` generates Dockerfile for each app
2. Backend Dockerfiles optimized for Node.js (multi-stage, minimal image)
3. Frontend Dockerfiles optimized for Next.js standalone
4. Dockerfiles generated on-demand, not committed
5. Monorepo-aware: copies only relevant packages
6. Supports custom base image configuration

**Integration Verification:**
- IV1: Generated Dockerfiles build successfully
- IV2: Built images run correctly in isolation
- IV3: No secrets or sensitive data in Dockerfiles

---

## Story 1.8: Docker Compose Generation

> As a developer,
> I want to generate docker-compose.yml for local containerized development,
> so that I can test my deployment setup locally before deploying to Dokploy.

**Acceptance Criteria:**
1. `gkm compose` generates `docker-compose.yml` for workspace
2. Each app defined as a service
3. Service discovery: apps can reach each other by name
4. Ports mapped according to workspace config
5. Environment variables injected with `{APP_NAME}_URL` pattern
6. Compatible with Docker Compose v2

**Integration Verification:**
- IV1: `docker compose up` starts all services
- IV2: Apps can communicate via service names
- IV3: Compose file matches Dokploy deployment structure

---

## Story 1.9: Multi-App Dokploy Deployment

> As a developer,
> I want `gkm deploy` to deploy my entire workspace to Dokploy,
> so that I can ship my full-stack application with one command.

**Acceptance Criteria:**
1. `gkm deploy` deploys all apps to Dokploy
2. Workspace maps to one Dokploy project
3. Each app maps to one Dokploy application
4. Deployment respects dependency order (backends before dependent frontends)
5. Environment variables synced per-app including `{APP_NAME}_URL`
6. `gkm deploy [app...]` supports selective deployment

**Integration Verification:**
- IV1: Existing single-app Dokploy deploy unchanged
- IV2: Selective deploy only affects specified apps
- IV3: Deployment URLs correctly resolved for inter-app communication

---

## Story 1.10: Per-App Deploy Targets

> As a developer,
> I want to deploy different apps to different targets,
> so that I can use the best platform for each app (e.g., Vercel for frontends).

**Acceptance Criteria:**
1. `app.deploy` property overrides `deploy.default`
2. `deploy.default` falls back to `'dokploy'` if not specified
3. Unsupported targets (Vercel, Cloudflare) error with "coming in Phase 2" message
4. Config validated at startup, not at deploy time
5. Selective deploy respects per-app targets

**Integration Verification:**
- IV1: Apps without `deploy` override use default target
- IV2: Mixed-target workspace validates correctly
- IV3: Clear error message for Phase 2 targets

---

## Story 1.11: Project Initialization

> As a developer,
> I want to scaffold a new project with `gkm init`,
> so that I can quickly start building with best-practice structure and configuration.

**Acceptance Criteria:**
1. `gkm init` runs interactive prompts for project setup
2. Two templates available: `api` (single backend) and `fullstack` (monorepo with api + web + models)
3. Fullstack template creates `packages/models` with example Zod schemas
4. Services selection: db (PostgreSQL), cache (Redis), mail (Mailpit)
5. Package manager selection: pnpm, npm, yarn, bun
6. Deployment target selection: Dokploy or configure later
7. `--name` and `--template` flags skip respective prompts
8. Generated `gkm.config.ts` matches selected options
9. Generated `turbo.json` for fullstack template
10. Success message with next steps printed

**Integration Verification:**
- IV1: `gkm init --template api` creates working single-app project
- IV2: `gkm init --template fullstack` creates working monorepo
- IV3: `gkm dev` works immediately after init (with dependencies installed)
- IV4: Models package exports are importable from api and web apps

---
