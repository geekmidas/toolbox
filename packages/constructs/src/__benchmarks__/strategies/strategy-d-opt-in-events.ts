/**
 * Strategy D: Opt-in Event Publishing
 *
 * Key optimizations:
 * 1. Only add event middleware to routes that publish events
 * 2. Remove global event middleware entirely
 * 3. Zero overhead for routes without events
 * 4. Per-route event publishing configuration
 */
import type { Logger } from '@geekmidas/logger';
import type {
	Service,
	ServiceDiscovery,
	ServiceRecord,
} from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Context, Hono, Next } from 'hono';
import { validator } from 'hono/validator';
import {
	Endpoint,
	type EndpointSchemas,
	ResponseBuilder,
} from '../../endpoints/Endpoint';
import { parseHonoQuery } from '../../endpoints/parseHonoQuery';
import type { HttpMethod, LowerHttpMethod } from '../../types';

// ============================================================================
// Event Publishing Middleware (Per-Route)
// ============================================================================

/**
 * Creates event publishing middleware only for endpoints with events
 * This runs AFTER the handler to publish events on success
 */
function createEventPublishMiddleware<
	TServices extends Service[],
	TLogger extends Logger,
>(
	endpoint: Endpoint<
		any,
		any,
		any,
		any,
		TServices,
		TLogger,
		any,
		any,
		any,
		any,
		any,
		any,
		any,
		any
	>,
	serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>, TLogger>,
): ((c: Context, next: Next) => Promise<Response | void>) | null {
	// Return null if no events configured - middleware won't be added
	if (!endpoint.events || endpoint.events.length === 0) {
		return null;
	}

	return async (c, next) => {
		await next();

		// Only publish events on success
		if (Endpoint.isSuccessStatus(c.res.status)) {
			const response = c.get('__response');
			const logger = c.get('__logger') as Logger;

			if (response !== undefined) {
				// Note: In a real implementation, this would call publishConstructEvents
				// For benchmarking, we simulate the work
				await simulateEventPublish(endpoint.events, response, logger);
			}
		}
	};
}

/**
 * Simulates event publishing for benchmarking
 */
async function simulateEventPublish(
	events: any[],
	response: any,
	logger: Logger,
): Promise<void> {
	// Simulate the async work of event publishing
	// In production, this would serialize and publish to a message broker
	for (const event of events) {
		// Simulated event processing
		const eventPayload = typeof event === 'function' ? event(response) : event;
		logger.debug({ event: eventPayload }, 'Publishing event');
	}
}

// ============================================================================
// Hono Context Type Augmentation
// ============================================================================

declare module 'hono' {
	interface ContextVariableMap {
		__response: unknown;
		__logger: Logger;
		__endpoint: Endpoint<
			any,
			any,
			any,
			any,
			any,
			any,
			any,
			any,
			any,
			any,
			any,
			any,
			any,
			any
		>;
	}
}

// ============================================================================
// Main Adaptor with Opt-in Events
// ============================================================================

/**
 * HonoEndpoint adaptor with opt-in event publishing
 * No global event middleware - only routes with events get the overhead
 */
export class OptInEventHonoEndpoint {
	/**
	 * Add routes with opt-in event publishing
	 */
	static addRoutes<
		TServices extends Service[] = [],
		TLogger extends Logger = Logger,
	>(
		endpoints: Endpoint<string, HttpMethod, any, any, TServices, TLogger>[],
		serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>, TLogger>,
		app: Hono,
	): void {
		// NO global event middleware here!
		// Each route adds its own if needed

		// Sort endpoints (static routes before dynamic)
		const sortedEndpoints = [...endpoints].sort((a, b) => {
			const aHasDynamic = a.route.includes(':');
			const bHasDynamic = b.route.includes(':');
			if (!aHasDynamic && bHasDynamic) return -1;
			if (aHasDynamic && !bHasDynamic) return 1;
			return a.route.localeCompare(b.route);
		});

		for (const endpoint of sortedEndpoints) {
			this.addRoute(endpoint, serviceDiscovery, app);
		}
	}

