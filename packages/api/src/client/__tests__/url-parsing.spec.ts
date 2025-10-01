import { describe, expect, it, vi } from 'vitest';
import { createTypedFetcher } from '../fetcher';

describe('URL Path Parameter Parsing', () => {
  it('should correctly parse single path parameter', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = createTypedFetcher<any>({
      baseURL: 'https://api.example.com',
      fetch: mockFetch,
    });

    await client('GET /users/{userId}' as any, {
      params: { userId: '12345' },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/users/12345',
      expect.any(Object),
    );
  });

  it('should correctly parse multiple path parameters', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = createTypedFetcher<any>({
      fetch: mockFetch,
      baseURL: 'https://api.example.com',
    });

    await client(
      'GET /organizations/{orgId}/projects/{projectId}/tasks/{taskId}' as any,
      {
        params: {
          orgId: 'org-123',
          projectId: 'proj-456',
          taskId: 'task-789',
        },
      },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/organizations/org-123/projects/proj-456/tasks/task-789',
      expect.any(Object),
    );
  });

  it('should URL encode special characters in path parameters', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = createTypedFetcher<any>({
      baseURL: 'https://api.example.com',
      fetch: mockFetch,
    });

    await client('GET /files/{filename}' as any, {
      params: {
        filename: 'my file with spaces & special#characters.txt',
      },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/files/my%20file%20with%20spaces%20%26%20special%23characters.txt',
      expect.any(Object),
    );
  });

  it('should handle path parameters with forward slashes', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = createTypedFetcher<any>({
      baseURL: 'https://api.example.com',
      fetch: mockFetch,
    });

    await client('GET /repositories/{repoPath}' as any, {
      params: {
        repoPath: 'owner/repo/branch',
      },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/repositories/owner%2Frepo%2Fbranch',
      expect.any(Object),
    );
  });

  it('should handle path parameters and query parameters together', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createTypedFetcher<any>({
      baseURL: 'https://api.example.com',
      fetch: mockFetch,
    });

    await client('GET /users/{userId}/posts' as any, {
      params: { userId: 'user-123' },
      query: { page: 2, limit: 10, sort: 'desc' },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/users/user-123/posts?page=2&limit=10&sort=desc',
      expect.any(Object),
    );
  });

  it('should handle numeric path parameters', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createTypedFetcher<any>({
      baseURL: 'https://api.example.com',
      fetch: mockFetch,
    });

    await client('GET /api/v{version}/users/{id}' as any, {
      params: { version: 2, id: 12345 },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v2/users/12345',
      expect.any(Object),
    );
  });

  it('should handle empty baseURL', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createTypedFetcher<any>({
      baseURL: '',
      fetch: mockFetch,
    });

    await client('GET /users/{id}' as any, {
      params: { id: '123' },
    });

    expect(mockFetch).toHaveBeenCalledWith('/users/123', expect.any(Object));
  });

  it('should not replace parameters that are not provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = createTypedFetcher<any>({
      baseURL: 'https://api.example.com',
      fetch: mockFetch,
    });

    // Missing the userId parameter
    await client('GET /users/{userId}/posts/{postId}' as any, {
      params: { postId: '456' },
    });

    // The {userId} should remain in the URL unchanged
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/users/{userId}/posts/456',
      expect.any(Object),
    );
  });
});
