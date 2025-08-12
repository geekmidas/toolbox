import type {
  UseInfiniteQueryOptions,
  UseMutationOptions,
  UseQueryOptions,
} from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { createTypedFetcher } from './fetcher';
import type {
  ExtractEndpointResponse,
  FetcherOptions,
  FilteredRequestConfig,
  MutationEndpoint,
  QueryEndpoint,
  TypedEndpoint,
} from './types';

export interface TypedQueryClientOptions extends FetcherOptions {}

export class TypedQueryClient<Paths> {
  private fetcher: ReturnType<typeof createTypedFetcher<Paths>>;

  constructor(options: TypedQueryClientOptions = {}) {
    this.fetcher = createTypedFetcher<Paths>(options);
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
    TData = ExtractEndpointResponse<Paths, T>,
    TPageParam = unknown,
  >(
    endpoint: T,
    options: Omit<
      UseInfiniteQueryOptions<TData, Response, TData, unknown[], TPageParam>,
      'queryKey' | 'queryFn' | 'getNextPageParam' | 'initialPageParam'
    > & {
      getNextPageParam: (
        lastPage: TData,
        allPages: TData[],
        lastPageParam: TPageParam,
        allPageParams: TPageParam[],
      ) => TPageParam | undefined;
      initialPageParam: TPageParam;
    },
    config?: FilteredRequestConfig<Paths, T>,
  ) {
    const queryKey = this.buildQueryKey(endpoint, config);

    return useInfiniteQuery<TData, Response, TData, unknown[], TPageParam>({
      queryKey,
      queryFn: ({ pageParam }) => {
        let mergedConfig = config;
        if (pageParam && config) {
          mergedConfig = {
            ...config,
            query: { ...(config as any).query, ...pageParam },
          } as any;
        } else if (pageParam && !config) {
          mergedConfig = { query: pageParam } as any;
        }
        return this.fetcher(endpoint, mergedConfig) as Promise<TData>;
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
  TData = ExtractEndpointResponse<Paths, T>,
  TPageParam = unknown,
>(
  client: TypedQueryClient<Paths>,
  endpoint: T,
  options: Omit<
    UseInfiniteQueryOptions<TData, Response, TData, unknown[], TPageParam>,
    'queryKey' | 'queryFn' | 'getNextPageParam' | 'initialPageParam'
  > & {
    getNextPageParam: (
      lastPage: TData,
      allPages: TData[],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined;
    initialPageParam: TPageParam;
  },
  config?: FilteredRequestConfig<Paths, T>,
) {
  return client.useInfiniteQuery(endpoint, options, config);
}
