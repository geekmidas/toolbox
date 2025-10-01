/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
// biome-ignore lint/style/useImportType: <explanation>
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { paths } from '../openapi-types';
import { createTypedQueryClient } from '../react-query';
import './setup';

describe('TypedQueryClient - useInfiniteQuery', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    queryClient.clear();
  });

  it('should correctly merge query parameters with pageParam', async () => {
    // Mock fetch to verify the URL
    const originalFetch = global.fetch;
    const fetchSpy = vi.fn(originalFetch);
    global.fetch = fetchSpy;

    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
      fetch: fetchSpy,
    });

    const { result } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /posts',
          {
            initialPageParam: 1,
            getNextPageParam: () => undefined,
          },
          {
            query: {
              sort: 'desc',
              limit: 10,
            },
          },
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Restore original fetch
    global.fetch = originalFetch;

    // Verify the fetch URL contains all query parameters
    expect(fetchSpy).toHaveBeenCalled();
    const callArg = fetchSpy.mock.calls[0][0];
    const url = new URL(
      callArg instanceof Request ? callArg.url : callArg.toString(),
    );

    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('sort')).toBe('desc');
    expect(url.searchParams.get('limit')).toBe('10');

    // Verify response data
    expect(result.current.data?.pages[0]).toBeDefined();
    expect(result.current.data?.pages[0].sort).toBe('desc');
  });

  it('should correctly type the data structure with pages array', () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const { result } = renderHook(
      () => {
        const query = typedClient.useInfiniteQuery('GET /users/paginated', {
          initialPageParam: 1,
          getNextPageParam: (lastPage, allPages, lastPageParam) => {
            if (!lastPage) return undefined;
            // Type tests - these should compile without error
            const pageNum: number = lastPage.pagination.page;
            const hasMore: boolean = lastPage.pagination.hasMore;
            const users: Array<{ id: string; name: string; email: string }> =
              lastPage.users;

            // allPages should be an array
            const pagesArray: (typeof lastPage)[] = allPages;

            // lastPageParam should be number (as we defined)
            const param: number = lastPageParam;

            return hasMore ? param + 1 : undefined;
          },
        });

        // Type test for the returned data structure
        if (query.data) {
          // This should compile - data.pages should exist and be an array
          const pages: Array<{
            users: Array<{ id: string; name: string; email: string }>;
            pagination: {
              page: number;
              limit: number;
              total: number;
              hasMore: boolean;
            };
          }> = query.data.pages;

          // pageParams should also be typed correctly
          const pageParams: number[] = query.data.pageParams;

          // Test accessing nested data
          if (pages.length > 0) {
            const firstPageUsers = pages[0].users;
            const firstUser = firstPageUsers[0];
            if (firstUser) {
              const userId: string = firstUser.id;
              const userName: string = firstUser.name;
              const userEmail: string = firstUser.email;
            }
          }
        }

        return query;
      },
      { wrapper },
    );

    // The test passes if TypeScript compiles without error
    expect(result.current).toBeDefined();
  });

  it('should work with cursor-based pagination types', () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const { result } = renderHook(
      () => {
        const query = typedClient.useInfiniteQuery('GET /messages', {
          initialPageParam: undefined as string | undefined,
          getNextPageParam: (lastPage) => {
            // Type test - nextCursor should be string | null
            const cursor: string | null = lastPage.nextCursor;
            return cursor ?? undefined;
          },
        });

        // Type test for cursor-based data
        if (query.data) {
          const pages: Array<{
            messages: Array<{ id: string; text: string; timestamp: string }>;
            nextCursor: string | null;
          }> = query.data.pages;

          const pageParams: (string | undefined)[] = query.data.pageParams;
        }

        return query;
      },
      { wrapper },
    );

    expect(result.current).toBeDefined();
  });

  it('should preserve existing query parameters when paginating', async () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const { result } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /posts',
          {
            initialPageParam: 1,
            getNextPageParam: (lastPage) => {
              const nextPage = lastPage?.pagination?.page
                ? lastPage.pagination.page + 1
                : undefined;
              return nextPage && nextPage <= 3 ? nextPage : undefined;
            },
          },
          {
            query: {
              limit: 5,
              sort: 'asc',
            },
          },
        ),
      { wrapper },
    );

    // Wait for initial load
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Verify initial data has query params applied
    expect(result.current.data?.pages[0]).toBeDefined();
    expect(result.current.data?.pages[0].pagination.limit).toBe(5);
    expect(result.current.data?.pages[0].sort).toBe('asc');
  });

  it('should merge query parameters with pageParam correctly', async () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const { result } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /posts',
          {
            initialPageParam: 1,
            getNextPageParam: (_lastPage, _allPages, lastPageParam) =>
              lastPageParam < 3 ? lastPageParam + 1 : undefined,
          },
          {
            query: {
              sort: 'desc',
              limit: 15,
            },
          },
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Check that initial query parameters are present
    expect(result.current.data?.pages[0].sort).toBe('desc');
    expect(result.current.data?.pages[0].pagination.limit).toBe(15);
    expect(result.current.data?.pages[0].pagination.page).toBe(1);
  });

  it('should handle object pageParam with existing query parameters', async () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const { result } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /messages',
          {
            initialPageParam: {
              cursor: undefined as string | undefined,
              limit: 10,
            },
            getNextPageParam: (lastPage) =>
              lastPage.nextCursor
                ? { cursor: lastPage.nextCursor, limit: 10 }
                : undefined,
          },
          {
            query: {
              limit: 20, // This should be overridden by pageParam
            },
          },
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The pageParam should override the initial query parameter
    expect(result.current.data?.pages[0].messages).toBeDefined();
  });

  it('should handle numeric pageParam without config', async () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const { result } = renderHook(
      () =>
        typedClient.useInfiniteQuery('GET /posts', {
          initialPageParam: 1,
          getNextPageParam: () => undefined,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.pages[0].pagination.page).toBe(1);
  });

  it('should include query parameters in cache key', async () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const { result: result1 } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /posts',
          {
            initialPageParam: 1,
            getNextPageParam: () => undefined,
          },
          {
            query: { sort: 'asc' },
          },
        ),
      { wrapper },
    );

    const { result: result2 } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /posts',
          {
            initialPageParam: 1,
            getNextPageParam: () => undefined,
          },
          {
            query: { sort: 'desc' },
          },
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true);
      expect(result2.current.isSuccess).toBe(true);
    });

    // Different query parameters should result in different cache entries
    expect(result1.current.data?.pages[0].sort).toBe('asc');
    expect(result2.current.data?.pages[0].sort).toBe('desc');
  });

  it('should maintain all query parameters across multiple page fetches', async () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    // Mock fetch to verify URLs
    const originalFetch = global.fetch;
    const fetchCalls: string[] = [];
    const fetchSpy = vi.fn((url, ...args) => {
      const urlString = url instanceof Request ? url.url : url.toString();
      fetchCalls.push(urlString);
      return originalFetch(url, ...args);
    });
    global.fetch = fetchSpy;

    const { result } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /posts',
          {
            initialPageParam: 1,
            getNextPageParam: (_lastPage, _allPages, lastPageParam) => {
              return lastPageParam < 3 ? lastPageParam + 1 : undefined;
            },
          },
          {
            query: {
              sort: 'desc',
              limit: 10,
            },
          },
        ),
      { wrapper },
    );

    // Wait for initial page
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Fetch next pages
    await result.current.fetchNextPage();
    await result.current.fetchNextPage();

    // Restore original fetch
    global.fetch = originalFetch;

    // Verify all requests had the correct query parameters
    fetchCalls.forEach((urlString, index) => {
      const url = new URL(urlString);
      expect(url.searchParams.get('page')).toBe(String(index + 1));
      expect(url.searchParams.get('sort')).toBe('desc');
      expect(url.searchParams.get('limit')).toBe('10');
    });
  });

  it('should handle complex object pageParam merging', async () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const { result } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /messages',
          {
            initialPageParam: {
              cursor: undefined as string | undefined,
              limit: 5,
              type: 'initial',
            },
            getNextPageParam: (lastPage) =>
              lastPage.nextCursor
                ? {
                    cursor: lastPage.nextCursor,
                    limit: 5,
                    type: 'next',
                  }
                : undefined,
          },
          {
            query: {
              limit: 10, // Should be overridden by pageParam
            },
          },
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The complex pageParam should properly merge with config
    expect(result.current.data?.pages[0]).toBeDefined();

    // Fetch next page to ensure complex objects continue to work
    if (result.current.hasNextPage) {
      await waitFor(async () => {
        await result.current.fetchNextPage();
        expect(result.current.data?.pages).toHaveLength(2);
      });
    }
  });

  it('should correctly build query key with query parameters', () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    // Test with query parameters
    const queryKey1 = typedClient.buildQueryKey('GET /posts', {
      query: { sort: 'asc', limit: 10 },
    });

    expect(queryKey1).toEqual([
      'GET /posts',
      { query: { sort: 'asc', limit: 10 } },
    ]);

    // Test with both params and query
    const queryKey2 = typedClient.buildQueryKey('GET /users/{id}', {
      params: { id: '123' },
    });

    expect(queryKey2).toEqual(['GET /users/{id}', { params: { id: '123' } }]);
  });

  it('should handle undefined pageParam correctly', async () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const { result } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /messages',
          {
            initialPageParam: undefined,
            getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
          },
          {
            query: {
              limit: 15,
            },
          },
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Should still include the initial query parameters
    expect(result.current.data?.pages[0].messages).toBeDefined();
  });

  it('should validate query parameter types are preserved in responses', async () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const { result } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /posts',
          {
            initialPageParam: 1,
            getNextPageParam: () => undefined,
          },
          {
            query: {
              page: 1,
              limit: 20,
              sort: 'asc',
            },
          },
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const firstPage = result.current.data?.pages[0];

    // Type checks - these should compile
    if (firstPage) {
      const posts: Array<{
        id: string;
        title: string;
        content: string;
        authorId: string;
        createdAt: string;
      }> = firstPage.posts;

      const pagination: {
        page: number;
        limit: number;
        total: number;
      } = firstPage.pagination;

      const sort: 'asc' | 'desc' = firstPage.sort;

      // Runtime checks
      expect(posts).toBeInstanceOf(Array);
      expect(typeof pagination.page).toBe('number');
      expect(typeof pagination.limit).toBe('number');
      expect(typeof pagination.total).toBe('number');
      expect(['asc', 'desc']).toContain(sort);
    }
  });

  it('should send all query parameters in HTTP request', async () => {
    // Mock fetch to capture the actual request
    const originalFetch = global.fetch;
    const fetchSpy = vi.fn(originalFetch);

    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
      fetch: fetchSpy,
    });

    const { result } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /posts',
          {
            initialPageParam: 2,
            getNextPageParam: () => undefined,
          },
          {
            query: {
              sort: 'desc',
              limit: 25,
            },
          },
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Check that the fetch was called with correct URL including all query params
    expect(fetchSpy).toHaveBeenCalled();
    const callArg = fetchSpy.mock.calls[0][0];
    const url = new URL(
      callArg instanceof Request ? callArg.url : callArg.toString(),
    );

    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('sort')).toBe('desc');
    expect(url.searchParams.get('limit')).toBe('25');
  });

  it('should handle empty query config gracefully', async () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const { result } = renderHook(
      () =>
        typedClient.useInfiniteQuery('GET /posts', {
          initialPageParam: 1,
          getNextPageParam: () => undefined,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.pages[0]).toBeDefined();
    expect(result.current.data?.pages[0].pagination.page).toBe(1);
  });

  it('should handle query parameters with special characters', async () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const { result } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /messages',
          {
            initialPageParam: 'cursor%20with%20spaces',
            getNextPageParam: () => undefined,
          },
          {
            query: {
              limit: 10,
            },
          },
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Should handle special characters in pageParam correctly
    expect(result.current.data?.pages[0]).toBeDefined();
  });

  it('should verify object pageParam merging with echo endpoint', async () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const { result } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /echo',
          {
            initialPageParam: {
              page: 1,
              size: 20,
              offset: 0,
            },
            getNextPageParam: (lastPage) =>
              lastPage.pagination.hasMore
                ? {
                    page: lastPage.pagination.page + 1,
                    size: 20,
                    offset: lastPage.pagination.page * 20,
                  }
                : undefined,
          },
          {
            query: {
              sort: 'asc',
              type: 'premium',
            } as any,
          },
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Verify object pageParam is spread into query params
    const firstPage = result.current.data?.pages[0];
    expect(firstPage?.queryParams).toEqual({
      page: '1',
      size: '20',
      offset: '0',
      sort: 'asc',
      type: 'premium',
    });

    // Fetch next page
    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    const secondPage = result.current.data?.pages[1];
    expect(secondPage?.queryParams).toEqual({
      page: '2',
      size: '20',
      offset: '20',
      sort: 'asc',
      type: 'premium',
    });
  });

  it('should verify all query params are sent using echo endpoint', async () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const { result } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /echo',
          {
            initialPageParam: 1,
            getNextPageParam: (lastPage) =>
              lastPage.pagination.hasMore
                ? lastPage.pagination.page + 1
                : undefined,
          },
          {
            query: {
              sort: 'desc',
              filter: 'active',
              category: 'tech',
              includeArchived: false,
              limit: 25,
            } as any, // Using any to allow arbitrary query params for echo endpoint
          },
        ),
      { wrapper },
    );

    // Wait for initial load
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Verify the echo endpoint returned all our query parameters
    const firstPage = result.current.data?.pages[0];
    expect(firstPage?.queryParams).toEqual({
      page: '1', // From pageParam
      sort: 'desc',
      filter: 'active',
      category: 'tech',
      includeArchived: 'false',
      limit: '25',
    });

    // Fetch next page
    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    // Verify second page also has all parameters with updated page
    const secondPage = result.current.data?.pages[1];
    expect(secondPage?.queryParams).toEqual({
      page: '2', // Updated pageParam
      sort: 'desc',
      filter: 'active',
      category: 'tech',
      includeArchived: 'false',
      limit: '25',
    });

    // Verify the actual data and pagination info
    expect(firstPage?.pagination).toMatchObject({
      page: 1,
      limit: 25,
      total: 50,
      hasMore: true,
    });
  });

  it('should distinguish between queries with different query parameters in cache', async () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    // Query 1: sort=asc, limit=5
    const { result: result1 } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /posts',
          {
            initialPageParam: 1,
            getNextPageParam: () => 2,
          },
          {
            query: { sort: 'asc', limit: 5 },
          },
        ),
      { wrapper },
    );

    // Query 2: sort=desc, limit=5
    const { result: result2 } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /posts',
          {
            initialPageParam: 1,
            getNextPageParam: () => 2,
          },
          {
            query: { sort: 'desc', limit: 5 },
          },
        ),
      { wrapper },
    );

    // Query 3: sort=asc, limit=10
    const { result: result3 } = renderHook(
      () =>
        typedClient.useInfiniteQuery(
          'GET /posts',
          {
            initialPageParam: 1,
            getNextPageParam: () => 2,
          },
          {
            query: { sort: 'asc', limit: 10 },
          },
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true);
      expect(result2.current.isSuccess).toBe(true);
      expect(result3.current.isSuccess).toBe(true);
    });

    // Each query should have different data based on query params
    expect(result1.current.data?.pages[0].sort).toBe('asc');
    expect(result1.current.data?.pages[0].pagination.limit).toBe(5);

    expect(result2.current.data?.pages[0].sort).toBe('desc');
    expect(result2.current.data?.pages[0].pagination.limit).toBe(5);

    expect(result3.current.data?.pages[0].sort).toBe('asc');
    expect(result3.current.data?.pages[0].pagination.limit).toBe(10);

    // Fetch next page for first query
    await waitFor(async () => {
      await result1.current.fetchNextPage();
      expect(result1.current.data?.pages).toHaveLength(2);
    });

    // Verify the second page also has correct query params
    expect(result1.current.data?.pages[1].sort).toBe('asc');
    expect(result1.current.data?.pages[1].pagination.limit).toBe(5);
    expect(result1.current.data?.pages[1].pagination.page).toBe(2);
  });
});
