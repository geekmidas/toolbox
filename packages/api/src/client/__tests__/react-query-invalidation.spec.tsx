/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { paths } from '../openapi-types';
import { TypedQueryClient, useTypedInvalidateQueries } from '../react-query';
// Mock the fetcher module
vi.mock('../fetcher', () => ({
  createTypedFetcher: () => vi.fn(),
}));

describe('TypedQueryClient - Query Invalidation', () => {
  let queryClient: QueryClient;
  let typedClient: TypedQueryClient<paths>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    typedClient = new TypedQueryClient({ queryClient });
  });

  describe('buildQueryKey', () => {
    it('should build query key with endpoint only', () => {
      const key = typedClient.buildQueryKey('GET /users');
      expect(key).toEqual(['GET /users']);
    });

    it('should build query key with params', () => {
      const key = typedClient.buildQueryKey('GET /users/{id}', {
        params: { id: '123' },
      });
      expect(key).toEqual(['GET /users/{id}', { params: { id: '123' } }]);
    });

    it('should build query key with query params', () => {
      const key = typedClient.buildQueryKey('GET /users', {
        query: { page: 1, limit: 10 },
      });
      expect(key).toEqual(['GET /users', { query: { page: 1, limit: 10 } }]);
    });

    it('should build query key with params only for paths without query support', () => {
      const key = typedClient.buildQueryKey('GET /users/{id}', {
        params: { id: '123' },
      });
      expect(key).toEqual([
        'GET /users/{id}',
        { params: { id: '123' } },
      ]);
    });
  });

  describe('invalidateQueries', () => {
    it('should invalidate queries with endpoint only (partial match)', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await typedClient.invalidateQueries('GET /users');

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['GET /users'],
        exact: false,
      });
    });

    it('should invalidate queries with config (exact match)', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await typedClient.invalidateQueries('GET /users/{id}', {
        params: { id: '123' },
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['GET /users/{id}', { params: { id: '123' } }],
        exact: true,
      });
    });

    it('should invalidate queries with query params', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await typedClient.invalidateQueries('GET /posts', {
        query: { sort: 'asc' },
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['GET /posts', { query: { sort: 'asc' } }],
        exact: true,
      });
    });
  });

  describe('invalidateAllQueries', () => {
    it('should invalidate all queries', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await typedClient.invalidateAllQueries();

      expect(invalidateSpy).toHaveBeenCalledWith();
    });
  });

  describe('getQueryClient / setQueryClient', () => {
    it('should return the query client when provided in constructor', () => {
      const client = typedClient.getQueryClient();
      expect(client).toBe(queryClient);
    });

    it('should throw error when no query client is set', () => {
      const clientWithoutQC = new TypedQueryClient();

      expect(() => clientWithoutQC.getQueryClient()).toThrow(
        'No QueryClient set, please provide a QueryClient via the queryClient option or ensure you are within a QueryClientProvider',
      );
    });

    it('should allow setting query client after construction', () => {
      const clientWithoutQC = new TypedQueryClient();
      const newQueryClient = new QueryClient();

      clientWithoutQC.setQueryClient(newQueryClient);

      expect(clientWithoutQC.getQueryClient()).toBe(newQueryClient);
    });
  });

  describe('useTypedInvalidateQueries hook', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    it('should provide invalidateQueries function', async () => {
      const { result } = renderHook(
        () => useTypedInvalidateQueries(typedClient),
        { wrapper },
      );

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await result.current.invalidateQueries('GET /users/{id}', {
        params: { id: '456' },
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['GET /users/{id}', { params: { id: '456' } }],
        exact: true,
      });
    });

    it('should provide invalidateAllQueries function', async () => {
      const { result } = renderHook(
        () => useTypedInvalidateQueries(typedClient),
        { wrapper },
      );

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await result.current.invalidateAllQueries();

      expect(invalidateSpy).toHaveBeenCalledWith();
    });
  });

  describe('Integration test: Query invalidation with real queries', () => {
    it('should invalidate matching queries after mutation', async () => {
      // Set up some queries in the cache
      queryClient.setQueryData(
        ['GET /users'],
        [
          { id: '1', name: 'User 1' },
          { id: '2', name: 'User 2' },
        ],
      );
      queryClient.setQueryData(['GET /users/{id}', { params: { id: '1' } }], {
        id: '1',
        name: 'User 1',
      });
      queryClient.setQueryData(
        ['GET /users', { query: { page: 1 } }],
        [{ id: '1', name: 'User 1' }],
      );

      // Verify data is in cache
      expect(queryClient.getQueryData(['GET /users'])).toBeDefined();
      expect(
        queryClient.getQueryData(['GET /users/{id}', { params: { id: '1' } }]),
      ).toBeDefined();
      expect(
        queryClient.getQueryData(['GET /users', { query: { page: 1 } }]),
      ).toBeDefined();

      // Invalidate all user queries (partial match)
      await typedClient.invalidateQueries('GET /users');

      // All queries starting with 'GET /users' should be invalidated
      await waitFor(() => {
        const cache = queryClient.getQueryCache();
        const queries = cache.findAll({ queryKey: ['GET /users'] });
        queries.forEach((query) => {
          expect(query.state.isInvalidated).toBe(true);
        });
      });
    });

    it('should only invalidate exact matches when config is provided', async () => {
      // Set up queries
      queryClient.setQueryData(
        ['GET /users', { query: { page: 1 } }],
        [{ id: '1', name: 'User 1' }],
      );
      queryClient.setQueryData(
        ['GET /users', { query: { page: 2 } }],
        [{ id: '2', name: 'User 2' }],
      );

      // Invalidate only page 1
      await typedClient.invalidateQueries('GET /users', {
        query: { page: 1 },
      });

      await waitFor(() => {
        const cache = queryClient.getQueryCache();
        const page1Query = cache.find({
          queryKey: ['GET /users', { query: { page: 1 } }],
        });
        const page2Query = cache.find({
          queryKey: ['GET /users', { query: { page: 2 } }],
        });

        expect(page1Query?.state.isInvalidated).toBe(true);
        expect(page2Query?.state.isInvalidated).toBe(false);
      });
    });
  });
});
