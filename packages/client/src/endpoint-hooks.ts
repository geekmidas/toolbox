import type {
	QueryClient,
	QueryFunctionContext,
	UseInfiniteQueryOptions,
	UseInfiniteQueryResult,
	UseMutationOptions,
	UseMutationResult,
	UseQueryOptions,
	UseQueryResult,
} from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type {
	ExtractEndpointResponse,
	FilteredRequestConfig,
	IsConfigRequired,
	MutationEndpoint,
	QueryEndpoint,
	TypedApiFunction,
} from './types';

/**
 * Build query key from endpoint and config
 */
function buildQueryKey<Paths, T extends QueryEndpoint<Paths>>(
	endpoint: T,
	config?: FilteredRequestConfig<Paths, T>,
): unknown[] {
	const key: unknown[] = [endpoint];

	if (config && 'params' in config && config.params) {
		key.push({ params: config.params });
	}

	if (config && 'query' in config && config.query) {
		key.push({ query: config.query });
	}

	return key;
}

/**
 * Options for creating endpoint-based hooks
 */
export interface CreateEndpointHooksOptions {
	queryClient?: QueryClient;
}

/**
 * Hook options type that conditionally requires config
 */
type UseQueryArgs<Paths, T extends QueryEndpoint<Paths>> = IsConfigRequired<
	Paths,
	T
> extends true
	? [
			config: FilteredRequestConfig<Paths, T>,
			options?: Omit<
				UseQueryOptions<ExtractEndpointResponse<Paths, T>, Error>,
				'queryKey' | 'queryFn'
			>,
		]
	: [
			config?: FilteredRequestConfig<Paths, T>,
			options?: Omit<
				UseQueryOptions<ExtractEndpointResponse<Paths, T>, Error>,
				'queryKey' | 'queryFn'
			>,
		];

/**
 * Endpoint-based React Query hooks
 */
export interface EndpointHooks<Paths> {
	/**
	 * Use query hook for GET endpoints.
	 * Config is required when endpoint has path params.
	 */
	useQuery: <T extends QueryEndpoint<Paths>>(
		endpoint: T,
		...args: UseQueryArgs<Paths, T>
	) => UseQueryResult<ExtractEndpointResponse<Paths, T>, Error>;

	/**
	 * Use mutation hook for POST, PUT, PATCH, DELETE endpoints.
	 * Config with params/body is passed to mutate().
	 */
	useMutation: <T extends MutationEndpoint<Paths>>(
		endpoint: T,
		options?: Omit<
			UseMutationOptions<
				ExtractEndpointResponse<Paths, T>,
				Error,
				FilteredRequestConfig<Paths, T>
			>,
			'mutationFn'
		>,
	) => UseMutationResult<
		ExtractEndpointResponse<Paths, T>,
		Error,
		FilteredRequestConfig<Paths, T>
	>;

	/**
	 * Use infinite query hook for paginated GET endpoints.
	 */
	useInfiniteQuery: <
		T extends QueryEndpoint<Paths>,
		TPageData = ExtractEndpointResponse<Paths, T>,
		TPageParam = unknown,
	>(
		endpoint: T,
		options: Omit<
			UseInfiniteQueryOptions<
				TPageData,
				Error,
				{ pages: TPageData[]; pageParams: TPageParam[] },
				unknown[],
				TPageParam
			>,
			'queryKey' | 'queryFn' | 'getNextPageParam' | 'initialPageParam'
		> & {
			getNextPageParam: (
				lastPage: TPageData,
				allPages: TPageData[],
				lastPageParam: TPageParam,
				allPageParams: TPageParam[],
			) => TPageParam | undefined;
			initialPageParam: TPageParam;
		},
		config?: FilteredRequestConfig<Paths, T>,
	) => UseInfiniteQueryResult<
		{ pages: TPageData[]; pageParams: TPageParam[] },
		Error
	>;

	/**
	 * Invalidate queries for a specific endpoint.
	 */
	invalidateQueries: <T extends QueryEndpoint<Paths>>(
		endpoint: T,
		config?: FilteredRequestConfig<Paths, T>,
	) => Promise<void>;

	/**
	 * Invalidate all queries in the cache.
	 */
	invalidateAllQueries: () => Promise<void>;

	/**
	 * Build a query key for manual cache operations
	 */
	buildQueryKey: <T extends QueryEndpoint<Paths>>(
		endpoint: T,
		config?: FilteredRequestConfig<Paths, T>,
	) => unknown[];
}

/**
 * Create endpoint-based React Query hooks from a typed fetcher.
 *
 * @example
 * ```typescript
 * const fetcher = createAuthAwareFetcher<paths>({ ... });
 * const hooks = createEndpointHooks<paths>(fetcher);
 *
 * // In a component
 * const { data } = hooks.useQuery('GET /users/{id}', { params: { id: '123' } });
 *
 * const mutation = hooks.useMutation('POST /users');
 * await mutation.mutateAsync({ body: { name: 'John' } });
 * ```
 */
