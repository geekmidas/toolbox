# @geekmidas/toolbox Workspace Enhancement PRD

## Document Information

| Field | Value |
|-------|-------|
| **Project** | @geekmidas/toolbox Workspace & Full-Stack Framework |
| **Version** | 1.0 |
| **Status** | Draft |
| **Created** | 2026-01-13 |
| **Author** | PM |
| **Source** | Project Brief (`docs/brief.md`) |

---

## 1. Introduction and Project Context

### 1.1 Analysis Source

- **Project Brief:** `docs/brief.md` (comprehensive, created 2026-01-13)
- **IDE-based analysis:** @geekmidas/toolbox monorepo
- **Technical documentation:** `CLAUDE.md`

### 1.2 Current Project State

**@geekmidas/toolbox** is a production TypeScript monorepo containing 18+ packages for building web applications:

| Category | Packages |
|----------|----------|
| Core Framework | `constructs` (endpoints, functions, crons, subscribers) |
| Client | `client` (React Query integration, typed fetcher) |
| Infrastructure | `cli`, `cloud`, `storage`, `events` |
| Data | `db`, `cache`, `audit` |
| Auth & Security | `auth`, `rate-limit`, `errors` |
| Utilities | `envkit`, `schema`, `logger`, `services`, `testkit`, `emailkit` |

**Current CLI (`gkm`) capabilities:**
- `gkm dev` — Single backend development server
- `gkm build` — Lambda handler or server builds
- `gkm openapi` — OpenAPI spec generation
- `gkm deploy` — Deployment support
- `gkm dokploy deploy` — Dokploy deployment
- React Query hooks generation

### 1.3 Enhancement Scope

**Enhancement Type:**
- [x] New Feature Addition
- [x] Major Feature Modification
- [x] Integration with New Systems (Next.js frontends)

**Enhancement Description:**
Evolve @geekmidas/toolbox from a backend-focused utility library into a workspace-first, full-stack TypeScript framework. Add `defineWorkspace()` configuration, multi-app orchestration (backends + Next.js frontends), Docker/Compose generation, and multi-target deployment (Dokploy default, Vercel/Cloudflare Phase 2).

**Impact Assessment:**
- [x] Significant Impact (substantial existing code changes to `packages/cli`)
- Existing packages remain unchanged
- 100% backwards compatibility with single-app configs required

### 1.4 Goals

- Enable full-stack TypeScript monorepo development with unified tooling
- Provide one-command development (`gkm dev`) across multiple apps
- Automate type-safe client generation from backend to frontend
- Support self-hosted deployment (Dokploy) with path to Vercel/Cloudflare
- Maintain 100% backwards compatibility with existing single-app configs

### 1.5 Background Context

@geekmidas/toolbox has proven its value for backend API development. However, users building production applications need more than backends — they need frontends, multiple services, and unified deployment. Currently, users must manually coordinate separate dev servers, sync types between projects, and configure deployment independently for each app.

This enhancement addresses the natural evolution: from "utility library" to "full-stack framework" with workspace-first architecture.

### 1.6 Change Log

| Change | Date | Version | Description | Author |
|--------|------|---------|-------------|--------|
| Initial PRD | 2026-01-13 | 1.0 | Created from Project Brief | PM |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement |
|----|-------------|
| FR1 | The CLI shall support a `defineWorkspace()` configuration export in `gkm.config.ts` that defines multiple apps within a single monorepo |
| FR2 | The workspace config shall support `type: 'backend'` apps with existing single-app config properties (routes, services, output provider) |
| FR3 | The workspace config shall support `type: 'frontend'` apps with `framework: 'nextjs'` for Next.js applications |
| FR4 | Each app shall support a `dependencies` array referencing other apps by name (e.g., `dependencies: ['api']`) |
| FR5 | Each app shall support a `deploy` property to override the default deployment target (e.g., `deploy: 'vercel'`) |
| FR6 | The `gkm dev` command shall start all defined apps concurrently — backends via tsx, frontends via `next dev` |
| FR7 | The `gkm dev` command shall inject `{APP_NAME}_URL` environment variables for each app's dependencies |
| FR8 | The `gkm dev` command shall aggregate logs from all apps with app-name prefixes for identification |
| FR9 | The CLI shall automatically generate typed API clients for frontend apps based on their backend dependencies' OpenAPI specs |
| FR10 | Client generation shall trigger only on new endpoint files or schema changes (.params, .query, .body, .output modifications) |
| FR11 | The `gkm build` command shall build all apps respecting the dependency graph order |
| FR12 | The `gkm docker` command shall generate Dockerfiles optimized for each app type (Node.js backend, Next.js standalone) |
| FR13 | The `gkm compose` command shall generate a `docker-compose.yml` with service discovery between apps |
| FR14 | The `gkm deploy` command shall deploy all apps to their configured targets, respecting dependency order |
| FR15 | The `gkm deploy [app...]` command shall support selective deployment of specific apps |
| FR16 | Dokploy deployment shall map 1 workspace = 1 Dokploy project, with each app as a separate Dokploy application |
| FR17 | The workspace config shall support `shared.packages` glob patterns for shared package resolution |
| FR18 | Single-app `gkm.config.ts` files (without `defineWorkspace()`) shall continue to work unchanged |

