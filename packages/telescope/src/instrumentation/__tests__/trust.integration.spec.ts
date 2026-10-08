import type { AddressInfo } from 'node:net';
import { type ServerType, serve } from '@hono/node-server';
import { propagation, type Span, TraceFlags, trace } from '@opentelemetry/api';
import { core } from '@opentelemetry/sdk-node';
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	type Sampler,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { getSpanFromContext, honoTelemetryMiddleware } from '../hono';
import { traceSampler, traceSamplerFromEnv } from '../sampler';

/**
 * A real API — `@hono/node-server` on a real socket, the request middleware a
 * built server mounts, an in-memory exporter — called the way a browser and a
 * neighbouring service call it, over HTTP.
 */

const SITE = 'https://web.example.com';
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const PARENT_SPAN_ID = 'b7ad6b7169203331';
const SAMPLED = `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`;

interface Api {
	url: string;
	exporter: InMemorySpanExporter;
	/** Each request's span, sampled or not. */
	handled: Span[];
}

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
	await cleanup?.();
	cleanup = undefined;
});

async function startApi(sampler: Sampler = traceSampler(1)): Promise<Api> {
	const exporter = new InMemorySpanExporter();
	const provider = new BasicTracerProvider({
		sampler,
		spanProcessors: [new SimpleSpanProcessor(exporter)],
	});
	trace.setGlobalTracerProvider(provider);
	propagation.setGlobalPropagator(new core.W3CTraceContextPropagator());

	const handled: Span[] = [];
	const app = new Hono();
	app.use('*', honoTelemetryMiddleware({ trustedOrigins: [SITE] }));
	app.get('/users', (c) => {
		const span = getSpanFromContext(c);
		if (span) handled.push(span);
		return c.json({ users: [] });
	});

	// Port 0: whatever is free, never a developer's own dev server.
	const server = await new Promise<ServerType>((resolve) => {
		const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () =>
			resolve(s),
		);
	});
	const { port } = server.address() as AddressInfo;

	cleanup = async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await provider.shutdown();
		trace.disable();
		propagation.disable();
	};

	return { url: `http://127.0.0.1:${port}`, exporter, handled };
}

describe('whose traceparent the API continues', () => {
	it("continues a trace from one of the API's own sites", async () => {
		const api = await startApi();

		await fetch(`${api.url}/users`, {
			headers: { origin: SITE, traceparent: SAMPLED },
		});

		const [span] = api.exporter.getFinishedSpans();
		expect(span?.spanContext().traceId).toBe(TRACE_ID);
		expect(span?.parentSpanContext?.spanId).toBe(PARENT_SPAN_ID);
		expect(span?.links).toEqual([]);
	});

	it('starts a new trace, linked to the claimed one, from another origin', async () => {
		const api = await startApi();

		await fetch(`${api.url}/users`, {
			headers: { origin: 'https://evil.example.net', traceparent: SAMPLED },
		});

		const [span] = api.exporter.getFinishedSpans();
		expect(span?.spanContext().traceId).not.toBe(TRACE_ID);
		expect(span?.parentSpanContext).toBeUndefined();
		expect(span?.links).toHaveLength(1);
		expect(span?.links[0]?.context.traceId).toBe(TRACE_ID);
		expect(span?.links[0]?.context.spanId).toBe(PARENT_SPAN_ID);
		expect(span?.links[0]?.attributes).toEqual({
			'gkm.trace.untrusted_parent': true,
		});
	});

	it('continues an internal caller: no Origin, straight from the private network', async () => {
		// Another service calling this one by its internal URL — here, from
		// loopback, with no proxy in between.
		const api = await startApi();

		await fetch(`${api.url}/users`, { headers: { traceparent: SAMPLED } });

		const [span] = api.exporter.getFinishedSpans();
		expect(span?.spanContext().traceId).toBe(TRACE_ID);
		expect(span?.parentSpanContext?.spanId).toBe(PARENT_SPAN_ID);
	});

	it('continues an internal caller that says whose request it is in x-gkm-client-ip', async () => {
		// An API's session check: the client's address travels in gkm's own
		// header, which no proxy adds — the edge strips it from outside
		// traffic — so it does not make the call look like it came through one.
		const api = await startApi();

		await fetch(`${api.url}/users`, {
			headers: { traceparent: SAMPLED, 'x-gkm-client-ip': '203.0.113.7' },
		});

		const [span] = api.exporter.getFinishedSpans();
		expect(span?.spanContext().traceId).toBe(TRACE_ID);
		expect(span?.parentSpanContext?.spanId).toBe(PARENT_SPAN_ID);
	});

	it('does not count a request through a proxy as internal', async () => {
		// The stack's proxy adds X-Forwarded-For to everything from outside, so
		// a request with no Origin that came through it is a stranger's.
		const api = await startApi();

		await fetch(`${api.url}/users`, {
			headers: { traceparent: SAMPLED, 'x-forwarded-for': '203.0.113.7' },
		});

		const [span] = api.exporter.getFinishedSpans();
		expect(span?.spanContext().traceId).not.toBe(TRACE_ID);
		expect(span?.links[0]?.context.traceId).toBe(TRACE_ID);
	});

	it('does not count a site that is not its own just because CORS let it through', async () => {
		// A wildcard is not a list of the API's own sites.
		const exporter = new InMemorySpanExporter();
		const provider = new BasicTracerProvider({
			spanProcessors: [new SimpleSpanProcessor(exporter)],
		});
		trace.setGlobalTracerProvider(provider);
		propagation.setGlobalPropagator(new core.W3CTraceContextPropagator());
		cleanup = async () => {
			await provider.shutdown();
			trace.disable();
			propagation.disable();
		};
		const app = new Hono();
		app.use('*', honoTelemetryMiddleware({ trustedOrigins: ['*'] }));
		app.get('/users', (c) => c.json([]));

		await app.request('/users', {
			headers: { origin: SITE, traceparent: SAMPLED },
		});

		const [span] = exporter.getFinishedSpans();
		expect(span?.spanContext().traceId).not.toBe(TRACE_ID);
	});
});

describe("the API's own rate caps a caller's sampled flag", () => {
	it('does not sample a sampled=1 request when the stage samples nothing', async () => {
		const api = await startApi(
			traceSamplerFromEnv({
				OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
				OTEL_TRACES_SAMPLER_ARG: '0',
			}),
		);

		const response = await fetch(`${api.url}/users`, {
			headers: { origin: SITE, traceparent: SAMPLED },
		});

		expect(response.status).toBe(200);
		expect(api.exporter.getFinishedSpans()).toHaveLength(0);
		// Still the caller's trace, so its logs correlate — just not recorded.
		const [span] = api.handled;
		expect(span?.spanContext().traceId).toBe(TRACE_ID);
		expect(span?.spanContext().traceFlags & TraceFlags.SAMPLED).toBe(0);
		expect(span?.isRecording()).toBe(false);
	});

	it('samples it when the stage samples everything', async () => {
		const api = await startApi(
			traceSamplerFromEnv({
				OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
				OTEL_TRACES_SAMPLER_ARG: '1',
			}),
		);

		await fetch(`${api.url}/users`, {
			headers: { origin: SITE, traceparent: SAMPLED },
		});

		expect(api.exporter.getFinishedSpans()).toHaveLength(1);
	});

	it('follows a caller that asked for less: sampled=0 stays unsampled', async () => {
		const api = await startApi(traceSampler(1));

		await fetch(`${api.url}/users`, {
			headers: {
				origin: SITE,
				traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-00`,
			},
		});

		expect(api.exporter.getFinishedSpans()).toHaveLength(0);
	});
});
