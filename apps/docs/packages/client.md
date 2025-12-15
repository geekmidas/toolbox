# @geekmidas/client

Type-safe API client utilities with React Query integration.

## Installation

```bash
pnpm add @geekmidas/client
```

## Features

- Type-safe API client with automatic type inference
- React Query hooks generation from OpenAPI specs
- Typed fetcher with error handling
- Automatic retries and request/response interceptors
- Query invalidation utilities

## Package Exports

- `/` - Core client types
- `/fetcher` - Typed fetcher implementation
- `/infer` - Type inference utilities
- `/react-query` - React Query integration
- `/openapi` - OpenAPI client utilities
- `/types` - Type definitions

## Basic Usage

### Typed Query Client

```typescript
import { createTypedQueryClient } from '@geekmidas/client';
import type { paths } from './openapi-types';

const api = createTypedQueryClient<paths>({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
});

// Type-safe queries
const { data, isLoading } = api.useQuery('GET /users/{id}', {
  params: { id: '123' }
});

// Type-safe mutations
const mutation = api.useMutation('POST /users');
await mutation.mutateAsync({ body: { name: 'John', email: 'john@example.com' } });
```

### Typed Fetcher

```typescript
import { createTypedFetcher } from '@geekmidas/client/fetcher';
import type { paths } from './openapi-types';

const fetcher = createTypedFetcher<paths>({
  baseURL: 'https://api.example.com',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Type-safe API calls
const user = await fetcher('GET /users/{id}', {
  params: { id: '123' },
});

const newUser = await fetcher('POST /users', {
  body: { name: 'John', email: 'john@example.com' },
});
```

### React Query Integration

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';
import { createQueryKey, createMutationFn } from '@geekmidas/client/react-query';

// Create query key factory
const userKeys = {
  all: ['users'] as const,
  detail: (id: string) => [...userKeys.all, id] as const,
};

// In your component
function UserProfile({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: userKeys.detail(userId),
    queryFn: () => fetcher('GET /users/{id}', { params: { id: userId } }),
  });

  if (isLoading) return <div>Loading...</div>;
  return <div>{data?.name}</div>;
}
```

### Query Invalidation

```typescript
import { useQueryClient } from '@tanstack/react-query';

function CreateUserForm() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: CreateUserInput) =>
      fetcher('POST /users', { body: data }),
    onSuccess: () => {
      // Invalidate all user queries
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      mutation.mutate({ name: 'John', email: 'john@example.com' });
    }}>
      {/* form fields */}
    </form>
  );
}
```

## OpenAPI Type Generation

Use `@geekmidas/cli` to generate TypeScript types from your OpenAPI spec:

```bash
gkm generate:react-query --input api-docs.json --output ./src/api
```

This generates type-safe hooks and fetchers from your API specification.
