import { createTypedFetcher } from './fetcher';
import { createTypedQueryClient } from './react-query';
import type { paths } from './openapi-types';

// Example 1: Basic fetcher usage with type parameters
const client = createTypedFetcher<paths>({
  baseURL: 'https://api.example.com',
  headers: {
    'Authorization': 'Bearer your-token',
  },
});

// TypeScript will infer the response type based on the endpoint
async function fetchUser() {
  // Response type is automatically inferred as { id: string; name: string; email: string; }
  const user = await client('GET /users/{id}', {
    params: { id: '123' },
  });
  
  console.log(user.name); // TypeScript knows this is a string
}

// Example 2: Creating a new user
async function createUser() {
  // TypeScript enforces the correct body shape
  const newUser = await client('POST /users', {
    body: {
      name: 'John Doe',
      email: 'john@example.com',
    },
  });
  
  return newUser;
}

// Example 3: Query with pagination
async function fetchPosts() {
  const response = await client('GET /posts', {
    query: {
      page: 1,
      limit: 10,
      sort: 'desc',
    },
  });
  
  return response.posts;
}

// Example 4: React Query usage
const queryClient = createTypedQueryClient<paths>({
  baseURL: 'https://api.example.com',
  headers: {
    'Authorization': 'Bearer your-token',
  },
});

// In a React component:
function UserProfile({ userId }: { userId: string }) {
  // Type-safe query with automatic response typing
  const { data: user, isLoading, error } = queryClient.useQuery(
    'GET /users/{id}',
    { params: { id: userId } },
    {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 3,
    }
  );
  
  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  if (!user) return null;
  
  return (
    <div>
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
}

// Example 5: Mutations with React Query
function CreateUserForm() {
  const createUserMutation = queryClient.useMutation('POST /users', {
    onSuccess: (data) => {
      console.log('User created:', data);
      // Invalidate and refetch users list
    },
    onError: (error) => {
      console.error('Failed to create user:', error);
    },
  });
  
  const handleSubmit = (formData: { name: string; email: string }) => {
    createUserMutation.mutate({ body: formData });
  };
  
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      handleSubmit({
        name: formData.get('name') as string,
        email: formData.get('email') as string,
      });
    }}>
      <input name="name" required />
      <input name="email" type="email" required />
      <button type="submit" disabled={createUserMutation.isPending}>
        {createUserMutation.isPending ? 'Creating...' : 'Create User'}
      </button>
    </form>
  );
}

// Example 6: Advanced configuration with interceptors
const advancedClient = createTypedFetcher({
  baseURL: process.env.API_URL,
  onRequest: async (config) => {
    // Add timestamp to all requests
    config.headers = {
      ...config.headers,
      'X-Request-Time': new Date().toISOString(),
    };
    return config;
  },
  onResponse: async (response) => {
    // Log all responses
    console.log(`Response from ${response.url}: ${response.status}`);
    return response;
  },
  onError: async (error) => {
    // Handle authentication errors
    if ((error as any).response?.status === 401) {
      // Redirect to login
      window.location.href = '/login';
    }
  },
});

// Example 7: Type-safe error handling
async function safeUserFetch(userId: string) {
  try {
    const user = await client('GET /users/{id}', {
      params: { id: userId },
    });
    return { success: true, data: user } as const;
  } catch (error) {
    return { success: false, error: error as Error } as const;
  }
}

// Usage shows discriminated union
async function displayUser(userId: string) {
  const result = await safeUserFetch(userId);
  
  if (result.success) {
    // TypeScript knows result.data exists here
    console.log(result.data.name);
  } else {
    // TypeScript knows result.error exists here
    console.error(result.error.message);
  }
}