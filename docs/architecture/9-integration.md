# 9. Integration

## 9.1 Backwards Compatibility

```typescript
// All existing exports remain unchanged
export { defineConfig } from './config';
export type { GkmConfig } from './types';

// New exports are additive
export { defineWorkspace } from './config';
export type { WorkspaceConfig, AppConfig, ServicesConfig } from './types';

// Internal normalization ensures consistency
// Single-app configs are wrapped as workspaces internally
// but external API remains unchanged
```

## 9.2 Command Behavior

| Command | Single-App | Workspace |
|---------|------------|-----------|
| `gkm init` | Scaffold single API | Scaffold workspace with apps |
| `gkm dev` | Start tsx dev server | `turbo run dev --parallel` |
| `gkm build` | Build lambda/server | Build all apps (dependency order) |
| `gkm deploy` | Deploy to Dokploy | Deploy all apps to Dokploy |
| `gkm docker` | Generate Dockerfile | Generate per-app Dockerfiles |
| `gkm compose` | Generate compose.yml | Generate workspace compose.yml |
| `gkm openapi` | Generate OpenAPI spec | Generate per-backend specs |

## 9.3 Environment Variable Injection

```
Development (gkm dev):
┌─────────────────────────────────────────────────────────┐
│ API_URL=http://localhost:3000                           │
│ WEB_URL=http://localhost:3001                           │
│ DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app │
│ REDIS_URL=redis://localhost:6379                        │
│ SMTP_HOST=localhost                                     │
│ SMTP_PORT=1025                                          │
└─────────────────────────────────────────────────────────┘

Production (Docker Compose):
┌─────────────────────────────────────────────────────────┐
│ API_URL=http://api:3000                                 │
│ WEB_URL=http://web:3001                                 │
│ DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/app │
│ REDIS_URL=redis://cache:6379                            │
└─────────────────────────────────────────────────────────┘
```

## 9.4 Configuration Example

```typescript
// gkm.config.ts
import { defineWorkspace } from '@geekmidas/cli';

export default defineWorkspace({
  name: 'my-saas',

  apps: {
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env',
      logger: './src/logger',
      telescope: true,
    },

    web: {
      type: 'frontend',
      framework: 'nextjs',
      path: 'apps/web',
      port: 3001,
      dependencies: ['api'],
      client: {
        output: './src/api',
      },
    },
  },

  services: {
    db: true,      // postgres:18-alpine
    cache: true,   // redis:8-alpine
    mail: true,    // mailpit (dev), needs SMTP config for prod
  },

  shared: {
    packages: ['packages/*'],
    models: {
      path: 'packages/models',
      schema: 'zod',  // Currently only zod, future: any StandardSchema lib
    },
  },

  secrets: {
    enabled: true, // Use .enc.json files
  },

  deploy: {
    default: 'dokploy',
    dokploy: {
      endpoint: 'https://dokploy.example.com/api',
      projectId: 'my-saas-project',
    },
  },
});
```

## 9.5 CLI Command Reference

```bash
# Initialization
gkm init                   # Interactive workspace setup
gkm init --name my-app     # Initialize with name
gkm init --template api    # Single API (no monorepo)
gkm init --template fullstack  # API + Web + models (monorepo)

# Development
gkm dev                    # Start all apps + services
gkm dev --filter api       # Start only api app
gkm dev --no-services      # Start apps without db/cache/mail

# Building
gkm build                  # Build all apps
gkm build api              # Build specific app
gkm build --provider aws   # Build for AWS Lambda

# Docker
gkm docker                 # Generate Dockerfiles for all apps
gkm compose                # Generate docker-compose.yml

# Deployment
gkm deploy                 # Deploy all apps
gkm deploy api web         # Deploy specific apps
gkm deploy --dry-run       # Preview deployment

# Secrets
gkm secrets:init --stage dev       # Initialize secrets
gkm secrets:encrypt --stage dev    # Encrypt for committing
gkm secrets:decrypt --stage dev    # Decrypt for use

# OpenAPI & Clients
gkm openapi                # Generate OpenAPI specs
gkm client                 # Generate typed clients
```

---

[← Previous: Init Command](./8-init-command.md) | [Next: Appendices →](./10-appendices.md)
