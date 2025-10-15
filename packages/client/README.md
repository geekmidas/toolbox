# @geekmidas/client

Type-safe client library for consuming HTTP APIs with full TypeScript support, React Query integration, and automatic code generation from OpenAPI specifications.

## Features

- **Type-Safe Fetcher**: Fully typed HTTP client with automatic type inference
- **React Query Integration**: Pre-built hooks with TypeScript support
- **OpenAPI Code Generation**: Generate React Query hooks from OpenAPI specs
- **Infinite Queries**: Built-in support for pagination and infinite scroll
- **Automatic Validation**: Request/response validation with StandardSchema
- **Error Handling**: Type-safe error handling with HTTP status codes
- **Query Invalidation**: Type-safe cache invalidation
- **Method Restrictions**: Type-level enforcement of HTTP methods per endpoint

## Installation

```bash
pnpm add @geekmidas/client
```

For React Query integration:

```bash
pnpm add @geekmidas/client @tanstack/react-query
```

## Package Exports

```typescript
// Type-safe fetcher
import { createTypedFetcher } from '@geekmidas/client';

// React Query client
import { createTypedQueryClient } from '@geekmidas/client/react-query';

// OpenAPI hooks generation
import { generateReactQueryHooks } from '@geekmidas/client/openapi';

// Type utilities
import type { TypedFetcherOptions } from '@geekmidas/client/types';
```

## Quick Start

### Type-Safe Fetcher

Create a typed fetcher for your API:

```typescript
import { createTypedFetcher } from '@geekmidas/client';

// Define your API types
interface API {
  'GET /users': {
    response: {
      id: string;
      name: string;
      email: string;
    }[];
  };
  'POST /users': {
    body: {
      name: string;
      email: string;
    };
    response: {
      id: string;
      name: string;
      email: string;
    };
  };
  'GET /users/:id': {
    params: {
      id: string;
    };
    response: {
      id: string;
      name: string;
      email: string;
    };
  };
}

// Create typed fetcher
const api = createTypedFetcher<API>({
  baseUrl: 'https://api.example.com'
});

// Use with full type safety
const users = await api('GET /users');
// users is typed as Array<{ id: string; name: string; email: string }>

const user = await api('POST /users', {
  body: { name: 'John Doe', email: 'john@example.com' }
});
// user is typed as { id: string; name: string; email: string }

const singleUser = await api('GET /users/:id', {
  params: { id: '123' }
});
// singleUser is typed as { id: string; name: string; email: string }
```

### React Query Integration

Use with React Query for automatic caching and state management:

```typescript
import { createTypedQueryClient } from '@geekmidas/client/react-query';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Create query client
const queryClient = new QueryClient();
const api = createTypedQueryClient<API>({
  baseUrl: 'https://api.example.com'
});

// In your component
function UsersList() {
  const { data, isLoading, error } = api.useQuery('GET /users');

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <ul>
      {data.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}

// Mutations
function CreateUser() {
  const createUser = api.useMutation('POST /users');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createUser.mutateAsync({
      body: { name: 'Jane Doe', email: 'jane@example.com' }
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <button disabled={createUser.isPending}>
        Create User
      </button>
    </form>
  );
}
```

### Query Parameters

Handle query parameters with full type safety:

```typescript
interface API {
  'GET /users/search': {
    query: {
      q: string;
      limit?: number;
      offset?: number;
    };
    response: {
      users: Array<{ id: string; name: string }>;
      total: number;
    };
  };
}

// Usage
const result = await api('GET /users/search', {
  query: { q: 'john', limit: 10 }
});
```

### Infinite Queries

Implement infinite scroll pagination:

```typescript
function InfiniteUsersList() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = api.useInfiniteQuery(
    'GET /users',
    {
      query: { limit: 20 }
    },
    {
      getNextPageParam: (lastPage, pages) => {
        if (pages.length * 20 < lastPage.total) {
          return { offset: pages.length * 20 };
        }
        return undefined;
      }
    }
  );

  return (
    <div>
      {data?.pages.map((page, i) => (
        <div key={i}>
          {page.users.map(user => (
            <div key={user.id}>{user.name}</div>
          ))}
        </div>
      ))}
      {hasNextPage && (
        <button
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          Load More
        </button>
      )}
    </div>
  );
}
```

## OpenAPI Code Generation

Generate React Query hooks from OpenAPI specifications:

```bash
# Using CLI
pnpm gkm generate:react-query --input api-docs.json --output ./src/api

# Programmatic usage
import { generateReactQueryHooks } from '@geekmidas/client/openapi';
import fs from 'fs/promises';

const spec = JSON.parse(await fs.readFile('api-docs.json', 'utf-8'));
const code = await generateReactQueryHooks(spec);
await fs.writeFile('./src/api/generated.ts', code);
```

Generated hooks example:

```typescript
// Generated from OpenAPI spec
export const api = createTypedQueryClient<{
  'GET /users': {
    response: User[];
  };
  'POST /users': {
    body: CreateUserRequest;
    response: User;
  };
  // ... all your endpoints
}>({
  baseUrl: process.env.REACT_APP_API_URL
});

// Use generated hooks
function MyComponent() {
  const { data: users } = api.useQuery('GET /users');
  const createUser = api.useMutation('POST /users');

  return (
    // Your component
  );
}
```

