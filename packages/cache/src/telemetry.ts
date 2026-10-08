/**
 * A span per cache call, through the global OpenTelemetry tracer — a no-op
 * without a registered provider.
 *
 * `cache.get`, `cache.set` and `cache.delete`, each with the backend as
 * `db.system` and, on a read, whether it hit. Never the key or the value: a key
 * often names a user, and a value is whatever was cached.
 *
 * @module
 */
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

export type CacheOperation = 'get' | 'set' | 'delete';

/** Run `fn` inside a `cache.<operation>` span for a backend. */
export async function traceCache<T>(
	system: string,
	operation: CacheOperation,
	fn: () => Promise<T>,
): Promise<T> {
	const span = trace
		.getTracer('@geekmidas/cache')
		.startSpan(`cache.${operation}`, {
			kind: SpanKind.CLIENT,
			attributes: { 'db.system': system, 'cache.operation': operation },
		});
	try {
		const result = await fn();
		if (operation === 'get')
			span.setAttribute('cache.hit', result !== undefined);
		return result;
	} catch (error) {
		if (error instanceof Error) span.recordException(error);
		span.setStatus({ code: SpanStatusCode.ERROR });
		throw error;
	} finally {
		span.end();
	}
}
