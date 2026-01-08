/**
 * Strategy A: Lazy Service Resolution
 *
 * Key optimizations:
 * 1. Services are resolved lazily (only when accessed)
 * 2. Service registration is deduplicated
 * 3. Cached service instances are reused
 */
import type { Logger } from '@geekmidas/logger';
import type {
	Service,
	ServiceDiscovery,
	ServiceRecord,
} from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Hono } from 'hono';
import { validator } from 'hono/validator';
import {
	Endpoint,
	type EndpointSchemas,
	ResponseBuilder,
} from '../../endpoints/Endpoint';
import { parseHonoQuery } from '../../endpoints/parseHonoQuery';
import type { HttpMethod, LowerHttpMethod } from '../../types';

/**
 * Lazy service resolver that caches service instances
 * and deduplicates registration calls
 */
class LazyServiceResolver<TServices extends Service[]> {
	private cache = new Map<string, any>();
	private pendingRegistrations = new Map<string, Promise<any>>();

	constructor(
		private serviceDiscovery: ServiceDiscovery<
			ServiceRecord<TServices>,
			Logger
		>,
		private availableServices: TServices,
	) {}

	/**
	 * Get a service by name, registering it lazily if needed
	 */
	async get<TName extends TServices[number]['serviceName']>(
		serviceName: TName,
	): Promise<any> {
		// Return cached instance
		if (this.cache.has(serviceName)) {
			return this.cache.get(serviceName);
		}

		// Wait for pending registration
		if (this.pendingRegistrations.has(serviceName)) {
			return this.pendingRegistrations.get(serviceName);
		}

		// Find and register service
		const service = this.availableServices.find(
			(s) => s.serviceName === serviceName,
		);
		if (!service) {
			throw new Error(
				`Service '${serviceName}' not found in available services`,
			);
		}

		const registrationPromise = this.serviceDiscovery
			.register([service])
			.then((result) => {
				const instance = result[serviceName as keyof typeof result];
				this.cache.set(serviceName, instance);
				this.pendingRegistrations.delete(serviceName);
				return instance;
			});

		this.pendingRegistrations.set(serviceName, registrationPromise);
		return registrationPromise;
	}

	/**
	 * Preload multiple services at once (batch registration)
	 */
	async preload(serviceNames: string[]): Promise<Record<string, any>> {
		const toLoad = serviceNames.filter(
			(name) => !this.cache.has(name) && !this.pendingRegistrations.has(name),
		);

		if (toLoad.length === 0) {
			// All cached, return from cache
			const result: Record<string, any> = {};
			for (const name of serviceNames) {
				result[name] = this.cache.get(name);
			}
			return result;
		}

		// Find services to register
		const servicesToRegister = this.availableServices.filter((s) =>
			toLoad.includes(s.serviceName),
		);

		if (servicesToRegister.length > 0) {
			const registered =
				await this.serviceDiscovery.register(servicesToRegister);

			// Cache all registered services
			for (const [name, instance] of Object.entries(registered)) {
				this.cache.set(name, instance);
			}
		}

		// Return requested services from cache
		const result: Record<string, any> = {};
		for (const name of serviceNames) {
			result[name] = this.cache.get(name);
		}
		return result;
	}

	/**
	 * Create a proxy that lazily resolves services on access
	 */
	createProxy(): Record<string, any> {
		const resolver = this;
		return new Proxy(
			{},
			{
				get(_, prop: string) {
					// Synchronous access returns a promise
					// Handler should await services.serviceName
					return resolver.get(prop);
				},
			},
		);
	}
}

/**
 * Optimized HonoEndpoint adaptor with lazy service resolution
 */
export class OptimizedHonoEndpoint {
	/**
	 * Add routes with lazy service resolution
	 */
	static addRoutes<
		TServices extends Service[] = [],
		TLogger extends Logger = Logger,
	>(
		endpoints: Endpoint<string, HttpMethod, any, any, TServices, TLogger>[],
		serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>, TLogger>,
		app: Hono,
	): void {
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
	 * Add a single route with optimized handler
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
		const serviceNames = endpoint.services.map((s) => s.serviceName);

		// Create service resolver once per route (shared across requests)
		const serviceResolver = new LazyServiceResolver(
			serviceDiscovery,
			endpoint.services,
		);

		// Register route with optimized handler
		app[method](
			route,
			// Validators
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
			// Main handler
			async (c) => {
				try {
					// Only resolve services if needed
					const services = hasServices
						? await serviceResolver.preload(serviceNames)
						: ({} as any);

					// Resolve database service only if configured
					const db = hasDatabaseService
						? await serviceResolver.get(endpoint.databaseService!.serviceName)
						: undefined;

					// Only check authorization if configured
					if (hasAuthorizer) {
						const headerValues = c.req.header();
						const header = Endpoint.createHeaders(headerValues);
						const cookie = Endpoint.createCookies(headerValues.cookie);

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
					}

					// Execute handler
					const responseBuilder = new ResponseBuilder();
					const response = await endpoint.handler(
						{
							services,
							logger: endpoint.logger,
							body: c.req.valid('json'),
							query: c.req.valid('query'),
							params: c.req.valid('param'),
							session: undefined,
							header: Endpoint.createHeaders(c.req.header()),
							cookie: Endpoint.createCookies(c.req.header().cookie),
							auditor: undefined,
							db,
						} as any,
						responseBuilder,
					);

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
			},
		);
	}
}
