export type OpenAPIRoutes<Paths> = keyof Paths;

export type ExtractMethod<
  Paths,
  Route extends OpenAPIRoutes<Paths>,
> = keyof Paths[Route];

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

// Filter out methods that are never to avoid showing them in autocomplete
// This handles both explicit never and optional never (?: never)
type FilterNeverMethods<T> = {
  [K in keyof T as T[K] extends never | undefined
    ? never
    : K]: T[K] extends undefined ? never : T[K];
};

// Generate all valid endpoint strings from OpenAPI paths
export type ValidEndpoint<Paths> = {
  [Route in keyof Paths]: {
    [Method in keyof FilterNeverMethods<Paths[Route]>]: `${Uppercase<
      string & Method
    >} ${string & Route}`;
  }[keyof FilterNeverMethods<Paths[Route]>];
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

export type FilteredRequestConfig<Paths, T extends EndpointString> = {
  [K in keyof ExtractEndpointConfig<Paths, T> as ExtractEndpointConfig<
    Paths,
    T
  >[K] extends never | undefined
    ? never
    : K]: ExtractEndpointConfig<Paths, T>[K];
};

export interface FetcherOptions {
  baseURL?: string;
  headers?: Record<string, string>;
  onRequest?: (config: RequestInit) => RequestInit | Promise<RequestInit>;
  onResponse?: (response: Response) => Response | Promise<Response>;
  onError?: (error: Error) => void | Promise<void>;
  fetch?: typeof fetch;
}
