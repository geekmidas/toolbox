# API Reference

::: info
Detailed API documentation is available in the individual package documentation pages.
:::

## Core Packages

### Framework

| Package | Description |
|---------|-------------|
| [@geekmidas/constructs](/packages/constructs) | HTTP endpoints, functions, crons, and event subscribers |
| [@geekmidas/cli](/packages/cli) | CLI for building, development, and deployment |
| [@geekmidas/envkit](/packages/envkit) | Environment configuration parser |
| [@geekmidas/services](/packages/services) | Service discovery and dependency injection |

### Data & Storage

| Package | Description |
|---------|-------------|
| [@geekmidas/db](/packages/db) | Database utilities for Kysely |
| [@geekmidas/cache](/packages/cache) | Unified caching interface |
| [@geekmidas/storage](/packages/storage) | Cloud storage abstraction (S3) |
| [@geekmidas/events](/packages/events) | Event messaging (RabbitMQ, SQS, SNS) |

### Security

| Package | Description |
|---------|-------------|
| [@geekmidas/auth](/packages/auth) | JWT/OIDC authentication |
| [@geekmidas/errors](/packages/errors) | HTTP error classes |
| [@geekmidas/rate-limit](/packages/rate-limit) | Rate limiting utilities |
| [@geekmidas/audit](/packages/audit) | Type-safe audit logging |

### Development Tools

| Package | Description |
|---------|-------------|
| [@geekmidas/telescope](/packages/telescope) | Debugging dashboard |
| [@geekmidas/studio](/packages/studio) | Database browser |
| [@geekmidas/logger](/packages/logger) | Structured logging |
| [@geekmidas/testkit](/packages/testkit) | Testing utilities and factories |

### Frontend & API Client

| Package | Description |
|---------|-------------|
| [@geekmidas/client](/packages/client) | Type-safe API client with React Query |
| [@geekmidas/ui](/packages/ui) | React components (shadcn/ui based) |
| [@geekmidas/emailkit](/packages/emailkit) | Email templates with React |

### Infrastructure

| Package | Description |
|---------|-------------|
| [@geekmidas/cloud](/packages/cloud) | SST integration utilities |
| [@geekmidas/schema](/packages/schema) | StandardSchema type utilities |

## Quick Reference

### Endpoint Builder

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

export const getUser = e
  .get('/users/:id')
  .params(z.object({ id: z.string() }))
  .output(z.object({ id: z.string(), name: z.string() }))
  .handle(async ({ params }) => {
    return { id: params.id, name: 'John Doe' };
  });
```

### Service Pattern

```typescript
import type { Service } from '@geekmidas/services';

const dbService = {
  serviceName: 'db' as const,
  async register(envParser) {
    const config = envParser.create((get) => ({
      url: get('DATABASE_URL').string(),
    })).parse();
    return createConnection(config.url);
  },
} satisfies Service<'db', Database>;
```

### Error Handling

```typescript
import { createError } from '@geekmidas/errors';

throw createError.notFound('User not found');
throw createError.unauthorized('Invalid credentials');
throw createError.forbidden('Access denied');
```

### Workspace Configuration

```typescript
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  apps: {
    api: {
      path: 'apps/api',
      type: 'backend',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
    },
  },
  services: { db: true, cache: true },
  deploy: {
    default: 'dokploy',
    dns: { provider: 'route53', domain: 'myapp.com' },
  },
});
```
