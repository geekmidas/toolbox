# Project Brief: @geekmidas/toolbox Workspace & Full-Stack Framework Evolution

## Executive Summary

**@geekmidas/toolbox** is a TypeScript developer toolkit that provides a cohesive set of type-safe packages for building production-ready web applications.

**Primary Problem:** TypeScript developers building modern web applications face fragmentation — they must stitch together disparate libraries for endpoints, validation, clients, caching, events, auth, and testing, often losing type safety at integration boundaries and spending significant time on boilerplate. Additionally, as projects grow to include multiple backends and frontends, existing tooling fails to provide unified workspace management.

**Target Market:** TypeScript/Node.js developers building APIs, serverless functions, and full-stack applications — particularly teams deploying to self-hosted infrastructure (Dokploy), Vercel, or Cloudflare.

**Key Value Proposition:** One unified, type-safe ecosystem where packages are designed to work together seamlessly, providing end-to-end type inference from endpoint definition to client consumption, with workspace-first architecture supporting multiple apps in a single monorepo with one-command deployment.

---

## Problem Statement

### Current State

@geekmidas/toolbox provides excellent utilities for building backend APIs with type-safe endpoints, validation, services, and AWS Lambda deployment. However, users building real-world applications face gaps:

**Pain Points for Current Users:**

1. **Backend-Only Focus** — The framework handles API construction well, but frontend applications (Next.js, React) require separate tooling, configuration, and manual integration with generated clients.

2. **Single-App Assumption** — The current `gkm.config.ts` assumes one API application. Real-world projects often have multiple services: main API, admin API, background workers, and one or more frontends — all in one monorepo.

3. **Manual Workspace Coordination** — Users with monorepos must manually wire up:
   - Shared packages between apps
   - Type generation and synchronization
   - Build orchestration across apps
   - Environment configuration per app

4. **Fragmented Developer Experience** — Running `gkm dev` starts one backend. Starting frontends requires separate terminals, separate configs, and manual coordination.

### Impact

- Teams building production apps outgrow the single-app model quickly
- Type-safe client generation exists but isn't integrated into a frontend workflow
- The "batteries included" promise breaks down at the monorepo/full-stack boundary

### Why This Matters Now

The toolbox has proven its value for backends. Users are asking "how do I use this for my whole app?" The natural evolution is workspace-first, full-stack framework support.

---

## Proposed Solution

### Core Concept

Evolve @geekmidas/toolbox into a **workspace-aware, full-stack framework** where a single `gkm.config.ts` at the monorepo root defines all applications — backends, frontends, workers — and the CLI orchestrates development, builds, and deployment across them.

### High-Level Vision

