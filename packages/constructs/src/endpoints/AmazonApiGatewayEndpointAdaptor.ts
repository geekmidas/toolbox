import type { AuditableAction, AuditStorage } from '@geekmidas/audit';
import { withRlsContext } from '@geekmidas/db/rls';
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import middy, { type MiddlewareObj } from '@middy/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type {
	APIGatewayProxyEvent,
	APIGatewayProxyEventV2,
	Context,
} from 'aws-lambda';
import set from 'lodash.set';
import type { Telemetry } from '../telemetry';
import type { HttpMethod } from '../types';
import { Endpoint, type EndpointSchemas, ResponseBuilder } from './Endpoint';

/**
 * Telescope integration for request recording.
 * Uses Middy middleware pattern for compatibility with existing telescope package.
 */
export interface TelescopeIntegration {
	middleware: MiddlewareObj<any, any, Error, Context>;
}

import {
	UnauthorizedError,
	UnprocessableEntityError,
	wrapError,
} from '@geekmidas/errors';
import type { EventPublisher } from '@geekmidas/events';
import type {
	InferComposableStandardSchema,
	InferStandardSchema,
} from '@geekmidas/schema';
import {
	type Service,
	ServiceDiscovery,
	type ServiceRecord,
} from '@geekmidas/services';
import { publishConstructEvents } from '../publisher';
import type { MappedAudit } from './audit';
import type { CookieFn, HeaderFn } from './Endpoint';
import {
	createAuditContext,
	executeWithAuditTransaction,
} from './processAudits';

// Helper function to publish events

/**
 * Options for Amazon API Gateway endpoint adaptors
 */
export interface AmazonApiGatewayEndpointOptions {
	/**
	 * Telescope integration for request recording and monitoring.
	 *
	 * @example
	 * ```typescript
	 * import { telescopeMiddleware } from '@geekmidas/telescope/lambda';
	 *
	 * const adaptor = new AmazonApiGatewayV2Endpoint(envParser, endpoint, {
	 *   telescope: { middleware: telescopeMiddleware(telescope) },
	 * });
	 * ```
	 */
	telescope?: TelescopeIntegration;

	/**
	 * Telemetry integration for distributed tracing.
	 * Works with any OpenTelemetry-compatible backend.
	 *
	 * @example
	 * ```typescript
	 * import { OTelTelemetry } from '@geekmidas/telescope/instrumentation';
	 *
	 * const adaptor = new AmazonApiGatewayV2Endpoint(envParser, endpoint, {
	 *   telemetry: new OTelTelemetry(),
	 * });
	 * ```
	 */
	telemetry?: Telemetry;
}

export abstract class AmazonApiGatewayEndpoint<
	THandler extends
		| AmazonApiGatewayV1EndpointHandler
		| AmazonApiGatewayV2EndpointHandler,
	TEvent extends HandlerEvent<THandler>,
	TRoute extends string,
	TMethod extends HttpMethod,
	TInput extends EndpointSchemas = {},
	TOutSchema extends StandardSchemaV1 | undefined = undefined,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TSession = unknown,
	TEventPublisher extends EventPublisher<any> | undefined = undefined,
	TEventPublisherServiceName extends string = string,
	TAuditStorage extends AuditStorage | undefined = undefined,
	TAuditStorageServiceName extends string = string,
	TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
		string,
		unknown
	>,
