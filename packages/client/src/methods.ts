import type {
	ExtractEndpointResponse,
	ExtractMethod,
	FilteredRequestConfig,
	IsConfigRequired,
	TypedApiFunction,
	TypedEndpoint,
} from './types';

/** The HTTP methods a client offers as calls: `api.get(…)`, `api.post(…)`. */
export const CALL_METHODS = [
	'get',
	'post',
	'put',
	'patch',
	'delete',
	'options',
] as const;

export type CallMethod = (typeof CALL_METHODS)[number];

/**
 * The routes that answer `M` — only routes with a `POST` appear in `api.post`,
 * so a route that exists under another method is a type error, not a 405.
 */
export type RoutesFor<Paths, M extends CallMethod> = {
	[R in keyof Paths]: M extends ExtractMethod<Paths, R> ? R : never;
}[keyof Paths] &
	string;

/**
 * One method's call: `api.post('/users', { body })`.
 *
 * The second argument has only the keys the endpoint declares, and is required
 * exactly when something in it is — the same rule as `api('POST /users', …)`,
 * which this is sugar over.
 */
export type MethodCall<Paths, M extends CallMethod> = <
	R extends RoutesFor<Paths, M>,
>(
	route: R,
	...args: `${Uppercase<M>} ${R}` extends TypedEndpoint<Paths>
		? IsConfigRequired<Paths, `${Uppercase<M>} ${R}`> extends true
			? [config: FilteredRequestConfig<Paths, `${Uppercase<M>} ${R}`>]
			: [config?: FilteredRequestConfig<Paths, `${Uppercase<M>} ${R}`>]
		: never
) => Promise<ExtractEndpointResponse<Paths, `${Uppercase<M>} ${R}`>>;

export type MethodCalls<Paths> = {
	[M in CallMethod]: MethodCall<Paths, M>;
};

/** The method calls for a client, each delegating to `api('METHOD /route', …)`. */
export function methodCalls<Paths>(
	fn: TypedApiFunction<Paths>,
): MethodCalls<Paths> {
	const call =
		(method: CallMethod) =>
		(route: string, config?: unknown): Promise<unknown> =>
			(fn as (endpoint: string, config?: unknown) => Promise<unknown>)(
				`${method.toUpperCase()} ${route}`,
				config,
			);

	return Object.fromEntries(
		CALL_METHODS.map((method) => [method, call(method)]),
	) as unknown as MethodCalls<Paths>;
}