```typescript
// gkm.config.ts (root)
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
      deploy: 'vercel', // Override -> deploys to Vercel
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

### Key Differentiators

| Existing Solutions | @geekmidas Approach |
|---|---|
| Turborepo/Nx: Build orchestration only | **App-aware**: understands backends vs frontends, wires them together |
| SST: Infrastructure-focused | **Developer experience-focused**: unified dev server, auto client generation |
| Next.js monorepo: Frontend-centric | **Full-stack native**: backends and frontends as first-class citizens |
| tRPC: Requires specific patterns | **OpenAPI-based**: works with any client, REST-native |

### Why This Will Succeed

1. **Natural Extension** — Builds on proven `gkm` CLI patterns; existing users get a smooth upgrade path
2. **Type Safety End-to-End** — Backend endpoint types flow automatically to frontend clients
3. **One Command DX** — `gkm dev` starts all apps, watches all packages, coordinates hot reload
4. **Incremental Adoption** — Single-app configs still work; workspace features are additive

### Capabilities Unlocked

- `gkm dev` — Starts all apps with coordinated logging and URL injection
- `gkm build` — Builds all apps with correct dependency order
- `gkm deploy` — Deploys apps to configured targets (Dokploy, Vercel, Cloudflare)
- `gkm deploy [app]` — Selective deployment of specific apps

---

## Target Users

### Primary User Segment: Full-Stack TypeScript Teams

**Profile:**
- Small to mid-sized teams (2-10 developers) building SaaS products, internal tools, or B2B applications
- Strong TypeScript preference; value type safety as a productivity multiplier
- Typically deploy to self-hosted (Dokploy), Vercel, or AWS
- Use monorepo structure (or want to) for code sharing and consistency

**Current Behaviors & Workflows:**
- Manually coordinate multiple `package.json` scripts across apps
- Run separate terminal tabs for backend and frontend dev servers
- Copy-paste or manually sync API types to frontend projects
- Use Turborepo or pnpm workspaces for basic monorepo orchestration
- Spend time debugging type mismatches between client and server

**Specific Pain Points:**
- "I updated the API response but forgot to regenerate the client types"
- "Our frontend and backend configs are out of sync"
- "Setting up a new app in our monorepo takes a full day of boilerplate"
- "We can't easily see logs from all our services in one place during dev"

**Goals:**
- Ship features faster with less infrastructure friction
- Maintain type safety from database to UI without manual effort
- Onboard new developers quickly with consistent patterns
- Scale from MVP to production without re-architecting

### Secondary User Segment: Solo Developers & Indie Hackers

**Profile:**
- Individual developers building side projects, MVPs, or indie SaaS
- Value speed and simplicity; want "it just works" defaults
- May not have deep DevOps expertise
- Often work across the full stack alone

**Current Behaviors:**
- Use Next.js API routes for simple backends, but hit limits
- Start with simple setups, then painfully migrate as complexity grows
- Avoid monorepos due to perceived complexity

**Specific Pain Points:**
- "I want a real backend but don't want to manage two separate projects"
- "Type safety between my API and frontend is tedious to maintain"
- "I spend more time on tooling than on my actual product"

**Goals:**
- Get a production-ready full-stack setup with minimal configuration
- Focus on product features, not build tooling
- Have a clear path to scale when the project succeeds

---

## Goals & Success Metrics

### Business Objectives

- **Establish framework positioning** — Transition @geekmidas/toolbox from "utility collection" to "full-stack TypeScript framework" in developer perception
- **Increase adoption scope** — Enable users to build entire applications (not just backends) within the ecosystem
- **Reduce churn at scaling points** — Eliminate the "outgrow and migrate away" pattern when projects need multiple apps
- **Build competitive moat** — Workspace-first, full-stack DX is harder to replicate than individual utilities

### User Success Metrics

- **Time to first full-stack app** — New user can scaffold a working backend + frontend monorepo in <10 minutes
- **Type sync accuracy** — 100% of backend endpoint changes automatically reflected in frontend clients (zero manual regeneration)
- **Dev server startup** — `gkm dev` starts entire workspace (2+ apps) in <5 seconds
- **New app scaffolding** — Adding a new backend or frontend app to existing workspace takes <2 minutes
- **Zero-config ratio** — 80%+ of workspace features work with sensible defaults (no configuration required)

### Key Performance Indicators (KPIs)

| KPI | Definition | Target |
|-----|------------|--------|
| Workspace adoption rate | % of new projects using workspace config vs single-app | 60% within 6 months of release |
| Multi-app projects | Average number of apps per workspace config | 2.5+ apps |
| Frontend integration | % of workspace projects with at least one Next.js app | 40% |
| Retention at scale | Users still active 6 months after adding 2nd app | 70%+ |
| CLI command usage | Daily `gkm dev` invocations per active workspace | Proxy for active usage |
| Community contributions | PRs for new app types, templates, integrations | Growing monthly |

---

## MVP Scope

### Core Features (Must Have)

- **`defineWorkspace()` configuration** — Root `gkm.config.ts` exports workspace definition with `apps` object supporting multiple app entries

- **Backend app type** — `type: 'backend'` apps work as current single-app configs do (routes, services, output provider) — backwards compatible

- **Frontend app type (Next.js)** — `type: 'frontend', framework: 'nextjs'` recognized; CLI understands Next.js project structure

- **Unified `gkm dev`** — Starts all defined apps concurrently:
  - Backends via tsx (current behavior)
  - Frontends via `next dev`
  - Aggregates logs with app prefixes
  - Handles graceful shutdown
  - Coordinates URLs between apps

- **Auto client generation (smart)** — Frontend apps with `dependencies: ['api']` automatically get typed client generated from that backend's OpenAPI spec:
  - Triggers on new endpoint files
  - Triggers on schema changes (.params, .query, .body, .output)
  - Does NOT trigger on handler logic changes only

- **URL injection** — Apps receive environment variables for their dependencies:
  - `{APP_NAME}_URL` pattern (e.g., `API_URL`, `ADMIN_URL`)
  - Automatic during dev (localhost ports)
  - Resolved to production URLs during deploy

- **Shared packages support** — `shared.packages` glob patterns ensure proper TypeScript references and build ordering

- **Per-app environment** — Each app can define its own env requirements; existing secrets support reused

- **`gkm build` for workspaces** — Builds all apps respecting dependency graph; outputs to per-app directories

- **Dokploy development support:**
  - `gkm docker` generates per-app Dockerfiles optimized for app type (Node.js backend, Next.js standalone)
  - `gkm compose` generates `docker-compose.yml` for local development matching Dokploy deployment structure
  - Compose includes service discovery (apps can reach each other by name)
  - Dockerfiles generated on deploy (not committed to repo)

- **`gkm deploy` with multi-target support:**
  - Deploy all apps: `gkm deploy`
  - Deploy specific apps: `gkm deploy api web`
  - Per-app target override: `app.deploy: 'vercel' | 'dokploy'`
  - Default target: `deploy.default` (falls back to `dokploy`)
  - Dokploy: 1 workspace = 1 project, 1 app = 1 application
  - Respects dependency order (backends before dependent frontends)
  - Environment variable sync from workspace config

### Out of Scope for MVP

- **Other frontend frameworks** — No React (Vite), Vue, Svelte, or Expo support initially
- **Worker/cron app type** — Background workers stay as backend endpoints for now
- **`gkm add app` scaffolding** — No interactive app creation wizard yet; users manually add to config
- **Shared Telescope dashboard** — Each backend gets its own; unified view is post-MVP
- **Vercel/Cloudflare deployment** — Config structure ready, implementation in Phase 2
- **Remote caching** — No Turborepo-style remote build caching
- **Database containers** — Compose won't auto-generate Postgres/Redis; users add manually
- **Dockerfile ejection** — Generate-and-commit pattern for customization is post-MVP
- **Rollback support** — No `gkm rollback` command initially
- **Preview deployments** — No automatic PR preview environments

### MVP Success Criteria

1. **Existing users can upgrade** — A single-app `gkm.config.ts` continues to work unchanged
2. **New workspace works end-to-end** — User can define 1 backend + 1 Next.js frontend, run `gkm dev`, edit backend endpoint, and see types update in frontend automatically
3. **Build produces deployable artifacts** — `gkm build` outputs production-ready builds for all apps
4. **One-command deploy** — `gkm deploy` successfully deploys entire workspace to Dokploy instance
5. **Selective deploy works** — `gkm deploy api` deploys only the specified app
6. **Dev/prod parity** — Same Dockerfiles work locally (via compose) and in Dokploy
7. **Documentation complete** — Workspace configuration, Dokploy setup, and deploy workflow fully documented
8. **No performance regression** — Single-app dev server startup time unchanged

---

## Post-MVP Vision

### Phase 2 Features

**Additional Frontend Frameworks:**
- React (Vite) support for SPAs
- Expo/React Native for mobile apps with same typed client generation
- Vue.js and Svelte for teams with different preferences

**Additional Deployment Targets:**
- **Cloudflare** — Workers for backends, Pages for frontends; edge-first deployment
- **Vercel** — Direct API integration; serverless functions + Next.js optimized hosting
- AWS deployment — Lambda + CloudFront for backends, Amplify or S3+CloudFront for frontends

**Worker App Type:**
- `type: 'worker'` for background job processors
- Queue integration (SQS, RabbitMQ, BullMQ, Cloudflare Queues)
- Cron scheduling defined in workspace config
- Cloudflare Durable Objects support for stateful workers

**Scaffolding & Templates:**
- `gkm add app` interactive wizard
- `gkm init` with workspace templates (SaaS starter, API + Admin + Web, etc.)
- Community template registry

**Enhanced Observability:**
- Unified Telescope dashboard across all apps in workspace
- Distributed tracing across backend services
- Error aggregation with source maps for frontends

**Dockerfile Ejection:**
- `gkm eject docker` generates and commits Dockerfiles for customization
- Warns if generated files are outdated

### Long-term Vision (1-2 Years)

**The "Full-Stack TypeScript Platform":**

@geekmidas/toolbox becomes the default choice for TypeScript teams building production applications — a cohesive platform where:

- **Define** your entire application architecture in one config file
- **Develop** with instant hot reload, automatic type sync, and unified logging
- **Deploy** anywhere — Dokploy (self-hosted), Cloudflare (edge), Vercel (serverless), AWS (enterprise)
- **Debug** with integrated observability across the full stack
- **Scale** from solo project to multi-team monorepo without re-architecting

**Deployment Philosophy:**

| Target | Best For |
|--------|----------|
| Dokploy | Self-hosted, full control, cost-effective |
| Cloudflare | Edge performance, global distribution, Workers ecosystem |
| Vercel | Next.js optimization, preview deployments, DX |
| AWS | Enterprise requirements, existing infrastructure |

**Platform Capabilities:**
- Plugin system for community extensions (custom app types, deploy targets, integrations)
- GUI dashboard (optional) for workspace management and monitoring
- AI-assisted development integration (endpoint generation, type inference suggestions)
- First-class testing orchestration across the workspace

### Expansion Opportunities

**Horizontal:**
- Database schema management integrated into workspace (migrations, seeding)
- Authentication flows as workspace-level config (Better Auth, Clerk, custom)
- Feature flags and A/B testing coordination across apps
- Edge-compatible packages — ensure core libs work on Cloudflare Workers

**Vertical:**
- Managed cloud offering — hosted platform optimized for @geekmidas workspaces
- Enterprise features — RBAC, audit logs, compliance tooling
- Consulting/support tier for teams adopting the framework

**Ecosystem:**
- VS Code extension for workspace visualization and navigation
- GitHub Actions / CI templates for workspace builds and deploys
- Integration partners (Neon, PlanetScale, Upstash, Cloudflare D1/R2/KV) with first-class workspace support

---

## Technical Considerations

### Platform Requirements

- **Target Platforms:**
  - Node.js >=22 (current requirement, maintained)
  - Docker containers (Linux-based for Dokploy deployment)
  - Next.js 14+ (App Router support)

- **Development Environment:**
  - macOS, Linux, Windows (via WSL2) support
  - pnpm workspaces as primary (npm/yarn workspace support post-MVP)

- **Performance Requirements:**
  - `gkm dev` cold start: <3 seconds for single app, <5 seconds for workspace
  - Hot reload propagation: <500ms from file save to browser update
  - `gkm build` parallel execution across independent apps
  - Docker image builds: leverage layer caching for fast rebuilds

### Technology Preferences

- **CLI Framework:**
  - Current: Custom implementation
  - Consider: Citty or Commander.js for enhanced arg parsing, help generation

- **Process Management:**
  - Concurrent app orchestration via native Node.js child processes
  - Consider: execa for better process handling, or custom process manager
  - Graceful shutdown coordination across all apps

- **Docker Integration:**
  - Dockerfile generation: Template-based with app-type-specific optimizations
  - Compose generation: YAML builder (js-yaml or similar)
  - Registry interaction: Docker CLI wrapper or dockerode library

- **Dokploy API Client:**
  - REST API integration for deployment
  - WebSocket for deployment status streaming
  - Built with @geekmidas/client patterns (typed fetcher)

- **File Watching:**
  - Current: chokidar (via Vite/tsx)
  - Workspace-wide watch coordination for type regeneration triggers

### Architecture Considerations

- **Repository Structure:**
  ```
  packages/cli/src/
  ├── commands/
  │   ├── dev.ts          # Enhanced for workspace
  │   ├── build.ts        # Enhanced for workspace
  │   ├── docker.ts       # NEW
  │   ├── compose.ts      # NEW
  │   └── deploy.ts       # NEW
  ├── workspace/
  │   ├── config.ts       # defineWorkspace, parsing, validation
  │   ├── resolver.ts     # App discovery, dependency graph
  │   ├── orchestrator.ts # Multi-app process management
  │   └── types.ts        # Workspace type definitions
  ├── generators/
  │   ├── dockerfile.ts   # Per-app-type Dockerfile templates
  │   ├── compose.ts      # docker-compose.yml generation
  │   └── client.ts       # Existing OpenAPI client generation
  ├── deployers/
  │   ├── dokploy.ts      # Dokploy API integration
  │   ├── vercel.ts       # Vercel API integration (Phase 2)
  │   └── cloudflare.ts   # Cloudflare API integration (Phase 2)
  └── apps/
      ├── backend.ts      # Backend app handler
      └── nextjs.ts       # Next.js app handler
  ```

- **Service Architecture:**
  - Workspace config is the single source of truth
  - Each app type (backend, nextjs) has dedicated handler implementing common interface
  - Deployers are pluggable (Dokploy now, Cloudflare/Vercel later)
  - Generators produce static files (Dockerfiles, compose) that can be committed or gitignored

- **Integration Requirements:**
  - Dokploy REST API (projects, applications, deployments, environment variables)
  - Docker CLI or daemon API for image operations
  - Next.js build system (standalone output mode)
  - Existing @geekmidas/cli OpenAPI generation

- **Security/Compliance:**
  - Dokploy API token stored securely (env var, not in config file)
  - No secrets in generated Dockerfiles or compose files
  - Environment variables injected at runtime, not build time
  - Registry credentials handled via Docker CLI login (not stored by gkm)

---

## Constraints & Assumptions

### Constraints

- **Budget:**
  - Open-source project; development primarily time-invested rather than capital-invested
  - No paid infrastructure dependencies for core functionality (Dokploy is self-hosted)
  - Testing against Dokploy requires running instance (self-hosted or test server)

- **Timeline:**
  - No hard deadline; quality over speed
  - Incremental releases preferred — workspace config can ship before full deploy support
  - Must maintain existing release cadence for bug fixes and non-workspace features

- **Resources:**
  - Primary development by core maintainer(s)
  - Community contributions welcome but not relied upon for MVP
  - Limited capacity for supporting multiple deployment targets simultaneously (hence Dokploy-first)

- **Technical:**
  - Must maintain backwards compatibility — existing single-app configs cannot break
  - Node.js >=22 requirement maintained (no backporting to older Node versions)
  - pnpm workspace structure assumed; other package managers are best-effort
  - Next.js App Router focus; Pages Router support not guaranteed
  - Dokploy API stability dependency — changes to their API require updates

### Key Assumptions

**User Assumptions:**
- Users are comfortable with TypeScript and modern Node.js tooling
- Users have basic Docker knowledge (can debug container issues)
- Users can self-host or have access to a Dokploy instance
- Users prefer configuration-as-code over GUI-based setup
- Monorepo adoption is growing; users want or already use workspace structures

**Technical Assumptions:**
- Dokploy API remains stable and publicly documented
- Next.js standalone output mode continues to be supported
- Docker Compose v2 is the standard (not legacy v1)
- pnpm workspaces handle cross-package TypeScript references correctly
- OpenAPI spec generation remains the source of truth for client types

**Market Assumptions:**
- Self-hosted deployment (Dokploy, Coolify) is a growing trend vs vendor lock-in
- Full-stack TypeScript monorepos are increasingly common
- Developers want unified tooling, not best-of-breed fragmentation
- Framework-level workspace support is underserved (Turborepo is build-only, not app-aware)

**Dependency Assumptions:**
- Existing @geekmidas packages (constructs, client, envkit, etc.) work unchanged in workspace context
- No circular dependency issues when generating clients that import from shared packages
- Hot reload for both backend (tsx) and frontend (Next.js) can coexist without port conflicts

---

## Risks & Open Questions

### Key Risks

- **Dokploy API instability** — Dokploy is a younger project; API may change without notice or deprecation period. *Impact: Deploy command breaks, requires maintenance.* *Mitigation: Abstract Dokploy client behind interface; pin to known-working API version; maintain relationship with Dokploy maintainers.*

- **Complexity explosion** — Supporting multiple app types, deployment targets, and configuration options can lead to combinatorial complexity. *Impact: Bugs in edge cases, maintenance burden, confusing docs.* *Mitigation: Start minimal (backend + Next.js + Dokploy only); add incrementally with full test coverage.*

- **Hot reload coordination failures** — Synchronizing file watching across multiple apps with type generation triggers is subtle. *Impact: Types get out of sync, poor DX, user frustration.* *Mitigation: Extensive integration testing; clear error messages when sync fails; manual regenerate command as fallback.*

- **Docker performance on macOS** — Docker Desktop on macOS has known performance issues with volume mounts. *Impact: Slow hot reload in containerized dev, users avoid `gkm compose` locally.* *Mitigation: Document alternatives (native dev vs containerized); optimize Dockerfile for minimal rebuilds; consider mutagen or similar for volume performance.*

- **Scope creep toward "platform"** — Pressure to add features (databases, auth, CI) before core workspace experience is solid. *Impact: Half-finished features, diluted focus, delayed MVP.* *Mitigation: Strict MVP scope adherence; document post-MVP features but don't start them early.*

- **Breaking changes for existing users** — Despite intentions, workspace changes could inadvertently break single-app configs. *Impact: Trust erosion, adoption friction, support burden.* *Mitigation: Comprehensive test suite for single-app backwards compatibility; beta period before stable release.*

### Resolved Questions

| Question | Decision |
|----------|----------|
| `gkm dev` Docker vs native? | **Native** — tsx for backends, `next dev` for frontends. Coordinate URLs only. |
| Environment variables? | Reuse existing **secrets support**. Inter-app URLs via `{APP_NAME}_URL` pattern. |
| Client generation trigger? | **Smart detection** — only on new endpoint files or schema changes affecting OpenAPI spec. |
| Dockerfiles committed? | **Generated on deploy** — not committed. Ejection support post-MVP. |
| Multiple backend dependencies? | **`dependencies` array** on apps — generates `{APP_NAME}_URL` env vars and typed clients. |
| Dokploy mapping? | **1 workspace = 1 Dokploy project**. Each app = 1 Dokploy application. |
| Per-app deploy targets? | **Supported** — `app.deploy: 'vercel'` overrides `deploy.default`. |

### Areas Needing Further Research

- **Dokploy API capabilities** — Full audit of what's automatable via API vs requires UI interaction. Specifically: environment variables, domains, SSL, logs streaming.

- **Next.js standalone build integration** — Exact requirements for running standalone Next.js in container; handling of static assets, ISR, image optimization.

- **Monorepo Docker builds** — Best practices for building monorepo apps in Docker (copying only relevant packages, layer caching strategies, build context management).

- **Competitor deep-dive** — Detailed analysis of how SST, Nx, and Turborepo handle similar multi-app scenarios; what can be learned or differentiated from.

- **Port management** — Strategy for assigning and managing ports across multiple dev servers; avoiding conflicts; making inter-app communication seamless.

---

## Appendices

### A. URL Injection Example

During `gkm dev`, environment variables are automatically injected:

```bash
# apps/web process receives:
API_URL=http://localhost:3001

