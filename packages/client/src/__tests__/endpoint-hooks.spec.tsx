/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
// biome-ignore lint/style/useImportType: needed for JSX
import React, { createElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEndpointHooks } from '../endpoint-hooks';
import type { TypedApiFunction } from '../types';
import { server } from './setup';

// Test API paths type
interface TestPaths {
	'/health': {
		get: {
			responses: {
				200: {
					content: {
						'application/json': { status: string };
					};
				};
			};
		};
	};
	'/users/{id}': {
		parameters: {
			path: { id: string };
		};
		get: {
			responses: {
				200: {
					content: {
						'application/json': { id: string; name: string };
					};
				};
			};
		};
	};
	'/users': {
		get: {
			parameters: {
				query: { limit?: number; offset?: number };
			};
			responses: {
				200: {
					content: {
						'application/json': Array<{ id: string; name: string }>;
					};
				};
			};
		};
		post: {
			requestBody: {
				content: {
					'application/json': { name: string; email: string };
				};
			};
			responses: {
				201: {
					content: {
						'application/json': { id: string; name: string; email: string };
					};
				};
			};
		};
	};
	'/posts/{postId}/comments': {
		parameters: {
			path: { postId: string };
		};
		post: {
			requestBody: {
				content: {
					'application/json': { content: string };
				};
			};
			responses: {
				201: {
					content: {
						'application/json': { id: string; postId: string; content: string };
					};
				};
			};
		};
	};
}

// Create a mock fetcher
function createMockFetcher(): TypedApiFunction<TestPaths> {
	return async (endpoint: string, config?: any) => {
		const [method, path] = endpoint.split(' ');
		let url = `https://api.example.com${path}`;

		// Replace path params
		if (config?.params) {
			for (const [key, value] of Object.entries(config.params)) {
				url = url.replace(`{${key}}`, value as string);
			}
		}

		// Add query params
		if (config?.query) {
			const searchParams = new URLSearchParams();
			for (const [key, value] of Object.entries(config.query)) {
				if (value !== undefined) {
					searchParams.set(key, String(value));
				}
			}
			if (searchParams.toString()) {
				url += `?${searchParams.toString()}`;
			}
		}

		const response = await fetch(url, {
			method,
			headers: {
				'Content-Type': 'application/json',
				...config?.headers,
			},
			body: config?.body ? JSON.stringify(config.body) : undefined,
		});

		return response.json();
	};
}

