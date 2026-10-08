import { context, propagation, trace } from '@opentelemetry/api';
import {
	InMemorySpanExporter,
	NodeTracerProvider,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTypedFetcher } from '../fetcher';
import {
	InvalidClientSampleRate,
	sampledAt,
	traceContextInjector,
} from '../telemetry';
import { server } from './setup';

/** `version-traceid-spanid-flags`, lowercase hex, as W3C Trace Context has it. */
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-(0[01])$/;

/** A client whose every request answers with the headers it arrived with. */
function echoingClient(telemetry?: Parameters<typeof traceContextInjector>[1]) {
	server.use(
		http.get('https://api.example.com/echo', ({ request }) =>
			HttpResponse.json(Object.fromEntries(request.headers)),
		),
	);
	const client = createTypedFetcher<any>({
		baseURL: 'https://api.example.com',
		...(telemetry !== undefined ? { telemetry } : {}),
	});
	return () =>
		client('GET /echo' as any) as Promise<Record<string, string | undefined>>;
}

describe('trace context on the client', () => {
	it('sends no trace headers when telemetry is off', async () => {
		const send = echoingClient();

		const headers = await send();

		expect(headers.traceparent).toBeUndefined();
		expect(headers.tracestate).toBeUndefined();
	});

	it('sends none when telemetry is explicitly false', async () => {
		const headers = await echoingClient(false)();

		expect(headers.traceparent).toBeUndefined();
	});

	describe('with no OpenTelemetry context (level 1)', () => {
		it('sends a W3C traceparent', async () => {
			const headers = await echoingClient(true)();

			expect(headers.traceparent).toMatch(TRACEPARENT);
			// No vendor state of its own to carry.
			expect(headers.tracestate).toBeUndefined();
		});

		it('keeps one trace id per page view and a fresh span id per request', async () => {
			const send = echoingClient(true);

			const first = (await send()).traceparent!.match(TRACEPARENT)!;
			const second = (await send()).traceparent!.match(TRACEPARENT)!;

			expect(second[1]).toBe(first[1]);
			expect(second[2]).not.toBe(first[2]);
			expect(first[1]).not.toBe('0'.repeat(32));
			expect(first[2]).not.toBe('0'.repeat(16));
		});

		it('gives each client in Node its own trace', async () => {
			// A server process outlives any one user action: two clients there
			// are two callers, not one page.
			const a = (await echoingClient(true)()).traceparent!.match(TRACEPARENT)!;
			const b = (await echoingClient(true)()).traceparent!.match(TRACEPARENT)!;

			expect(a[1]).not.toBe(b[1]);
		});

		it('samples every page view at the default rate', async () => {
			const headers = await echoingClient(true)();

			expect(headers.traceparent!.match(TRACEPARENT)![3]).toBe('01');
		});

		it('samples none at rate 0', async () => {
			const send = echoingClient({ sampleRate: 0 });

			expect((await send()).traceparent!.match(TRACEPARENT)![3]).toBe('00');
			expect((await send()).traceparent!.match(TRACEPARENT)![3]).toBe('00');
		});

		it('samples about the rate of page views, decided once per page view', async () => {
			const flags: string[] = [];
			for (let i = 0; i < 400; i++) {
				const send = echoingClient({ sampleRate: 0.25 });
				const one = (await send()).traceparent!.match(TRACEPARENT)!;
				const two = (await send()).traceparent!.match(TRACEPARENT)!;
				// The page view's requests are kept or dropped together.
				expect(two[3]).toBe(one[3]);
				// From the trace id, by the rule the API's sampler applies.
				expect(one[3] === '01').toBe(sampledAt(one[1]!, 0.25));
				flags.push(one[3]!);
			}

			const sampled = flags.filter((flag) => flag === '01').length / 400;
			expect(sampled).toBeGreaterThan(0.15);
			expect(sampled).toBeLessThan(0.35);
		});

		it('leaves a traceparent the caller set alone', async () => {
			server.use(
				http.get('https://api.example.com/echo', ({ request }) =>
					HttpResponse.json(Object.fromEntries(request.headers)),
				),
			);
			const client = createTypedFetcher<any>({
				baseURL: 'https://api.example.com',
				telemetry: true,
			});
			const own = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

			const headers = (await client(
				'GET /echo' as any,
				{
					headers: { traceparent: own },
				} as any,
			)) as Record<string, string>;

			expect(headers.traceparent).toBe(own);
		});

		it('refuses a rate outside 0-1', () => {
			expect(() =>
				createTypedFetcher<any>({
					baseURL: 'https://api.example.com',
					telemetry: { sampleRate: 2 },
				}),
			).toThrow(InvalidClientSampleRate);
		});
	});

	describe('with an active OpenTelemetry context', () => {
		let provider: NodeTracerProvider;

		beforeEach(() => {
			// The SDK a server process — or a browser, with the web provider —
			// registers: a tracer provider, a context manager and the W3C
			// propagator, all global.
			provider = new NodeTracerProvider({
				spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
			});
			provider.register();
		});

		afterEach(async () => {
			await provider.shutdown();
			trace.disable();
			context.disable();
			propagation.disable();
		});

		it('continues the active span through the global propagator', async () => {
			const send = echoingClient(true);
			const tracer = trace.getTracer('test');

			const { headers, traceId, spanId } = await tracer.startActiveSpan(
				'page',
				async (span) => {
					const headers = await send();
					span.end();
					return {
						headers,
						traceId: span.spanContext().traceId,
						spanId: span.spanContext().spanId,
					};
				},
			);

			expect(headers.traceparent).toBe(`00-${traceId}-${spanId}-01`);
		});

		it('carries tracestate when the context has one', async () => {
			const send = echoingClient(true);
			const parent = propagation.extract(context.active(), {
				traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
				tracestate: 'vendor=value',
			});

			const headers = await context.with(parent, () => send());

			expect(headers.traceparent).toBe(
				'00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
			);
			expect(headers.tracestate).toBe('vendor=value');
		});

		it('falls back to the page view outside any span', async () => {
			const headers = await echoingClient(true)();

			expect(headers.traceparent).toMatch(TRACEPARENT);
		});
	});

	describe('origins', () => {
		it("adds headers only to the API's own origin", () => {
			const inject = traceContextInjector('https://api.example.com', true)!;

			const own: Record<string, string> = {};
			inject('https://api.example.com/users', own);
			const other: Record<string, string> = {};
			inject('https://tracker.example.net/collect', other);
			const otherPort: Record<string, string> = {};
			inject('https://api.example.com:8443/users', otherPort);

			expect(own.traceparent).toMatch(TRACEPARENT);
			expect(other).toEqual({});
			expect(otherPort).toEqual({});
		});

		it('adds none when the API origin cannot be told', () => {
			// A relative base URL with no page to resolve it against.
			const inject = traceContextInjector('/api', true)!;
			const headers: Record<string, string> = {};

			inject('/api/users', headers);

			expect(headers).toEqual({});
		});

		it('is not created at all when telemetry is off', () => {
			expect(traceContextInjector('https://api.example.com', undefined)).toBe(
				undefined,
			);
		});
	});
});
