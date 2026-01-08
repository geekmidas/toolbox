/**
 * OpenTelemetry instrumentation middleware for @geekmidas/constructs
 *
 * This middleware automatically creates spans for HTTP requests,
 * extracts trace context from incoming headers, and records
 * request/response metadata as span attributes.
 */
import type { MiddlewareObj } from '@middy/core';
import { context, type Span, trace } from '@opentelemetry/api';
import type { Context as LambdaContext } from 'aws-lambda';
import {
	createHttpServerSpan,
	endHttpSpan,
	extractTraceContext,
	type HttpSpanAttributes,
} from './http';

/**
 * Options for the telemetry middleware
 */
export interface TelemetryMiddlewareOptions {
	/**
	 * Whether to record request body as span attribute
	 * @default false
	 */
	recordBody?: boolean;

	/**
	 * Whether to record response body as span attribute
	 * @default false
	 */
	recordResponseBody?: boolean;

	/**
	 * Custom function to extract endpoint name from event
	 */
	getEndpointName?: (event: any) => string | undefined;

	/**
	 * Custom function to extract operation ID from event
	 */
	getOperationId?: (event: any) => string | undefined;

	/**
	 * Custom function to extract user ID from event
	 */
	getUserId?: (event: any) => string | undefined;

	/**
	 * Whether to skip tracing for this request
	 */
	shouldSkip?: (event: any) => boolean;
}

// Symbol for storing span on event
const SPAN_SYMBOL = Symbol('telemetry.span');
const CONTEXT_SYMBOL = Symbol('telemetry.context');

/**
 * Get the current span from the Lambda event
 */
export function getSpanFromEvent(event: any): Span | undefined {
	return event?.[SPAN_SYMBOL];
}

/**
 * Get the current trace context from the Lambda event
 */
export function getContextFromEvent(event: any): any {
	return event?.[CONTEXT_SYMBOL];
}

/**
 * Create a telemetry middleware for Lambda handlers
 *
 * @example
 * ```typescript
 * import { telemetryMiddleware } from '@geekmidas/telescope/instrumentation';
 *
 * const adaptor = new AmazonApiGatewayV2Endpoint(envParser, endpoint, {
 *   telemetry: { middleware: telemetryMiddleware() },
 * });
 * ```
 */
export function telemetryMiddleware(
	options: TelemetryMiddlewareOptions = {},
): MiddlewareObj<any, any, Error, LambdaContext> {
	return {
		before: async (request) => {
			// Skip if custom skip function returns true
			if (options.shouldSkip?.(request.event)) {
				return;
			}

			const event = request.event;
			const lambdaContext = request.context;

			// Extract trace context from headers
			const headers = normalizeHeaders(event.headers || {});
			const parentContext = extractTraceContext(headers);

			// Build span attributes from event
			const attrs = buildSpanAttributes(event, lambdaContext, options);

			// Create the span
			const span = createHttpServerSpan(attrs, parentContext);

			// Store span and context on event for access in handler
			event[SPAN_SYMBOL] = span;
			event[CONTEXT_SYMBOL] = trace.setSpan(parentContext, span);

			// Add Lambda-specific attributes
			span.setAttribute('faas.invocation_id', lambdaContext.awsRequestId);
			span.setAttribute('faas.name', lambdaContext.functionName);

			if (options.recordBody && event.body) {
				const bodyStr =
					typeof event.body === 'string'
						? event.body
						: JSON.stringify(event.body);
				// Truncate large bodies
				span.setAttribute(
					'http.request.body',
					bodyStr.length > 4096 ? `${bodyStr.slice(0, 4096)}...` : bodyStr,
				);
			}
		},

		after: async (request) => {
			const span = getSpanFromEvent(request.event);
			if (!span) {
				return;
			}

			const response = request.response;
			const statusCode =
				typeof response?.statusCode === 'number' ? response.statusCode : 200;

			if (options.recordResponseBody && response?.body) {
				const bodyStr =
					typeof response.body === 'string'
						? response.body
						: JSON.stringify(response.body);
				span.setAttribute(
					'http.response.body',
					bodyStr.length > 4096 ? `${bodyStr.slice(0, 4096)}...` : bodyStr,
				);
			}

			endHttpSpan(span, { statusCode });
		},

		onError: async (request) => {
			const span = getSpanFromEvent(request.event);
			if (!span) {
				return;
			}

			const error = request.error;
			const response = request.response;

			// Determine status code from response or error
			let statusCode = 500;
			if (response?.statusCode) {
				statusCode = response.statusCode;
			} else if (error && 'statusCode' in error) {
				statusCode = (error as any).statusCode;
			}

			endHttpSpan(
				span,
				{ statusCode },
				error instanceof Error ? error : new Error(String(error)),
			);
		},
	};
}

