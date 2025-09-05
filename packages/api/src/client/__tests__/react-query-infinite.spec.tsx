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

describe('TypedQueryClient - useInfiniteQuery', () => {
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

  it('should correctly type the data structure with pages array', () => {
    const typedClient = createTypedQueryClient<paths>({
      baseURL: 'https://api.example.com',
    });

    const { result } = renderHook(
      () => {
        const query = typedClient.useInfiniteQuery('GET /users/paginated', {
          initialPageParam: 1,
          getNextPageParam: (lastPage, allPages, lastPageParam) => {
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
});
