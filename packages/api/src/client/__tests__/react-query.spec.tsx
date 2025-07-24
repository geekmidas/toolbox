/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
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
          total: 1,
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
});