export function createEndpointHooks<Paths>(
	fetcher: TypedApiFunction<Paths>,
	options: CreateEndpointHooksOptions = {},
): EndpointHooks<Paths> {
	return {
		useQuery: <T extends QueryEndpoint<Paths>>(
			endpoint: T,
			...args: UseQueryArgs<Paths, T>
		) => {
			// Parse args - config is first, options is second
			const [config, queryOptions] = args as [
				FilteredRequestConfig<Paths, T> | undefined,
				(
					| Omit<
							UseQueryOptions<ExtractEndpointResponse<Paths, T>, Error>,
							'queryKey' | 'queryFn'
					  >
					| undefined
				),
			];

			const queryKey = buildQueryKey(endpoint, config);

			const memoizedOptions = useMemo(
				() => ({
					queryKey,
					queryFn: () =>
						// Type assertion needed due to complex conditional types
						(
							fetcher as (
								endpoint: T,
								config?: unknown,
							) => Promise<ExtractEndpointResponse<Paths, T>>
						)(endpoint, config),
					...queryOptions,
				}),
				[endpoint, config, fetcher, queryKey, queryOptions],
			);

			return useQuery<ExtractEndpointResponse<Paths, T>, Error>(
				memoizedOptions,
			);
		},

		useMutation: <T extends MutationEndpoint<Paths>>(
			endpoint: T,
			mutationOptions?: Omit<
				UseMutationOptions<
					ExtractEndpointResponse<Paths, T>,
					Error,
					FilteredRequestConfig<Paths, T>
				>,
				'mutationFn'
			>,
		) => {
			const memoizedOptions = useMemo(
				() => ({
					mutationFn: (config: FilteredRequestConfig<Paths, T>) =>
						// Type assertion needed due to complex conditional types
						(
							fetcher as (
								endpoint: T,
								config?: unknown,
							) => Promise<ExtractEndpointResponse<Paths, T>>
						)(endpoint, config),
					...mutationOptions,
				}),
				[endpoint, fetcher, mutationOptions],
			);

			return useMutation<
				ExtractEndpointResponse<Paths, T>,
				Error,
				FilteredRequestConfig<Paths, T>
			>(memoizedOptions);
		},

		useInfiniteQuery: <
			T extends QueryEndpoint<Paths>,
			TPageData = ExtractEndpointResponse<Paths, T>,
			TPageParam = unknown,
		>(
			endpoint: T,
			options: Omit<
				UseInfiniteQueryOptions<
					TPageData,
					Error,
					{ pages: TPageData[]; pageParams: TPageParam[] },
					unknown[],
					TPageParam
				>,
				'queryKey' | 'queryFn' | 'getNextPageParam' | 'initialPageParam'
			> & {
				getNextPageParam: (
					lastPage: TPageData,
					allPages: TPageData[],
					lastPageParam: TPageParam,
					allPageParams: TPageParam[],
				) => TPageParam | undefined;
				initialPageParam: TPageParam;
			},
			config?: FilteredRequestConfig<Paths, T>,
		) => {
			const queryKey = buildQueryKey(endpoint, config);

			const memoizedOptions = useMemo(
				() => ({
					queryKey,
					queryFn: ({
						pageParam,
					}: QueryFunctionContext<unknown[], TPageParam>) => {
						let mergedConfig = config;
						if (pageParam !== undefined && config) {
							const pageQuery =
								typeof pageParam === 'object' ? pageParam : { page: pageParam };
							mergedConfig = {
								...config,
								query: { ...(config as any).query, ...pageQuery },
							} as any;
						} else if (pageParam !== undefined && !config) {
							const pageQuery =
								typeof pageParam === 'object' ? pageParam : { page: pageParam };
							mergedConfig = { query: pageQuery } as any;
						}
						return (
							fetcher as (
								endpoint: T,
								config?: unknown,
							) => Promise<ExtractEndpointResponse<Paths, T>>
						)(endpoint, mergedConfig) as Promise<TPageData>;
					},
					...options,
				}),
				[endpoint, config, fetcher, queryKey, options],
			);

			return useInfiniteQuery<
				TPageData,
				Error,
				{ pages: TPageData[]; pageParams: TPageParam[] },
				unknown[],
				TPageParam
			>(memoizedOptions);
		},

		invalidateQueries: <T extends QueryEndpoint<Paths>>(
			endpoint: T,
			config?: FilteredRequestConfig<Paths, T>,
		) => {
			if (!options.queryClient) {
				throw new Error(
					'queryClient is required for invalidateQueries. Pass it to createEndpointHooks options.',
				);
			}
			const queryKey = buildQueryKey(endpoint, config);
			return options.queryClient.invalidateQueries({
				queryKey,
				exact: !!config,
			});
		},

		invalidateAllQueries: () => {
			if (!options.queryClient) {
				throw new Error(
					'queryClient is required for invalidateAllQueries. Pass it to createEndpointHooks options.',
				);
			}
			return options.queryClient.invalidateQueries();
		},

		buildQueryKey,
	};
}
