import type {
  EndpointString,
  ExtractEndpointResponse,
  FetcherOptions,
  FilteredRequestConfig,
  ParseEndpoint,
  TypedEndpoint,
} from './types';

export type { FetcherOptions } from './types';

export class TypedFetcher<Paths> {
  private baseURL: string;
  private defaultHeaders: Record<string, string>;
  private options: FetcherOptions;
  private fetchFn: FetchFn;

  static getFetchFn(fn?: FetchFn): FetchFn {
    if (fn) {
      return fn;
    }

    if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
      return window.fetch.bind(window);
    }

    if (
      typeof globalThis !== 'undefined' &&
      typeof globalThis.fetch === 'function'
    ) {
      return globalThis.fetch.bind(globalThis);
    }

    throw new Error('No fetch implementation found');
  }

  constructor(options: FetcherOptions = {}) {
    this.baseURL = options.baseURL || '';
    this.defaultHeaders = options.headers || {};
    this.options = options;
    this.fetchFn = TypedFetcher.getFetchFn(options.fetch);
  }

  async request<T extends TypedEndpoint<Paths>>(
    endpoint: T,
    config?: FilteredRequestConfig<Paths, T>,
  ): Promise<ExtractEndpointResponse<Paths, T>> {
    const { method, route } = this.parseEndpoint(endpoint);

    // Replace path parameters
    let url = route;
    if (config && 'params' in config && config.params) {
      Object.entries(config.params as Record<string, unknown>).forEach(
        ([key, value]) => {
          url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
        },
      );
    }

    // Add query parameters
    if (config && 'query' in config && config.query) {
      const queryParams = new URLSearchParams();

      // Recursive function to handle nested objects and arrays
      const appendQueryParam = (prefix: string, value: unknown) => {
        if (value === undefined || value === null) {
          return;
        }

        if (Array.isArray(value)) {
          // Handle arrays by appending multiple values with the same key
          value.forEach((item) => {
            queryParams.append(prefix, String(item));
          });
        } else if (typeof value === 'object') {
          // For objects, recursively flatten into dot notation
          Object.entries(value as Record<string, unknown>).forEach(
            ([subKey, subValue]) => {
              appendQueryParam(`${prefix}.${subKey}`, subValue);
            },
          );
        } else {
          queryParams.append(prefix, String(value));
        }
      };

      // Process all query parameters
      Object.entries(config.query as Record<string, unknown>).forEach(
        ([key, value]) => {
          appendQueryParam(key, value);
        },
      );

      const queryString = queryParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    // Build request configuration
    let requestConfig: RequestInit = {
      method: method.toUpperCase(),
      headers: {
        ...this.defaultHeaders,
        ...((config && 'headers' in config && config.headers) || {}),
      },
    };

    // Add body if present
    if (config && 'body' in config && config.body) {
      requestConfig.body = JSON.stringify(config.body);
      requestConfig.headers = {
        ...requestConfig.headers,
        'Content-Type': 'application/json',
      };
    }

    // Apply request interceptor
    if (this.options.onRequest) {
      requestConfig = await this.options.onRequest(requestConfig);
    }

    try {
      // Make the request
      let response = await this.fetchFn(`${this.baseURL}${url}`, requestConfig);

      // Apply response interceptor
      if (this.options.onResponse) {
        response = await this.options.onResponse(response);
      }

      // Handle errors
      if (!response.ok) {
        throw response;
      }

      // Handle empty responses (204 No Content, etc.)
      if (
        response.status === 204 ||
        response.headers.get('content-length') === '0'
      ) {
        return undefined as ExtractEndpointResponse<Paths, T>;
      }

      // Parse JSON response
      const data = await response.json();
      return data as ExtractEndpointResponse<Paths, T>;
    } catch (error) {
      // Apply error handler
      if (this.options.onError) {
        // @ts-ignore
        await this.options.onError(error);
      }
      throw error;
    }
  }

  private parseEndpoint<T extends EndpointString>(
    endpoint: T,
  ): ParseEndpoint<T> {
    const [method, ...routeParts] = endpoint.split(' ');
    const route = routeParts.join(' ');
    return { method: method.toLowerCase(), route } as ParseEndpoint<T>;
  }
}

export function createTypedFetcher<Paths>(options?: FetcherOptions) {
  const fetcher = new TypedFetcher<Paths>(options);
  return <T extends TypedEndpoint<Paths>>(
    endpoint: T,
    config?: FilteredRequestConfig<Paths, T>,
  ) => fetcher.request(endpoint, config);
}

export type FetchFn = typeof fetch;
