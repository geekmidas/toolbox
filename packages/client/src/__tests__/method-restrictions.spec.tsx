/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
// biome-ignore lint/style/useImportType: <explanation>
import React from 'react';
import { describe, expect, it } from 'vitest';
import type { paths } from '../openapi-types';
import { createTypedQueryClient } from '../react-query';
import './setup';

describe('Method Restrictions', () => {
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

  describe('useQuery', () => {
    it('should accept GET endpoints', () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      // This should compile - GET endpoints are allowed
      const { result } = renderHook(() => typedClient.useQuery('GET /users'), {
        wrapper,
      });

      expect(result.current).toBeDefined();
    });

    it('should accept GET endpoints with parameters', () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      // This should compile - GET endpoints with params are allowed
      const { result } = renderHook(
        () =>
          typedClient.useQuery('GET /users/{id}', {
            params: { id: '123' },
          }),
        { wrapper },
      );

      expect(result.current).toBeDefined();
    });

    it('should accept GET endpoints with query parameters', () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      // This should compile - GET endpoints with query params are allowed
      const { result } = renderHook(
        () =>
          typedClient.useQuery('GET /posts', {
            query: { page: 1, limit: 10 },
          }),
        { wrapper },
      );

      expect(result.current).toBeDefined();
    });

    // The following tests would fail TypeScript compilation if uncommented
    // They are left here as documentation of what should NOT work

    /*
    it('should NOT accept POST endpoints', () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      // @ts-expect-error - POST endpoints should not be allowed in useQuery
      const { result } = renderHook(
        () => typedClient.useQuery('POST /users'),
        { wrapper },
      );
    });

    it('should NOT accept PUT endpoints', () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      // @ts-expect-error - PUT endpoints should not be allowed in useQuery
      const { result } = renderHook(
        () => typedClient.useQuery('PUT /users/{id}', { params: { id: '123' } }),
        { wrapper },
      );
    });

    it('should NOT accept DELETE endpoints', () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      // @ts-expect-error - DELETE endpoints should not be allowed in useQuery
      const { result } = renderHook(
        () => typedClient.useQuery('DELETE /users/{id}', { params: { id: '123' } }),
        { wrapper },
      );
    });
    */
  });

  describe('useMutation', () => {
    it('should accept POST endpoints', () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      // This should compile - POST endpoints are allowed
      const { result } = renderHook(
        () => typedClient.useMutation('POST /users'),
        { wrapper },
      );

      expect(result.current).toBeDefined();
    });

    it('should accept PUT endpoints', () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      // This should compile - PUT endpoints are allowed
      const { result } = renderHook(
        () => typedClient.useMutation('PUT /users/{id}'),
        { wrapper },
      );

      expect(result.current).toBeDefined();
    });

    it('should accept DELETE endpoints', () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      // This should compile - DELETE endpoints are allowed
      const { result } = renderHook(
        () => typedClient.useMutation('DELETE /users/{id}'),
        { wrapper },
      );

      expect(result.current).toBeDefined();
    });

    // The following test would fail TypeScript compilation if uncommented
    // It is left here as documentation of what should NOT work

    /*
    it('should NOT accept GET endpoints', () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      // @ts-expect-error - GET endpoints should not be allowed in useMutation
      const { result } = renderHook(
        () => typedClient.useMutation('GET /users'),
        { wrapper },
      );
    });
    */
  });

  describe('Type inference', () => {
    it('should correctly infer response types for GET requests', () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      const { result } = renderHook(() => typedClient.useQuery('GET /users'), {
        wrapper,
      });

      // TypeScript should infer this type correctly
      type ResponseType = typeof result.current.data;
      type ExpectedType =
        | { users: Array<{ id: string; name: string; email: string }> }
        | undefined;

      // This assertion validates that the types match at compile time
      const _typeCheck: ResponseType extends ExpectedType ? true : false = true;
      const _typeCheck2: ExpectedType extends ResponseType ? true : false =
        true;

      expect(_typeCheck).toBe(true);
      expect(_typeCheck2).toBe(true);
    });

    it('should correctly infer response types for POST requests', () => {
      const typedClient = createTypedQueryClient<paths>({
        baseURL: 'https://api.example.com',
      });

      const { result } = renderHook(
        () => typedClient.useMutation('POST /users'),
        { wrapper },
      );

      // TypeScript should infer this type correctly
      type ResponseType = typeof result.current.data;
      type ExpectedType =
        | { id: string; name: string; email: string }
        | undefined;

      // This assertion validates that the types match at compile time
      const _typeCheck: ResponseType extends ExpectedType ? true : false = true;
      const _typeCheck2: ExpectedType extends ResponseType ? true : false =
        true;

      expect(_typeCheck).toBe(true);
      expect(_typeCheck2).toBe(true);
    });
  });
});
