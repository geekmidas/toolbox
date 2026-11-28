import type { JsonSuccessBody } from './responses';
import type { ClientTelemetryOptions } from './telemetry';

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

/**
 * The request headers an operation declares — `parameters.header` — keyed by
 * lower-case name; `never` when it declares none.
 */
export type ExtractHeaderParams<
	Paths,
	Route extends OpenAPIRoutes<Paths>,
	Method extends ExtractMethod<Paths, Route>,
> = Paths[Route][Method] extends { parameters?: { header?: infer H } }
	? // A missing `header` key infers as `unknown`.
		unknown extends H
		? never
		: H
	: never;

/**
 * The `headers` a request may send: the declared ones, typed, beside any
 * other the caller adds.
 */
type HeadersConfig<THeaders> = [THeaders] extends [never]
	? Record<string, string>
	: THeaders & Record<string, string>;

export type ExtractRequestBody<
	Paths,
	Route extends OpenAPIRoutes<Paths>,
	Method extends ExtractMethod<Paths, Route>,
> = RequestBodyOf<
	Paths[Route][Method],
	// `requestBody?:` is a body the endpoint does not require
	// (`required: false`): the caller may leave it out. Asked here, before the
	// operation is matched — inside that match it reads as required.
	'requestBody' extends keyof Paths[Route][Method]
		? IsOptionalKey<Paths[Route][Method], 'requestBody'>
		: false
>;

type RequestBodyOf<Op, Optional extends boolean> = Op extends {
	requestBody?: infer RB;
}
	? // An absent body is declared `requestBody?: never`, which reads as
		// `undefined` — and `undefined` matches `{ content?: … }` with `B`
		// inferred as `unknown`, so a GET accepted any body at all.
		[NonNullable<RB>] extends [never]
		? never
		: NonNullable<RB> extends { content?: { 'application/json'?: infer B } }
			? Optional extends true
				? B | undefined
				: B
			: never
	: never;

/**
 * Whether `K` is an optional key of `T`. Asked of `T` itself: `infer` on
 * `{ k?: infer X }` reads an optional key's type without its `undefined`.
 */
type IsOptionalKey<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;

/**
 * What a call resolves to: the JSON body of any 2xx the operation documents —
 * a union when it answers more than one (201 when it creates, 200 when a retry
 * returns the original). See `JsonSuccessBody`.
 */
export type ExtractResponse<
	Paths,
	Route extends OpenAPIRoutes<Paths>,
	Method extends ExtractMethod<Paths, Route>,
> = JsonSuccessBody<Paths[Route][Method]>;

export type RequestConfig<
	Paths,
	Route extends OpenAPIRoutes<Paths>,
	Method extends ExtractMethod<Paths, Route>,
> = {
	params?: ExtractPathParams<Paths, Route>;
	query?: ExtractQueryParams<Paths, Route, Method>;
	body?: ExtractRequestBody<Paths, Route, Method>;
	headers?: HeadersConfig<ExtractHeaderParams<Paths, Route, Method>>;
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
export type TypedEndpoint<Paths> =
	ValidEndpoint<Paths> extends infer E ? (E extends string ? E : never) : never;

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
 * - `query` is required if it has a required key, optional otherwise
 * - `headers` is required when it has a required key, optional otherwise
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
					ExtractRequestBody<Paths, Route, Lowercase<Method>>,
					ExtractHeaderParams<Paths, Route, Lowercase<Method>>
				>
			: never
		: never
	: never;

/**
 * Helper to build request config with correct required/optional fields.
 * Uses [T] extends [never] pattern to prevent distribution over union types,
 * which would cause the entire type to become `never`.
 */
type BuildRequestConfig<
	TParams,
	TQuery,
	TBody,
	THeaders = never,
> = SimplifyIntersection<
	// params: required if not never
	([TParams] extends [never] ? {} : { params: TParams }) &
		// body: required if not never, unless it may be left out
		([TBody] extends [never]
			? {}
			: undefined extends TBody
				? { body?: TBody }
				: { body: TBody }) &
		// query: required when it has a required key, optional otherwise
		([TQuery] extends [never]
			? {}
			: {} extends TQuery
				? { query?: TQuery }
				: { query: TQuery }) &
		// headers: required when a declared one is, and open to any other
		(HasRequiredHeaders<THeaders> extends true
			? { headers: HeadersConfig<THeaders> }
			: { headers?: HeadersConfig<THeaders> })
>;

/** Whether the request must send a declared header. */
type HasRequiredHeaders<THeaders> = [THeaders] extends [never]
	? false
	: {} extends THeaders
		? false
		: true;

/**
 * Simplify intersection types for better IDE display
 */
type SimplifyIntersection<T> = { [K in keyof T]: T[K] };

/** Whether a query has a key the caller must supply. */
type HasRequiredQuery<TQuery> = [TQuery] extends [never]
	? false
	: {} extends TQuery
		? false
		: true;

/** Whether a body is one the caller must send. */
type HasRequiredBody<TBody> = [TBody] extends [never]
	? false
	: undefined extends TBody
		? false
		: true;

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
				? HasRequiredBody<
						ExtractRequestBody<Paths, Route, Lowercase<Method>>
					> extends false
					? HasRequiredQuery<
							ExtractQueryParams<Paths, Route, Lowercase<Method>>
						> extends true
						? true
						: HasRequiredHeaders<
								ExtractHeaderParams<Paths, Route, Lowercase<Method>>
							>
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
	/**
	 * W3C trace context (`traceparent`, `tracestate`) on every request to
	 * `baseURL`'s origin — never another. Continues the active OpenTelemetry
	 * span when there is one; otherwise a trace per page view, sampled at
	 * `sampleRate`. Off unless set.
	 */
	telemetry?: boolean | ClientTelemetryOptions;
}

export type WrappedResult<T, E = unknown> =
	| { ok: true; data: T }
	| { ok: false; error: E };

export type ErrorTransformer<E> = (error: unknown) => E | Promise<E>;

export type WrappedApiFunction<Paths, E = unknown> = <
	T extends TypedEndpoint<Paths>,
>(
	endpoint: T,
	...args: IsConfigRequired<Paths, T> extends true
		? [config: FilteredRequestConfig<Paths, T>]
		: [config?: FilteredRequestConfig<Paths, T>]
) => Promise<WrappedResult<ExtractEndpointResponse<Paths, T>, E>>;
