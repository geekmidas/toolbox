import type { Context as LambdaContext } from 'aws-lambda';
import { nanoid } from 'nanoid';
import { flushTelemetry } from '../instrumentation/core';
import type { Telescope } from '../Telescope';
import type {
	AdapterRequestContext,
	AdapterResponseContext,
	LambdaAdapterConfig,
	TelescopeAdapter,
} from './types';

// Re-export Middy middleware for convenience
export {
	createTelescopeHandler,
	type TelescopeMiddlewareOptions,
	telescopeMiddleware,
} from './middy';

/**
 * Lambda resource attributes detected from environment
 */
export interface LambdaResourceAttributes {
	'cloud.provider': 'aws';
	'cloud.region': string;
	'faas.name': string;
	'faas.version': string;
	'faas.instance': string;
	'faas.max_memory': number;
	[key: string]: string | number;
}

/**
 * Detect Lambda resource attributes from environment
 */
export function detectLambdaResources(): LambdaResourceAttributes {
	return {
		'cloud.provider': 'aws',
		'cloud.region': process.env.AWS_REGION || 'unknown',
		'faas.name': process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
		'faas.version': process.env.AWS_LAMBDA_FUNCTION_VERSION || 'unknown',
		'faas.instance': process.env.AWS_LAMBDA_LOG_STREAM_NAME || 'unknown',
		'faas.max_memory': parseInt(
			process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE || '128',
			10,
		),
	};
}

/**
 * Extract invocation context from Lambda event
 */
export function extractLambdaInvocationContext(
	event: unknown,
	context: LambdaContext,
): {
	requestId: string;
	coldStart: boolean;
	remainingTimeMs: number;
	memoryLimitMB: number;
	functionName: string;
	functionVersion: string;
} {
	return {
		requestId: context.awsRequestId,
		coldStart: !globalLambdaState.initialized,
		remainingTimeMs: context.getRemainingTimeInMillis(),
		memoryLimitMB: parseInt(String(context.memoryLimitInMB), 10),
		functionName: context.functionName,
		functionVersion: context.functionVersion,
	};
}

/**
 * Global state to track Lambda cold starts
 */
const globalLambdaState = {
	initialized: false,
};

/**
 * Default Lambda adapter configuration
 */
const DEFAULT_LAMBDA_CONFIG: LambdaAdapterConfig = {
	environment: 'lambda',
	spanProcessor: {
		strategy: 'simple', // Always use simple for Lambda
	},
	autoFlush: true,
	detectResource: true,
};

/**
 * Lambda adapter for Telescope.
 * Provides Lambda-specific request/response handling with auto-flush.
 */
export class LambdaAdapter implements TelescopeAdapter<LambdaAdapterConfig> {
	readonly config: LambdaAdapterConfig;
	private telescope: Telescope;
	private resourceAttributes: LambdaResourceAttributes | null = null;

	constructor(telescope: Telescope, config: Partial<LambdaAdapterConfig> = {}) {
		this.telescope = telescope;
		this.config = { ...DEFAULT_LAMBDA_CONFIG, ...config };
	}

	async onSetup(): Promise<void> {
		if (this.config.detectResource) {
			this.resourceAttributes = detectLambdaResources();
		}
		globalLambdaState.initialized = true;
	}

	async onDestroy(): Promise<void> {
		await flushTelemetry();
	}

	/**
	 * Extract request context from API Gateway event
	 */
	extractRequestContext(event: unknown): AdapterRequestContext {
		// Handle API Gateway v1 (REST API)
		if (isApiGatewayV1Event(event)) {
			return {
				id: event.requestContext?.requestId || nanoid(),
				method: event.httpMethod || 'UNKNOWN',
				path: event.path || '/',
				url: event.path || '/',
				headers: normalizeHeaders(event.headers || {}),
				query: event.queryStringParameters || {},
				body: parseBody(event.body, event.isBase64Encoded),
				ip:
					event.requestContext?.identity?.sourceIp ||
					event.headers?.['X-Forwarded-For']?.split(',')[0],
				startTime: Date.now(),
			};
		}

		// Handle API Gateway v2 (HTTP API)
		if (isApiGatewayV2Event(event)) {
			return {
				id: event.requestContext?.requestId || nanoid(),
				method: event.requestContext?.http?.method || 'UNKNOWN',
				path: event.rawPath || '/',
				url: event.rawPath || '/',
				headers: normalizeHeaders(event.headers || {}),
				query: event.queryStringParameters || {},
				body: parseBody(event.body, event.isBase64Encoded),
				ip:
					event.requestContext?.http?.sourceIp ||
					event.headers?.['x-forwarded-for']?.split(',')[0],
				startTime: Date.now(),
			};
		}

		// Handle ALB event
		if (isAlbEvent(event)) {
			return {
				id: nanoid(),
				method: event.httpMethod || 'UNKNOWN',
				path: event.path || '/',
				url: event.path || '/',
				headers: normalizeHeaders(event.headers || {}),
				query: event.queryStringParameters || {},
				body: parseBody(event.body, event.isBase64Encoded),
				ip: event.headers?.['x-forwarded-for']?.split(',')[0],
				startTime: Date.now(),
			};
		}

		// Generic Lambda invocation (not HTTP)
		return {
			id: nanoid(),
			method: 'INVOKE',
			path: '/',
			url: '/',
			headers: {},
			query: {},
			body: event,
			startTime: Date.now(),
		};
	}

