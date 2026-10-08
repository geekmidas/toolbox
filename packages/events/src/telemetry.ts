/**
 * Trace context across a broker: what makes request → queue → worker one trace.
 *
 * On publish, each message gets a PRODUCER span, and that span's context is
 * written into the message through the global propagator — into the broker's
 * own header or attribute field where it has one. On consume, the context is
 * read back and the handler runs inside a CONSUMER span that is its child. A
 * message carrying no context (an older publisher, a process with telemetry
 * off) starts a new trace instead.
 *
 * Everything goes through `@opentelemetry/api`'s globals. Without a registered
 * provider and propagator the spans are no-ops and nothing is written into a
 * message, so a process that never asked for telemetry publishes exactly what
 * it did before.
 *
 * @module
 */
import {
	type Attributes,
	type Context,
	context,
	type Link,
	propagation,
	ROOT_CONTEXT,
	type Span,
	SpanKind,
	SpanStatusCode,
	trace,
} from '@opentelemetry/api';

/**
 * The key a trace context travels under where a broker has no header field of
 * its own — a pg-boss job's data. Reserved: it is removed before a handler sees
 * the payload, and a payload of the application's own should not use it.
 */
export const TRACE_CONTEXT_KEY = '__gkmTrace';

/** A propagated trace context: `traceparent`, and `tracestate` when set. */
export type TraceCarrier = Record<string, string>;

/** What a message is, as its spans describe it. */
export interface MessagingTarget {
	/** `messaging.system`: `pgboss`, `aws_sqs`, `aws_sns`, `rabbitmq`, `basic`. */
	system: string;
	/** The queue or topic — `messaging.destination.name`. */
	destination: string;
	/** The event's type, when the message has one. */
	type?: string;
	/** The broker's id for the message, when it has one. */
	messageId?: string;
}

const TRACER = '@geekmidas/events';

function tracer() {
	return trace.getTracer(TRACER);
}

function attributes(
	target: MessagingTarget,
	operation: 'publish' | 'process',
): Attributes {
	return {
		'messaging.system': target.system,
		'messaging.destination.name': target.destination,
		'messaging.operation': operation,
		'messaging.operation.type': operation === 'publish' ? 'send' : 'process',
		...(target.type && { 'gkm.event.type': target.type }),
		...(target.messageId && { 'messaging.message.id': target.messageId }),
	};
}

/** A PRODUCER span for one message, and the context to send with it. */
export interface ProducedMessage {
	span: Span;
	/** Undefined when there is nothing to propagate: no propagator registered. */
	carrier: TraceCarrier | undefined;
}

/**
 * Start the PRODUCER span for one message, as a child of whatever is active,
 * and write its context into a carrier for the broker.
 */
export function startProducer(target: MessagingTarget): ProducedMessage {
	const active = context.active();
	const span = tracer().startSpan(
		`${target.destination} publish`,
		{ kind: SpanKind.PRODUCER, attributes: attributes(target, 'publish') },
		active,
	);

	const carrier: TraceCarrier = {};
	propagation.inject(trace.setSpan(active, span), carrier);

	return {
		span,
		carrier: Object.keys(carrier).length > 0 ? carrier : undefined,
	};
}

/** End producer spans, recording `error` on each when the send failed. */
export function endProducers(spans: readonly Span[], error?: unknown): void {
	for (const span of spans) {
		if (error !== undefined) recordError(span, error);
		span.end();
	}
}

/**
 * Publish `items`, each with a PRODUCER span of its own, through `send` —
 * which receives the carrier to attach to each item, in order.
 */
export async function publishTraced<T, R>(
	items: readonly T[],
	describe: (item: T) => MessagingTarget,
	send: (carriers: (TraceCarrier | undefined)[]) => Promise<R>,
): Promise<R> {
	const produced = items.map((item) => startProducer(describe(item)));
	const spans = produced.map((p) => p.span);
	try {
		const result = await send(produced.map((p) => p.carrier));
		endProducers(spans);
		return result;
	} catch (error) {
		endProducers(spans, error);
		throw error;
	}
}

/**
 * The context a carrier holds, or undefined when it holds none — no carrier, a
 * malformed `traceparent`, or a propagator that throws.
 */
