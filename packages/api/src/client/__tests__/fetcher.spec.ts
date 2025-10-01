import { describe, expect, it, vi } from 'vitest';
import { type FetchFn, createTypedFetcher } from '../fetcher';
import type { paths } from '../openapi-types';
import './setup';

describe('TypedFetcher', () => {
  it('should make GET request to fetch users', async () => {
    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
    });

    const result = await client('GET /users');

    expect(result).toEqual({
      users: [
        { id: '1', name: 'John Doe', email: 'john@example.com' },
        { id: '2', name: 'Jane Smith', email: 'jane@example.com' },
      ],
    });
  });

  it('should make GET request with path params', async () => {
    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
    });

    const result = await client('GET /users/{id}', { params: { id: '123' } });

    expect(result).toEqual({
      id: '123',
      name: 'John Doe',
      email: 'john@example.com',
    });
  });

  it('should make POST request with body', async () => {
    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
    });

    const requestBody = { name: 'Jane Doe', email: 'jane@example.com' };
    const result = await client('POST /users', { body: requestBody });

    expect(result).toEqual({
      id: '123',
      name: 'Jane Doe',
      email: 'jane@example.com',
    });
  });

  it('should make PUT request with path params and body', async () => {
    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
    });

    const result = await client('PUT /users/{id}', {
      params: { id: '456' },
      body: { name: 'Updated Name' },
    });

    expect(result).toEqual({
      id: '456',
      name: 'Updated Name',
      email: 'john@example.com',
    });
  });

  it('should handle DELETE requests', async () => {
    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
    });

    // DELETE returns no content (204)
    const result = await client('DELETE /users/{id}', {
      params: { id: '123' },
    });

    // For 204 responses, result should be undefined or empty
    expect(result).toBeUndefined();
  });

  it('should handle query parameters', async () => {
    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
    });

    const result = await client('GET /posts', {
      query: { page: 2, limit: 5, sort: 'desc' },
    });

    expect(result.posts).toHaveLength(5);
  });

  it('should handle array query parameters', async () => {
    // Mock fetch to capture the request URL
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ items: ['a', 'b', 'c'] }),
    });

    const client = createTypedFetcher<any>({
      baseURL: 'https://api.example.com',
      fetch: mockFetch,
    });

    await client('GET /search', {
      query: { tags: ['nodejs', 'typescript', 'javascript'] as any },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/search?tags=nodejs&tags=typescript&tags=javascript',
      expect.any(Object),
    );
  });

  it('should handle object query parameters with dot notation', async () => {
    // Mock fetch to capture the request URL
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ results: [] }),
    });

    const client = createTypedFetcher<any>({
      baseURL: 'https://api.example.com',
      fetch: mockFetch,
    });

    await client('GET /products', {
      query: {
        filter: {
          category: 'electronics',
          minPrice: 100,
          maxPrice: 500,
        },
        sort: 'price',
      } as any,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/products?filter.category=electronics&filter.minPrice=100&filter.maxPrice=500&sort=price',
      expect.any(Object),
    );
  });

  it('should handle arrays within nested objects', async () => {
    // Mock fetch to capture the request URL
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ results: [] }),
    });

    const client = createTypedFetcher<any>({
      baseURL: 'https://api.example.com',
      fetch: mockFetch,
    });

    await client('GET /advanced-search', {
      query: {
        user: {
          roles: ['admin', 'moderator', 'user'],
          status: 'active',
        },
        settings: {
          notifications: {
            types: ['email', 'sms', 'push'],
            enabled: true,
          },
        },
      } as any,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/advanced-search?user.roles=admin&user.roles=moderator&user.roles=user&user.status=active&settings.notifications.types=email&settings.notifications.types=sms&settings.notifications.types=push&settings.notifications.enabled=true',
      expect.any(Object),
    );
  });

  it('should handle 404 errors', async () => {
    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
    });

    try {
      await client('GET /users/{id}', {
        params: { id: '404' },
      });
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response;
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.message).toBe('User not found');
    }
  });

  it('should handle 500 errors', async () => {
    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
    });

    try {
      await client('GET /error');
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response;
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.message).toBe('Internal server error');
    }
  });

  it('should apply request interceptor', async () => {
    const onRequest = vi.fn((config) => ({
      ...config,
      headers: { ...config.headers, 'X-Custom-Header': 'test-value' },
    }));

    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
      onRequest,
    });

    await client('GET /users/{id}', { params: { id: '123' } });

    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Object),
      }),
    );
  });

  it('should apply response interceptor', async () => {
    const onResponse = vi.fn((response) => response);

    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
      onResponse,
    });

    await client('GET /users/{id}', { params: { id: '123' } });

    expect(onResponse).toHaveBeenCalledWith(expect.any(Response));
  });

  it('should apply error handler', async () => {
    const onError = vi.fn();

    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
      onError,
    });

    await expect(
      client('GET /users/{id}', { params: { id: '404' } }),
    ).rejects.toThrow();

    expect(onError).toHaveBeenCalledWith(expect.any(Response));
  });

  it('should merge default headers with request headers', async () => {
    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
      headers: { Authorization: 'Bearer valid-token' },
    });

    const result = await client('GET /protected', {
      headers: { 'X-Custom': 'value' },
    });

    expect(result).toEqual({ message: 'Protected data' });
  });

  it('should handle unauthorized requests', async () => {
    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
      headers: { Authorization: 'Bearer broken-token' },
    });

    try {
      await client('GET /protected');
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response;
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.message).toBe('Unauthorized');
    }
  });

  it('should handle empty query parameters', async () => {
    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
    });

    const result = await client('GET /posts', {
      query: { page: 1, sort: undefined as any },
    });

    expect(result.pagination.page).toBe(1);
    expect(result.sort).toBe('asc'); // Default value when sort is undefined
  });

  it('should properly encode path parameters', async () => {
    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
    });

    const result = await client('GET /users/{id}', {
      params: { id: 'user with spaces' },
    });

    // MSW decodes the URL parameters, so we get the original value back
    expect(result).toEqual({
      id: 'user with spaces',
      name: 'John Doe',
      email: 'john@example.com',
    });
  });

  it('should correctly substitute multiple path parameters', async () => {
    // Add a mock handler for this test
    const mockFetch = vi.fn(async (url: string) => {
      if (url === 'https://api.example.com/posts/123/comments/456') {
        return new Response(
          JSON.stringify({
            postId: '123',
            commentId: '456',
            content: 'Test comment',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    }) as FetchFn;

    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
      fetch: mockFetch,
    });

    const result = await client(
      'GET /posts/{postId}/comments/{commentId}' as any,
      {
        params: { postId: '123', commentId: '456' },
      },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/posts/123/comments/456',
      expect.any(Object),
    );
    expect(result).toEqual({
      postId: '123',
      commentId: '456',
      content: 'Test comment',
    });
  });

  it('should URL encode special characters in path parameters', async () => {
    // Mock fetch to verify the actual URL being called
    const mockFetch = vi.fn(async (url: string) => {
      if (
        url ===
        'https://api.example.com/users/user%20with%20spaces%2Fand%2Fslashes'
      ) {
        return new Response(
          JSON.stringify({
            id: 'user with spaces/and/slashes',
            name: 'Test User',
            email: 'test@example.com',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;
    
    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
      fetch: mockFetch,
    });

    const result = await client('GET /users/{id}', {
      params: { id: 'user with spaces/and/slashes' },
    });

    // Verify the URL was properly encoded
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/users/user%20with%20spaces%2Fand%2Fslashes',
      expect.any(Object),
    );

    expect(result).toEqual({
      id: 'user with spaces/and/slashes',
      name: 'Test User',
      email: 'test@example.com',
    });
  });
});
