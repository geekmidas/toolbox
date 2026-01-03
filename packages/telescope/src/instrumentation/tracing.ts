import {
  type Attributes,
  type Span,
  SpanStatusCode,
  context,
  trace,
} from '@opentelemetry/api';

/**
 * Get the currently active span
 */
export function getActiveSpan(): Span | undefined {
  return trace.getActiveSpan();
}

/**
 * Set attributes on the active span
 */
export function setSpanAttributes(attributes: Attributes): void {
  const span = getActiveSpan();
  if (span) {
    span.setAttributes(attributes);
  }
}

/**
 * Create a new span as a child of the current span
 */
export function createSpan(name: string, attributes?: Attributes): Span {
  const tracer = trace.getTracer('@geekmidas/telescope');
  const span = tracer.startSpan(name, { attributes });
  return span;
}

/**
 * Execute a function within a new span context
 *
 * @example
 * ```typescript
 * const result = await withSpan('processOrder', async (span) => {
 *   span.setAttribute('order.id', orderId);
 *   const order = await processOrder(orderId);
 *   return order;
 * });
 * ```
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  const tracer = trace.getTracer('@geekmidas/telescope');
  const span = tracer.startSpan(name, { attributes });

  try {
    const result = await context.with(
      trace.setSpan(context.active(), span),
      () => fn(span),
    );
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Synchronous version of withSpan
 */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  attributes?: Attributes,
): T {
  const tracer = trace.getTracer('@geekmidas/telescope');
  const span = tracer.startSpan(name, { attributes });

  try {
    const result = context.with(
      trace.setSpan(context.active(), span),
      () => fn(span),
    );
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Get the current trace ID (useful for log correlation)
 */
export function getTraceId(): string | undefined {
  const span = getActiveSpan();
  return span?.spanContext().traceId;
}

/**
 * Get the current span ID
 */
export function getSpanId(): string | undefined {
  const span = getActiveSpan();
  return span?.spanContext().spanId;
}

/**
 * Record an exception on the current span
 */
export function recordException(error: Error): void {
  const span = getActiveSpan();
  if (span) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  }
}

/**
 * Add an event to the current span
 */
export function addSpanEvent(name: string, attributes?: Attributes): void {
  const span = getActiveSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}
