/**
 * OpenTelemetry Instrumentation for @geekmidas/constructs
 *
 * This module provides automatic instrumentation for constructs endpoints,
 * functions, crons, and subscribers using the OpenTelemetry SDK.
 *
 * @example
 * ```typescript
 * import { setupTelemetry } from '@geekmidas/telescope/instrumentation';
 *
 * // Call before importing your app code
 * setupTelemetry({
 *   serviceName: 'my-api',
 *   // Dev: send to Telescope
 *   endpoint: 'http://localhost:3000/__telescope/v1',
 *   // Enable Pino log correlation
 *   instrumentPino: true,
 * });
 * ```
 */

export type {
	SpanProcessorOptions,
	SpanProcessorStrategy,
} from '../adapters/types';
export {
	createSpanProcessor,
	enableTelemetryDebug,
	flushTelemetry,
	getRecommendedStrategy,
	isTelemetryInitialized,
	NoopSpanProcessor,
	setGlobalLogProcessor,
	setGlobalSpanProcessor,
	withTelemetryFlush,
} from './core';
export type { HonoTelemetryMiddlewareOptions } from './hono';
// Middleware for Hono auto-instrumentation
export {
	getSpanFromContext,
	getTraceContextFromHono,
	honoTelemetryMiddleware,
	withHonoSpanContext,
} from './hono';
export type {
	EndpointAttributes,
	HttpRequestAttributes,
	HttpResponseAttributes,
	HttpSpanAttributes,
	UserAttributes,
} from './http';

// HTTP instrumentation utilities for constructs
export {
	createChildSpan,
	createHttpServerSpan,
	endHttpSpan,
	extractTraceContext,
	getConstructsTracer,
	injectTraceContext,
	isTracingEnabled,
	toOtelAttributes,
	withChildSpan,
	withHttpSpan,
} from './http';
export type { TelemetryMiddlewareOptions } from './middleware';

// Middleware for Lambda auto-instrumentation
export {
	getContextFromEvent,
	getSpanFromEvent,
	telemetryMiddleware,
	withEventContext,
} from './middleware';
export type { OTelTelemetryOptions } from './otel';
// OTelTelemetry - Telemetry interface implementation using OpenTelemetry
export { OTelTelemetry } from './otel';
export type { TelemetryOptions } from './setup';
export { setupTelemetry, shutdownTelemetry } from './setup';
export {
	addSpanEvent,
	createSpan,
	getActiveSpan,
	getSpanId,
	getTraceId,
	recordException,
	setSpanAttributes,
	withSpan,
	withSpanSync,
} from './tracing';
