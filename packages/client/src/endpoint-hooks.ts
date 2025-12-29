import type {
  QueryClient,
  UseMutationOptions,
  UseQueryOptions,
} from '@tanstack/react-query';
import { useMutation, useQuery } from '@tanstack/react-query';
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
type UseQueryArgs<Paths, T extends QueryEndpoint<Paths>> =
  IsConfigRequired<Paths, T> extends true
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
  ) => ReturnType<
    typeof useQuery<ExtractEndpointResponse<Paths, T>, Error>
  >;

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
  ) => ReturnType<
    typeof useMutation<
      ExtractEndpointResponse<Paths, T>,
      Error,
      FilteredRequestConfig<Paths, T>
    >
  >;

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
        Omit<
          UseQueryOptions<ExtractEndpointResponse<Paths, T>, Error>,
          'queryKey' | 'queryFn'
        > | undefined,
      ];

      const queryKey = buildQueryKey(endpoint, config);

      const memoizedOptions = useMemo(
        () => ({
          queryKey,
          queryFn: () =>
            fetcher(
              endpoint as Parameters<typeof fetcher>[0],
              config as Parameters<typeof fetcher>[1],
            ),
          ...queryOptions,
        }),
        [
          queryKey.join(','),
          endpoint,
          JSON.stringify(config),
          JSON.stringify(queryOptions),
        ],
      );

      return useQuery<ExtractEndpointResponse<Paths, T>, Error>(memoizedOptions);
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
            fetcher(
              endpoint as Parameters<typeof fetcher>[0],
              config as Parameters<typeof fetcher>[1],
            ),
          ...mutationOptions,
        }),
        [endpoint, JSON.stringify(mutationOptions)],
      );

      return useMutation<
        ExtractEndpointResponse<Paths, T>,
        Error,
        FilteredRequestConfig<Paths, T>
      >(memoizedOptions);
    },

    buildQueryKey,
  };
}
