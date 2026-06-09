import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import type { MiddlewareObj } from '@middy/core';
import type { Context } from 'aws-lambda';
import { enterRequestContext, exitRequestContext } from './context';
import { ServiceDiscovery, type ServiceRecord } from './ServiceDiscovery';
import type { Service } from './types';

/**
 * Middy middleware helpers that bring `@geekmidas/services` request context and
 * service discovery to **standalone** Middy Lambda handlers — i.e. functions
 * that aren't built with the `@geekmidas/constructs` Function/Cron constructs
 * but still want `serviceContext.getLogger()` and resolved services.
 *
 * Why middleware (and not `runWithRequestContext`)? Middy runs `before → handler
 * → after` as sequential awaits in a single async context, so establishing the
 * context with `AsyncLocalStorage.enterWith` (via `enterRequestContext`) in a
 * `before` hook propagates to the handler. `after`/`onError` reset it.
 *
 * Teardown is best-effort: like `enterRequestContext`, the reset is observable
 * to code the handler reaches but not necessarily to the frame that invoked the
 * Middy handler. This is fine for Lambda, where each invocation runs in its own
 * fresh async context — `requestContext` always establishes a brand-new context
 * per invocation, so requests never inherit a previous invocation's logger.
 *
 * @module
 */

/**
 * Options for {@link requestContext}. Generic over the logger type so a custom
 * logger that extends {@link Logger} is preserved rather than widened.
 */
export interface RequestContextOptions<TLogger extends Logger = Logger> {
	/**
	 * Logger to derive the per-request child logger from. Required — the caller
	 * decides which logger to use (there is no implicit default).
	 */
	logger: TLogger;
	/**
	 * Derive the request id from the event/context.
	 * Defaults to `context.awsRequestId` (always present in a Lambda invocation).
	 */
	getRequestId?: (event: unknown, context: Context) => string;
	/**
	 * Extra bindings to attach to the per-request child logger.
	 */
	bindings?: (event: unknown, context: Context) => Record<string, unknown>;
}

/**
 * Options for {@link addServices} — how services are resolved. No logger is
 * needed because resolving services doesn't establish a request context.
 */
export interface ServiceResolverOptions {
	/**
	 * Environment parser used to build the {@link ServiceDiscovery}. Required —
	 * the caller supplies the parser (there is no implicit `process.env` default).
	 */
	envParser: EnvironmentParser<{}>;
	/**
	 * Explicit {@link ServiceDiscovery} to resolve services from. Takes
	 * precedence over `envParser`.
	 */
	serviceDiscovery?: ServiceDiscovery;
}

/**
 * Options for {@link withServices}: request context (logger) + service resolution.
 */
export type ServiceMiddlewareOptions<TLogger extends Logger = Logger> =
	RequestContextOptions<TLogger> & ServiceResolverOptions;

function deriveRequestId(
	options: RequestContextOptions,
	event: unknown,
	context: Context,
): string {
	// Lambda always populates context.awsRequestId; getRequestId can override it.
	return options.getRequestId?.(event, context) ?? context.awsRequestId;
}

function buildLogger(
	baseLogger: Logger,
	options: RequestContextOptions,
	requestId: string,
	event: unknown,
	context: Context,
): Logger {
	return baseLogger.child({
		requestId,
		...(options.bindings?.(event, context) ?? {}),
	});
}

/**
 * Middy middleware that establishes a request context for the handler so any
 * code it reaches — including `@geekmidas/services` service methods — can call
 * `serviceContext.getLogger()` / `getRequestId()` / `getRequestStartTime()`.
 *
 * Use this on standalone functions that need request-scoped logging. To also
 * resolve services, pair it with {@link addServices}, or use
 * {@link withServices} which bundles both.
 *
 * @example
 * ```ts
 * import middy from '@middy/core';
 * import { serviceContext } from '@geekmidas/services';
 * import { requestContext } from '@geekmidas/services/middy';
 *
 * export const handler = middy(async () => {
 *   serviceContext.getLogger().info('tick');
 * }).use(requestContext({ logger }));
 * ```
 */
export function requestContext<TLogger extends Logger = Logger>(
	options: RequestContextOptions<TLogger>,
): MiddlewareObj<unknown, unknown, Error, Context> {
	const baseLogger = options.logger;
	return {
		before: (request) => {
			const { event, context } = request;
			const requestId = deriveRequestId(options, event, context);
			const logger = buildLogger(
				baseLogger,
				options,
				requestId,
				event,
				context,
			);
			enterRequestContext({ logger, requestId, startTime: Date.now() });
		},
		after: () => {
			exitRequestContext();
		},
		onError: () => {
			exitRequestContext();
		},
	};
}

function resolveDiscovery(options: ServiceResolverOptions): ServiceDiscovery {
	return (
		options.serviceDiscovery ?? ServiceDiscovery.getInstance(options.envParser)
	);
}

/**
 * Event augmentation applied by {@link addServices} / {@link withServices}:
 * resolved services keyed by `serviceName`. Intersect it with your own event
 * type to type the handler, e.g. `(event: EventServices<T> & APIGatewayEvent)`.
 */
export type EventServices<T extends Service[]> = {
	services: ServiceRecord<T>;
};

/**
 * Middy middleware that resolves an array of {@link Service}s via
 * {@link ServiceDiscovery} and attaches the resolved record to `event.services`
 * (keyed by each service's `serviceName`), matching how the `Function`/`Cron`
 * constructs expose services on the event.
 *
 * This middleware only resolves services; it does **not** establish a request
 * context. If your services read `serviceContext` (e.g. `getLogger()`), pair it
 * with {@link requestContext}, or use {@link withServices} which bundles both.
 *
 * Chainable — `.use(addServices([a])).use(addServices([b]))` accumulates onto
 * `event.services`.
 *
 * @example
 * ```ts
 * import middy from '@middy/core';
 * import { addServices, requestContext } from '@geekmidas/services/middy';
 *
 * export const handler = middy(async (event) => {
 *   await event.services.database.users.deletePast();
 *   event.services.cache.clear();
 * })
 *   .use(requestContext())
 *   .use(addServices([databaseService, cacheService], { envParser }));
 * ```
 */
export function addServices<const T extends Service[]>(
	services: [...T],
	options: ServiceResolverOptions,
): MiddlewareObj<EventServices<T>, unknown, Error, Context> {
	const discovery = resolveDiscovery(options);

	return {
		before: async (request) => {
			const resolved = await discovery.register(services);
			const event = request.event as { services?: Record<string, unknown> };
			// Merge so chained addServices(...) calls accumulate on event.services.
			event.services = { ...(event.services ?? {}), ...resolved };
		},
	};
}

/**
 * Batteries-included Middy setup for service-backed handlers: returns a pair of
 * middlewares — {@link requestContext} followed by {@link addServices} — so a
 * single `.use(withServices([...]))` gives the handler both a request context
 * and the resolved services on `event.services`.
 *
 * @example
 * ```ts
 * import middy from '@middy/core';
 * import { withServices } from '@geekmidas/services/middy';
 *
 * export const handler = middy(async (event) => {
 *   await event.services.database.users.deletePast();
 *   event.services.cache.clear();
 * }).use(withServices([databaseService, cacheService], { envParser }));
 * ```
 */
export function withServices<
	const T extends Service[],
	TLogger extends Logger = Logger,
>(
	services: [...T],
	options: ServiceMiddlewareOptions<TLogger>,
): [
	MiddlewareObj<unknown, unknown, Error, Context>,
	MiddlewareObj<EventServices<T>, unknown, Error, Context>,
] {
	return [requestContext(options), addServices(services, options)];
}
