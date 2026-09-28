/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { createEndpointHooks } from '../endpoint-hooks';
import type { TypedApiFunction } from '../types';

interface Paths {
	'/users': {
		get: {
			parameters: { query: { page?: number; cursor?: string; team?: string } };
			responses: { 200: { content: { 'application/json': { page: number } } } };
		};
	};
}

/** A fetcher that answers with the page it was asked for, and remembers it. */
function recordingFetcher() {
	const calls: { endpoint: string; config: unknown }[] = [];
	const fetcher = (async (endpoint: string, config?: unknown) => {
		calls.push({ endpoint, config });
		const query = (config as { query?: { page?: number } } | undefined)?.query;
		return { page: query?.page ?? 0 };
	}) as unknown as TypedApiFunction<Paths>;
	return { fetcher, calls };
}

function wrapperFor(queryClient: QueryClient) {
	return ({ children }: { children: ReactNode }) =>
		createElement(QueryClientProvider, { client: queryClient }, children);
}

const newClient = () =>
	new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('useInfiniteQuery', () => {
	it('merges a numeric page into the config it was given', async () => {
		const { fetcher, calls } = recordingFetcher();
		const hooks = createEndpointHooks<Paths>(fetcher);
		// Stable across renders, as a component's options would be.
		const options = {
			initialPageParam: 1,
			getNextPageParam: (last: unknown) =>
				(last as { page: number }).page < 2
					? (last as { page: number }).page + 1
					: undefined,
		};
		const config = { query: { team: 'core' } } as never;
		const { result } = renderHook(
			() => hooks.useInfiniteQuery('GET /users', options, config),
			{ wrapper: wrapperFor(newClient()) },
		);

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.hasNextPage).toBe(true);
		await act(() => result.current.fetchNextPage());

		// Each page's request carries the given config plus that page.
		expect(calls.map((c) => c.config)).toEqual([
			{ query: { team: 'core', page: 1 } },
			{ query: { team: 'core', page: 2 } },
		]);
	});

	it('spreads an object page param as query fields, with no config', async () => {
		const { fetcher, calls } = recordingFetcher();
		const hooks = createEndpointHooks<Paths>(fetcher);
		const { result } = renderHook(
			() =>
				hooks.useInfiniteQuery('GET /users', {
					initialPageParam: { cursor: 'a' } as unknown,
					getNextPageParam: () => undefined,
				}),
			{ wrapper: wrapperFor(newClient()) },
		);

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(calls[0]?.config).toEqual({ query: { cursor: 'a' } });
	});

	it('uses a numeric page as the page with no config', async () => {
		const { fetcher, calls } = recordingFetcher();
		const hooks = createEndpointHooks<Paths>(fetcher);
		const { result } = renderHook(
			() =>
				hooks.useInfiniteQuery('GET /users', {
					initialPageParam: 3,
					getNextPageParam: () => undefined,
				}),
			{ wrapper: wrapperFor(newClient()) },
		);

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(calls[0]?.config).toEqual({ query: { page: 3 } });
	});

	it('passes the config through untouched when there is no page param', async () => {
		const { fetcher, calls } = recordingFetcher();
		const hooks = createEndpointHooks<Paths>(fetcher);
		const { result } = renderHook(
			() =>
				hooks.useInfiniteQuery(
					'GET /users',
					{
						initialPageParam: undefined,
						getNextPageParam: () => undefined,
					},
					{ query: { team: 'core' } } as never,
				),
			{ wrapper: wrapperFor(newClient()) },
		);

		await waitFor(() => expect(result.current.isSuccess).toBe(true));

		expect(calls[0]?.config).toEqual({ query: { team: 'core' } });
	});
});

describe('invalidation', () => {
	it('needs a query client to invalidate anything', () => {
		const hooks = createEndpointHooks<Paths>(recordingFetcher().fetcher);

		expect(() => hooks.invalidateQueries('GET /users')).toThrow(
			'queryClient is required for invalidateQueries',
		);
		expect(() => hooks.invalidateAllQueries()).toThrow(
			'queryClient is required for invalidateAllQueries',
		);
	});

	it('invalidates one config exactly, or every config of an endpoint', async () => {
		const queryClient = newClient();
		const hooks = createEndpointHooks<Paths>(recordingFetcher().fetcher, {
			queryClient,
		});
		const teamKey = hooks.buildQueryKey('GET /users', {
			query: { team: 'core' },
		} as never);
		const otherKey = hooks.buildQueryKey('GET /users', {
			query: { team: 'ops' },
		} as never);
		queryClient.setQueryData(teamKey, { page: 1 });
		queryClient.setQueryData(otherKey, { page: 1 });

		await hooks.invalidateQueries('GET /users', {
			query: { team: 'core' },
		} as never);
		expect(queryClient.getQueryState(teamKey)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);

		await hooks.invalidateQueries('GET /users');
		expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(true);
	});

	it('invalidates the whole cache', async () => {
		const queryClient = newClient();
		const hooks = createEndpointHooks<Paths>(recordingFetcher().fetcher, {
			queryClient,
		});
		queryClient.setQueryData(['anything'], 1);

		await hooks.invalidateAllQueries();

		expect(queryClient.getQueryState(['anything'])?.isInvalidated).toBe(true);
	});
});