## Advanced Features

### Query Invalidation

Type-safe cache invalidation:

```typescript
// Invalidate specific query
await api.invalidateQueries('GET /users');

// Invalidate with params
await api.invalidateQueries('GET /users/:id', {
  params: { id: '123' }
});

// Invalidate multiple queries
await Promise.all([
  api.invalidateQueries('GET /users'),
  api.invalidateQueries('GET /users/:id')
]);
```

### Optimistic Updates

Implement optimistic UI updates:

```typescript
const updateUser = api.useMutation('PUT /users/:id', {
  onMutate: async (variables) => {
    // Cancel outgoing refetches
    await api.cancelQueries('GET /users/:id', {
      params: { id: variables.params.id }
    });

    // Snapshot previous value
    const previousUser = api.getQueryData('GET /users/:id', {
      params: { id: variables.params.id }
    });

    // Optimistically update
    api.setQueryData('GET /users/:id', {
      params: { id: variables.params.id }
    }, variables.body);

    return { previousUser };
  },
  onError: (err, variables, context) => {
    // Rollback on error
    if (context?.previousUser) {
      api.setQueryData('GET /users/:id', {
        params: { id: variables.params.id }
      }, context.previousUser);
    }
  },
  onSettled: (data, error, variables) => {
    // Refetch after mutation
    api.invalidateQueries('GET /users/:id', {
      params: { id: variables.params.id }
    });
  }
});
```

### Custom Headers

Add custom headers to requests:

```typescript
const api = createTypedFetcher<API>({
  baseUrl: 'https://api.example.com',
  headers: {
    'Authorization': `Bearer ${token}`,
    'X-Api-Key': apiKey
  }
});

// Per-request headers
const user = await api('GET /users/:id', {
  params: { id: '123' },
  headers: {
    'X-Request-ID': requestId
  }
});
```

### Error Handling

Handle errors with full type safety:

```typescript
import { HttpError } from '@geekmidas/errors';

try {
  const user = await api('GET /users/:id', {
    params: { id: '123' }
  });
} catch (error) {
  if (error instanceof HttpError) {
    if (error.statusCode === 404) {
      console.log('User not found');
    } else if (error.statusCode === 403) {
      console.log('Access denied');
    } else {
      console.error('API error:', error.message);
    }
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Request/Response Interceptors

Add interceptors for logging, auth, etc:

```typescript
const api = createTypedFetcher<API>({
  baseUrl: 'https://api.example.com',
  beforeRequest: async (url, options) => {
    // Add auth token
    const token = await getAuthToken();
    options.headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    };
    return { url, options };
  },
  afterResponse: async (response) => {
    // Log response
    console.log(`${response.status} ${response.url}`);
    return response;
  },
  onError: async (error) => {
    // Handle auth errors
    if (error instanceof HttpError && error.statusCode === 401) {
      await refreshAuthToken();
      // Retry request
    }
    throw error;
  }
});
```

### Prefetching

Prefetch queries for better UX:

```typescript
function UsersList() {
  const { data: users } = api.useQuery('GET /users');

  const handleUserHover = (userId: string) => {
    // Prefetch user details on hover
    api.prefetchQuery('GET /users/:id', {
      params: { id: userId }
    });
  };

  return (
    <ul>
      {users?.map(user => (
        <li
          key={user.id}
          onMouseEnter={() => handleUserHover(user.id)}
        >
          {user.name}
        </li>
      ))}
    </ul>
  );
}
```

## Type Utilities

### Infer API Types

```typescript
import type { InferAPIResponse, InferAPIRequest } from '@geekmidas/client/types';

type UsersResponse = InferAPIResponse<API, 'GET /users'>;
// type UsersResponse = Array<{ id: string; name: string; email: string }>

type CreateUserRequest = InferAPIRequest<API, 'POST /users'>;
// type CreateUserRequest = { body: { name: string; email: string } }
```

### Method Restrictions

Enforce correct HTTP methods at type level:

```typescript
// ✅ Correct - POST endpoint with body
await api('POST /users', {
  body: { name: 'John' }
});

// ❌ Type error - GET endpoint can't have body
await api('GET /users', {
  body: { name: 'John' } // Type error!
});

// ❌ Type error - Wrong method
await api('DELETE /users', {}); // Type error if endpoint not defined!
```

## Testing

Mock API calls in tests:

```typescript
import { createTypedFetcher } from '@geekmidas/client';
import { vi } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const api = createTypedFetcher<API>({
  baseUrl: 'https://api.example.com'
});

// Mock response
mockFetch.mockResolvedValueOnce({
  ok: true,
  json: async () => [{ id: '1', name: 'John', email: 'john@example.com' }]
});

const users = await api('GET /users');
expect(users).toHaveLength(1);
expect(mockFetch).toHaveBeenCalledWith(
  'https://api.example.com/users',
  expect.objectContaining({ method: 'GET' })
);
```

## Related Packages

- [@geekmidas/constructs](../constructs) - Build type-safe endpoints that this client consumes
- [@geekmidas/errors](../errors) - HTTP error classes for error handling
- [@geekmidas/cli](../cli) - Generate OpenAPI specs and React Query hooks
- [@tanstack/react-query](https://tanstack.com/query) - React Query library

## License

MIT
