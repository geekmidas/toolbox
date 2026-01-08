import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createSpanProcessor,
	flushTelemetry,
	getRecommendedStrategy,
	isTelemetryInitialized,
	NoopSpanProcessor,
	setGlobalLogProcessor,
	setGlobalSpanProcessor,
	shutdownTelemetry,
	withTelemetryFlush,
} from '../core';

describe('core telemetry utilities', () => {
	beforeEach(async () => {
		// Reset state before each test
		await shutdownTelemetry();
	});

	afterEach(async () => {
		await shutdownTelemetry();
	});

	describe('createSpanProcessor', () => {
		const mockExporter: SpanExporter = {
			export: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};

		it('should create a simple span processor when strategy is simple', () => {
			const processor = createSpanProcessor(mockExporter, {
				strategy: 'simple',
			});

			expect(processor).toBeDefined();
			expect(processor.forceFlush).toBeDefined();
		});

		it('should create a batch span processor when strategy is batch', () => {
			const processor = createSpanProcessor(mockExporter, {
				strategy: 'batch',
			});

			expect(processor).toBeDefined();
			expect(processor.forceFlush).toBeDefined();
		});

		it('should create batch processor with custom options', () => {
			const processor = createSpanProcessor(mockExporter, {
				strategy: 'batch',
				maxQueueSize: 1024,
				scheduledDelayMillis: 1000,
				exportTimeoutMillis: 10000,
				maxExportBatchSize: 256,
			});

			expect(processor).toBeDefined();
		});

		it('should default to batch when strategy is not simple', () => {
			const processor = createSpanProcessor(mockExporter, {
				strategy: 'batch',
			});

			expect(processor).toBeDefined();
		});
	});

	describe('getRecommendedStrategy', () => {
		it('should return simple for lambda environment', () => {
			expect(getRecommendedStrategy('lambda')).toBe('simple');
		});

		it('should return simple for edge environment', () => {
			expect(getRecommendedStrategy('edge')).toBe('simple');
		});

		it('should return batch for server environment', () => {
			expect(getRecommendedStrategy('server')).toBe('batch');
		});

		it('should return batch for custom environment', () => {
			expect(getRecommendedStrategy('custom')).toBe('batch');
		});
	});

	describe('global state management', () => {
		it('should track initialization state', () => {
			expect(isTelemetryInitialized()).toBe(false);

			const processor = new NoopSpanProcessor();
			setGlobalSpanProcessor(processor);

			expect(isTelemetryInitialized()).toBe(true);
		});

		it('should set and use global log processor', () => {
			const mockLogProcessor = {
				forceFlush: vi.fn().mockResolvedValue(undefined),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};

			setGlobalLogProcessor(mockLogProcessor);
			// The log processor is stored internally
		});
	});

	describe('flushTelemetry', () => {
		it('should flush span processor', async () => {
			const processor = new NoopSpanProcessor();
			const flushSpy = vi.spyOn(processor, 'forceFlush');
			setGlobalSpanProcessor(processor);

			await flushTelemetry();

			expect(flushSpy).toHaveBeenCalled();
		});

		it('should flush log processor if available', async () => {
			const mockLogProcessor = {
				forceFlush: vi.fn().mockResolvedValue(undefined),
			};
			setGlobalLogProcessor(mockLogProcessor);

			await flushTelemetry();

			expect(mockLogProcessor.forceFlush).toHaveBeenCalled();
		});

		it('should handle flush timeout gracefully', async () => {
			const slowProcessor = {
				forceFlush: vi
					.fn()
					.mockImplementation(
						() => new Promise((resolve) => setTimeout(resolve, 100000)),
					),
				onStart: vi.fn(),
				onEnd: vi.fn(),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			setGlobalSpanProcessor(slowProcessor);

			// Should not throw, should timeout gracefully
			await flushTelemetry(10); // Very short timeout
		});

		it('should do nothing if not initialized', async () => {
			// No processor set, should complete without error
			await flushTelemetry();
		});
	});

	describe('shutdownTelemetry', () => {
		it('should shutdown span processor', async () => {
			const processor = new NoopSpanProcessor();
			const shutdownSpy = vi.spyOn(processor, 'shutdown');
			setGlobalSpanProcessor(processor);

			await shutdownTelemetry();

			expect(shutdownSpy).toHaveBeenCalled();
			expect(isTelemetryInitialized()).toBe(false);
		});

		it('should shutdown log processor if available', async () => {
			const mockLogProcessor = {
				forceFlush: vi.fn().mockResolvedValue(undefined),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			setGlobalLogProcessor(mockLogProcessor);

			await shutdownTelemetry();

			expect(mockLogProcessor.shutdown).toHaveBeenCalled();
		});

		it('should handle multiple shutdowns gracefully', async () => {
			const processor = new NoopSpanProcessor();
			setGlobalSpanProcessor(processor);

			await shutdownTelemetry();
			await shutdownTelemetry(); // Second call should be safe
		});
	});

	describe('withTelemetryFlush', () => {
		it('should wrap handler and flush after execution', async () => {
			const processor = new NoopSpanProcessor();
			const flushSpy = vi.spyOn(processor, 'forceFlush');
			setGlobalSpanProcessor(processor);

			const mockHandler = vi.fn().mockResolvedValue({ result: 'success' });
			const wrappedHandler = withTelemetryFlush(mockHandler);

			const result = await wrappedHandler({ event: 'test' }, {});

			expect(result).toEqual({ result: 'success' });
			expect(mockHandler).toHaveBeenCalledWith({ event: 'test' }, {});
			expect(flushSpy).toHaveBeenCalled();
		});

		it('should flush even when handler throws', async () => {
			const processor = new NoopSpanProcessor();
			const flushSpy = vi.spyOn(processor, 'forceFlush');
			setGlobalSpanProcessor(processor);

			const mockHandler = vi.fn().mockRejectedValue(new Error('Handler error'));
			const wrappedHandler = withTelemetryFlush(mockHandler);

			await expect(wrappedHandler({ event: 'test' }, {})).rejects.toThrow(
				'Handler error',
			);
			expect(flushSpy).toHaveBeenCalled();
		});
	});

	describe('NoopSpanProcessor', () => {
		it('should implement SpanProcessor interface', () => {
			const processor = new NoopSpanProcessor();

			expect(processor.forceFlush).toBeDefined();
			expect(processor.onStart).toBeDefined();
			expect(processor.onEnd).toBeDefined();
			expect(processor.shutdown).toBeDefined();
		});

		it('should resolve forceFlush immediately', async () => {
			const processor = new NoopSpanProcessor();
			await processor.forceFlush();
		});

		it('should resolve shutdown immediately', async () => {
			const processor = new NoopSpanProcessor();
			await processor.shutdown();
		});

		it('should do nothing on onStart', () => {
			const processor = new NoopSpanProcessor();
			processor.onStart({} as any);
		});

		it('should do nothing on onEnd', () => {
			const processor = new NoopSpanProcessor();
			processor.onEnd({} as any);
		});
	});
});