	/**
	 * Add a single route with opt-in event publishing
	 */
	static addRoute<
		TRoute extends string,
		TMethod extends HttpMethod,
		TInput extends EndpointSchemas = {},
		TOutSchema extends StandardSchemaV1 | undefined = undefined,
		TServices extends Service[] = [],
		TLogger extends Logger = Logger,
	>(
		endpoint: Endpoint<
			TRoute,
			TMethod,
			TInput,
			TOutSchema,
			TServices,
			TLogger,
			any,
			any,
			any,
			any,
			any,
			any,
			any,
			any
		>,
		serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>, TLogger>,
		app: Hono,
	): void {
		const { route } = endpoint;
		const method = endpoint.method.toLowerCase() as LowerHttpMethod<TMethod>;

		// Pre-resolve services at setup time
		const servicesPromise =
			endpoint.services.length > 0
				? serviceDiscovery.register(endpoint.services)
				: Promise.resolve({} as ServiceRecord<TServices>);

		// Pre-resolve database service if configured
		const dbPromise = endpoint.databaseService
			? serviceDiscovery
					.register([endpoint.databaseService])
					.then(
						(s) => s[endpoint.databaseService!.serviceName as keyof typeof s],
					)
			: Promise.resolve(undefined);

		// Build middleware chain
		const middlewares: ((
			c: Context,
			next: Next,
		) => Promise<Response | void>)[] = [];

		// Validators (always needed)
		const validators = [
			validator('json', async (value, c) => {
				if (!endpoint.input?.body) return undefined;
				const parsed = await Endpoint.validate(endpoint.input.body, value);
				if (parsed.issues) return c.json(parsed.issues, 422);
				return parsed.value;
			}),
			validator('query', async (_, c) => {
				if (!endpoint.input?.query) return undefined;
				const parsedQuery = parseHonoQuery(c);
				const parsed = await Endpoint.validate(
					endpoint.input.query,
					parsedQuery,
				);
				if (parsed.issues) return c.json(parsed.issues, 422);
				return parsed.value;
			}),
			validator('param', async (params, c) => {
				if (!endpoint.input?.params) return undefined;
				const parsed = await Endpoint.validate(endpoint.input.params, params);
				if (parsed.issues) return c.json(parsed.issues, 422);
				return parsed.value;
			}),
		];

		// Add event middleware ONLY if endpoint has events
		const eventMiddleware = createEventPublishMiddleware(
			endpoint,
			serviceDiscovery,
		);
		if (eventMiddleware) {
			middlewares.push(eventMiddleware);
		}

		// Core handler
		const handler = async (c: Context): Promise<Response> => {
			try {
				const [services, db] = await Promise.all([servicesPromise, dbPromise]);

				const headerValues = c.req.header();
				const header = Endpoint.createHeaders(headerValues);
				const cookie = Endpoint.createCookies(headerValues.cookie);

				// Handle authorization if needed
				let session: unknown = undefined;
				if (endpoint.authorizer !== 'none') {
					session = await endpoint.getSession({
						services: services as any,
						logger: endpoint.logger,
						header,
						cookie,
						...(db !== undefined && { db }),
					} as any);

					const isAuthorized = await endpoint.authorize({
						header,
						cookie,
						services: services as any,
						logger: endpoint.logger,
						session,
					});

					if (!isAuthorized) {
						return c.json({ error: 'Unauthorized' }, 401);
					}
				}

				// Execute handler
				const responseBuilder = new ResponseBuilder();
				const response = await endpoint.handler(
					{
						services: services as any,
						logger: endpoint.logger,
						body: c.req.valid('json'),
						query: c.req.valid('query'),
						params: c.req.valid('param'),
						session,
						header,
						cookie,
						auditor: undefined,
						db,
					} as any,
					responseBuilder,
				);

				// Store response for event middleware (only needed if events are configured)
				if (endpoint.events?.length) {
					c.set('__response', response);
					c.set('__logger', endpoint.logger);
				}

				// Build response
				let data = response;
				let metadata = responseBuilder.getMetadata();

				if (Endpoint.hasMetadata(response)) {
					data = response.data;
					metadata = response.metadata;
				}

				const output = endpoint.outputSchema
					? await endpoint.parseOutput(data)
					: data;

				const status = (metadata.status ?? endpoint.status) as any;
				return c.json(output, status);
			} catch (error) {
				return c.json({ error: 'Internal Server Error' }, 500);
			}
		};

		// Register route
		app[method](route, ...validators, ...middlewares, handler);
	}
}

// ============================================================================
// Combined Optimized Adaptor (A + C + D combined)
// ============================================================================

/**
 * Fully optimized HonoEndpoint adaptor combining:
 * - Strategy A: Lazy service resolution
 * - Strategy C: Middleware composition
 * - Strategy D: Opt-in event publishing
 */
export class FullyOptimizedHonoEndpoint {
	/**
	 * Add routes with all optimizations
	 */
	static addRoutes<
		TServices extends Service[] = [],
		TLogger extends Logger = Logger,
	>(
		endpoints: Endpoint<string, HttpMethod, any, any, TServices, TLogger>[],
		serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>, TLogger>,
		app: Hono,
	): void {
		// Sort endpoints
		const sortedEndpoints = [...endpoints].sort((a, b) => {
			const aHasDynamic = a.route.includes(':');
			const bHasDynamic = b.route.includes(':');
			if (!aHasDynamic && bHasDynamic) return -1;
			if (aHasDynamic && !bHasDynamic) return 1;
			return a.route.localeCompare(b.route);
		});

		for (const endpoint of sortedEndpoints) {
			this.addRoute(endpoint, serviceDiscovery, app);
		}
	}