### 2.2 Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR1 | `gkm dev` cold start shall complete in <3 seconds for single app, <5 seconds for workspace with 2+ apps |
| NFR2 | Hot reload propagation shall occur within 500ms from file save to browser/server update |
| NFR3 | Client regeneration on schema changes shall complete within 2 seconds |
| NFR4 | `gkm build` shall execute independent app builds in parallel |
| NFR5 | Existing single-app performance characteristics shall not regress |
| NFR6 | The workspace config schema shall be fully typed with TypeScript inference |
| NFR7 | All new commands shall provide clear error messages with actionable remediation steps |
| NFR8 | Documentation shall cover workspace configuration, all new commands, and Dokploy setup |

### 2.3 Compatibility Requirements

| ID | Requirement |
|----|-------------|
| CR1 | **Existing Config Compatibility**: Single-app `gkm.config.ts` without `defineWorkspace()` shall work identically to current behavior |
| CR2 | **CLI Command Compatibility**: Existing `gkm dev`, `gkm build`, `gkm deploy`, `gkm openapi` commands shall maintain current behavior when used with single-app configs |
| CR3 | **Dokploy Integration Compatibility**: Existing `gkm dokploy deploy` functionality shall be preserved and extended for multi-app workspaces |
| CR4 | **Package Compatibility**: All existing @geekmidas packages shall work unchanged within workspace context |
| CR5 | **Node.js Compatibility**: Maintain Node.js >=22 requirement; no backporting |
| CR6 | **pnpm Workspace Compatibility**: Workspace features shall work with pnpm workspace structure; npm/yarn best-effort |

---

## 3. Technical Constraints and Integration

### 3.1 Existing Technology Stack

| Category | Technology | Version/Notes |
|----------|------------|---------------|
| **Languages** | TypeScript | 5.8.2 |
| **Runtime** | Node.js | >=22.0.0 |
| **Package Manager** | pnpm | 10.13.1 (workspaces) |
| **Build Tool** | tsdown | ESM + CJS output |
| **Monorepo** | Turbo | Build orchestration |
| **Code Style** | Biome | Linting + formatting |
| **Testing** | Vitest | Unit + integration |
| **CLI Framework** | Custom | Current implementation |
| **Frameworks** | Hono | Backend HTTP adapter |
| **Deployment** | Dokploy | Existing integration |

### 3.2 Integration Approach

**Workspace Config Integration:**
- Detect `defineWorkspace()` export vs legacy single-app export
- Single-app configs internally wrapped as single-app workspace
- Shared config validation using Zod schemas

**Backend App Integration:**
- Reuse existing backend handling
- Backend apps use current gkm.config.ts properties
- Routes, services, envParser, logger patterns unchanged

**Frontend App Integration:**
- New app type handler
- Detect Next.js project via next.config.js/ts
- Spawn `next dev` process for development
- Build via `next build` with standalone output

**Deployment Integration:**
- Extend existing Dokploy integration
- Workspace maps to Dokploy project
- Each app maps to Dokploy application
- Per-app deploy target allows override

### 3.3 Code Organization

