# 3. Technical Constraints and Integration

## 3.1 Existing Technology Stack

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

## 3.2 Integration Approach

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

## 3.3 Code Organization

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

## 3.4 Risk Assessment

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
