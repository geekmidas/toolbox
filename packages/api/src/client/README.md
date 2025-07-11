# Typed API Client

A fully type-safe API client for TypeScript that uses OpenAPI specifications to provide automatic type inference for requests and responses.

## Features

- 🚀 Full TypeScript support with automatic type inference
- 🔒 Type-safe request parameters (path, query, body)
- 📦 Built-in React Query integration
- 🛡️ Request/response interceptors
- 🔄 Automatic OpenAPI types generation
- 💪 Zero runtime overhead - all types are compile-time only

## Installation

```bash
npm install @geekmidas/api
# or
pnpm add @geekmidas/api
```

## Quick Start

### 1. Generate Types from OpenAPI Spec

First, generate TypeScript types from your OpenAPI specification using `openapi-typescript`:

```bash
# Install openapi-typescript
npm install -D openapi-typescript

# Generate types from URL
npx openapi-typescript https://api.example.com/openapi.json -o ./src/openapi-types.d.ts

# Or generate types from local file
npx openapi-typescript ./openapi.yaml -o ./src/openapi-types.d.ts
```

This will create a file with your API types that looks like:

```typescript
export interface paths {
  "/users": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": User[];
          };
        };
      };
    };
    post: {
      requestBody: {
        content: {
          "application/json": {
            name: string;
            email: string;
          };
        };
      };
      responses: {
        201: {
          content: {
            "application/json": User;
          };
        };
      };
    };
  };
  // ... more endpoints
}
```

### 2. Create a Typed Fetcher

```typescript
import { createTypedFetcher } from '@geekmidas/api/client';
import type { paths } from './openapi-types';

const client = createTypedFetcher<paths>({
  baseURL: 'https://api.example.com',
  headers: {
    'Authorization': 'Bearer your-token',
  },
});

// TypeScript automatically infers the response type!
const user = await client('GET /users/{id}', {
  params: { id: '123' },
});

console.log(user.name); // TypeScript knows this is a string
```

### 3. Use with React Query

```typescript
import { createTypedQueryClient } from '@geekmidas/api/client';
import type { paths } from './openapi-types';

const queryClient = createTypedQueryClient<paths>({
  baseURL: 'https://api.example.com',
});

function UserProfile({ userId }: { userId: string }) {
  const { data: user, isLoading } = queryClient.useQuery(
    'GET /users/{id}',
    { params: { id: userId } }
  );
  
  if (isLoading) return <div>Loading...</div>;
  
  // TypeScript knows user has properties: id, name, email
  return <div>{user?.name}</div>;
}
```

## API Reference

### `createTypedFetcher<Paths>(options)`

Creates a typed fetcher instance.

#### Type Parameters

- `Paths`: Your OpenAPI paths type (generated from your OpenAPI spec)

#### Options

- `baseURL`: Base URL for all requests
- `headers`: Default headers to include with every request
- `onRequest`: Request interceptor
- `onResponse`: Response interceptor
- `onError`: Error handler

### `createTypedQueryClient<Paths>(options)`

Creates a typed React Query client.

#### Type Parameters

- `Paths`: Your OpenAPI paths type (generated from your OpenAPI spec)

#### Options

Extends `FetcherOptions`

### Request Configuration

The second parameter accepts a configuration object with the following properties (only available properties based on the endpoint will be accepted):

- `params`: Path parameters (e.g., `{id}` in `/users/{id}`)
- `query`: Query parameters
- `body`: Request body (for POST, PUT, PATCH requests)
- `headers`: Additional headers for this request

## Advanced Usage

### Interceptors

```typescript
import type { paths } from './your-openapi-types';

const client = createTypedFetcher<paths>({
  baseURL: 'https://api.example.com',
  onRequest: async (config) => {
    // Modify request before sending
    config.headers['X-Request-ID'] = generateRequestId();
    return config;
  },
  onResponse: async (response) => {
    // Process response
    if (response.headers.get('X-Refresh-Token')) {
      await refreshAuth();
    }
    return response;
  },
  onError: async (error) => {
    // Handle errors globally
    if (error.response?.status === 401) {
      window.location.href = '/login';
    }
  },
});
```

### Type-Safe Error Handling

```typescript
try {
  const user = await client('GET /users/{id}', {
    params: { id: userId },
  });
  // Handle success
} catch (error) {
  if (error.response?.status === 404) {
    // User not found
  }
}
```

## How It Works

1. **OpenAPI Types**: The `openapi-typescript` tool generates TypeScript interfaces from your OpenAPI spec
2. **Type Magic**: Our client uses TypeScript's template literal types and conditional types to:
   - Parse the endpoint string (e.g., `'GET /users/{id}'`)
   - Extract the HTTP method and path
   - Look up the corresponding types from the OpenAPI definitions
   - Infer request parameters and response types
   - Provide VS Code autocomplete for all valid endpoints
3. **Runtime Fetching**: At runtime, the client constructs and executes the HTTP request

## VS Code Autocomplete

When you type endpoint strings, you get **full autocomplete** showing all available endpoints:

```typescript
// Start typing: client('
// VS Code shows:
//   ✓ 'GET /users'
//   ✓ 'POST /users' 
//   ✓ 'GET /users/{id}'
//   ✓ 'PUT /users/{id}'
//   ✓ 'DELETE /users/{id}'
//   ✓ 'GET /posts'

const user = await client('GET /users/{id}', {
  params: { id: '123' }  // ← TypeScript enforces required params
});
```

## Best Practices

1. **Keep OpenAPI Spec Updated**: Regenerate types whenever your API changes
   ```bash
   npx openapi-typescript https://api.example.com/openapi.json -o ./src/openapi-types.d.ts
   ```
2. **Use Specific Endpoints**: Let TypeScript autocomplete guide you to valid endpoints
3. **Handle Errors**: Always handle potential errors, especially for mutations
4. **Cache Wisely**: Configure React Query's `staleTime` and `cacheTime` appropriately
5. **Commit Generated Types**: Include the generated types file in your repository for team consistency

## TypeScript Support

This library requires TypeScript 4.5+ for full template literal type support.

## License

MIT