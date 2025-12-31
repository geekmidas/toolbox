# OpenAPI TypeScript Generation

Generate a TypeScript module from your API endpoints that includes type-safe paths, runtime authentication maps, and reusable schema interfaces.

## Why TypeScript Instead of JSON?

The traditional OpenAPI workflow generates a JSON specification, which then requires a separate tool to create TypeScript types. This has limitations:

- **No runtime auth info** - Security requirements exist in the spec but aren't usable by your client code
- **Two-step process** - Requires running `openapi-typescript` after generating the spec
- **No schema reuse** - Generated types are isolated and can't reference shared interfaces

TypeScript output is the default - it generates a single module that exports both types and runtime values.

## Quick Start

```bash
# Generate TypeScript OpenAPI module (default)
gkm openapi --output ./src/api/openapi.ts

# Generate JSON (legacy)
gkm openapi --json --output ./openapi.json
```

## What Gets Generated

### Security Schemes

Your authorizer configurations become typed security scheme definitions:

```typescript
export const securitySchemes = {
  bearer: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  },
  iam: {
    type: 'apiKey',
    in: 'header',
    name: 'Authorization',
    'x-amazon-apigateway-authtype': 'awsSigv4',
  },
} as const;

export type SecuritySchemeId = keyof typeof securitySchemes;
```

### Endpoint Auth Map

A runtime map linking each endpoint to its required authentication:

```typescript
export const endpointAuth = {
  'POST /tenants': 'iam',
  'GET /tenants/{id}': 'bearer',
  'GET /health': null,  // public
} as const;
```

### Reusable Schema Interfaces

Your Zod/Valibot schemas become TypeScript interfaces:

```typescript
export interface Tenant {
  id: string;
  name: string;
  createdAt: string;
}

export interface CreateTenantInput {
  name: string;
}
```

### Type-Safe Paths

Full OpenAPI path types for your fetcher:

```typescript
export interface paths {
  '/tenants': {
    post: {
      requestBody: {
        content: {
          'application/json': CreateTenantInput;
        };
      };
      responses: {
        201: {
          content: {
            'application/json': Tenant;
          };
        };
      };
    };
  };
  // ... more paths
}
```

## Using with Auth-Aware Fetcher

The generated auth map enables automatic authentication per endpoint:

```typescript
import { createAuthAwareFetcher } from '@geekmidas/client/auth-fetcher';
import { TokenClient } from '@geekmidas/auth/client';
import { paths, endpointAuth, securitySchemes } from './openapi';

const tokenClient = new TokenClient({
  storage: new LocalStorageTokenStorage(),
  refreshEndpoint: '/api/auth/refresh',
});

const api = createAuthAwareFetcher<paths>({
  baseURL: 'https://api.example.com',
  endpointAuth,
  securitySchemes,
  tokenClient,
});

// Bearer auth automatically applied
const tenant = await api('GET /tenants/{id}', {
  params: { id: '123' }
});

// IAM SigV4 auth automatically applied
const newTenant = await api('POST /tenants', {
  body: { name: 'Acme Corp' }
});

// No auth applied (public endpoint)
const health = await api('GET /health');
```

## Authorizer Type Mapping

Your endpoint authorizers map to OpenAPI security schemes:

| Authorizer Type | OpenAPI Security Scheme |
|-----------------|------------------------|
| `jwt`, `bearer` | HTTP Bearer with JWT |
| `iam`, `aws-sigv4` | API Key with SigV4 extension |
| `apiKey` | API Key (header/query) |
| `oauth2` | OAuth 2.0 flows |
| `oidc` | OpenID Connect |
| `none` / not set | Public (no auth) |

### Example Endpoint Definitions

```typescript
import { e } from '@geekmidas/constructs/endpoints';
import { createAuthorizer } from '@geekmidas/constructs/endpoints';

const jwtAuth = createAuthorizer('bearer', { type: 'jwt' });
const iamAuth = createAuthorizer('iam', { type: 'aws-sigv4' });

// This endpoint requires JWT bearer auth
const getTenant = e
  .get('/tenants/{id}')
  .authorizer(jwtAuth)
  .params(z.object({ id: z.string() }))
  .output(TenantSchema)
  .handle(async ({ params }) => { ... });

// This endpoint requires IAM SigV4 auth
const createTenant = e
  .post('/tenants')
  .authorizer(iamAuth)
  .body(CreateTenantSchema)
  .output(TenantSchema)
  .handle(async ({ body }) => { ... });

// This endpoint is public (no auth)
const healthCheck = e
  .get('/health')
  .authorizer('none')
  .output(z.object({ status: z.string() }))
  .handle(async () => ({ status: 'ok' }));
```

## Comparison with JSON Output

| Feature | JSON (`openapi.json`) | TypeScript (`openapi.ts`) |
|---------|----------------------|---------------------------|
| Type-safe paths | Requires `openapi-typescript` | Built-in |
| Runtime auth map | Not available | `endpointAuth` export |
| Schema reuse | No | Yes (interfaces) |
| Security schemes | In spec only | Typed constant |
| Tree-shakeable | N/A | Yes |

## Configuration

Add to your `gkm.config.ts`:

```typescript
import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  routes: './src/endpoints/**/*.ts',
  openapi: {
    title: 'My API',
    version: '1.0.0',
    output: './src/api/openapi.ts',
    // json: true,  // Uncomment for legacy JSON output
  },
});
```

Then run:

```bash
gkm openapi
```

## Type Helpers

The generated module includes utility types:

```typescript
// Endpoints that require authentication
type AuthenticatedEndpoint = 'POST /tenants' | 'GET /tenants/{id}' | ...;

// Public endpoints
type PublicEndpoint = 'GET /health' | 'GET /docs';

// Get the security scheme for an endpoint
type GetEndpointAuth<E extends keyof typeof endpointAuth> = typeof endpointAuth[E];
```

## Migration from JSON

If you're currently using JSON output:

1. **Update your command**:
   ```bash
   # Before (now requires --json flag)
   gkm openapi --json --output ./openapi.json

   # After (default behavior)
   gkm openapi --output ./src/api/openapi.ts
   ```

2. **Update imports**:
   ```typescript
   // Before
   import type { paths } from './openapi-types';

   // After
   import { paths, endpointAuth, securitySchemes } from './openapi';
   ```

3. **Switch to auth-aware fetcher**:
   ```typescript
   // Before
   const api = createTypedFetcher<paths>({ ... });

   // After
   const api = createAuthAwareFetcher<paths>({
     endpointAuth,
     securitySchemes,
     tokenClient,
     ...
   });
   ```
