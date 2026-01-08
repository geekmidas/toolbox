/**
 * Telescope Core
 *
 * Core types, interfaces, and utilities for Telescope.
 * This module is environment-agnostic and can be used anywhere.
 */

// Adapter types and interfaces
export type {
	AdapterConfig,
	AdapterErrorContext,
	AdapterLifecycle,
	AdapterRequestContext,
	AdapterResponseContext,
	HonoAdapterConfig,
	HonoContextWithTelescope,
	LambdaAdapterConfig,
	SpanProcessorOptions,
	SpanProcessorStrategy,
	TelescopeAdapter,
	TelescopeEnvironment,
	TelescopeHonoContext,
	TelescopeHonoVariables,
} from './adapters/types';

// Instrumentation core utilities
export {
	createSpanProcessor,
	enableTelemetryDebug,
	flushTelemetry,
	getRecommendedStrategy,
	isTelemetryInitialized,
	NoopSpanProcessor,
	setGlobalLogProcessor,
	setGlobalSpanProcessor,
	shutdownTelemetry,
	withTelemetryFlush,
} from './instrumentation/core';

// Tracing utilities
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
} from './instrumentation/tracing';