	/**
	 * Add a single route with all optimizations
	 */
	static addRoute<
		TRoute extends string,
		TMethod extends HttpMethod,
		TInput extends EndpointSchemas = {},
		TOutSchema extends StandardSchemaV1 | undefined = undefined,
		TServices extends Service[] = [],
		TLogger extends Logger = Logger,
	>(
		endpoint: Endpoint<
			TRoute,
			TMethod,
			TInput,
			TOutSchema,
			TServices,
			TLogger,
			any,
			any,
			any,
			any,
			any,
			any,
			any,
			any
		>,
		serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>, TLogger>,
		app: Hono,
	): void {
		const { route } = endpoint;
		const method = endpoint.method.toLowerCase() as LowerHttpMethod<TMethod>;

		// Pre-analyze endpoint features at registration time
		const hasServices = endpoint.services.length > 0;
		const hasDatabaseService = !!endpoint.databaseService;
		const hasAuthorizer = endpoint.authorizer !== 'none';
		const hasEvents = (endpoint.events?.length ?? 0) > 0;

		// Pre-resolve services at setup time (not per request)
		const allServices = hasServices ? endpoint.services : [];
		if (hasDatabaseService && endpoint.databaseService) {
			allServices.push(endpoint.databaseService);
		}

		// Single service registration for all needed services
		const servicesPromise =
			allServices.length > 0
				? serviceDiscovery.register(allServices)
				: Promise.resolve({} as any);

		// Build minimal middleware chain
		const middlewares: ((
			c: Context,
			next: Next,
		) => Promise<Response | void>)[] = [];

		// Validators
		const validators = [
			validator('json', async (value, c) => {
				if (!endpoint.input?.body) return undefined;
				const parsed = await Endpoint.validate(endpoint.input.body, value);
				if (parsed.issues) return c.json(parsed.issues, 422);
				return parsed.value;
			}),
			validator('query', async (_, c) => {
				if (!endpoint.input?.query) return undefined;
				const parsedQuery = parseHonoQuery(c);
				const parsed = await Endpoint.validate(
					endpoint.input.query,
					parsedQuery,
				);
				if (parsed.issues) return c.json(parsed.issues, 422);
				return parsed.value;
			}),
			validator('param', async (params, c) => {
				if (!endpoint.input?.params) return undefined;
				const parsed = await Endpoint.validate(endpoint.input.params, params);
				if (parsed.issues) return c.json(parsed.issues, 422);
				return parsed.value;
			}),
		];

		// Only add auth middleware if needed
		if (hasAuthorizer) {
			middlewares.push(async (c, next) => {
				const services = await servicesPromise;
				const headerValues = c.req.header();
				const header = Endpoint.createHeaders(headerValues);
				const cookie = Endpoint.createCookies(headerValues.cookie);

				const db = hasDatabaseService
					? services[
							endpoint.databaseService!.serviceName as keyof typeof services
						]
					: undefined;

				const session = await endpoint.getSession({
					services,
					logger: endpoint.logger,
					header,
					cookie,
					...(db !== undefined && { db }),
				} as any);

				const isAuthorized = await endpoint.authorize({
					header,
					cookie,
					services,
					logger: endpoint.logger,
					session,
				});

				if (!isAuthorized) {
					return c.json({ error: 'Unauthorized' }, 401);
				}

				c.set('__session' as any, session);
				await next();
			});
		}

		// Only add event middleware if needed
		if (hasEvents) {
			middlewares.push(async (c, next) => {
				await next();

				if (Endpoint.isSuccessStatus(c.res.status)) {
					const response = c.get('__response');
					if (response !== undefined) {
						await simulateEventPublish(
							endpoint.events!,
							response,
							endpoint.logger,
						);
					}
				}
			});
		}

		// Minimal core handler
		const handler = async (c: Context): Promise<Response> => {
			try {
				const services = await servicesPromise;

				const db = hasDatabaseService
					? services[
							endpoint.databaseService!.serviceName as keyof typeof services
						]
					: undefined;

				const headerValues = c.req.header();

				// Execute handler
				const responseBuilder = new ResponseBuilder();
				const response = await endpoint.handler(
					{
						services,
						logger: endpoint.logger,
						body: c.req.valid('json'),
						query: c.req.valid('query'),
						params: c.req.valid('param'),
						session: hasAuthorizer ? c.get('__session' as any) : undefined,
						header: Endpoint.createHeaders(headerValues),
						cookie: Endpoint.createCookies(headerValues.cookie),
						auditor: undefined,
						db,
					} as any,
					responseBuilder,
				);

				// Store for event middleware if needed
				if (hasEvents) {
					c.set('__response', response);
				}

				// Build response
				let data = response;
				let metadata = responseBuilder.getMetadata();

				if (Endpoint.hasMetadata(response)) {
					data = response.data;
					metadata = response.metadata;
				}

				const output = endpoint.outputSchema
					? await endpoint.parseOutput(data)
					: data;

				const status = (metadata.status ?? endpoint.status) as any;
				return c.json(output, status);
			} catch (error) {
				return c.json({ error: 'Internal Server Error' }, 500);
			}
		};

		// Register route with minimal middleware
		app[method](route, ...validators, ...middlewares, handler);
	}
}
