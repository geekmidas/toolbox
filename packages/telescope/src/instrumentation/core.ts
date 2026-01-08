import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import {
	BatchSpanProcessor,
	type ReadableSpan,
	SimpleSpanProcessor,
	type Span,
	type SpanExporter,
	type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type {
	SpanProcessorOptions,
	SpanProcessorStrategy,
} from '../adapters/types';

/**
 * Global telemetry state for flush operations
 */
interface TelemetryState {
	spanProcessor: SpanProcessor | null;
	logProcessor: unknown | null;
	initialized: boolean;
}

const state: TelemetryState = {
	spanProcessor: null,
	logProcessor: null,
	initialized: false,
};

/**
 * Create a span processor based on the strategy
 */
export function createSpanProcessor(
	exporter: SpanExporter,
	options: SpanProcessorOptions,
): SpanProcessor {
	const { strategy, ...config } = options;

	if (strategy === 'simple') {
		return new SimpleSpanProcessor(exporter);
	}

	return new BatchSpanProcessor(exporter, {
		maxQueueSize: config.maxQueueSize ?? 2048,
		scheduledDelayMillis: config.scheduledDelayMillis ?? 5000,
		exportTimeoutMillis: config.exportTimeoutMillis ?? 30000,
		maxExportBatchSize: config.maxExportBatchSize ?? 512,
	});
}

/**
 * Get the recommended span processor strategy for an environment
 */
export function getRecommendedStrategy(
	environment: 'server' | 'lambda' | 'edge' | 'custom',
): SpanProcessorStrategy {
	switch (environment) {
		case 'lambda':
		case 'edge':
			// Use simple processor for serverless - immediate export
			return 'simple';
		case 'server':
		case 'custom':
		default:
			// Use batch processor for long-running servers - efficient batching
			return 'batch';
	}
}

/**
 * Set the global span processor for flush operations
 */
export function setGlobalSpanProcessor(processor: SpanProcessor): void {
	state.spanProcessor = processor;
	state.initialized = true;
}

/**
 * Set the global log processor for flush operations
 */
export function setGlobalLogProcessor(processor: unknown): void {
	state.logProcessor = processor;
}

/**
 * Check if telemetry is initialized
 */
export function isTelemetryInitialized(): boolean {
	return state.initialized;
}

/**
 * Flush all pending telemetry data.
 * This is critical for serverless environments where the process may freeze.
 *
 * @example
 * ```typescript
 * // In a Lambda handler
 * export const handler = async (event, context) => {
 *   try {
 *     const result = await processRequest(event);
 *     return result;
 *   } finally {
 *     // Flush before Lambda freezes
 *     await flushTelemetry();
 *   }
 * };
 * ```
 */
export async function flushTelemetry(timeoutMs = 30000): Promise<void> {
	const promises: Promise<void>[] = [];

	// Flush span processor
	if (state.spanProcessor) {
		promises.push(
			Promise.race([
				state.spanProcessor.forceFlush(),
				new Promise<void>((_, reject) =>
					setTimeout(() => reject(new Error('Span flush timeout')), timeoutMs),
				),
			]).catch((error) => {
				if (diag.debug) {
					diag.debug(`Span flush error: ${error.message}`);
				}
			}),
		);
	}

	// Flush log processor if it has forceFlush method
	if (
		state.logProcessor &&
		typeof (state.logProcessor as { forceFlush?: () => Promise<void> })
			.forceFlush === 'function'
	) {
		promises.push(
			Promise.race([
				(
					state.logProcessor as { forceFlush: () => Promise<void> }
				).forceFlush(),
				new Promise<void>((_, reject) =>
					setTimeout(() => reject(new Error('Log flush timeout')), timeoutMs),
				),
			]).catch((error) => {
				if (diag.debug) {
					diag.debug(`Log flush error: ${error.message}`);
				}
			}),
		);
	}

	await Promise.all(promises);
}

/**
 * Shutdown all telemetry processors
 */
export async function shutdownTelemetry(): Promise<void> {
	const promises: Promise<void>[] = [];

	if (state.spanProcessor) {
		promises.push(state.spanProcessor.shutdown());
		state.spanProcessor = null;
	}

	if (
		state.logProcessor &&
		typeof (state.logProcessor as { shutdown?: () => Promise<void> })
			.shutdown === 'function'
	) {
		promises.push(
			(state.logProcessor as { shutdown: () => Promise<void> }).shutdown(),
		);
		state.logProcessor = null;
	}

	state.initialized = false;
	await Promise.all(promises);
}

/**
 * Enable debug logging for telemetry
 */
export function enableTelemetryDebug(): void {
	diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

/**
 * Wraps a handler function to ensure telemetry is flushed before returning.
 * Useful for Lambda handlers.
 *
 * @example
 * ```typescript
 * export const handler = withTelemetryFlush(async (event, context) => {
 *   // Your Lambda logic here
 *   return { statusCode: 200, body: 'OK' };
 * });
 * ```
 */
export function withTelemetryFlush<TEvent, TResult>(
	handler: (event: TEvent, context: unknown) => Promise<TResult>,
): (event: TEvent, context: unknown) => Promise<TResult> {
	return async (event: TEvent, context: unknown): Promise<TResult> => {
		try {
			return await handler(event, context);
		} finally {
			await flushTelemetry();
		}
	};
}

/**
 * Noop span processor for testing or when telemetry is disabled
 */
export class NoopSpanProcessor implements SpanProcessor {
	forceFlush(): Promise<void> {
		return Promise.resolve();
	}

	onStart(_span: Span): void {
		// noop
	}

	onEnd(_span: ReadableSpan): void {
		// noop
	}

	shutdown(): Promise<void> {
		return Promise.resolve();
	}
}
