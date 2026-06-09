import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { ConsoleLogger } from '@geekmidas/logger/console';
import {
	enterRequestContext,
	exitRequestContext,
	type Service,
	ServiceDiscovery,
	type ServiceRecord,
} from '@geekmidas/services';
import type { MiddlewareObj } from '@middy/core';
import type { Context } from 'aws-lambda';
import set from 'lodash.set';

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
 * Options shared by the request-context-aware middlewares.
 */
export interface RequestContextOptions {
	/**
	 * Base logger to derive the per-request child logger from.
	 * Defaults to a new {@link ConsoleLogger}.
	 */
	logger?: Logger;
	/**
	 * Derive the request id from the event/context.
	 * Defaults to `context.awsRequestId`, falling back to `crypto.randomUUID()`.
	 */
	getRequestId?: (event: unknown, context: Context) => string;
	/**
	 * Extra bindings to attach to the per-request child logger.
	 */
	bindings?: (event: unknown, context: Context) => Record<string, unknown>;
}

/**
 * Options for the service-resolving middlewares.
 */
export interface ServiceMiddlewareOptions extends RequestContextOptions {
	/**
	 * Environment parser used to build the default {@link ServiceDiscovery}.
	 * Defaults to `new EnvironmentParser({ ...process.env })`.
	 */
	envParser?: EnvironmentParser<{}>;
	/**
	 * Explicit {@link ServiceDiscovery} to resolve services from. Takes
	 * precedence over `envParser`.
	 */
	serviceDiscovery?: ServiceDiscovery;
}

function deriveRequestId(
	options: RequestContextOptions,
	event: unknown,
	context: Context | undefined,
): string {
	return (
		options.getRequestId?.(event, context as Context) ??
		context?.awsRequestId ??
		crypto.randomUUID()
	);
}

function buildLogger(
	baseLogger: Logger,
	options: RequestContextOptions,
	requestId: string,
	event: unknown,
	context: Context | undefined,
): Logger {
	return baseLogger.child({
		requestId,
		...(options.bindings?.(event, context as Context) ?? {}),
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
 * import { requestContext } from '@geekmidas/constructs/middy';
 *
 * export const handler = middy(async () => {
 *   serviceContext.getLogger().info('tick');
 * }).use(requestContext());
 * ```
 */
export function requestContext(
	options: RequestContextOptions = {},
): MiddlewareObj<unknown, unknown, Error, Context> {
	const baseLogger = options.logger ?? new ConsoleLogger();
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

function resolveDiscovery(options: ServiceMiddlewareOptions): ServiceDiscovery {
	return (
		options.serviceDiscovery ??
		ServiceDiscovery.getInstance(
			options.envParser ?? new EnvironmentParser({ ...process.env }),
		)
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
 * import { addServices, requestContext } from '@geekmidas/constructs/middy';
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
	options: ServiceMiddlewareOptions = {},
): MiddlewareObj<EventServices<T>, unknown, Error, Context> {
	const discovery = resolveDiscovery(options);

	return {
		before: async (request) => {
			const resolved = await discovery.register(services);
			set(request, 'event.services', resolved);
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
 * import { withServices } from '@geekmidas/constructs/middy';
 *
 * export const handler = middy(async (event) => {
 *   await event.services.database.users.deletePast();
 *   event.services.cache.clear();
 * }).use(withServices([databaseService, cacheService], { envParser }));
 * ```
 */
export function withServices<const T extends Service[]>(
	services: [...T],
	options: ServiceMiddlewareOptions = {},
): [
	MiddlewareObj<unknown, unknown, Error, Context>,
	MiddlewareObj<EventServices<T>, unknown, Error, Context>,
] {
	return [requestContext(options), addServices(services, options)];
}
