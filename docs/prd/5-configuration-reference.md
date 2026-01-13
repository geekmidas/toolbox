# 5. Configuration Reference

## 5.1 Workspace Configuration Example

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

## 5.2 URL Injection

During `gkm dev`, environment variables are automatically injected:

```bash
# apps/web process receives:
API_URL=http://localhost:3001

# apps/dashboard process receives:
API_URL=http://localhost:3001
ADMIN_URL=http://localhost:3002
```

During `gkm deploy`, these resolve to Dokploy/Vercel-assigned URLs.

## 5.3 Smart Client Generation Logic

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

## 5.4 CLI Commands Summary

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