/**
 * Build span attributes from Lambda event
 */
function buildSpanAttributes(
	event: any,
	lambdaContext: LambdaContext,
	options: TelemetryMiddlewareOptions,
): HttpSpanAttributes {
	// Detect event type (API Gateway v1, v2, ALB, or direct invoke)
	const isV2 =
		'requestContext' in event && 'http' in (event.requestContext || {});
	const isV1 =
		'requestContext' in event &&
		'httpMethod' in event &&
		!('http' in (event.requestContext || {}));

	let method = 'INVOKE';
	let path = '/';
	let route: string | undefined;
	let host: string | undefined;
	let scheme: 'http' | 'https' | undefined;
	let userAgent: string | undefined;
	let clientIp: string | undefined;
	let requestId: string | undefined;

	if (isV2) {
		// API Gateway v2 (HTTP API)
		const http = event.requestContext.http;
		method = http.method;
		path = event.rawPath || http.path;
		route = event.routeKey?.replace(/^[A-Z]+\s+/, ''); // Remove HTTP method prefix
		host = event.headers?.host;
		scheme = 'https';
		userAgent = http.userAgent;
		clientIp = http.sourceIp;
		requestId = event.requestContext.requestId;
	} else if (isV1) {
		// API Gateway v1 (REST API)
		method = event.httpMethod;
		path = event.path;
		route = event.resource;
		host = event.headers?.Host || event.headers?.host;
		scheme = 'https';
		userAgent = event.headers?.['User-Agent'] || event.headers?.['user-agent'];
		clientIp = event.requestContext?.identity?.sourceIp;
		requestId = event.requestContext?.requestId;
	} else if ('httpMethod' in event) {
		// ALB event
		method = event.httpMethod;
		path = event.path;
		host = event.headers?.host;
		userAgent = event.headers?.['user-agent'] || event.headers?.['User-Agent'];
		clientIp = event.headers?.['x-forwarded-for']?.split(',')[0]?.trim();
	}

	const attrs: HttpSpanAttributes = {
		method,
		path,
		route,
		host,
		scheme,
		userAgent,
		clientIp,
		requestId: requestId || lambdaContext.awsRequestId,
	};

	// Add endpoint metadata if extractors provided
	if (options.getEndpointName || options.getOperationId) {
		attrs.endpoint = {
			name: options.getEndpointName?.(event),
			operationId: options.getOperationId?.(event),
		};
	}

	// Add user metadata if extractor provided
	if (options.getUserId) {
		const userId = options.getUserId(event);
		if (userId) {
			attrs.user = { userId };
		}
	}

	return attrs;
}

/**
 * Normalize headers to lowercase keys
 */
function normalizeHeaders(
	headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
	const normalized: Record<string, string | string[] | undefined> = {};
	for (const [key, value] of Object.entries(headers)) {
		normalized[key.toLowerCase()] = value;
	}
	return normalized;
}

/**
 * Run a function within the span context from a Lambda event
 *
 * @example
 * ```typescript
 * await withEventContext(event, async () => {
 *   // Any spans created here will be children of the request span
 *   await doSomething();
 * });
 * ```
 */
export async function withEventContext<T>(
	event: any,
	fn: () => Promise<T>,
): Promise<T> {
	const ctx = getContextFromEvent(event);
	if (!ctx) {
		return fn();
	}
	return context.with(ctx, fn);
}
