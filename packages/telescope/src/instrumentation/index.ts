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

export { setupTelemetry, shutdownTelemetry } from './setup';
export type { TelemetryOptions } from './setup';
export {
  createSpan,
  withSpan,
  withSpanSync,
  getActiveSpan,
  setSpanAttributes,
  getTraceId,
  getSpanId,
  recordException,
  addSpanEvent,
} from './tracing';
export {
  createSpanProcessor,
  getRecommendedStrategy,
  flushTelemetry,
  withTelemetryFlush,
  setGlobalSpanProcessor,
  setGlobalLogProcessor,
  isTelemetryInitialized,
  enableTelemetryDebug,
  NoopSpanProcessor,
} from './core';
export type {
  SpanProcessorOptions,
  SpanProcessorStrategy,
} from '../adapters/types';

// HTTP instrumentation utilities for constructs
export {
  getConstructsTracer,
  toOtelAttributes,
  extractTraceContext,
  injectTraceContext,
  createHttpServerSpan,
  endHttpSpan,
  withHttpSpan,
  createChildSpan,
  withChildSpan,
  isTracingEnabled,
} from './http';
export type {
  HttpRequestAttributes,
  HttpResponseAttributes,
  EndpointAttributes,
  UserAttributes,
  HttpSpanAttributes,
} from './http';

// Middleware for Lambda auto-instrumentation
export {
  telemetryMiddleware,
  getSpanFromEvent,
  getContextFromEvent,
  withEventContext,
} from './middleware';
export type { TelemetryMiddlewareOptions } from './middleware';

// Middleware for Hono auto-instrumentation
export {
  honoTelemetryMiddleware,
  getSpanFromContext,
  getTraceContextFromHono,
  withHonoSpanContext,
} from './hono';
export type { HonoTelemetryMiddlewareOptions } from './hono';

// OTelTelemetry - Telemetry interface implementation using OpenTelemetry
export { OTelTelemetry } from './otel';
export type { OTelTelemetryOptions } from './otel';
