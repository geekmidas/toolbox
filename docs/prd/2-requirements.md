# 2. Requirements

## 2.1 Functional Requirements

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

## 2.2 Non-Functional Requirements

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

## 2.3 Compatibility Requirements

| ID | Requirement |
|----|-------------|
| CR1 | **Existing Config Compatibility**: Single-app `gkm.config.ts` without `defineWorkspace()` shall work identically to current behavior |
| CR2 | **CLI Command Compatibility**: Existing `gkm dev`, `gkm build`, `gkm deploy`, `gkm openapi` commands shall maintain current behavior when used with single-app configs |
| CR3 | **Dokploy Integration Compatibility**: Existing `gkm dokploy deploy` functionality shall be preserved and extended for multi-app workspaces |
| CR4 | **Package Compatibility**: All existing @geekmidas packages shall work unchanged within workspace context |
| CR5 | **Node.js Compatibility**: Maintain Node.js >=22 requirement; no backporting |
| CR6 | **pnpm Workspace Compatibility**: Workspace features shall work with pnpm workspace structure; npm/yarn best-effort |

---
