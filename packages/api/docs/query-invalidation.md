# Query Invalidation

The TypedQueryClient provides built-in support for invalidating queries, allowing you to refresh cached data when needed.

## Basic Usage

### Invalidate Specific Queries

```typescript
import { createTypedQueryClient } from '@geekmidas/api/client';
import type { paths } from './openapi-types';

const client = createTypedQueryClient<paths>();

// Invalidate all queries for an endpoint
await client.invalidateQueries('GET /users');

// Invalidate queries with specific params
await client.invalidateQueries('GET /users/{id}', {
  params: { id: '123' }
});

// Invalidate queries with specific query params
await client.invalidateQueries('GET /posts', {
  query: { page: 1, limit: 10 }
});
```

### Invalidate All Queries

```typescript
// Invalidate all queries in the cache
await client.invalidateAllQueries();
```

## Hook-based Invalidation

For React components, use the `useTypedInvalidateQueries` hook:

```typescript
import { useTypedInvalidateQueries } from '@geekmidas/api/client';

function MyComponent() {
  const { invalidateQueries, invalidateAllQueries } = useTypedInvalidateQueries(client);
  
  const handleUserUpdate = async () => {
    // Update user...
    
    // Invalidate user queries
    await invalidateQueries('GET /users/{id}', {
      params: { id: userId }
    });
  };
  
  const handleRefreshAll = async () => {
    await invalidateAllQueries();
  };
}
```

## Common Patterns

### After Mutations

```typescript
const updateUser = client.useMutation('PUT /users/{id}', {
  onSuccess: async (data, variables) => {
    // Invalidate the specific user query
    await client.invalidateQueries('GET /users/{id}', {
      params: { id: variables.params.id }
    });
    
    // Also invalidate the users list
    await client.invalidateQueries('GET /users');
  }
});
```

### Partial Matching

When you don't provide config, the invalidation uses partial matching:

```typescript
// This will invalidate:
// - GET /users
// - GET /users?page=1
// - GET /users?filter=active
// etc.
await client.invalidateQueries('GET /users');

// This will only invalidate the exact query with page=1
await client.invalidateQueries('GET /users', {
  query: { page: 1 }
});
```

### With QueryClient Instance

You can provide a QueryClient instance when creating the TypedQueryClient:

```typescript
import { QueryClient } from '@tanstack/react-query';

const queryClient = new QueryClient();
const typedClient = createTypedQueryClient<paths>({
  queryClient,
  baseURL: 'https://api.example.com'
});

// Later, you can also set it
typedClient.setQueryClient(queryClient);
```

## Advanced Usage

### Invalidation Strategies

1. **Exact Match**: When config is provided, only exact matches are invalidated
2. **Partial Match**: When only endpoint is provided, all queries starting with that key are invalidated

### Custom Invalidation Logic

Access the underlying QueryClient for more complex invalidation:

```typescript
const queryClient = client.getQueryClient();

// Custom invalidation with predicate
await queryClient.invalidateQueries({
  predicate: (query) => {
    const queryKey = query.queryKey;
    return queryKey[0] === 'GET /users' && 
           queryKey[1]?.query?.status === 'active';
  }
});
```

## Best Practices

1. **Be Specific**: Invalidate only what needs to be refreshed
2. **Use Exact Matching**: When you know the exact query, provide full config
3. **Consider Related Data**: Invalidate related queries together
4. **Avoid Over-Invalidation**: Don't use `invalidateAllQueries()` unless necessary

## Type Safety

The invalidation methods are fully type-safe:

```typescript
// TypeScript will error if endpoint doesn't exist
client.invalidateQueries('GET /invalid-endpoint'); // ❌ Error

// TypeScript will error if params don't match endpoint
client.invalidateQueries('GET /users/{id}', {
  params: { wrong: 'param' } // ❌ Error
});
```