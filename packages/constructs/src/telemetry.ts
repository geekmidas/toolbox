/**
 * Telemetry interface for endpoint instrumentation
 *
 * This provides a framework-agnostic way to add telemetry to endpoints.
 * Implementations can use OpenTelemetry, DataDog, or any other system.
 */
import type { Context as LambdaContext } from 'aws-lambda';

/**
 * Context object returned by onRequestStart, passed to subsequent hooks
 */
export interface TelemetryContext {
	/**
	 * Any data the telemetry implementation needs to track across the request lifecycle
	 */
	[key: string]: unknown;
}

/**
 * Request information passed to telemetry hooks
 */
export interface TelemetryRequest {
	/**
	 * The raw Lambda event
	 */
	event: any;

	/**
	 * The Lambda context
	 */
	context: LambdaContext;
}

/**
 * Response information passed to onRequestEnd
 */
export interface TelemetryResponse {
	/**
	 * HTTP status code
	 */
	statusCode: number;

	/**
	 * Response body (may be stringified JSON)
	 */
	body?: string;

	/**
	 * Response headers
	 */
	headers?: Record<string, string>;
}

/**
 * Telemetry interface for instrumenting endpoint requests
 *
 * @example
 * ```typescript
 * const telemetry: Telemetry = {
 *   onRequestStart(req) {
 *     const span = tracer.startSpan('http.request');
 *     return { span };
 *   },
 *   onRequestEnd(ctx, response) {
 *     ctx.span.setStatus(response.statusCode);
 *     ctx.span.end();
 *   },
 *   onRequestError(ctx, error) {
 *     ctx.span.recordException(error);
 *     ctx.span.end();
 *   },
 * };
 *
 * const adaptor = new AmazonApiGatewayV2Endpoint(envParser, endpoint, {
 *   telemetry,
 * });
 * ```
 */
export interface Telemetry {
	/**
	 * Called at the start of each request
	 *
	 * @param request - The incoming request information
	 * @returns Context object that will be passed to onRequestEnd/onRequestError
	 */
	onRequestStart(request: TelemetryRequest): TelemetryContext;

	/**
	 * Called when the request completes successfully
	 *
	 * @param ctx - The context returned by onRequestStart
	 * @param response - The response information
	 */
	onRequestEnd(ctx: TelemetryContext, response: TelemetryResponse): void;

	/**
	 * Called when the request fails with an error
	 *
	 * @param ctx - The context returned by onRequestStart
	 * @param error - The error that occurred
	 */
	onRequestError(ctx: TelemetryContext, error: Error): void;
}
