import type { AuditableAction, AuditStorage } from '@geekmidas/audit';
import type { EnvironmentParser } from '@geekmidas/envkit';
import { type HttpError, isHttpError, wrapError } from '@geekmidas/errors';
import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import {
	runWithRequestContext,
	type Service,
	ServiceDiscovery,
	type ServiceRecord,
} from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type Context, Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { logger as honoLogger } from 'hono/logger';
import { timing } from 'hono/timing';
import type {
	ContentfulStatusCode,
	RedirectStatusCode,
} from 'hono/utils/http-status';
import { validator } from 'hono/validator';
import { publishConstructEvents } from '../publisher';
import type { HttpMethod, LowerHttpMethod } from '../types';
import type { MappedAudit } from './audit';
import {
	Endpoint,
	type EndpointContext,
	type EndpointSchemas,
	ResponseBuilder,
} from './Endpoint';
import { getEndpointsFromRoutes } from './helpers';
import { createHonoCookies, createHonoHeaders } from './lazyAccessors';
import { loadRls } from './optionalPeers';
import { parseHonoQuery } from './parseHonoQuery';
import {
	createAuditContext,
	executeWithAuditTransaction,
} from './processAudits';
import { enforceRateLimit } from './rateLimit';
import { readRequestBody } from './readRequestBody';

export interface HonoEndpointOptions {
	/**
	 * Path where OpenAPI documentation will be served.
	 * Set to false to disable docs route.
	 * @default '/docs'
	 */
	docsPath?: string | false;
	/**
	 * OpenAPI schema options
	 */
	openApiOptions?: {
		title?: string;
		version?: string;
		description?: string;
	};
}

/**
 * Feature flags for an endpoint, analyzed once at route registration time.
 * This avoids per-request feature detection overhead.
 */
interface EndpointFeatures {
	hasServices: boolean;
	hasDatabase: boolean;
	hasBodyValidation: boolean;
	hasQueryValidation: boolean;
	hasParamValidation: boolean;
	hasAudits: boolean;
	hasEvents: boolean;
	hasRateLimit: boolean;
	hasRls: boolean;
}

/**
 * Case-insensitive check for a `content-type` header in a metadata headers map.
 */
function hasContentTypeHeader(headers: Record<string, string>): boolean {
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === 'content-type') return true;
	}
	return false;
}

/**
 * Analyze endpoint features at registration time (not per-request)
 */
function analyzeEndpointFeatures(
	endpoint: Endpoint<
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
	>,
): EndpointFeatures {
	return {
		hasServices: endpoint.services.length > 0,
		hasDatabase: !!endpoint.databaseService,
		hasBodyValidation: !!endpoint.input?.body,
		hasQueryValidation: !!endpoint.input?.query,
		hasParamValidation: !!endpoint.input?.params,
		// Audit context needed if declarative audits OR auditor storage service configured (for manual audits)
		hasAudits:
			(endpoint.audits?.length ?? 0) > 0 || !!endpoint.auditorStorageService,
		hasEvents: (endpoint.events?.length ?? 0) > 0,
		hasRateLimit: !!endpoint.rateLimit,
		hasRls: !!endpoint.rlsConfig && !endpoint.rlsBypass,
	};
}

