import { describe, expect, it, vi } from 'vitest';
import { createTypedFetcher } from '../fetcher';
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

    expect(result).toEqual({
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
        page: 2,
        limit: 5,
        total: 1,
      },
      sort: 'desc',
    });
  });

  it('should handle 404 errors', async () => {
    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
    });

    await expect(
      client('GET /users/{id}', { params: { id: '404' } }),
    ).rejects.toThrow('HTTP 404: Not Found');
  });

  it('should handle 500 errors', async () => {
    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
    });

    await expect(client('GET /error')).rejects.toThrow(
      'HTTP 500: Internal Server Error',
    );
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

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
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

    await expect(() => client('GET /protected')).rejects.toThrow();
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

    expect(result).toEqual({
      id: 'user with spaces',
      name: 'John Doe',
      email: 'john@example.com',
    });
  });
});
