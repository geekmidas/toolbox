/**
 * Where the constructs meet OpenTelemetry, beyond the spans `@geekmidas/events`
 * starts for the brokers: the trace context in a Lambda's records, the spans
 * around an `ExternalApi`'s client, and the context a call to a sibling
 * service carries.
 *
 * Everything goes through the global API, so without a registered provider
 * none of it records anything.
 *
 * @module
 */
import { channel } from 'node:diagnostics_channel';
import { carrierFromAttributes, type TraceCarrier } from '@geekmidas/events';
import {
	context,
	propagation,
	SpanKind,
	SpanStatusCode,
	trace,
} from '@opentelemetry/api';

/**
 * The trace context a Lambda record carries: an SQS record's message
 * attributes, an SNS record's, or those of the SNS envelope an SQS
 * subscription delivers in its body.
 */
export function recordCarrier(record: unknown): TraceCarrier | undefined {
	const r = record as {
		messageAttributes?: Record<string, unknown>;
		body?: string;
		Sns?: { MessageAttributes?: Record<string, unknown> };
	};
	if (r?.Sns) return carrierFromAttributes(r.Sns.MessageAttributes);

	const own = carrierFromAttributes(r?.messageAttributes);
	if (own || typeof r?.body !== 'string') return own;
	try {
		const body = JSON.parse(r.body);
		return body?.Type === 'Notification'
			? carrierFromAttributes(body.MessageAttributes)
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * `client`, with a span around each of its methods: `<api>.<method>`, carrying
 * the API's name. An outbound `fetch` the method makes is traced already, and
 * becomes this span's child, so the name is on the trace without anything
 * knowing which URL belongs to which API.
 *
 * Only the client's own methods: what they return is the client's business.
 * Methods are called on the client itself, never on the proxy, so private
 * fields keep working.
 */
export function traceClient<T>(
	api: string,
	client: T,
	attributes: Record<string, string> = {},
): T {
	if (!client || (typeof client !== 'object' && typeof client !== 'function')) {
		return client;
	}
	const wrapped = new Map<PropertyKey, unknown>();
	return new Proxy(client as object, {
		get(target, property, receiver) {
			const value = Reflect.get(target, property, receiver);
			if (typeof value !== 'function' || typeof property === 'symbol') {
				return value;
			}
			if (property === 'constructor' || property === 'then') return value;

			const cached = wrapped.get(property);
			if (cached && (cached as { original?: unknown }).original === value) {
				return cached;
			}
			const traced = Object.assign(
				(...args: unknown[]) =>
					callTraced(api, property, attributes, () =>
						(value as (...a: unknown[]) => unknown).apply(target, args),
					),
				{ original: value },
			);
			wrapped.set(property, traced);
			return traced;
		},
	}) as T;
}

function callTraced(
	api: string,
	method: string,
	attributes: Record<string, string>,
	call: () => unknown,
): unknown {
	return trace.getTracer('@geekmidas/constructs').startActiveSpan(
		`${api}.${method}`,
		{
			kind: SpanKind.INTERNAL,
			attributes: {
				'gkm.external_api.name': api,
				'gkm.external_api.method': method,
				...attributes,
			},
		},
		(span) => {
			const fail = (error: unknown) => {
				if (error instanceof Error) span.recordException(error);
				span.setStatus({ code: SpanStatusCode.ERROR });
				span.end();
			};
			let result: unknown;
			try {
				result = call();
			} catch (error) {
				fail(error);
				throw error;
			}
			// Only a native promise is waited on, and the caller gets it back as
			// it was: a lazy thenable runs on `then`, and a promise subclass has
			// methods a chained promise would not.
			if (result instanceof Promise) {
				result.then(
					() => span.end(),
					(error) => fail(error),
				);
				return result;
			}
			span.end();
			return result;
		},
	);
}

/**
 * Where an instrumentation of `fetch` hears of each request — undici's own
 * diagnostics channel, which OpenTelemetry's undici instrumentation (and every
 * APM built on it) subscribes to.
 */
const FETCH_REQUESTS = channel('undici:request:create');

/**
 * The active trace context, written into `headers` for a call this process
 * makes to one of its own services — the auth server's session check — so the
 * callee's span joins the caller's trace.
 *
 * Through the global propagator, so it is a no-op without one. And not at all
 * when a `fetch` instrumentation is listening: that opens the request's own
 * CLIENT span and writes its `traceparent` by appending a header, so a second
 * one here would reach the callee as two values joined — `a, b` — which no
 * propagator reads, and the trace would break instead of joining.
 */
export function injectTraceContext(headers: Headers): void {
	if (FETCH_REQUESTS.hasSubscribers) return;
	propagation.inject(context.active(), headers, {
		set: (carrier, key, value) => carrier.set(key, value),
	});
}
