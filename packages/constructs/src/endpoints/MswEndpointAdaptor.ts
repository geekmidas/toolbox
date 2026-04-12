import { EnvironmentParser } from '@geekmidas/envkit';
import type { Service } from '@geekmidas/services';
import { ServiceDiscovery } from '@geekmidas/services';
import { Hono } from 'hono';
import { type HttpHandler, http } from 'msw';
import type { Endpoint } from './Endpoint';
import { HonoEndpoint } from './HonoEndpointAdaptor';

/**
 * Header used to identify which test context a request belongs to.
 * Each concurrent test registers its own context (services, db transaction, etc.)
 * and the MSW handler looks it up by this header value.
 */
export const TEST_CONTEXT_HEADER = 'x-test-context-id';

/**
 * Per-test context containing an isolated ServiceDiscovery instance.
 * Registered in the context map and looked up per-request via the context ID header.
 */
export interface MswTestContext {
	serviceDiscovery: ServiceDiscovery<any>;
}

/**
 * Options for creating MSW handlers from endpoint constructs.
 *
 * @example
 * ```typescript
 * import { createMswHandlers, registerTestContext } from '@geekmidas/constructs/testing';
 * import { setupServer } from 'msw/node';
 *
 * // Create handlers once (global)
 * const { handlers, registerContext, removeContext } = createMswHandlers(
 *   [getUsers, createUser],
 *   { baseURL: 'http://localhost:3000' },
 * );
 * const server = setupServer(...handlers);
 *
 * // Per test: register an isolated context with its own services/transaction
 * it('should list users', async ({ db }) => {
 *   const contextId = crypto.randomUUID();
 *   registerContext(contextId, {
 *     services: { database: db, auth: mockAuth },
 *   });
 *
 *   const api = createApi({
 *     baseURL: 'http://localhost:3000',
 *     headers: { [TEST_CONTEXT_HEADER]: contextId },
 *   });
 *
 *   const result = await api('GET /users');
 *   expect(result).toBeDefined();
 *
 *   removeContext(contextId);
 * });
 * ```
 */
export interface CreateMswHandlersOptions {
	/** Base URL the client fetches from (e.g., 'http://localhost:3000') */
	baseURL: string;
}

/**
 * Options for registering a per-test context.
 * Follows the same pattern as TestRequestAdaptor — services, database,
 * publisher, and auditorStorage are provided explicitly.
 */
export interface RegisterContextOptions {
	/** Service instances keyed by serviceName */
	services?: Record<string, unknown>;
	/** Database instance — required when endpoints use .database() */
	database?: unknown;
	/** Event publisher service definition */
	publisher?: Service;
	/** Audit storage instance — required when endpoints use .auditor() */
	auditorStorage?: unknown;
}

const MSW_HTTP_METHODS = [
	'get',
	'post',
	'put',
	'patch',
	'delete',
	'options',
] as const;

type MswHttpMethod = (typeof MSW_HTTP_METHODS)[number];

/**
 * Result of creating MSW handlers from endpoint constructs.
 */
export interface CreateMswHandlersResult {
	/** MSW handlers to pass to setupServer() */
	handlers: HttpHandler[];
	/** Register an isolated context for a test */
	registerContext: (id: string, options: RegisterContextOptions) => void;
}

/**
 * Creates MSW HTTP handlers from endpoint constructs.
 *
 * Mounts endpoints on a Hono app and creates MSW handlers that intercept
 * fetch requests and route them through `app.request()` — giving frontend
 * tests full endpoint behavior (validation, auth, sessions) without HTTP.
 *
 * Each test registers its own isolated context via `registerContext()`,
 * which is resolved per-request using the `x-test-context-id` header.
 * This allows concurrent tests with their own transactions and services.
 *
 * @param endpoints - Array of endpoint constructs to create handlers for
 * @param options - Configuration including baseURL
 * @returns MSW handlers, the Hono app, and context management functions
 */
export function createMswHandlers(
	endpoints: Endpoint<any, any, any, any, any, any>[],
	options: CreateMswHandlersOptions,
): CreateMswHandlersResult {
	const { baseURL } = options;
	const contexts = new Map<string, MswTestContext>();

	/**
	 * Register an isolated context for a test.
	 * Creates a fresh ServiceDiscovery and pre-registers all provided services.
	 */
	function registerContext(id: string, ctxOptions: RegisterContextOptions) {
		const envParser = new EnvironmentParser({});
		const serviceDiscovery = new ServiceDiscovery(envParser);

		const serviceDefs: Service[] = [];

		// Register explicit services
		if (ctxOptions.services) {
			for (const [name, instance] of Object.entries(ctxOptions.services)) {
				serviceDefs.push({
					serviceName: name,
					register: () => instance,
				} as Service);
			}
		}

		// Register database service from endpoint metadata
		if (ctxOptions.database !== undefined) {
			for (const endpoint of endpoints) {
				if (endpoint.databaseService) {
					serviceDefs.push({
						serviceName: endpoint.databaseService.serviceName,
						register: () => ctxOptions.database,
					} as Service);
					break;
				}
			}
		}

		// Register publisher service
		if (ctxOptions.publisher) {
			serviceDefs.push(ctxOptions.publisher);
		}

		// Register auditor storage service from endpoint metadata
		if (ctxOptions.auditorStorage !== undefined) {
			for (const endpoint of endpoints) {
				if (endpoint.auditorStorageService) {
					serviceDefs.push({
						serviceName: endpoint.auditorStorageService.serviceName,
						register: () => ctxOptions.auditorStorage,
					} as Service);
					break;
				}
			}
		}

		if (serviceDefs.length > 0) {
			serviceDiscovery.register(serviceDefs);
		}

		contexts.set(id, { serviceDiscovery });
	}

	// Create a Hono app per-request that uses the correct ServiceDiscovery.
	// We use a wrapper app that resolves the context from the header,
	// then delegates to a context-specific Hono app.
	const handlers: HttpHandler[] = [];

	for (const endpoint of endpoints) {
		const method = endpoint.method.toLowerCase() as MswHttpMethod;
		if (!MSW_HTTP_METHODS.includes(method)) continue;

		const mswUrl = `${baseURL}${endpoint.route}`;
		const mswMethod = http[method];

		handlers.push(
			mswMethod(mswUrl, async ({ request }) => {
				const contextId = request.headers.get(TEST_CONTEXT_HEADER);
				const ctx = contextId ? contexts.get(contextId) : undefined;

				if (!ctx) {
					return new Response(
						JSON.stringify({
							error: 'Missing or unknown test context ID',
							hint: `Set the '${TEST_CONTEXT_HEADER}' header to a registered context ID`,
						}),
						{ status: 500, headers: { 'content-type': 'application/json' } },
					);
				}

				// Build a fresh Hono app with this context's ServiceDiscovery
				const app = new Hono();
				HonoEndpoint.addRoute(endpoint, ctx.serviceDiscovery as any, app);

				const response = await app.request(request);

				return new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers: response.headers,
				});
			}),
		);
	}

	return {
		handlers,
		registerContext,
	};
}