	/**
	 * Extract response context from Lambda response
	 */
	extractResponseContext(
		response: unknown,
		startTime: number,
	): AdapterResponseContext {
		const duration = Date.now() - startTime;

		// API Gateway response format
		if (isApiGatewayResponse(response)) {
			return {
				status: response.statusCode || 200,
				headers: normalizeHeaders(response.headers || {}),
				body: response.body,
				duration,
			};
		}

		// Generic response
		return {
			status: 200,
			headers: {},
			body: response,
			duration,
		};
	}

	/**
	 * Flush telemetry data before Lambda context freezes
	 */
	async flush(): Promise<void> {
		await flushTelemetry();
	}

	/**
	 * Get resource attributes for the Lambda function
	 */
	getResourceAttributes(): LambdaResourceAttributes | null {
		return this.resourceAttributes;
	}
}

/**
 * Wrap a Lambda handler to automatically record requests and flush telemetry.
 *
 * @example
 * ```typescript
 * import { wrapLambdaHandler } from '@geekmidas/telescope/adapters/lambda';
 *
 * const telescope = new Telescope({ storage: new InMemoryStorage() });
 *
 * export const handler = wrapLambdaHandler(telescope, async (event, context) => {
 *   // Your Lambda logic here
 *   return { statusCode: 200, body: JSON.stringify({ success: true }) };
 * });
 * ```
 */
export function wrapLambdaHandler<TEvent, TResult>(
	telescope: Telescope,
	handler: (event: TEvent, context: LambdaContext) => Promise<TResult>,
	options: Partial<LambdaAdapterConfig> = {},
): (event: TEvent, context: LambdaContext) => Promise<TResult> {
	const adapter = new LambdaAdapter(telescope, options);

	return async (event: TEvent, context: LambdaContext): Promise<TResult> => {
		const requestContext = adapter.extractRequestContext(event);

		try {
			const result = await handler(event, context);

			// Record the request
			const responseContext = adapter.extractResponseContext(
				result,
				requestContext.startTime,
			);

			await telescope.recordRequest({
				method: requestContext.method,
				path: requestContext.path,
				url: requestContext.url,
				headers: requestContext.headers,
				query: requestContext.query,
				body: requestContext.body,
				ip: requestContext.ip,
				status: responseContext.status,
				responseHeaders: responseContext.headers,
				responseBody: responseContext.body,
				duration: responseContext.duration,
			});

			return result;
		} catch (error) {
			// Record the exception
			if (error instanceof Error) {
				await telescope.exception(error, requestContext.id);
			}
			throw error;
		} finally {
			// Always flush before Lambda freezes
			if (options.autoFlush !== false) {
				await adapter.flush();
			}
		}
	};
}

// ============================================
// Type Guards and Helpers
// ============================================

interface ApiGatewayV1Event {
	httpMethod?: string;
	path?: string;
	headers?: Record<string, string | undefined>;
	queryStringParameters?: Record<string, string>;
	body?: string | null;
	isBase64Encoded?: boolean;
	requestContext?: {
		requestId?: string;
		identity?: {
			sourceIp?: string;
		};
	};
}

interface ApiGatewayV2Event {
	rawPath?: string;
	headers?: Record<string, string | undefined>;
	queryStringParameters?: Record<string, string>;
	body?: string | null;
	isBase64Encoded?: boolean;
	requestContext?: {
		requestId?: string;
		http?: {
			method?: string;
			sourceIp?: string;
		};
	};
}

interface AlbEvent {
	httpMethod?: string;
	path?: string;
	headers?: Record<string, string | undefined>;
	queryStringParameters?: Record<string, string>;
	body?: string | null;
	isBase64Encoded?: boolean;
}

interface ApiGatewayResponse {
	statusCode?: number;
	headers?: Record<string, string | undefined>;
	body?: unknown;
}

function isApiGatewayV1Event(event: unknown): event is ApiGatewayV1Event {
	return (
		typeof event === 'object' &&
		event !== null &&
		'httpMethod' in event &&
		'path' in event
	);
}

function isApiGatewayV2Event(event: unknown): event is ApiGatewayV2Event {
	return (
		typeof event === 'object' &&
		event !== null &&
		'rawPath' in event &&
		'requestContext' in event &&
		typeof (event as ApiGatewayV2Event).requestContext === 'object' &&
		'http' in ((event as ApiGatewayV2Event).requestContext || {})
	);
}

function isAlbEvent(event: unknown): event is AlbEvent {
	return (
		typeof event === 'object' &&
		event !== null &&
		'httpMethod' in event &&
		!('requestContext' in event)
	);
}

function isApiGatewayResponse(
	response: unknown,
): response is ApiGatewayResponse {
	return (
		typeof response === 'object' &&
		response !== null &&
		'statusCode' in response
	);
}

function normalizeHeaders(
	headers: Record<string, string | undefined>,
): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (value !== undefined) {
			normalized[key.toLowerCase()] = value;
		}
	}
	return normalized;
}

function parseBody(
	body: string | null | undefined,
	isBase64Encoded?: boolean,
): unknown {
	if (!body) return undefined;

	try {
		const decoded = isBase64Encoded
			? Buffer.from(body, 'base64').toString('utf-8')
			: body;

		// Try to parse as JSON
		return JSON.parse(decoded);
	} catch {
		// Return raw string if not JSON
		return body;
	}
}