> {
	protected options: AmazonApiGatewayEndpointOptions;

	constructor(
		protected envParser: EnvironmentParser<{}>,
		protected readonly endpoint: Endpoint<
			TRoute,
			TMethod,
			TInput,
			TOutSchema,
			TServices,
			TLogger,
			TSession,
			TEventPublisher,
			TEventPublisherServiceName,
			TAuditStorage,
			TAuditStorageServiceName,
			TAuditAction
		>,
		options: AmazonApiGatewayEndpointOptions = {},
	) {
		this.options = options;
	}

	private error(): Middleware<TEvent, TInput, TServices, TLogger> {
		return {
			onError: (req) => {
				(req.event.logger || this.endpoint.logger).error(
					req.error || {},
					'Error processing request',
				);
				const wrappedError = wrapError(req.error);

				// Set the response with the proper status code from the HttpError
				req.response = {
					statusCode: wrappedError.statusCode,
					body: wrappedError.body,
				};
			},
		};
	}
	abstract getInput(e: TEvent): GetInputResponse;

	private input(): Middleware<TEvent, TInput, TServices, TLogger> {
		return {
			before: async (req) => {
				try {
					const { body, query, params } = this.getInput(req.event);
					const headers = req.event.headers as Record<string, string>;
					const header = Endpoint.createHeaders(headers);
					const cookie = Endpoint.createCookies(headers.cookie);

					set(req.event, 'body', await this.endpoint.parseInput(body, 'body'));

					set(
						req.event,
						'query',
						await this.endpoint.parseInput(query, 'query'),
					);
					set(
						req.event,
						'params',
						await this.endpoint.parseInput(params, 'params'),
					);
					set(req.event, 'header', header);
					set(req.event, 'cookie', cookie);
				} catch (error) {
					// Convert validation errors to 422 Unprocessable Entity
					if (error && typeof error === 'object' && Array.isArray(error)) {
						throw new UnprocessableEntityError('Validation failed', error);
					}
					throw error;
				}
			},
		};
	}

	abstract getLoggerContext(data: TEvent, context: Context): LoggerContext;

	private logger(): Middleware<TEvent, TInput, TServices, TLogger> {
		return {
			before: (req) => {
				req.event.logger = this.endpoint.logger.child({
					route: this.endpoint.route,
					host: req.event.headers?.host,
					method: this.endpoint.method,
					...this.getLoggerContext(req.event, req.context),
				}) as TLogger;
			},
		};
	}
	private services(): Middleware<TEvent, TInput, TServices, TLogger> {
		return {
			before: async (req) => {
				const logger = req.event.logger as TLogger;
				const serviceDiscovery = ServiceDiscovery.getInstance<
					ServiceRecord<TServices>,
					TLogger
				>(logger, this.envParser);

				const services = await serviceDiscovery.register(
					this.endpoint.services,
				);

				req.event.services = services;
			},
		};
	}

	private authorize(): Middleware<TEvent, TInput, TServices, TLogger> {
		return {
			before: async (req) => {
				const logger = req.event.logger as TLogger;
				const services = req.event.services;
				const header = req.event.header;
				const cookie = req.event.cookie;
				const session = req.event.session as TSession;

				const isAuthorized = await this.endpoint.authorize({
					header,
					cookie,
					services,
					logger,
					session,
				});

				if (!isAuthorized) {
					logger.warn('Unauthorized access attempt');
					throw new UnauthorizedError(
						'Unauthorized access to the endpoint',
						'You do not have permission to access this resource.',
					);
				}
			},
		};
	}

	private database(): Middleware<TEvent, TInput, TServices, TLogger> {
		return {
			before: async (req) => {
				if (!this.endpoint.databaseService) {
					return;
				}

				const logger = req.event.logger as TLogger;
				const serviceDiscovery = ServiceDiscovery.getInstance<
					ServiceRecord<TServices>,
					TLogger
				>(logger, this.envParser);

				const db = await serviceDiscovery
					.register([this.endpoint.databaseService])
					.then(
						(s) =>
							s[this.endpoint.databaseService!.serviceName as keyof typeof s],
					);

				(req.event as any).db = db;
			},
		};
	}

	private session(): Middleware<TEvent, TInput, TServices, TLogger> {
		return {
			before: async (req) => {
				const logger = req.event.logger as TLogger;
				const services = req.event.services;
				const db = (req.event as any).db;
				req.event.session = (await this.endpoint.getSession({
					logger,
					services,
					header: req.event.header,
					cookie: req.event.cookie,
					...(db !== undefined && { db }),
				} as any)) as TSession;
			},
		};
	}

	private events(): Middleware<TEvent, TInput, TServices, TLogger> {
		return {
			after: async (req) => {
				const event = req.event;
				const response = (event as any)
					.__response as InferStandardSchema<TOutSchema>;
				const statusCode = req.response?.statusCode ?? this.endpoint.status;

				// Only publish events on successful responses (2xx status codes)
				// Note: Audits are processed inside the handler's transaction
				if (Endpoint.isSuccessStatus(statusCode)) {
					const logger = event.logger as TLogger;
					const serviceDiscovery = ServiceDiscovery.getInstance<
						ServiceRecord<TServices>,
						TLogger
					>(logger, this.envParser);

					// Publish events
					await publishConstructEvents(
						this.endpoint,
						response,
						serviceDiscovery,
						logger,
					);
				}
			},
		};
	}

	private async _handler(
		event: Event<TEvent, TInput, TServices, TLogger, TSession>,
	) {
		const input = this.endpoint.refineInput(event);
		const logger = event.logger as TLogger;
		const serviceDiscovery = ServiceDiscovery.getInstance<
			ServiceRecord<TServices>,
			TLogger
		>(logger, this.envParser);

		// Create audit context if audit storage is configured
		const auditContext = await createAuditContext(
			this.endpoint,
			serviceDiscovery,
			logger,
			{
				session: event.session,
				header: event.header,
				cookie: event.cookie,
				services: event.services as Record<string, unknown>,
			},
		);

		// Warn if declarative audits are configured but no audit storage
		const audits = this.endpoint.audits as MappedAudit<
			TAuditAction,
			TOutSchema
		>[];
		if (!auditContext && audits?.length) {
			logger.warn('No auditor storage service available');
		}

		// Get pre-resolved database from middleware
		const rawDb = (event as any).db;

		// Extract RLS context if configured and not bypassed
		const rlsActive =
			this.endpoint.rlsConfig &&
			!this.endpoint.rlsBypass &&
			rawDb !== undefined;
		const rlsContext = rlsActive
			? await this.endpoint.rlsConfig!.extractor({
					services: event.services as ServiceRecord<TServices>,
					session: event.session,
					header: event.header,
					cookie: event.cookie,
					logger,
				})
			: undefined;

		// Execute handler with automatic audit transaction support
		const result = await executeWithAuditTransaction(
			auditContext,
			async (auditor) => {
				// Use audit transaction as db only if the storage uses the same database service
				const sameDatabase =
					auditContext?.storage?.databaseServiceName &&
					auditContext.storage.databaseServiceName ===
						this.endpoint.databaseService?.serviceName;
				const baseDb = sameDatabase
					? (auditor?.getTransaction?.() ?? rawDb)
					: rawDb;

				// Helper to execute handler with given db
				const executeHandler = async (db: any) => {
					const responseBuilder = new ResponseBuilder();
					const response = await this.endpoint.handler(
						{
							header: event.header,
							cookie: event.cookie,
							logger: event.logger,
							services: event.services,
							session: event.session,
							auditor,
							db,
							...input,
						} as any,
						responseBuilder,
					);

					// Check if response has metadata
					let data = response;
					let metadata = responseBuilder.getMetadata();

					if (Endpoint.hasMetadata(response)) {
						data = response.data;
						metadata = response.metadata;
					}

					const output = this.endpoint.outputSchema
						? await this.endpoint.parseOutput(data)
						: undefined;

					return { output, metadata, responseBuilder };
				};

				// If RLS is active, wrap handler with RLS context
				if (rlsActive && rlsContext && baseDb) {
					return withRlsContext(
						baseDb,
						rlsContext,
						async (trx: any) => executeHandler(trx),
						{ prefix: this.endpoint.rlsConfig!.prefix },
					);
				}

				return executeHandler(baseDb);
			},
			// Process declarative audits after handler (inside transaction)
			async (result, auditor) => {
				if (!audits?.length) return;

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
			// Pass rawDb so storage can reuse existing transactions
			{ db: rawDb },
		);

		const { output, metadata } = result;
		const body = output !== undefined ? JSON.stringify(output) : undefined;

		// Store response for middleware access
		(event as any).__response = output;

		// Build response with metadata
		const lambdaResponse: AmazonApiGatewayEndpointHandlerResponse = {
			statusCode: metadata.status ?? this.endpoint.status,
			body,
		};

		// Add custom headers
		if (metadata.headers && Object.keys(metadata.headers).length > 0) {
			lambdaResponse.headers = { ...metadata.headers };
		}

		// Format cookies as Set-Cookie headers
		if (metadata.cookies && metadata.cookies.size > 0) {
			const setCookieHeaders: string[] = [];
			for (const [name, { value, options }] of metadata.cookies) {
				setCookieHeaders.push(
					Endpoint.formatCookieHeader(name, value, options),
				);
			}

			if (setCookieHeaders.length > 0) {
				lambdaResponse.multiValueHeaders = {
					...lambdaResponse.multiValueHeaders,
					'Set-Cookie': setCookieHeaders,
				};
			}
		}

		return lambdaResponse;
	}

	/**
	 * Convert Telemetry interface to Middy middleware
	 */
	private telemetry(): Middleware<TEvent, TInput, TServices, TLogger> | null {
		if (!this.options.telemetry) {
			return null;
		}

		const telemetry = this.options.telemetry;
		let ctx: any;

		return {
			before: (request) => {
				ctx = telemetry.onRequestStart({
					event: request.event,
					context: request.context,
				});
			},
			after: (request) => {
				if (ctx) {
					telemetry.onRequestEnd(ctx, {
						statusCode: request.response?.statusCode ?? 200,
						body: request.response?.body,
						headers: request.response?.headers,
					});
				}
			},
			onError: (request) => {
				if (ctx && request.error) {
					telemetry.onRequestError(
						ctx,
						request.error instanceof Error
							? request.error
							: new Error(String(request.error)),
					);
				}
			},
		};
	}

	get handler() {
		const handler = this._handler.bind(this);
		let chain = middy(handler)
			.use(this.logger())
			.use(this.error())
			.use(this.services())
			.use(this.input())
			.use(this.database())
			.use(this.session())
			.use(this.authorize())
			.use(this.events());

		// Add telemetry middleware if configured (runs early for span creation)
		const telemetryMiddleware = this.telemetry();
		if (telemetryMiddleware) {
			chain = chain.use(telemetryMiddleware);
		}

		// Add Telescope middleware if configured (runs first/last in chain)
		if (this.options.telescope?.middleware) {
			chain = chain.use(this.options.telescope.middleware);
		}

		return chain as unknown as THandler;
	}
}

export type Event<
	TEvent extends APIGatewayProxyEvent | APIGatewayProxyEventV2,
	TInput extends EndpointSchemas = {},
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TSession = unknown,
> = {
	services: ServiceRecord<TServices>;
	logger: TLogger;
	header: HeaderFn;
	cookie: CookieFn;
	session: TSession;
} & TEvent &
	InferComposableStandardSchema<TInput>;

type Middleware<
	TEvent extends APIGatewayProxyEvent | APIGatewayProxyEventV2,
	TInput extends EndpointSchemas = {},
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	TSession = unknown,
> = MiddlewareObj<Event<TEvent, TInput, TServices, TLogger, TSession>>;

export type AmazonApiGatewayEndpointHandlerResponse = {
	statusCode: number;
	body: string | undefined;
	headers?: Record<string, string>;
	multiValueHeaders?: Record<string, string[]>;
};

export type LoggerContext = {
	fn: {
		name: string;
		version: string;
	};
	req: {
		id: string | undefined;
		awsRequestId: string;
		path: string;
		ip: string | undefined;
		userAgent: string | undefined;
	};
};

export type GetInputResponse = {
	body: any;
	query: any;
	params: any;
};

export type AmazonApiGatewayV1EndpointHandler = (
	event: APIGatewayProxyEvent,
	context: Context,
) => Promise<AmazonApiGatewayEndpointHandlerResponse>;

export type AmazonApiGatewayV2EndpointHandler = (
	event: APIGatewayProxyEventV2,
	context: Context,
) => Promise<AmazonApiGatewayEndpointHandlerResponse>;

export type HandlerEvent<T extends Function> = T extends (
	event: infer E,
	context: Context,
) => any
	? E
	: never;