// Test wrapper with QueryClient
function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	});

	return ({ children }: { children: React.ReactNode }) =>
		createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('createEndpointHooks', () => {
	beforeEach(() => {
		// Add test-specific handlers
		server.use(
			http.get('https://api.example.com/health', () => {
				return HttpResponse.json({ status: 'ok' });
			}),
			http.get('https://api.example.com/posts/:postId/comments', () => {
				return HttpResponse.json([{ id: 'c1', content: 'Test comment' }]);
			}),
			http.post(
				'https://api.example.com/posts/:postId/comments',
				async ({ params, request }) => {
					const body = (await request.json()) as { content: string };
					return HttpResponse.json(
						{
							id: 'comment-1',
							postId: params.postId as string,
							content: body.content,
						},
						{ status: 201 },
					);
				},
			),
		);
	});

	describe('useQuery', () => {
		it('should fetch data for endpoint without params', async () => {
			const fetcher = createMockFetcher();
			const hooks = createEndpointHooks<TestPaths>(fetcher);

			const { result } = renderHook(() => hooks.useQuery('GET /health'), {
				wrapper: createWrapper(),
			});

			await waitFor(() => expect(result.current.isSuccess).toBe(true));

			expect(result.current.data).toEqual({ status: 'ok' });
		});

		it('should fetch data for endpoint with path params', async () => {
			const fetcher = createMockFetcher();
			const hooks = createEndpointHooks<TestPaths>(fetcher);

			const { result } = renderHook(
				() => hooks.useQuery('GET /users/{id}', { params: { id: '123' } }),
				{ wrapper: createWrapper() },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));

			// Uses mock from setup.ts which returns { id, name: 'John Doe', email: ... }
			expect(result.current.data).toMatchObject({
				id: '123',
				name: 'John Doe',
			});
		});

		it('should pass query options to useQuery', async () => {
			const fetcher = createMockFetcher();
			const hooks = createEndpointHooks<TestPaths>(fetcher);

			const { result } = renderHook(
				() => hooks.useQuery('GET /health', undefined, { enabled: false }),
				{ wrapper: createWrapper() },
			);

			// Should not fetch because enabled: false
			expect(result.current.isLoading).toBe(false);
			expect(result.current.isFetching).toBe(false);
			expect(result.current.data).toBeUndefined();
		});
	});

	describe('useMutation', () => {
		it('should mutate data for POST endpoint', async () => {
			const fetcher = createMockFetcher();
			const hooks = createEndpointHooks<TestPaths>(fetcher);

			const { result } = renderHook(() => hooks.useMutation('POST /users'), {
				wrapper: createWrapper(),
			});

			result.current.mutate({ body: { name: 'John', email: 'john@test.com' } });

			await waitFor(() => expect(result.current.isSuccess).toBe(true));

			// Uses mock from setup.ts
			expect(result.current.data).toMatchObject({
				id: '123',
				name: 'John',
				email: 'john@test.com',
			});
		});

		it('should mutate data for endpoint with params and body', async () => {
			const fetcher = createMockFetcher();
			const hooks = createEndpointHooks<TestPaths>(fetcher);

			const { result } = renderHook(
				() => hooks.useMutation('POST /posts/{postId}/comments'),
				{ wrapper: createWrapper() },
			);

			result.current.mutate({
				params: { postId: 'post-123' },
				body: { content: 'Great post!' },
			});

			await waitFor(() => expect(result.current.isSuccess).toBe(true));

			expect(result.current.data).toEqual({
				id: 'comment-1',
				postId: 'post-123',
				content: 'Great post!',
			});
		});

		it('should pass mutation options', async () => {
			const fetcher = createMockFetcher();
			const hooks = createEndpointHooks<TestPaths>(fetcher);

			let onSuccessCalled = false;

			const { result } = renderHook(
				() =>
					hooks.useMutation('POST /users', {
						onSuccess: () => {
							onSuccessCalled = true;
						},
					}),
				{ wrapper: createWrapper() },
			);

			result.current.mutate({ body: { name: 'Jane', email: 'jane@test.com' } });

			await waitFor(() => expect(result.current.isSuccess).toBe(true));

			expect(onSuccessCalled).toBe(true);
		});
	});

	describe('buildQueryKey', () => {
		it('should build key with just endpoint', () => {
			const fetcher = createMockFetcher();
			const hooks = createEndpointHooks<TestPaths>(fetcher);

			const key = hooks.buildQueryKey('GET /health');

			expect(key).toEqual(['GET /health']);
		});

		it('should build key with params', () => {
			const fetcher = createMockFetcher();
			const hooks = createEndpointHooks<TestPaths>(fetcher);

			const key = hooks.buildQueryKey('GET /users/{id}', {
				params: { id: '123' },
			});

			expect(key).toEqual(['GET /users/{id}', { params: { id: '123' } }]);
		});

		it('should build key with both params and query', () => {
			const fetcher = createMockFetcher();
			const hooks = createEndpointHooks<TestPaths>(fetcher);

			// Using a hypothetical endpoint that has both
			const key = hooks.buildQueryKey(
				'GET /users/{id}' as any,
				{
					params: { id: '123' },
					query: { include: 'posts' },
				} as any,
			);

			expect(key).toEqual([
				'GET /users/{id}',
				{ params: { id: '123' } },
				{ query: { include: 'posts' } },
			]);
		});
	});

	describe('type enforcement', () => {
		it('should allow optional config for endpoints without required fields', () => {
			const fetcher = createMockFetcher();
			const hooks = createEndpointHooks<TestPaths>(fetcher);

			// This should compile - config is optional for GET /health
			renderHook(() => hooks.useQuery('GET /health'), {
				wrapper: createWrapper(),
			});

			// This should also compile - providing optional config
			renderHook(() => hooks.useQuery('GET /health', {}), {
				wrapper: createWrapper(),
			});
		});

		it('should require config for endpoints with path params', async () => {
			const fetcher = createMockFetcher();
			const hooks = createEndpointHooks<TestPaths>(fetcher);

			// Config with params is required for GET /users/{id}
			const { result } = renderHook(
				() => hooks.useQuery('GET /users/{id}', { params: { id: '456' } }),
				{ wrapper: createWrapper() },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(result.current.data?.id).toBe('456');
		});

		it('should require body in mutation config for POST endpoints', async () => {
			const fetcher = createMockFetcher();
			const hooks = createEndpointHooks<TestPaths>(fetcher);

			const { result } = renderHook(() => hooks.useMutation('POST /users'), {
				wrapper: createWrapper(),
			});

			// Body is required in mutate() for POST /users
			result.current.mutate({
				body: { name: 'Test', email: 'test@test.com' },
			});

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
		});
	});
});
