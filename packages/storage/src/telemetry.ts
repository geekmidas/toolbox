/**
 * A span per storage call, through the global OpenTelemetry tracer — a no-op
 * without a registered provider.
 *
 * `storage.presign`, `storage.put`, `storage.delete` and `storage.list`, with
 * the backend and the bucket. Never the object's key: keys often name a user.
 *
 * @module
 */
import {
	type Attributes,
	SpanKind,
	SpanStatusCode,
	trace,
} from '@opentelemetry/api';

export type StorageOperation = 'presign' | 'put' | 'delete' | 'list';

/** Run `fn` inside a `storage.<operation>` span. */
export async function traceStorage<T>(
	operation: StorageOperation,
	attributes: Attributes,
	fn: () => Promise<T>,
): Promise<T> {
	const span = trace
		.getTracer('@geekmidas/storage')
		.startSpan(`storage.${operation}`, {
			kind: SpanKind.CLIENT,
			attributes: { 'storage.operation': operation, ...attributes },
		});
	try {
		return await fn();
	} catch (error) {
		if (error instanceof Error) span.recordException(error);
		span.setStatus({ code: SpanStatusCode.ERROR });
		throw error;
	} finally {
		span.end();
	}
}
