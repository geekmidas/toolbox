/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
// biome-ignore lint/style/useImportType: <explanation>
import React from 'react';
import { describe, expect, it } from 'vitest';
import type { paths } from '../openapi-types';
import {
  createTypedQueryClient,
  useTypedMutation,
  useTypedQuery,
} from '../react-query';
import './setup';

describe('TypedQueryClient', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('should create query client with correct configuration', () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
      headers: { Authorization: 'Bearer token' },
    });

    expect(typedClient).toBeDefined();
  });

  describe('useQuery', () => {
    it('should fetch data successfully', async () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      const { result } = renderHook(
        () =>
          typedClient.useQuery('GET /users/{id}', {
            params: { id: '123' },
          }),
        { wrapper },
      );

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual({
        id: '123',
        name: 'John Doe',
        email: 'john@example.com',
      });
    });

    it('should handle query parameters', async () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      const { result } = renderHook(
        () =>
          typedClient.useQuery('GET /posts', {
            query: { page: 1, limit: 10, sort: 'desc' },
          }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toMatchObject({
        posts: expect.any(Array),
        pagination: {
          page: 1,
          limit: 10,
          total: 50,
        },
        sort: 'desc',
      });
    });

    it('should handle errors', async () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      const { result } = renderHook(() => typedClient.useQuery('GET /error'), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeDefined();
    });

    it('should pass additional query options', async () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      const { result } = renderHook(
        () =>
          typedClient.useQuery(
            'GET /users/{id}',
            { params: { id: '123' } },
            {
              staleTime: 5 * 60 * 1000,
              gcTime: 10 * 60 * 1000,
            },
          ),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toBeDefined();
    });
  });

  describe('useMutation', () => {
    it('should perform mutations successfully', async () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      const { result } = renderHook(
        () => typedClient.useMutation('POST /users'),
        { wrapper },
      );

      expect(result.current.isPending).toBe(false);

      act(() => {
        result.current.mutate({
          body: {
            name: 'New User',
            email: 'new@example.com',
          },
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual({
        id: '123',
        name: 'New User',
        email: 'new@example.com',
      });
    });

    it('should handle mutation with path parameters', async () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      const { result } = renderHook(
        () => typedClient.useMutation('PUT /users/{id}'),
        { wrapper },
      );

      act(() => {
        result.current.mutate({
          params: { id: '456' },
          body: {
            name: 'Updated User',
          },
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toMatchObject({
        id: '456',
        name: 'Updated User',
      });
    });

    it('should accept mutation options', async () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      let successData: any;
      const onSuccess = (data: any) => {
        successData = data;
      };

      const { result } = renderHook(
        () => typedClient.useMutation('POST /users', { onSuccess }),
        { wrapper },
      );

      act(() => {
        result.current.mutate({
          body: {
            name: 'Test User',
            email: 'test@example.com',
          },
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(successData).toEqual({
        id: '123',
        name: 'Test User',
        email: 'test@example.com',
      });
    });
  });

  describe('helper hooks', () => {
    it('should work with useTypedQuery helper', async () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      const { result } = renderHook(
        () =>
          useTypedQuery(typedClient, 'GET /users/{id}', {
            params: { id: '789' },
          }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toMatchObject({
        id: '789',
        name: 'John Doe',
        email: 'john@example.com',
      });
    });

    it('should work with useTypedMutation helper', async () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      const { result } = renderHook(
        () => useTypedMutation(typedClient, 'DELETE /users/{id}'),
        { wrapper },
      );

      act(() => {
        result.current.mutate({
          params: { id: '999' },
        });
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toBeUndefined();
    });
  });

  describe('query key generation', () => {
    it('should generate correct query keys', async () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      // Test with path params only
      const { result: result1 } = renderHook(
        () =>
          typedClient.useQuery('GET /users/{id}', {
            params: { id: '123' },
          }),
        { wrapper },
      );

      await waitFor(() => expect(result1.current.isSuccess).toBe(true));

      // The query key should include the endpoint and params
      const queryState = queryClient.getQueryState([
        'GET /users/{id}',
        { params: { id: '123' } },
      ]);
      expect(queryState).toBeDefined();

      // Test with query params
      const { result: result2 } = renderHook(
        () =>
          typedClient.useQuery('GET /posts', {
            query: { page: 1, limit: 10 },
          }),
        { wrapper },
      );

      await waitFor(() => expect(result2.current.isSuccess).toBe(true));

      const queryState2 = queryClient.getQueryState([
        'GET /posts',
        { query: { page: 1, limit: 10 } },
      ]);
      expect(queryState2).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle 404 errors', async () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      const { result } = renderHook(
        () =>
          typedClient.useQuery('GET /users/{id}', {
            params: { id: '404' },
          }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.status).toBe(404);
    });

    it('should handle authorization errors', async () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      const { result } = renderHook(
        () => typedClient.useQuery('GET /protected'),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error?.status).toBe(401);
    });
  });

  describe('Memoization', () => {
    it('should not cause unnecessary re-renders when options object is recreated with same values', async () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      // Track API calls using MSW request interception
      let requestCount = 0;
      const { server } = await import('./setup');
      server.use(
        http.get('https://api.example.com/users/:id', () => {
          requestCount++;
          return HttpResponse.json({ id: '123', name: 'John Doe' });
        }),
      );

      let renderCount = 0;

      const { rerender } = renderHook(
        ({ options }: { options?: { enabled?: boolean } }) => {
          renderCount++;
          return typedClient.useQuery(
            'GET /users/{id}',
            { params: { id: '123' } },
            options,
          );
        },
        {
          wrapper,
          initialProps: { options: { enabled: true } },
        },
      );

      await waitFor(() => {
        expect(requestCount).toBe(1);
      });

      const initialRenderCount = renderCount;

      // Rerender with a new options object that has the same values
      rerender({ options: { enabled: true } });

      // Give React time to potentially trigger re-renders
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // The API should not be called again because options haven't actually changed
      expect(requestCount).toBe(1);

      // Component should re-render due to props change, but React Query shouldn't refetch
      expect(renderCount).toBeGreaterThan(initialRenderCount);
    });

    it('should re-fetch when options actually change', async () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      // Track API calls using MSW request interception
      let requestCount = 0;
      const { server } = await import('./setup');
      server.use(
        http.get('https://api.example.com/users/:id', () => {
          requestCount++;
          return HttpResponse.json({ id: '123', name: 'John Doe' });
        }),
      );

      const { rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) =>
          typedClient.useQuery(
            'GET /users/{id}',
            { params: { id: '123' } },
            { enabled },
          ),
        {
          wrapper,
          initialProps: { enabled: true },
        },
      );

      await waitFor(() => {
        expect(requestCount).toBe(1);
      });

      // Disable the query
      rerender({ enabled: false });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Should still only be called once since we disabled it
      expect(requestCount).toBe(1);

      // Re-enable the query
      rerender({ enabled: true });

      await waitFor(() => {
        expect(requestCount).toBe(2);
      });
    });

    it('should memoize mutation options correctly', async () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      // Track API calls using MSW request interception
      let requestCount = 0;
      const { server } = await import('./setup');
      server.use(
        http.post('https://api.example.com/users', async ({ request }) => {
          requestCount++;
          const body = await request.json();
          return HttpResponse.json({ id: '123', name: (body as any).name });
        }),
      );

      let renderCount = 0;
      let successCallCount = 0;

      const { result, rerender } = renderHook(
        ({ options }: { options?: { onSuccess?: () => void } }) => {
          renderCount++;
          return typedClient.useMutation('POST /users', options);
        },
        {
          wrapper,
          initialProps: {
            options: {
              onSuccess: () => {
                successCallCount++;
              },
            },
          },
        },
      );

      const initialRenderCount = renderCount;

      // Trigger a mutation to test the options
      await act(async () => {
        result.current.mutate({
          body: { name: 'Test User', email: 'test@example.com' },
        });
      });

      await waitFor(() => {
        expect(requestCount).toBe(1);
        expect(successCallCount).toBe(1);
      });

      // Rerender with a new options object that has the same function reference
      const onSuccess = () => {
        successCallCount++;
      };
      rerender({ options: { onSuccess } });
      rerender({ options: { onSuccess } });

      // Component should re-render due to props change
      expect(renderCount).toBeGreaterThan(initialRenderCount);
    });

    it('should handle config changes in useQuery correctly', async () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      // Track API calls using MSW request interception
      let requestCount = 0;
      const requestedIds: string[] = [];
      const { server } = await import('./setup');
      server.use(
        http.get('https://api.example.com/users/:id', ({ params }) => {
          requestCount++;
          const { id } = params;
          requestedIds.push(id as string);
          return HttpResponse.json({ id, name: `User ${id}` });
        }),
      );

      const { rerender } = renderHook(
        ({ userId }: { userId: string }) =>
          typedClient.useQuery('GET /users/{id}', { params: { id: userId } }),
        {
          wrapper,
          initialProps: { userId: '123' },
        },
      );

      await waitFor(() => {
        expect(requestCount).toBe(1);
        expect(requestedIds).toEqual(['123']);
      });

      // Change the user ID - should trigger a new fetch
      rerender({ userId: '456' });

      await waitFor(() => {
        expect(requestCount).toBe(2);
        expect(requestedIds).toEqual(['123', '456']);
      });

      // Call with same ID again - should not trigger new fetch due to React Query caching
      rerender({ userId: '456' });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(requestCount).toBe(2);
      expect(requestedIds).toEqual(['123', '456']);
    });
  });
});
