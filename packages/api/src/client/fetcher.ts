import type {
  EndpointString,
  ExtractEndpointResponse,
  FetcherOptions,
  FilteredRequestConfig,
  ParseEndpoint,
  TypedEndpoint,
} from './types';

export class TypedFetcher<Paths> {
  private baseURL: string;
  private defaultHeaders: Record<string, string>;
  private options: FetcherOptions;

  constructor(options: FetcherOptions = {}) {
    this.baseURL = options.baseURL || '';
    this.defaultHeaders = options.headers || {};
    this.options = options;
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
      Object.entries(config.query as Record<string, unknown>).forEach(
        ([key, value]) => {
          if (value !== undefined && value !== null) {
            queryParams.append(key, String(value));
          }
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
      let response = await fetch(`${this.baseURL}${url}`, requestConfig);

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
