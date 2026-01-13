# 1. Introduction and Project Context

## 1.1 Analysis Source

- **Project Brief:** `docs/brief.md` (comprehensive, created 2026-01-13)
- **IDE-based analysis:** @geekmidas/toolbox monorepo
- **Technical documentation:** `CLAUDE.md`

## 1.2 Current Project State

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

## 1.3 Enhancement Scope

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

## 1.4 Goals

- Enable full-stack TypeScript monorepo development with unified tooling
- Provide one-command development (`gkm dev`) across multiple apps
- Automate type-safe client generation from backend to frontend
- Support self-hosted deployment (Dokploy) with path to Vercel/Cloudflare
- Maintain 100% backwards compatibility with existing single-app configs

## 1.5 Background Context

@geekmidas/toolbox has proven its value for backend API development. However, users building production applications need more than backends — they need frontends, multiple services, and unified deployment. Currently, users must manually coordinate separate dev servers, sync types between projects, and configure deployment independently for each app.

This enhancement addresses the natural evolution: from "utility library" to "full-stack framework" with workspace-first architecture.

## 1.6 Change Log

| Change | Date | Version | Description | Author |
|--------|------|---------|-------------|--------|
| Initial PRD | 2026-01-13 | 1.0 | Created from Project Brief | PM |

---
