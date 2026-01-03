import { trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addSpanEvent,
  createSpan,
  getActiveSpan,
  getSpanId,
  getTraceId,
  recordException,
  setSpanAttributes,
  withSpan,
  withSpanSync,
} from '../tracing';

describe('Tracing Utilities', () => {
  let provider: NodeTracerProvider;

  beforeAll(() => {
    // Register a real tracer provider for tests
    provider = new NodeTracerProvider();
    provider.register();
  });

  afterAll(async () => {
    await provider.shutdown();
    // Reset to default noop provider
    trace.disable();
  });
  describe('createSpan', () => {
    it('should create a new span', () => {
      const span = createSpan('test-span');
      expect(span).toBeDefined();
      expect(span.spanContext().spanId).toBeDefined();
      span.end();
    });

    it('should create span with attributes', () => {
      const span = createSpan('test-span-attrs', { 'test.attr': 'value' });
      expect(span).toBeDefined();
      span.end();
    });
  });

  describe('withSpan', () => {
    it('should execute function within span context', async () => {
      const result = await withSpan('async-operation', async (span) => {
        expect(span).toBeDefined();
        expect(span.spanContext().spanId).toBeDefined();
        return 'result';
      });

      expect(result).toBe('result');
    });

    it('should propagate errors', async () => {
      await expect(
        withSpan('error-span', async () => {
          throw new Error('Test error');
        }),
      ).rejects.toThrow('Test error');
    });

    it('should pass attributes to span', async () => {
      let spanReceived = false;
      await withSpan(
        'attr-span',
        async (span) => {
          spanReceived = true;
          expect(span).toBeDefined();
          return 'done';
        },
        { 'custom.attr': 123 },
      );
      expect(spanReceived).toBe(true);
    });
  });

  describe('withSpanSync', () => {
    it('should execute synchronous function within span context', () => {
      const result = withSpanSync('sync-operation', (span) => {
        expect(span).toBeDefined();
        return 42;
      });

      expect(result).toBe(42);
    });

    it('should handle errors in sync functions', () => {
      expect(() =>
        withSpanSync('sync-error', () => {
          throw new Error('Sync error');
        }),
      ).toThrow('Sync error');
    });
  });

  describe('getActiveSpan', () => {
    it('should return active span within withSpan', async () => {
      await withSpan('active-span', async () => {
        const active = getActiveSpan();
        expect(active).toBeDefined();
      });
    });
  });

  describe('getTraceId and getSpanId', () => {
    it('should return trace and span IDs within span context', async () => {
      let traceId: string | undefined;
      let spanId: string | undefined;

      await withSpan('id-span', async (span) => {
        traceId = getTraceId();
        spanId = getSpanId();
        // Verify they match the span we're in
        expect(traceId).toBe(span.spanContext().traceId);
        expect(spanId).toBe(span.spanContext().spanId);
      });

      expect(traceId).toBeDefined();
      expect(traceId?.length).toBe(32); // 16 bytes hex
      expect(spanId).toBeDefined();
      expect(spanId?.length).toBe(16); // 8 bytes hex
    });

    it('should return undefined outside span context', () => {
      // Outside of any span context
      const traceId = getTraceId();
      const spanId = getSpanId();
      // These may be undefined if no span is active
      expect(traceId === undefined || typeof traceId === 'string').toBe(true);
      expect(spanId === undefined || typeof spanId === 'string').toBe(true);
    });
  });

  describe('setSpanAttributes', () => {
    it('should set attributes on active span', async () => {
      await withSpan('attrs-span', async (span) => {
        setSpanAttributes({ 'custom.key': 'custom-value', 'custom.num': 42 });
        // Span should still be valid
        expect(span.isRecording()).toBe(true);
      });
    });

    it('should not throw when no active span', () => {
      // Should not throw even when called outside span context
      expect(() => {
        setSpanAttributes({ key: 'value' });
      }).not.toThrow();
    });
  });

  describe('recordException', () => {
    it('should record exception on active span', async () => {
      await withSpan('exception-span', async () => {
        const error = new Error('Test exception');
        recordException(error);
        // Should not throw
      });
    });

    it('should not throw when no active span', () => {
      expect(() => {
        recordException(new Error('No span error'));
      }).not.toThrow();
    });
  });

  describe('addSpanEvent', () => {
    it('should add event to active span', async () => {
      await withSpan('event-span', async () => {
        addSpanEvent('test.event', { detail: 'some detail' });
        // Should not throw
      });
    });

    it('should add event without attributes', async () => {
      await withSpan('event-span-simple', async () => {
        addSpanEvent('simple.event');
        // Should not throw
      });
    });

    it('should not throw when no active span', () => {
      expect(() => {
        addSpanEvent('orphan.event', { data: 123 });
      }).not.toThrow();
    });
  });

  describe('error handling edge cases', () => {
    it('should handle non-Error exceptions in withSpan', async () => {
      await expect(
        withSpan('string-error-span', async () => {
          throw 'string error'; // Non-Error exception
        }),
      ).rejects.toBe('string error');
    });

    it('should handle non-Error exceptions in withSpanSync', () => {
      expect(() =>
        withSpanSync('sync-string-error', () => {
          throw 'sync string error';
        }),
      ).toThrow();
    });
  });
});
