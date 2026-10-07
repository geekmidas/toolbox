import {
	context,
	propagation,
	SpanKind,
	SpanStatusCode,
	trace,
} from '@opentelemetry/api';
import {
	InMemorySpanExporter,
	NodeTracerProvider,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	createChildSpan,
	createHttpServerSpan,
	endHttpSpan,
	extractTraceContext,
	injectTraceContext,
	isTracingEnabled,
	toOtelAttributes,
	withChildSpan,
	withHttpSpan,
} from '../http';

const TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

describe('http instrumentation', () => {
	let exporter: InMemorySpanExporter;
	let provider: NodeTracerProvider;

	beforeEach(() => {
		exporter = new InMemorySpanExporter();
		provider = new NodeTracerProvider({
			spanProcessors: [new SimpleSpanProcessor(exporter)],
		});
		// Also installs async context and W3C trace-context propagation.
		provider.register();
	});

	afterEach(async () => {
		await provider.shutdown();
		trace.disable();
		context.disable();
		propagation.disable();
	});

	const finished = () => exporter.getFinishedSpans();

	describe('toOtelAttributes', () => {
		it('maps every field to its semantic-convention name', () => {
			expect(
				toOtelAttributes({
					method: 'POST',
					url: 'https://shop.test/orders?x=1',
					path: '/orders',
					route: '/orders',
					host: 'shop.test',
					scheme: 'https',
					userAgent: 'curl/8',
					clientIp: '1.2.3.4',
					requestId: 'req-1',
					response: { statusCode: 201, responseSize: 42 },
					endpoint: {
						name: 'createOrder',
						operationId: 'orders.create',
						tags: ['orders'],
					},
					user: { userId: 'u1', sessionId: 's1', roles: ['admin', 'ops'] },
					custom: { 'tenant.id': 't1' },
				}),
			).toEqual({
				'http.request.method': 'POST',
				'url.full': 'https://shop.test/orders?x=1',
				'url.path': '/orders',
				'http.route': '/orders',
				'server.address': 'shop.test',
				'url.scheme': 'https',
				'user_agent.original': 'curl/8',
				'client.address': '1.2.3.4',
				'http.request.id': 'req-1',
				'http.response.status_code': 201,
				'http.response.body.size': 42,
				'endpoint.name': 'createOrder',
				'endpoint.operation_id': 'orders.create',
				'endpoint.tags': ['orders'],
				'enduser.id': 'u1',
				'session.id': 's1',
				'enduser.role': 'admin,ops',
				'tenant.id': 't1',
			});
		});

		it('leaves out what was not given', () => {
			expect(
				toOtelAttributes({
					method: 'GET',
					endpoint: { tags: [] },
					user: { roles: [] },
				}),
			).toEqual({ 'http.request.method': 'GET' });
		});
	});

	describe('trace context propagation', () => {
		it('continues a trace from incoming headers, whatever their case', () => {
			const ctx = extractTraceContext({
				Traceparent: [TRACEPARENT, 'ignored'],
				'X-Empty': '',
				'X-Missing': undefined,
			});

			expect(trace.getSpanContext(ctx)?.traceId).toBe(
				'0af7651916cd43dd8448eb211c80319c',
			);
		});

		it('writes the active trace into outgoing headers', () => {
			const span = trace.getTracer('t').startSpan('outer');
			const headers = injectTraceContext(
				{ accept: 'application/json' },
				trace.setSpan(context.active(), span),
			);
			span.end();

			expect(headers.accept).toBe('application/json');
			expect(headers.traceparent).toContain(span.spanContext().traceId);
		});

		it('injects nothing when there is no active trace', () => {
			expect(injectTraceContext({})).toEqual({});
		});
	});

	describe('server spans', () => {
		it('names a span by its route, falling back to the path', () => {
			createHttpServerSpan({ method: 'GET', route: '/users/:id' }).end();
			createHttpServerSpan({ method: 'GET', path: '/health' }).end();
			createHttpServerSpan({ method: 'GET' }).end();

			expect(finished().map((s) => [s.name, s.kind])).toEqual([
				['GET /users/:id', SpanKind.SERVER],
				['GET /health', SpanKind.SERVER],
				['GET /', SpanKind.SERVER],
			]);
		});

		it('joins a parent trace when given one', () => {
			const parent = extractTraceContext({ traceparent: TRACEPARENT });

			createHttpServerSpan({ method: 'GET', path: '/' }, parent).end();

			expect(finished()[0]?.spanContext().traceId).toBe(
				'0af7651916cd43dd8448eb211c80319c',
			);
		});

		it('ends ok, unset on a 4xx, errored by 5xx or by exception', () => {
			endHttpSpan(createHttpServerSpan({ method: 'GET' }), {
				statusCode: 200,
				responseSize: 10,
			});
			endHttpSpan(createHttpServerSpan({ method: 'GET' }), { statusCode: 404 });
			endHttpSpan(createHttpServerSpan({ method: 'GET' }), { statusCode: 503 });
			endHttpSpan(
				createHttpServerSpan({ method: 'GET' }),
				{ statusCode: 500 },
				new Error('boom'),
			);

			const [ok, notFound, unavailable, failed] = finished();
			expect(ok?.status.code).toBe(SpanStatusCode.OK);
			expect(ok?.attributes['http.response.body.size']).toBe(10);
			expect(notFound?.status.code).toBe(SpanStatusCode.UNSET);
			expect(unavailable?.status).toEqual({
				code: SpanStatusCode.ERROR,
				message: 'HTTP 503',
			});
			expect(failed?.status).toEqual({
				code: SpanStatusCode.ERROR,
				message: 'boom',
			});
			expect(failed?.events.map((e) => e.name)).toEqual(['exception']);
		});
	});

	describe('withHttpSpan', () => {
		it('runs inside the span and records the returned status', async () => {
			const result = await withHttpSpan(
				{ method: 'POST', path: '/orders' },
				async (span) => {
					expect(trace.getActiveSpan()).toBe(span);
					return { statusCode: 201, id: 'o1' };
				},
			);

			expect(result).toEqual({ statusCode: 201, id: 'o1' });
			expect(finished()[0]?.attributes['http.response.status_code']).toBe(201);
		});

		it('defaults to 200 when the result names no status', async () => {
			await withHttpSpan({ method: 'GET' }, async () => ({ ok: true }));

			expect(finished()[0]?.attributes['http.response.status_code']).toBe(200);
		});

		it('records a 500 and rethrows, even for a thrown non-Error', async () => {
			await expect(
				withHttpSpan({ method: 'GET' }, async () => {
					throw 'nope';
				}),
			).rejects.toBe('nope');

			expect(finished()[0]?.status).toEqual({
				code: SpanStatusCode.ERROR,
				message: 'nope',
			});
		});
	});

	describe('child spans', () => {
		it('creates internal spans with attributes', () => {
			createChildSpan('validate', { step: 1 }).end();

			expect(finished()[0]).toMatchObject({
				name: 'validate',
				kind: SpanKind.INTERNAL,
				attributes: { step: 1 },
			});
		});

		it('marks a child span ok when its work succeeds', async () => {
			expect(await withChildSpan('load', async () => 7)).toBe(7);

			expect(finished()[0]?.status.code).toBe(SpanStatusCode.OK);
		});

		it('marks a child span errored and rethrows', async () => {
			await expect(
				withChildSpan('save', async () => {
					throw new Error('conflict');
				}),
			).rejects.toThrow('conflict');
			await expect(
				withChildSpan('save', async () => {
					throw 42;
				}),
			).rejects.toBe(42);

			const [first, second] = finished();
			expect(first?.status).toEqual({
				code: SpanStatusCode.ERROR,
				message: 'conflict',
			});
			expect(second?.status.message).toBe('Unknown error');
		});
	});

	it('knows whether a real tracer is installed', async () => {
		expect(isTracingEnabled()).toBe(true);

		await provider.shutdown();
		trace.disable();

		expect(isTracingEnabled()).toBe(false);
	});
});