```
packages/cli/src/
├── commands/
│   ├── dev.ts          # Extend with workspace orchestration
│   ├── build.ts        # Extend with workspace builds
│   ├── deploy.ts       # Extend with multi-app deploy
│   ├── docker.ts       # NEW: Dockerfile generation
│   └── compose.ts      # NEW: docker-compose generation
├── workspace/          # NEW: Workspace module
│   ├── config.ts       # defineWorkspace(), parsing, validation
│   ├── resolver.ts     # App discovery, dependency graph
│   ├── orchestrator.ts # Multi-process management
│   └── types.ts        # Workspace type definitions
├── generators/
│   ├── dockerfile.ts   # NEW: Dockerfile templates
│   ├── compose.ts      # NEW: docker-compose.yml generation
│   └── client.ts       # Existing, extend for auto-trigger
├── deployers/
│   ├── dokploy.ts      # Existing, extend for multi-app
│   └── base.ts         # NEW: Deployer interface
└── apps/               # NEW: App type handlers
    ├── base.ts         # Common app interface
    ├── backend.ts      # Backend app handler
    └── nextjs.ts       # Next.js app handler
```

### 3.4 Risk Assessment

**Technical Risks:**

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Multi-process coordination complexity | High | Medium | Start with simple spawn; use execa for robustness |
| Hot reload race conditions | Medium | Medium | Debounce file watchers; queue regeneration |
| Port conflicts between apps | Medium | Low | Auto-assign from configurable range; clear error messages |
| Next.js standalone build issues | Medium | Low | Test extensively; document known limitations |

**Integration Risks:**

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Breaking existing single-app configs | Critical | Low | Comprehensive backwards-compat test suite |
| Dokploy API changes | High | Medium | Abstract behind interface; pin API version |
| pnpm workspace edge cases | Medium | Medium | Test with various workspace structures |

**Deployment Risks:**

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Docker image size bloat | Medium | Medium | Optimize Dockerfiles; use multi-stage builds |
| Dependency order failures in deploy | High | Low | Explicit dependency graph; validate before deploy |
| Environment variable sync failures | High | Low | Validate env vars exist before deploy; dry-run option |

---

## 4. Epic and Story Structure

### 4.1 Epic Approach

**Decision:** Single comprehensive epic

**Rationale:** This enhancement is a cohesive evolution of the CLI — all features (workspace config, multi-app dev, client generation, deployment) are interconnected and build toward one goal: workspace-first full-stack development.

---

## Epic 1: Workspace-First Full-Stack Framework

**Epic Goal:** Enable developers to define, develop, and deploy multiple apps (backends + Next.js frontends) from a single `gkm.config.ts` workspace configuration with unified CLI commands.

**Integration Requirements:**
- All existing single-app functionality must continue working unchanged
- New workspace features are additive, not replacement
- Dokploy deployment extends existing implementation
- Client generation integrates with existing OpenAPI generation

---

### Story 1.1: Workspace Configuration Foundation

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

### Story 1.2: Backend App Handler

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

### Story 1.3: Multi-App Dev Server Orchestration

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

### Story 1.4: Next.js Frontend App Support

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

### Story 1.5: Smart Client Generation

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

### Story 1.6: Workspace Build Command

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

### Story 1.7: Dockerfile Generation

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

### Story 1.8: Docker Compose Generation

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

### Story 1.9: Multi-App Dokploy Deployment

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

### Story 1.10: Per-App Deploy Targets

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

## 5. Configuration Reference

### 5.1 Workspace Configuration Example

```typescript
// gkm.config.ts
import { defineWorkspace } from '@geekmidas/cli';

export default defineWorkspace({
  name: 'my-saas',

  apps: {
    api: {
      type: 'backend',
      path: './apps/api',
      routes: './src/endpoints/**/*.ts',
      port: 3001,
      // No deploy specified -> uses default (dokploy)
    },
    admin: {
      type: 'backend',
      path: './apps/admin-api',
      routes: './src/endpoints/**/*.ts',
      port: 3002,
      deploy: 'dokploy', // Explicit, same as default
    },
    web: {
      type: 'frontend',
      framework: 'nextjs',
      path: './apps/web',
      port: 3000,
      dependencies: ['api'], // Gets API_URL + typed client
      deploy: 'vercel', // Override -> deploys to Vercel (Phase 2)
    },
    dashboard: {
      type: 'frontend',
      framework: 'nextjs',
      path: './apps/dashboard',
      port: 3003,
      dependencies: ['api', 'admin'], // Gets API_URL, ADMIN_URL + both clients
      // No deploy specified -> uses default (dokploy)
    },
  },

  shared: {
    packages: ['./packages/*'],
  },

  deploy: {
    default: 'dokploy', // Default target for all apps

    dokploy: {
      serverUrl: process.env.DOKPLOY_URL,
      token: process.env.DOKPLOY_TOKEN,
      project: 'my-saas',
    },

    vercel: {
      token: process.env.VERCEL_TOKEN,
      team: 'my-team',
    },
  },
});
```

