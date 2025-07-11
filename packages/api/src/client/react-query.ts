import type {
  UseMutationOptions,
  UseQueryOptions,
} from '@tanstack/react-query';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createTypedFetcher } from './fetcher';
import type {
  ExtractEndpointResponse,
  FetcherOptions,
  FilteredRequestConfig,
  TypedEndpoint,
} from './types';

export interface TypedQueryClientOptions extends FetcherOptions {}

export class TypedQueryClient<Paths> {
  private fetcher: ReturnType<typeof createTypedFetcher<Paths>>;
  private options: TypedQueryClientOptions;

  constructor(options: TypedQueryClientOptions = {}) {
    this.fetcher = createTypedFetcher<Paths>(options);
    this.options = options;
  }

  useQuery<T extends TypedEndpoint<Paths>>(
    endpoint: T,
    config?: FilteredRequestConfig<Paths, T>,
    options?: Omit<
      UseQueryOptions<ExtractEndpointResponse<Paths, T>, Error>,
      'queryKey' | 'queryFn'
    >,
  ) {
    const queryKey = this.buildQueryKey(endpoint, config);

    return useQuery<ExtractEndpointResponse<Paths, T>, Error>({
      queryKey,
      queryFn: () => this.fetcher(endpoint, config),
      ...options,
    });
  }

  useMutation<T extends TypedEndpoint<Paths>>(
    endpoint: T,
    options?: Omit<
      UseMutationOptions<
        ExtractEndpointResponse<Paths, T>,
        Error,
        FilteredRequestConfig<Paths, T>
      >,
      'mutationFn'
    >,
  ) {
    return useMutation<
      ExtractEndpointResponse<Paths, T>,
      Error,
      FilteredRequestConfig<Paths, T>
    >({
      mutationFn: (config: FilteredRequestConfig<Paths, T>) =>
        this.fetcher(endpoint, config),
      ...options,
    });
  }

  private buildQueryKey<T extends TypedEndpoint<Paths>>(
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
export function useTypedQuery<Paths, T extends TypedEndpoint<Paths>>(
  client: TypedQueryClient<Paths>,
  endpoint: T,
  config?: FilteredRequestConfig<Paths, T>,
  options?: Omit<
    UseQueryOptions<ExtractEndpointResponse<Paths, T>, Error>,
    'queryKey' | 'queryFn'
  >,
) {
  return client.useQuery(endpoint, config, options);
}

export function useTypedMutation<Paths, T extends TypedEndpoint<Paths>>(
  client: TypedQueryClient<Paths>,
  endpoint: T,
  options?: Omit<
    UseMutationOptions<
      ExtractEndpointResponse<Paths, T>,
      Error,
      FilteredRequestConfig<Paths, T>
    >,
    'mutationFn'
  >,
) {
  return client.useMutation(endpoint, options);
}
