import { createTypedFetcher, createTypedQueryClient } from './index';
import type { paths } from './openapi-types';
import type { TypedEndpoint } from './types';

// This file demonstrates VS Code autocomplete functionality
// When you type the endpoint strings, you'll get full autocomplete

const client = createTypedFetcher<paths>({
  baseURL: 'https://api.example.com',
});

const queryClient = createTypedQueryClient<paths>({
  baseURL: 'https://api.example.com',
});

// Example of autocomplete - when you type the quotes and start typing,
// VS Code will show you all available endpoints with their methods:

// Try typing: client(' and you'll see:
// - 'GET /users'
// - 'POST /users'
// - 'GET /users/{id}'
// - 'PUT /users/{id}'
// - 'DELETE /users/{id}'
// - 'GET /posts'

async function demonstrateAutocomplete() {
  // Full autocomplete when typing endpoint strings
  const users = await client('GET /users');
  const newUser = await client('POST /users', {
    body: { name: 'John', email: 'john@example.com' },
  });
  const user = await client('GET /users/{id}', {
    params: { id: '123' },
  });
  const posts = await client('GET /posts', {
    query: { page: 1, limit: 10 },
  });

  // Same autocomplete works with React Query
  const { data } = queryClient.useQuery('GET /users/{id}', {
    params: { id: '123' },
  });

  const mutation = queryClient.useMutation('POST /users');

  return { users, newUser, user, posts, data, mutation };
}

// You can also use the TypedEndpoint type directly for type safety
function createRequest<T extends TypedEndpoint<paths>>(endpoint: T) {
  return (config?: any) => client(endpoint, config);
}

// This will be type-safe and provide autocomplete
const getUserRequest = createRequest('GET /users/{id}');
const createUserRequest = createRequest('POST /users');

// Usage examples with full type safety
async function typeSafeUsage() {
  // TypeScript knows the exact response type and required config
  const user = await getUserRequest({ params: { id: '123' } });
  const newUser = await createUserRequest({
    body: { name: 'Jane', email: 'jane@example.com' },
  });

  return { user, newUser };
}

export { demonstrateAutocomplete, typeSafeUsage };