export function extractTraceContext(
	carrier: TraceCarrier | undefined,
): Context | undefined {
	if (!carrier || Object.keys(carrier).length === 0) return undefined;
	try {
		const extracted = propagation.extract(ROOT_CONTEXT, carrier);
		return trace.getSpanContext(extracted) ? extracted : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Run `fn` inside a CONSUMER span for one message: a child of the context the
 * message carried, or a new trace when it carried none. The active context of
 * the poller that received it is never the parent — a job is not part of
 * whatever happened to start the poll loop.
 */
export function consumeTraced<R>(
	target: MessagingTarget,
	carrier: TraceCarrier | undefined,
	fn: () => Promise<R>,
): Promise<R> {
	const parent = extractTraceContext(carrier) ?? ROOT_CONTEXT;
	return runConsumer(target, parent, [], fn);
}

/**
 * One CONSUMER span for a batch that arrived together — a Lambda's records.
 * One message with a context is its child; several start a trace of their own
 * that links to each message's producer, since a span has one parent.
 */
export function consumeBatchTraced<R>(
	target: MessagingTarget,
	carriers: readonly (TraceCarrier | undefined)[],
	fn: () => Promise<R>,
): Promise<R> {
	const contexts = carriers
		.map(extractTraceContext)
		.filter((c): c is Context => c !== undefined);

	if (carriers.length === 1 && contexts.length === 1) {
		return runConsumer(target, contexts[0]!, [], fn);
	}

	const links: Link[] = contexts.map((c) => ({
		context: trace.getSpanContext(c)!,
	}));
	return runConsumer(target, ROOT_CONTEXT, links, fn);
}

function runConsumer<R>(
	target: MessagingTarget,
	parent: Context,
	links: Link[],
	fn: () => Promise<R>,
): Promise<R> {
	const span = tracer().startSpan(
		`${target.destination} process`,
		{
			kind: SpanKind.CONSUMER,
			attributes: attributes(target, 'process'),
			links,
		},
		parent,
	);

	return context.with(trace.setSpan(parent, span), async () => {
		try {
			return await fn();
		} catch (error) {
			recordError(span, error);
			throw error;
		} finally {
			span.end();
		}
	});
}

function recordError(span: Span, error: unknown): void {
	if (error instanceof Error) span.recordException(error);
	span.setStatus({
		code: SpanStatusCode.ERROR,
		...(error instanceof Error && { message: error.message }),
	});
}

/**
 * A carrier from broker message attributes, in any of the shapes they arrive
 * in: SQS's `{ StringValue }`, a Lambda SQS record's `{ stringValue }`, an SNS
 * envelope's `{ Value }`, or plain strings (RabbitMQ headers).
 */
export function carrierFromAttributes(
	attributes: Record<string, unknown> | undefined | null,
): TraceCarrier | undefined {
	if (!attributes) return undefined;
	const carrier: TraceCarrier = {};
	for (const field of PROPAGATION_FIELDS) {
		const value = attributeValue(attributes[field]);
		if (value) carrier[field] = value;
	}
	return Object.keys(carrier).length > 0 ? carrier : undefined;
}

/** The W3C fields; what the default propagator reads and writes. */
const PROPAGATION_FIELDS = ['traceparent', 'tracestate'] as const;

function attributeValue(value: unknown): string | undefined {
	if (typeof value === 'string') return value;
	if (Buffer.isBuffer(value)) return value.toString();
	if (value && typeof value === 'object') {
		const v = value as {
			Value?: unknown;
			StringValue?: unknown;
			stringValue?: unknown;
		};
		const found = v.StringValue ?? v.stringValue ?? v.Value;
		return typeof found === 'string' ? found : undefined;
	}
	return undefined;
}

/** A carrier as SQS/SNS message attributes. */
export function carrierAsAttributes(
	carrier: TraceCarrier | undefined,
): Record<string, { DataType: 'String'; StringValue: string }> {
	const attributes: Record<
		string,
		{ DataType: 'String'; StringValue: string }
	> = {};
	if (!carrier) return attributes;
	for (const [key, value] of Object.entries(carrier)) {
		attributes[key] = { DataType: 'String', StringValue: value };
	}
	return attributes;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * `data` with the carrier under {@link TRACE_CONTEXT_KEY}, for a broker with no
 * header field. Unchanged when there is no carrier, or when `data` is not a
 * plain object a key can be added to — such a message starts its own trace.
 */
export function withTraceKey<T>(data: T, carrier: TraceCarrier | undefined): T {
	if (!carrier || !isPlainObject(data)) return data;
	return { ...data, [TRACE_CONTEXT_KEY]: carrier } as T;
}

/**
 * `data` without {@link TRACE_CONTEXT_KEY}, and the carrier that was under it.
 * What a handler sees never has the key.
 */
export function withoutTraceKey<T>(data: T): {
	data: T;
	carrier: TraceCarrier | undefined;
} {
	if (!isPlainObject(data) || !(TRACE_CONTEXT_KEY in data)) {
		return { data, carrier: undefined };
	}
	const { [TRACE_CONTEXT_KEY]: raw, ...rest } = data;
	return {
		data: rest as T,
		carrier: isPlainObject(raw) ? carrierFromAttributes(raw) : undefined,
	};
}
