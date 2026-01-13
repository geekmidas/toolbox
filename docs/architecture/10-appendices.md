# 10. Appendices

## A. Migration Path

### A.1 From Single-App to Workspace

```typescript
// Before: gkm.config.ts
import { defineConfig } from '@geekmidas/cli';

export default defineConfig({
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env',
  logger: './src/logger',
});

// After: gkm.config.ts (backwards compatible!)
// Option 1: Keep as-is (still works!)
// Option 2: Migrate to workspace:
import { defineWorkspace } from '@geekmidas/cli';

export default defineWorkspace({
  apps: {
    api: {
      type: 'backend',
      path: '.',  // Current directory
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env',
      logger: './src/logger',
    },
  },
});
```

### A.2 Adding Frontend

```typescript
// Step 1: Add Next.js app to workspace
apps: {
  api: { /* existing */ },
  web: {
    type: 'frontend',
    framework: 'nextjs',
    path: 'apps/web',
    port: 3001,
    dependencies: ['api'],
  },
},

// Step 2: Configure next.config.ts
// apps/web/next.config.ts
export default {
  output: 'standalone',  // Required for Docker
};

// Step 3: Run dev
// gkm dev (starts both api and web)
```

---

## B. Testing Strategy

### B.1 Unit Tests

- Configuration parsing and validation
- Workspace normalization
- Service URL generation
- Dockerfile template generation
- Secrets encryption/decryption

### B.2 Integration Tests

- Multi-app dev server startup
- Client generation on schema changes
- Docker build and run
- Compose service orchestration

### B.3 E2E Tests

- Full workspace: api + web + services
- Deploy to test Dokploy instance
- Verify inter-app communication

---

## C. Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Turbo compatibility | High | Fall back to manual orchestration if turbo unavailable |
| Breaking existing configs | Critical | Wrapper pattern ensures 100% backwards compatibility |
| Docker build failures | Medium | Extensive template testing, clear error messages |
| Secret key management | High | Document secure key sharing practices |
| Performance regression | Medium | Benchmark single-app vs workspace modes |

---

## D. Success Metrics

1. **Zero Breaking Changes**: All existing `gkm.config.ts` files work unchanged
2. **Dev Startup < 5s**: 2-app workspace starts in under 5 seconds
3. **Build Parallelization**: Independent apps build in parallel
4. **Client Gen < 2s**: Smart client regeneration completes in under 2 seconds
5. **Docker Image Size**: Backend < 100MB, Frontend < 150MB

---

## E. Service Mapping

| Alias | Service | Default Image | Port |
|-------|---------|---------------|------|
| `db` | PostgreSQL | `postgres:18-alpine` | 5432 |
| `cache` | Redis | `redis:8-alpine` | 6379 |
| `mail` | Mailpit | `axllent/mailpit` | 8025 (UI), 1025 (SMTP) |

---

## F. Environment Variables

| Variable | Source | Dev Value | Prod Value |
|----------|--------|-----------|------------|
| `{APP}_URL` | Dependencies | `http://localhost:{port}` | `http://{app}:{port}` |
| `DATABASE_URL` | Services | `postgresql://...@localhost:5432` | `postgresql://...@db:5432` |
| `REDIS_URL` | Services | `redis://localhost:6379` | `redis://cache:6379` |
| `SMTP_HOST` | Services | `localhost` | (configured) |
| `SMTP_PORT` | Services | `1025` | (configured) |

---

## G. Related Documents

- PRD: `docs/prd/`
- Project Brief: `docs/brief.md`
- Technical Reference: `CLAUDE.md`

---

[← Previous: Integration](./9-integration.md) | [Back to Index →](./index.md)
