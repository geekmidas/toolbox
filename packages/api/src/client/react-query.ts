import type {
  QueryClient,
  UseInfiniteQueryOptions,
  UseMutationOptions,
  UseQueryOptions,
} from '@tanstack/react-query';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createTypedFetcher } from './fetcher';
import type {
  ExtractEndpointResponse,
  FetcherOptions,
  FilteredRequestConfig,
  MutationEndpoint,
  QueryEndpoint,
  TypedEndpoint,
} from './types';

export interface TypedQueryClientOptions extends FetcherOptions {
  queryClient?: QueryClient;
}

export class TypedQueryClient<Paths> {
  private fetcher: ReturnType<typeof createTypedFetcher<Paths>>;
  private queryClient?: QueryClient;

  constructor(options: TypedQueryClientOptions = {}) {
    this.fetcher = createTypedFetcher<Paths>(options);
    this.queryClient = options.queryClient;
  }

  useQuery<T extends QueryEndpoint<Paths>>(
    endpoint: T,
    config?: FilteredRequestConfig<Paths, T>,
    options?: Omit<
      UseQueryOptions<ExtractEndpointResponse<Paths, T>, Response>,
      'queryKey' | 'queryFn'
    >,
  ) {
    const queryKey = this.buildQueryKey(endpoint, config);

    return useQuery<ExtractEndpointResponse<Paths, T>, Response>({
      queryKey,
      queryFn: () => this.fetcher(endpoint, config),
      ...options,
    });
  }

  useMutation<T extends MutationEndpoint<Paths>>(
    endpoint: T,
    options?: Omit<
      UseMutationOptions<
        ExtractEndpointResponse<Paths, T>,
        Response,
        FilteredRequestConfig<Paths, T>
      >,
      'mutationFn'
    >,
  ) {
    return useMutation<
      ExtractEndpointResponse<Paths, T>,
      Response,
      FilteredRequestConfig<Paths, T>
    >({
      mutationFn: (config: FilteredRequestConfig<Paths, T>) =>
        this.fetcher(endpoint, config),
      ...options,
    });
  }

  useInfiniteQuery<
    T extends QueryEndpoint<Paths>,
    TPageData = ExtractEndpointResponse<Paths, T>,
    TPageParam = unknown,
  >(
    endpoint: T,
    options: Omit<
      UseInfiniteQueryOptions<
        TPageData,
        Response,
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
  ) {
    const queryKey = this.buildQueryKey(endpoint, config);

    return useInfiniteQuery<
      TPageData,
      Response,
      { pages: TPageData[]; pageParams: TPageParam[] },
      unknown[],
      TPageParam
    >({
      queryKey,
      queryFn: ({ pageParam }) => {
        let mergedConfig = config;
        if (pageParam !== undefined && config) {
          // If pageParam is an object, spread it into query
          const pageQuery =
            typeof pageParam === 'object' ? pageParam : { page: pageParam };
          mergedConfig = {
            ...config,
            query: { ...(config as any).query, ...pageQuery },
          } as any;
        } else if (pageParam !== undefined && !config) {
          // If pageParam is an object, use it directly, otherwise wrap in page property
          const pageQuery =
            typeof pageParam === 'object' ? pageParam : { page: pageParam };
          mergedConfig = { query: pageQuery } as any;
        }
        return this.fetcher(endpoint, mergedConfig) as Promise<TPageData>;
      },
      ...options,
    });
  }

  buildQueryKey<T extends TypedEndpoint<Paths>>(
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
   * Invalidate queries for a specific endpoint with optional config
   * @param endpoint - The endpoint to invalidate (e.g., 'GET /users')
   * @param config - Optional params/query to match specific queries
   * @returns Promise that resolves when invalidation is complete
   */
  invalidateQueries<T extends QueryEndpoint<Paths>>(
    endpoint: T,
    config?: FilteredRequestConfig<Paths, T>,
  ): Promise<void> {
    const queryClient = this.getQueryClient();
    const queryKey = this.buildQueryKey(endpoint, config);

    return queryClient.invalidateQueries({
      queryKey,
      exact: !!config, // Use exact matching if config is provided
    });
  }

  /**
   * Invalidate all queries in the cache
   * @returns Promise that resolves when invalidation is complete
   */
  invalidateAllQueries(): Promise<void> {
    const queryClient = this.getQueryClient();
    return queryClient.invalidateQueries();
  }

  /**
   * Get the underlying QueryClient instance
   * @returns The QueryClient instance
   */
  getQueryClient(): QueryClient {
    if (this.queryClient) {
      return this.queryClient;
    }

    // If no query client was provided, try to get it from context
    // This will throw if used outside of QueryClientProvider
    throw new Error(
      'No QueryClient set, please provide a QueryClient via the queryClient option or ensure you are within a QueryClientProvider',
    );
  }

  /**
   * Set the QueryClient instance
   * @param queryClient - The QueryClient instance to use
   */
  setQueryClient(queryClient: QueryClient): void {
    this.queryClient = queryClient;
  }
}

export function createTypedQueryClient<Paths>(
  options?: TypedQueryClientOptions,
) {
  return new TypedQueryClient<Paths>(options);
}

// Hook exports for convenience
export function useTypedQuery<Paths, T extends QueryEndpoint<Paths>>(
  client: TypedQueryClient<Paths>,
  endpoint: T,
  config?: FilteredRequestConfig<Paths, T>,
  options?: Omit<
    UseQueryOptions<ExtractEndpointResponse<Paths, T>, Response>,
    'queryKey' | 'queryFn'
  >,
) {
  return client.useQuery(endpoint, config, options);
}

export function useTypedMutation<Paths, T extends MutationEndpoint<Paths>>(
  client: TypedQueryClient<Paths>,
  endpoint: T,
  options?: Omit<
    UseMutationOptions<
      ExtractEndpointResponse<Paths, T>,
      Response,
      FilteredRequestConfig<Paths, T>
    >,
    'mutationFn'
  >,
) {
  return client.useMutation(endpoint, options);
}

export function useTypedInfiniteQuery<
  Paths,
  T extends QueryEndpoint<Paths>,
  TPageData = ExtractEndpointResponse<Paths, T>,
  TPageParam = unknown,
>(
  client: TypedQueryClient<Paths>,
  endpoint: T,
  options: Omit<
    UseInfiniteQueryOptions<
      TPageData,
      Response,
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
) {
  return client.useInfiniteQuery(endpoint, options, config);
}

/**
 * Hook to invalidate queries using the current QueryClient from context
 */
export function useTypedInvalidateQueries<Paths>(
  client: TypedQueryClient<Paths>,
) {
  const queryClient = useQueryClient();

  return {
    /**
     * Invalidate queries for a specific endpoint
     */
    invalidateQueries: <T extends QueryEndpoint<Paths>>(
      endpoint: T,
      config?: FilteredRequestConfig<Paths, T>,
    ) => {
      const queryKey = client.buildQueryKey(endpoint, config);
      return queryClient.invalidateQueries({
        queryKey,
        exact: !!config,
      });
    },

    /**
     * Invalidate all queries
     */
    invalidateAllQueries: () => {
      return queryClient.invalidateQueries();
    },
  };
}
