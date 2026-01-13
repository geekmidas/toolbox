# 1. Current State Analysis

## 1.1 Existing CLI Structure

```
packages/cli/src/
├── config.ts           # defineConfig(), loadConfig() - single-app config
├── types.ts            # GkmConfig, DokployProviderConfig, DockerConfig
├── dev/
│   └── index.ts        # Dev server with tsx, chokidar file watching
├── build/
│   └── index.ts        # Lambda/server builds
├── deploy/
│   ├── dokploy.ts      # Dokploy deployment integration
│   └── types.ts        # DeployResult, DokployDeployOptions
├── docker/
│   ├── templates.ts    # Dockerfile generation (multi-stage, turbo, slim)
│   └── compose.ts      # docker-compose.yml generation
├── secrets/
│   ├── index.ts        # Stage-based secrets management
│   ├── generator.ts    # Password generation
│   └── storage.ts      # Secrets file I/O
└── openapi/
    └── index.ts        # OpenAPI spec + React Query hooks generation
```

## 1.2 Existing Capabilities to Preserve

| Capability | File | Status |
|------------|------|--------|
| Single-app dev server | `dev/index.ts` | Keep as-is for single-app |
| Lambda builds | `build/index.ts` | Extend for workspace |
| Server builds | `build/index.ts` | Extend for workspace |
| Dokploy deploy | `deploy/dokploy.ts` | Extend for multi-app |
| Turbo Dockerfile | `docker/templates.ts` | Reuse for backends |
| Docker Compose | `docker/compose.ts` | Extend for multi-app |
| OpenAPI generation | `openapi/index.ts` | Integrate with client gen |
| Secrets management | `secrets/index.ts` | Extend with encryption |

## 1.3 Existing Service Support

From `docker/compose.ts`:
```typescript
export const DEFAULT_SERVICE_VERSIONS: Record<ComposeServiceName, string> = {
  postgres: '18-alpine',
  redis: '8-alpine',
  rabbitmq: '3-management-alpine',
};
```

---

[Next: Target Architecture →](./2-target-architecture.md)
