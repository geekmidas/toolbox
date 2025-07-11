import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTypedFetcher } from '../fetcher';
import type { paths } from '../openapi-types';

// Mock fetch
global.fetch = vi.fn();

describe('TypedFetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should make GET request with path params', async () => {
    const mockResponse = { id: '123', name: 'John', email: 'john@example.com' };
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
    });
    const result = await client('GET /users/{id}', { params: { id: '123' } });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/users/123',
      {
        method: 'GET',
        headers: {},
      },
    );
    expect(result).toEqual(mockResponse);
  });

  it('should make POST request with body', async () => {
    const mockResponse = { id: '456', name: 'Jane', email: 'jane@example.com' };
    const requestBody = { name: 'Jane', email: 'jane@example.com' };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
    });
    const result = await client('POST /users', { body: requestBody });

    expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    expect(result).toEqual(mockResponse);
  });

  it('should handle query parameters', async () => {
    const mockResponse = {
      posts: [],
      pagination: { page: 1, limit: 10, total: 0 },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
    });
    const result = await client('GET /posts', {
      query: { page: 1, limit: 10, sort: 'desc' },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/posts?page=1&limit=10&sort=desc',
      {
        method: 'GET',
        headers: {},
      },
    );
    expect(result).toEqual(mockResponse);
  });

  it('should apply request interceptor', async () => {
    const mockResponse = { id: '123' };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const onRequest = vi.fn((config) => ({
      ...config,
      headers: { ...config.headers, 'X-Custom': 'header' },
    }));

    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
      onRequest,
    });

    await client('GET /users/{id}', { params: { id: '123' } });

    expect(onRequest).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/users/123',
      {
        method: 'GET',
        headers: { 'X-Custom': 'header' },
      },
    );
  });

  it('should handle errors', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const onError = vi.fn();
    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
      onError,
    });

    await expect(
      client('GET /users/{id}', { params: { id: '999' } }),
    ).rejects.toThrow('HTTP 404: Not Found');

    expect(onError).toHaveBeenCalled();
  });

  it('should merge default headers with request headers', async () => {
    const mockResponse = { id: '123' };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const client = createTypedFetcher<paths>({
      baseURL: 'https://api.example.com',
      headers: { Authorization: 'Bearer default-token' },
    });

    await client('GET /users/{id}', {
      params: { id: '123' },
      headers: { 'X-Custom': 'value' },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/users/123',
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer default-token',
          'X-Custom': 'value',
        },
      },
    );
  });
});
