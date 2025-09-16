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
  http.patch(
    'https://api.example.com/users/:id',
    async ({ params, request }) => {
      const { id } = params;
      const body = await request.json();
      return HttpResponse.json({
        id,
        name: (body as any).name || 'John Doe',
        email: (body as any).email || 'john@example.com',
      });
    },
  ),

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

    // Generate posts based on page to simulate pagination
    const totalPosts = 50;
    const startIndex = (page - 1) * limit;
    const endIndex = Math.min(startIndex + limit, totalPosts);

    const posts = Array.from({ length: endIndex - startIndex }, (_, i) => ({
      id: `post-${startIndex + i + 1}`,
      title: `Test Post ${startIndex + i + 1}`,
      content: `Test content for post ${startIndex + i + 1}`,
      authorId: `author-${((startIndex + i) % 5) + 1}`,
      createdAt: new Date(
        Date.now() - (startIndex + i) * 3600000,
      ).toISOString(),
    }));

    return HttpResponse.json({
      posts,
      pagination: {
        page,
        limit,
        total: totalPosts,
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

  // Paginated users endpoint for infinite queries
  http.get('https://api.example.com/users/paginated', ({ request }) => {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '10');

    const allUsers = Array.from({ length: 50 }, (_, i) => ({
      id: `user-${i + 1}`,
      name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
    }));

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const users = allUsers.slice(startIndex, endIndex);
    const hasMore = endIndex < allUsers.length;

    return HttpResponse.json({
      users,
      pagination: {
        page,
        limit,
        total: allUsers.length,
        hasMore,
      },
    });
  }),

  // Cursor-based pagination endpoint for infinite queries
  http.get('https://api.example.com/messages', ({ request }) => {
    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor');
    const limit = parseInt(url.searchParams.get('limit') || '10');

    const allMessages = Array.from({ length: 100 }, (_, i) => ({
      id: `msg-${i + 1}`,
      text: `Message ${i + 1}`,
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
    }));

    let startIndex = 0;
    if (cursor) {
      const cursorIndex = allMessages.findIndex((m) => m.id === cursor);
      startIndex = cursorIndex !== -1 ? cursorIndex + 1 : 0;
    }

    const messages = allMessages.slice(startIndex, startIndex + limit);
    const nextCursor =
      messages.length === limit ? messages[messages.length - 1].id : null;

    return HttpResponse.json({
      messages,
      nextCursor,
    });
  }),

  // Echo endpoint that returns all query parameters
  http.get('https://api.example.com/echo', ({ request }) => {
    const url = new URL(request.url);
    const queryParams: Record<string, string> = {};

    // Collect all query parameters
    url.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });

    return HttpResponse.json({
      queryParams,
      // Also include some pagination data for infinite query testing
      data: Array.from({ length: 5 }, (_, i) => ({
        id: `item-${i + 1}`,
        value: `Value ${i + 1}`,
      })),
      pagination: {
        page: parseInt(queryParams.page || '1'),
        limit: parseInt(queryParams.limit || '10'),
        total: 50,
        hasMore: parseInt(queryParams.page || '1') < 5,
      },
    });
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
