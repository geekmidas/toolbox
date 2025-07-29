import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

// Define request handlers
export const handlers = [
  // GET /users
  http.get('https://api.example.com/users', () => {
    return HttpResponse.json({
      users: [
        { id: '1', name: 'John Doe', email: 'john@example.com' },
        { id: '2', name: 'Jane Smith', email: 'jane@example.com' },
      ],
    });
  }),

  // POST /users
  http.post('https://api.example.com/users', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json(
      {
        id: '123',
        name: (body as any).name,
        email: (body as any).email,
      },
      { status: 201 },
    );
  }),

  // GET /users/{id}
  http.get('https://api.example.com/users/:id', ({ params }) => {
    const { id } = params;
    if (id === '404') {
      return HttpResponse.json({ message: 'User not found' }, { status: 404 });
    }
    return HttpResponse.json({
      id,
      name: 'John Doe',
      email: 'john@example.com',
    });
  }),

  // PUT /users/{id}
  http.put('https://api.example.com/users/:id', async ({ params, request }) => {
    const { id } = params;
    const body = await request.json();
    return HttpResponse.json({
      id,
      name: (body as any).name || 'John Doe',
      email: (body as any).email || 'john@example.com',
    });
  }),

  // PATCH /users/{id}
  http.patch('https://api.example.com/users/:id', async ({ params, request }) => {
    const { id } = params;
    const body = await request.json();
    return HttpResponse.json({
      id,
      name: (body as any).name || 'John Doe',
      email: (body as any).email || 'john@example.com',
    });
  }),

  // DELETE /users/{id}
  http.delete('https://api.example.com/users/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // GET /posts with query parameters
  http.get('https://api.example.com/posts', ({ request }) => {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '10');
    const sort = url.searchParams.get('sort') || 'asc';

    return HttpResponse.json({
      posts: [
        {
          id: '1',
          title: 'Test Post',
          content: 'Test content',
          authorId: '1',
          createdAt: '2023-01-01T00:00:00Z',
        },
      ],
      pagination: {
        page,
        limit,
        total: 1,
      },
      sort,
    });
  }),

  // GET /posts/{postId}
  http.get('https://api.example.com/posts/:postId', ({ params, request }) => {
    const { postId } = params;
    const url = new URL(request.url);
    const includeAuthor = url.searchParams.get('includeAuthor') === 'true';

    const response = {
      id: postId,
      title: 'Test Post',
      content: 'Test content',
      authorId: '123',
    };

    if (includeAuthor) {
      return HttpResponse.json({
        ...response,
        author: { id: '123', name: 'John' },
      });
    }

    return HttpResponse.json(response);
  }),

  // Error endpoint for testing
  http.get('https://api.example.com/error', () => {
    return HttpResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  }),

  // Unauthorized endpoint
  http.get('https://api.example.com/protected', ({ request }) => {
    const auth = request.headers.get('Authorization');
    if (!auth || !auth.includes('valid-token')) {
      return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    return HttpResponse.json({ message: 'Protected data' });
  }),
];

export const server = setupServer(...handlers);

// Establish API mocking before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

// Reset any request handlers that we may add during the tests,
// so they don't affect other tests
afterEach(() => {
  server.resetHandlers();
});

// Clean up after the tests are finished
afterAll(() => {
  server.close();
});