# apps/dashboard process receives:
API_URL=http://localhost:3001
ADMIN_URL=http://localhost:3002
```

During `gkm deploy`, these resolve to Dokploy/Vercel-assigned URLs.

### B. Smart Client Generation Logic

```
Trigger regeneration when:
+-- New file created in routes glob pattern
+-- File deleted from routes glob pattern
+-- Existing endpoint file changed AND:
    +-- .params() schema modified
    +-- .query() schema modified
    +-- .body() schema modified
    +-- .output() schema modified
    +-- Route path changed

Do NOT regenerate when:
+-- Handler logic changes (no schema impact)
+-- Non-endpoint files change
+-- Shared package changes (unless imported by endpoint)
```

### C. CLI Commands Summary

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

## Next Steps

### Immediate Actions

1. **Validate Dokploy API** — Audit API documentation; confirm all required operations (create app, deploy, set env vars) are available programmatically

2. **Prototype workspace config parsing** — Implement `defineWorkspace()` and config validation without full functionality

3. **Spike: Multi-process orchestration** — Test concurrent tsx + next dev processes with log aggregation

4. **Spike: Smart file watching** — Prototype detection of schema-affecting changes vs handler-only changes

5. **Design document: URL injection** — Detail exactly how `{APP_NAME}_URL` flows through dev -> build -> deploy

6. **Dokploy test environment** — Set up Dokploy instance for integration testing

---

## PM Handoff

This Project Brief provides the full context for **@geekmidas/toolbox Workspace & Full-Stack Framework Evolution**.

**Summary:** Evolving from a utility library to a workspace-first, full-stack TypeScript framework supporting multiple backends and Next.js frontends, with native development experience and flexible deployment to Dokploy, Vercel, or Cloudflare.

**Key Deliverables:**
- `defineWorkspace()` configuration in root `gkm.config.ts`
- Unified `gkm dev` with URL coordination across apps
- Smart client generation on schema changes
- `gkm build` for workspace-wide builds
- `gkm deploy` with per-app target support (Dokploy default, Vercel/Cloudflare Phase 2)

**Next Phase:** Create PRD with detailed requirements for each CLI command, configuration schema, and deployment flow.