### 5.2 URL Injection

During `gkm dev`, environment variables are automatically injected:

```bash
# apps/web process receives:
API_URL=http://localhost:3001

# apps/dashboard process receives:
API_URL=http://localhost:3001
ADMIN_URL=http://localhost:3002
```

During `gkm deploy`, these resolve to Dokploy/Vercel-assigned URLs.

### 5.3 Smart Client Generation Logic

```
Trigger regeneration when:
├── New file created in routes glob pattern
├── File deleted from routes glob pattern
└── Existing endpoint file changed AND:
    ├── .params() schema modified
    ├── .query() schema modified
    ├── .body() schema modified
    ├── .output() schema modified
    └── Route path changed

Do NOT regenerate when:
├── Handler logic changes (no schema impact)
├── Non-endpoint files change
└── Shared package changes (unless imported by endpoint)
```

### 5.4 CLI Commands Summary

| Command | Description |
|---------|-------------|
| `gkm dev` | Start all apps in development mode (native) |
| `gkm build` | Build all apps for production |
| `gkm docker` | Generate Dockerfiles for all apps |
| `gkm compose` | Generate docker-compose.yml for local containerized dev |
| `gkm deploy` | Deploy all apps to their configured targets |
| `gkm deploy [apps...]` | Deploy specific apps only |
| `gkm openapi` | Generate OpenAPI specs (existing) |

---

## 6. Success Criteria

### 6.1 MVP Success Criteria

1. **Existing users can upgrade** — A single-app `gkm.config.ts` continues to work unchanged
2. **New workspace works end-to-end** — User can define 1 backend + 1 Next.js frontend, run `gkm dev`, edit backend endpoint, and see types update in frontend automatically
3. **Build produces deployable artifacts** — `gkm build` outputs production-ready builds for all apps
4. **One-command deploy** — `gkm deploy` successfully deploys entire workspace to Dokploy instance
5. **Selective deploy works** — `gkm deploy api` deploys only the specified app
6. **Dev/prod parity** — Same Dockerfiles work locally (via compose) and in Dokploy
7. **Documentation complete** — Workspace configuration, Dokploy setup, and deploy workflow fully documented
8. **No performance regression** — Single-app dev server startup time unchanged

### 6.2 Performance Targets

| Metric | Target |
|--------|--------|
| `gkm dev` cold start (single app) | <3 seconds |
| `gkm dev` cold start (2+ apps) | <5 seconds |
| Hot reload propagation | <500ms |
| Client regeneration | <2 seconds |

---

## 7. Out of Scope (Phase 2+)

- Other frontend frameworks (React/Vite, Vue, Svelte, Expo)
- Worker/cron app type
- `gkm add app` scaffolding wizard
- Shared Telescope dashboard
- Vercel/Cloudflare deployment implementation (config structure ready)
- Remote caching
- Database containers in Compose
- Dockerfile ejection
- Rollback support
- Preview deployments

---

## 8. Dependencies and Assumptions

### 8.1 Dependencies

- Dokploy API remains stable
- Next.js standalone output mode supported
- Docker Compose v2 available
- pnpm workspaces handle TypeScript references correctly

### 8.2 Assumptions

- Users comfortable with TypeScript and modern Node.js tooling
- Users have basic Docker knowledge
- Users can self-host or have access to Dokploy instance
- Users prefer configuration-as-code over GUI

---

## 9. Appendices

### A. Related Documents

- Project Brief: `docs/brief.md`
- Technical Documentation: `CLAUDE.md`
- Design Documents: `docs/designs/`

### B. Glossary

| Term | Definition |
|------|------------|
| Workspace | A monorepo configuration defining multiple apps |
| App | A single deployable unit (backend or frontend) |
| Backend | A @geekmidas/constructs-based API application |
| Frontend | A Next.js (or future framework) web application |
| Dependency | An app that another app depends on for types/URLs |