export class HonoEndpoint<
	TRoute extends string,
	TMethod extends HttpMethod,
	TInput extends EndpointSchemas = {},
	TOutSchema extends StandardSchemaV1 | undefined = undefined,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TSession = unknown,
	TAuditStorage extends AuditStorage | undefined = undefined,
	TAuditStorageServiceName extends string = string,
	TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
		string,
		unknown
	>,
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> {
	constructor(
		private readonly endpoint: Endpoint<
			TRoute,
			TMethod,
			TInput,
			TOutSchema,
			TServices,
			TLogger,
			TSession,
			TAuditStorage,
			TAuditStorageServiceName,
			TAuditAction,
			TDatabase,
			TDatabaseServiceName
		>,
	) {}

	static isDev = process.env.NODE_ENV === 'development';

	static async validate<T extends StandardSchemaV1>(
		c: Context<any, string, {}>,
		data: unknown,
		schema?: T,
	) {
		if (!schema) {
			return undefined;
		}

		const parsed = await Endpoint.validate(schema, data);

		if (parsed.issues) {
			return c.json(parsed.issues, 422);
		}

		return parsed.value;
	}
	addRoute(
		serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>>,
		app: Hono,
	): void {
		HonoEndpoint.addRoute(this.endpoint, serviceDiscovery, app);
	}

	/**
	 * @deprecated Global event middleware is no longer used.
	 * Events are now published per-route only for endpoints that have events configured.
	 * This method is kept for backward compatibility but does nothing.
	 */
	static applyEventMiddleware(
		_app: Hono,
		_serviceDiscovery: ServiceDiscovery<any>,
	) {
		// No-op: Event publishing is now handled per-route in addRoute
		// This avoids running middleware on every request including 404s
	}

	static async fromRoutes<TLogger extends Logger, TServices extends Service[]>(
		routes: string[],
		envParser: EnvironmentParser<{}>,
		app = new Hono(),
		_logger: TLogger,
		cwd = process.cwd(),
		options?: HonoEndpointOptions,
	): Promise<Hono> {
		const endpoints = await getEndpointsFromRoutes<TServices>(routes, cwd);
		const serviceDiscovery =
			ServiceDiscovery.getInstance<ServiceRecord<TServices>>(envParser);

		HonoEndpoint.addRoutes(endpoints, serviceDiscovery, app, options);

		return app;
	}

	static addRoutes<
		TServices extends Service[] = [],
		TLogger extends Logger = Logger,
	>(
		endpoints: Endpoint<string, HttpMethod, any, any, TServices, TLogger>[],
		serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>>,
		app: Hono,
		options?: HonoEndpointOptions,
	): void {
		// Add timing middleware (always enabled)
		app.use('*', timing());

		// Add logger middleware in development mode

		if (HonoEndpoint.isDev) {
			app.use('*', honoLogger());
		}

		// Add docs route if not disabled
		const docsPath =
			options?.docsPath !== false ? options?.docsPath || '/docs' : null;
		if (docsPath) {
			HonoEndpoint.addDocsRoute(
				endpoints,
				app,
				docsPath,
				options?.openApiOptions,
			);
		}

		// Sort endpoints to ensure static routes come before dynamic ones
		const sortedEndpoints = endpoints.sort((a, b) => {
			const aSegments = a.route.split('/');
			const bSegments = b.route.split('/');

			// Compare each segment
			for (let i = 0; i < Math.max(aSegments.length, bSegments.length); i++) {
				const aSegment = aSegments[i] || '';
				const bSegment = bSegments[i] || '';

				// If one is dynamic and the other is not, static comes first
				const aIsDynamic = aSegment.startsWith(':');
				const bIsDynamic = bSegment.startsWith(':');

				if (!aIsDynamic && bIsDynamic) return -1;
				if (aIsDynamic && !bIsDynamic) return 1;

				// If both are the same type, compare alphabetically
				if (aSegment !== bSegment) {
					return aSegment.localeCompare(bSegment);
				}
			}

			return 0;
		});

		// Note: Global event middleware removed for performance
		// Events are now published per-route only for endpoints with events configured
		for (const endpoint of sortedEndpoints) {
			HonoEndpoint.addRoute(endpoint, serviceDiscovery, app);
		}
	}

	// biome-ignore lint/suspicious/useAdjacentOverloadSignatures: not an overload — the instance `addRoute` above registers this adaptor's own endpoint, this one registers any endpoint on a given app. They share a name because they do the same thing to different subjects.
	static addRoute<
		TRoute extends string,
		TMethod extends HttpMethod,
		TInput extends EndpointSchemas = {},
		TOutSchema extends StandardSchemaV1 | undefined = undefined,
		TServices extends Service[] = [],
		TLogger extends Logger = Logger,
		TSession = unknown,
		TAuditStorage extends AuditStorage | undefined = undefined,
		TAuditStorageServiceName extends string = string,
		TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
			string,
			unknown
		>,
		TDatabase = undefined,
		TDatabaseServiceName extends string = string,
	>(
		endpoint: Endpoint<
			TRoute,
			TMethod,
			TInput,
			TOutSchema,
			TServices,
			TLogger,
			TSession,
			TAuditStorage,
			TAuditStorageServiceName,
			TAuditAction,
			TDatabase,
			TDatabaseServiceName
		>,
		serviceDiscovery: ServiceDiscovery<ServiceRecord<TServices>>,
		app: Hono,
	): void {
		const { route } = endpoint;
		const method = endpoint.method.toLowerCase() as LowerHttpMethod<TMethod>;

		// Analyze endpoint features once at registration time (not per-request)
		const features = analyzeEndpointFeatures(endpoint);

		// Build validators array - only add validators for schemas that exist
		const validators: any[] = [];

		if (features.hasBodyValidation) {
			// Read by its Content-Type — JSON, an HTML form, text — and kept
			// where a JSON validator keeps it, so the handler reads it as before.
			validators.push(async (c: Context, next: () => Promise<void>) => {
				let raw: unknown;
				try {
					raw = await readRequestBody(c.req, c.req.header('content-type'), {
						untyped: 'empty',
					});
				} catch (error) {
					if (!isHttpError(error)) throw error;
					setErrorHeaders(c, error);
					return c.json(
						errorBody(error),
						error.statusCode as ContentfulStatusCode,
					);
				}
				const body = await HonoEndpoint.validate(c, raw, endpoint.input?.body);
				if (body instanceof Response) return body;
				c.req.addValidatedData('json', body as {});
				await next();
			});
		}

		if (features.hasQueryValidation) {
			validators.push(
				validator('query', (_, c) => {
					const parsedQuery = parseHonoQuery(c);
					return HonoEndpoint.validate(c, parsedQuery, endpoint.input?.query);
				}),
			);
		}

		if (features.hasParamValidation) {
			validators.push(
				validator('param', (params, c) =>
					HonoEndpoint.validate(c, params, endpoint.input?.params),
				),
			);
		}

		// Main handler
		const handler = async (c: Context) => {
			// Request context setup
			const startTime = Date.now();
			const requestId = c.req.header('X-Request-ID') ?? crypto.randomUUID();

			const logger = endpoint.logger.child({
				requestId,
				endpoint: endpoint.fullPath,
				route: endpoint.route,
				host: c.req.header('host'),
				method: endpoint.method,
				path: c.req.path,
			}) as TLogger;

			// Set response header
			c.header('X-Request-ID', requestId);

			// Wrap entire handler in request context for services to access
			return runWithRequestContext(
				{
					logger,
					requestId,
					startTime,
					operation: `${endpoint.method} ${endpoint.route}`,
				},
				async () => {
					try {
						// Lazy accessors - no upfront parsing, use native Hono methods
						const header = createHonoHeaders(c);
						const cookie = createHonoCookies(c);

						// Only register services if endpoint has any
						const services = features.hasServices
							? await serviceDiscovery.register(endpoint.services)
							: ({} as ServiceRecord<TServices>);

						// Resolve database service only if configured
						const rawDb = features.hasDatabase
							? await serviceDiscovery
									.register([endpoint.databaseService!])
									.then(
										(s) =>
											s[
												endpoint.databaseService?.serviceName as keyof typeof s
											],
									)
							: undefined;

						// Extract session (defaults to empty object)
						const session = await endpoint.getSession({
							services,
							logger,
							header,
							cookie,
							...(rawDb !== undefined && { db: rawDb }),
						} as any);

						// Check authorization (defaults to true)
						const isAuthorized = await endpoint.authorize({
							header,
							cookie,
							services,
							logger,
							session,
							...(rawDb !== undefined && { db: rawDb }),
							body: features.hasBodyValidation
								? (c.req.valid as any)('json')
								: undefined,
							query: features.hasQueryValidation
								? (c.req.valid as any)('query')
								: undefined,
							params: features.hasParamValidation
								? (c.req.valid as any)('param')
								: undefined,
						} as any);

						if (!isAuthorized) {
							logger.warn('Forbidden access attempt');
							return c.json({ error: 'Forbidden' }, 403);
						}

						// Check rate limit only if configured
						if (features.hasRateLimit) {
							const rateLimitHeaders = await enforceRateLimit(
								endpoint.rateLimit!,
								{
									header,
									services,
									logger,
									session,
									path: c.req.path,
									method: endpoint.method,
								},
							);
							for (const [key, value] of Object.entries(rateLimitHeaders)) {
								c.header(key, value);
							}
						}

						// Create audit context only if audits are configured
						const auditContext = features.hasAudits
							? await createAuditContext(
									endpoint as any,
									serviceDiscovery,
									logger,
									{
										session,
										header,
										cookie,
										services: services as Record<string, unknown>,
									},
								)
							: undefined;

						const audits = features.hasAudits
							? (endpoint.audits as MappedAudit<TAuditAction, TOutSchema>[])
							: [];

						// Warn if declarative audits are configured but no audit storage
						if (features.hasAudits && !auditContext) {
							logger.warn('No auditor storage service available');
						}

						// Extract RLS context only if configured and not bypassed
						const rlsContext =
							features.hasRls && rawDb !== undefined
								? await endpoint.rlsConfig?.extractor({
										services,
										session: session as TSession,
										header,
										cookie,
										logger,
									})
								: undefined;

						// Execute handler with automatic audit transaction support
						const result = await executeWithAuditTransaction(
							auditContext,
							async (auditor) => {
								const sameDatabase =
									auditContext?.storage?.databaseServiceName &&
									auditContext.storage.databaseServiceName ===
										endpoint.databaseService?.serviceName;
								const baseDb = sameDatabase
									? (auditor?.getTransaction?.() ?? rawDb)
									: rawDb;

								const executeHandler = async (db: TDatabase | undefined) => {
									const responseBuilder = new ResponseBuilder();
									const response = await endpoint.handler(
										{
											services,
											logger,
											body: features.hasBodyValidation
												? (c.req.valid as any)('json')
												: undefined,
											query: features.hasQueryValidation
												? (c.req.valid as any)('query')
												: undefined,
											params: features.hasParamValidation
												? (c.req.valid as any)('param')
												: undefined,
											session,
											header,
											cookie,
											auditor,
											db,
										} as unknown as EndpointContext<
											TInput,
											TServices,
											TLogger,
											TSession,
											TAuditAction,
											TDatabase,
											TAuditStorage
										>,
										responseBuilder,
									);

									let data = response;
									let metadata = responseBuilder.getMetadata();

									if (Endpoint.hasMetadata(response)) {
										data = response.data;
										metadata = response.metadata;
									}

									// A redirect has no body to check against the schema.
									const redirect = Endpoint.isRedirectStatus(
										metadata.status ?? endpoint.status,
									);
									const output =
										endpoint.outputSchema && !redirect
											? await endpoint.parseOutput(data)
											: undefined;

									return { output, metadata, responseBuilder, redirect };
								};

								if (features.hasRls && rlsContext && baseDb) {
									const { withRlsContext } = await loadRls();
									return withRlsContext(
										baseDb as any,
										rlsContext,
										async (trx) => executeHandler(trx as TDatabase),
										{ prefix: endpoint.rlsConfig?.prefix },
									);
								}

								return executeHandler(baseDb as TDatabase | undefined);
							},
							async (result, auditor) => {
								if (!audits?.length || result.redirect) return;

								for (const audit of audits) {
									if (audit.when && !audit.when(result.output as any)) {
										continue;
									}
									const payload = audit.payload(result.output as any);
									const entityId = audit.entityId?.(result.output as any);
									auditor.audit(audit.type as any, payload as any, {
										table: audit.table,
										entityId,
									});
								}
							},
							{ db: rawDb },
						);

						const { output, metadata, redirect } = result;

						try {
							let status = endpoint.status as ContentfulStatusCode;

							if (metadata.status) {
								status = metadata.status as ContentfulStatusCode;
							}

							if (metadata.headers) {
								for (const [key, value] of Object.entries(metadata.headers)) {
									c.header(key, value);
								}
							}

							if (metadata.cookies) {
								for (const [name, { value, options }] of metadata.cookies) {
									setCookie(c, name, value, options);
								}
							}

							// Only publish events if configured (no global middleware overhead)
							if (features.hasEvents && Endpoint.isSuccessStatus(status)) {
								await publishConstructEvents<any>(
									endpoint as any,
									output,
									serviceDiscovery,
									logger,
								);
							}

							if (HonoEndpoint.isDev) {
								logger.info({ status, body: output }, 'Outgoing response');
							}

							if (redirect) {
								return c.body(null, status as RedirectStatusCode);
							}

							// Respect the endpoint's declared responseType. For JSON (default)
							// we use c.json() which sets Content-Type and serializes. For any
							// other type, emit the body as-is and set the header explicitly —
							// metadata.headers (from r.header()) applied above still wins.
							if (endpoint.responseType === 'application/json') {
								// Hono 4.13 types `c.json`'s status well enough that the
								// suppression here is now itself an error.
								return c.json(output, status);
							}
							if (
								!(metadata.headers && hasContentTypeHeader(metadata.headers))
							) {
								c.header('content-type', endpoint.responseType);
							}
							return c.body(output as any, status);
						} catch (validationError: any) {
							logger.error(
								{ err: validationError },
								'Output validation failed',
							);
							const error = wrapError(
								validationError,
								422,
								'Response validation failed',
							);
							setErrorHeaders(c, error);
							const body = errorBody(error);
							if (HonoEndpoint.isDev) {
								logger.info(
									{ status: error.statusCode, body },
									'Outgoing response',
								);
							}
							return c.json(body, error.statusCode as ContentfulStatusCode);
						}
					} catch (e: any) {
						// Under `err`, which every pino serializes as an Error — passed bare,
						// one pino does not recognise (a ZodError) is spread into the line
						// with no stack.
						logger.error({ err: e }, 'Error processing endpoint request');
						const error = wrapError(e, 500, 'Internal Server Error');
						// Answered here rather than rethrown, so Hono never sets it:
						// a server failure is left on the context the way Hono
						// leaves an uncaught one, for middleware — a request span
						// records it as the exception. A 4xx is the client's.
						if (error.statusCode >= 500 && e instanceof Error) c.error = e;
						setErrorHeaders(c, error);
						const body = errorBody(error);
						if (HonoEndpoint.isDev) {
							logger.info(
								{ status: error.statusCode, body },
								'Outgoing response',
							);
						}
						return c.json(body, error.statusCode as ContentfulStatusCode);
					}
				},
			);
		};

		// Register route with conditional validators.
		//
		// `route` is a generic `TRoute`, and Hono 4.13 overloads `app.get` on
		// whether the first argument is a path or a handler. A generic that is
		// only *constrained* to string does not pick the path overload, so it
		// gets matched against the handler one and reported there. Saying it is a
		// string chooses the overload that was always intended.
		//
		// The spread is why a cast is needed rather than a better type: with
		// `...validators` of unknown length, the arity is not decidable, so the
		// first overload is chosen whatever the path argument says. Naming the
		// shape we are calling states the intent the overloads cannot infer.
		(
			app[method] as unknown as (
				path: string,
				...handlers: unknown[]
			) => unknown
		)(route, ...validators, handler);
	}

	static addDocsRoute<
		TServices extends Service[] = [],
		TLogger extends Logger = Logger,
	>(
		endpoints: Endpoint<string, HttpMethod, any, any, TServices, TLogger>[],
		app: Hono,
		docsPath: string,
		openApiOptions?: HonoEndpointOptions['openApiOptions'],
	): void {
		app.get(docsPath, async (c) => {
			try {
				const openApiSchema = await Endpoint.buildOpenApiSchema(
					endpoints,
					openApiOptions,
				);

				return c.json(openApiSchema);
			} catch {
				return c.json(
					{ error: 'Failed to generate OpenAPI documentation' },
					500,
				);
			}
		});
	}
}

/**
 * What a client is told about a failed request: what went wrong, and the stack
 * only under `gkm dev`. A server's stack is its file layout and its
 * dependencies' versions — for the person debugging it, not for whoever sent
 * the request. A server failure's details are the error it wrapped (an
 * environment variable it could not read, a query that failed), so they go to
 * the log and not the response either; a 4xx's details are the client's.
 */
function errorBody(error: HttpError) {
	const internal = error.statusCode >= 500 && !HonoEndpoint.isDev;
	return {
		name: error.name,
		message: error.message,
		statusCode: error.statusCode,
		statusMessage: error.statusMessage,
		code: error.code,
		...(internal ? {} : { details: error.details }),
		...(HonoEndpoint.isDev ? { stack: error.stack } : {}),
	};
}

/**
 * The headers an error says its response carries — a 429's `Retry-After` and
 * `X-RateLimit-*` — on the response that reports it.
 */
function setErrorHeaders(c: Context, error: HttpError): void {
	for (const [key, value] of Object.entries(error.headers ?? {})) {
		c.header(key, value);
	}
}
