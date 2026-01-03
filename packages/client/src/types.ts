export type OpenAPIRoutes<Paths> = keyof Paths;

type HttpMethod =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'head'
  | 'options';

export type ExtractMethod<Paths, Route extends OpenAPIRoutes<Paths>> = Extract<
  keyof Paths[Route],
  HttpMethod
>;

export type ExtractPathParams<
  Paths,
  Route extends OpenAPIRoutes<Paths>,
> = Paths[Route] extends {
  parameters?: { path?: infer P };
}
  ? P
  : never;

export type ExtractQueryParams<
  Paths,
  Route extends OpenAPIRoutes<Paths>,
  Method extends ExtractMethod<Paths, Route>,
> = Paths[Route][Method] extends { parameters?: { query?: infer Q } }
  ? Q
  : never;

export type ExtractRequestBody<
  Paths,
  Route extends OpenAPIRoutes<Paths>,
  Method extends ExtractMethod<Paths, Route>,
> = Paths[Route][Method] extends {
  requestBody?: { content?: { 'application/json'?: infer B } };
}
  ? B
  : never;

export type ExtractResponse<
  Paths,
  Route extends OpenAPIRoutes<Paths>,
  Method extends ExtractMethod<Paths, Route>,
> = Paths[Route][Method] extends {
  responses?: { 200?: { content?: { 'application/json'?: infer R } } };
}
  ? R
  : Paths[Route][Method] extends {
        responses?: { 201?: { content?: { 'application/json'?: infer R } } };
      }
    ? R
    : never;

export type RequestConfig<
  Paths,
  Route extends OpenAPIRoutes<Paths>,
  Method extends ExtractMethod<Paths, Route>,
> = {
  params?: ExtractPathParams<Paths, Route>;
  query?: ExtractQueryParams<Paths, Route, Method>;
  body?: ExtractRequestBody<Paths, Route, Method>;
  headers?: Record<string, string>;
};

export type EndpointString = `${Uppercase<string>} ${string}`;

// Generate all valid endpoint strings from OpenAPI paths
// Uses Extract with HttpMethod to filter out non-HTTP keys like 'parameters'
export type ValidEndpoint<Paths> = {
  [Route in keyof Paths]: {
    [Method in Extract<keyof Paths[Route], HttpMethod>]: `${Uppercase<
      string & Method
    >} ${string & Route}`;
  }[Extract<keyof Paths[Route], HttpMethod>];
}[keyof Paths];

// Helper type to get autocomplete for endpoint strings
export type TypedEndpoint<Paths> = ValidEndpoint<Paths> extends infer E
  ? E extends string
    ? E
    : never
  : never;

// Filter endpoints by HTTP method
export type FilterEndpointByMethod<
  Paths,
  Method extends string,
> = ValidEndpoint<Paths> extends infer E
  ? E extends `${Method} ${string}`
    ? E
    : never
  : never;

// Query endpoints (GET only)
export type QueryEndpoint<Paths> = FilterEndpointByMethod<Paths, 'GET'>;

// Mutation endpoints (POST, PATCH, PUT, DELETE)
export type MutationEndpoint<Paths> =
  | FilterEndpointByMethod<Paths, 'POST'>
  | FilterEndpointByMethod<Paths, 'PATCH'>
  | FilterEndpointByMethod<Paths, 'PUT'>
  | FilterEndpointByMethod<Paths, 'DELETE'>;

export type ParseEndpoint<T extends EndpointString> =
  T extends `${infer Method} ${infer Route}`
    ? { method: Lowercase<Method>; route: Route }
    : never;

export type ExtractEndpointResponse<
  Paths,
  T extends EndpointString,
> = T extends `${infer Method} ${infer Route}`
  ? Route extends OpenAPIRoutes<Paths>
    ? Lowercase<Method> extends ExtractMethod<Paths, Route>
      ? ExtractResponse<Paths, Route, Lowercase<Method>>
      : never
    : never
  : never;

export type ExtractEndpointConfig<
  Paths,
  T extends EndpointString,
> = T extends `${infer Method} ${infer Route}`
  ? Route extends OpenAPIRoutes<Paths>
    ? Lowercase<Method> extends ExtractMethod<Paths, Route>
      ? RequestConfig<Paths, Route, Lowercase<Method>>
      : never
    : never
  : never;

/**
 * Build a request config type where:
 * - `params` is required if the endpoint has path parameters
 * - `body` is required if the endpoint has a request body
 * - `query` and `headers` are always optional
 */
export type FilteredRequestConfig<
  Paths,
  T extends EndpointString,
> = T extends `${infer Method} ${infer Route}`
  ? Route extends OpenAPIRoutes<Paths>
    ? Lowercase<Method> extends ExtractMethod<Paths, Route>
      ? BuildRequestConfig<
          ExtractPathParams<Paths, Route>,
          ExtractQueryParams<Paths, Route, Lowercase<Method>>,
          ExtractRequestBody<Paths, Route, Lowercase<Method>>
        >
      : never
    : never
  : never;

/**
 * Helper to build request config with correct required/optional fields.
 * Uses [T] extends [never] pattern to prevent distribution over union types,
 * which would cause the entire type to become `never`.
 */
type BuildRequestConfig<TParams, TQuery, TBody> = SimplifyIntersection<
  // params: required if not never
  ([TParams] extends [never] ? {} : { params: TParams }) &
    // body: required if not never
    ([TBody] extends [never] ? {} : { body: TBody }) &
    // query: optional if not never
    ([TQuery] extends [never] ? {} : { query?: TQuery }) & {
      // headers: always optional
      headers?: Record<string, string>;
    }
>;

/**
 * Simplify intersection types for better IDE display
 */
type SimplifyIntersection<T> = { [K in keyof T]: T[K] };

/**
 * Check if the config object is required (has any required fields)
 */
export type IsConfigRequired<
  Paths,
  T extends EndpointString,
> = T extends `${infer Method} ${infer Route}`
  ? Route extends OpenAPIRoutes<Paths>
    ? Lowercase<Method> extends ExtractMethod<Paths, Route>
      ? ExtractPathParams<Paths, Route> extends never
        ? ExtractRequestBody<Paths, Route, Lowercase<Method>> extends never
          ? false
          : true
        : true
      : false
    : false
  : false;

/**
 * Typed function signature for the API client.
 * Config is required when endpoint has path params or body.
 */
export type TypedApiFunction<Paths> = <T extends TypedEndpoint<Paths>>(
  endpoint: T,
  ...args: IsConfigRequired<Paths, T> extends true
    ? [config: FilteredRequestConfig<Paths, T>]
    : [config?: FilteredRequestConfig<Paths, T>]
) => Promise<ExtractEndpointResponse<Paths, T>>;

export interface FetcherOptions {
  baseURL?: string;
  headers?: Record<string, string>;
  onRequest?: (config: RequestInit) => RequestInit | Promise<RequestInit>;
  onResponse?: (response: Response) => Response | Promise<Response>;
  onError?: (error: Error) => void | Promise<void>;
  fetch?: typeof fetch;
}
