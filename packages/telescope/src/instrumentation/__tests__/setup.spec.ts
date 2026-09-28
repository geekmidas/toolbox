import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { context, diag, propagation, trace } from '@opentelemetry/api';
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {
	flushTelemetry,
	shutdownTelemetry as shutdownProcessors,
} from '../core';
import { setupTelemetry, shutdownTelemetry } from '../setup';

/** Every OTLP export the collector received, by path. */
const received: { path: string; body: string }[] = [];

/** A real HTTP server standing in for the OTLP collector. */
let collector: Server;
let ENDPOINT = '';

describe('setupTelemetry', () => {
	beforeAll(async () => {
		collector = createServer((req, res) => {
			let body = '';
			req.on('data', (chunk) => {
				body += chunk;
			});
			req.on('end', () => {
				received.push({ path: req.url ?? '', body });
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end('{}');
			});
		});
		await new Promise<void>((resolve) => collector.listen(0, resolve));
		const { port } = collector.address() as AddressInfo;
		ENDPOINT = `http://127.0.0.1:${port}/__telescope/v1`;
	});
	afterAll(async () => {
		await new Promise((resolve) => collector.close(resolve));
	});
	afterEach(async () => {
		await shutdownTelemetry();
		await shutdownProcessors();
		// A shut-down SDK stays registered with the global API, which refuses a
		// second registration; the next test's SDK would never see a span.
		trace.disable();
		context.disable();
		propagation.disable();
		received.length = 0;
		vi.restoreAllMocks();
	});

	it(
		'exports spans to the OTLP endpoint, named for the service',
		{ timeout: 20_000 },
		async () => {
			setupTelemetry({
				serviceName: 'orders-api',
				serviceVersion: '2.1.0',
				endpoint: ENDPOINT,
				autoInstrument: false,
				spanProcessorStrategy: 'simple',
				headers: { authorization: 'Bearer t' },
				resourceAttributes: { team: 'checkout' },
			});

			trace.getTracer('test').startSpan('checkout').end();
			await flushTelemetry(5000);

			const traces = received.filter((r) => r.path.endsWith('/traces'));
			expect(traces.length).toBeGreaterThan(0);
			const body = traces.map((t) => t.body).join('');
			expect(body).toContain('checkout');
			expect(body).toContain('orders-api');
			expect(body).toContain('2.1.0');
		},
	);

	it('sets up only once', async () => {
		setupTelemetry({
			serviceName: 'first',
			endpoint: ENDPOINT,
			autoInstrument: false,
			instrumentPino: false,
			spanProcessorStrategy: 'simple',
		});
		setupTelemetry({
			serviceName: 'second',
			endpoint: ENDPOINT,
			autoInstrument: false,
			spanProcessorStrategy: 'simple',
		});

		trace.getTracer('test').startSpan('once').end();
		await flushTelemetry(5000);

		const body = received.map((r) => r.body).join('');
		expect(body).toContain('first');
		expect(body).not.toContain('second');
	});

	it('writes spans to the console when there is no endpoint', async () => {
		const dir = vi.spyOn(console, 'dir').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});

		setupTelemetry({
			serviceName: 'local',
			autoInstrument: false,
			instrumentPino: false,
			environment: 'lambda',
		});

		trace.getTracer('test').startSpan('to-console').end();
		await flushTelemetry(5000);

		expect(received).toEqual([]);
		expect(JSON.stringify(dir.mock.calls)).toContain('to-console');
	});

	it('turns on the SDK diagnostic logger in debug mode', () => {
		const setLogger = vi.spyOn(diag, 'setLogger');
		vi.spyOn(console, 'dir').mockImplementation(() => {});

		setupTelemetry({
			serviceName: 'noisy',
			autoInstrument: false,
			instrumentPino: false,
			debug: true,
		});

		expect(setLogger).toHaveBeenCalled();
		diag.disable();
	});

	it('shuts down cleanly more than once', async () => {
		setupTelemetry({
			serviceName: 'x',
			autoInstrument: false,
			instrumentPino: false,
		});

		await shutdownTelemetry();
		await expect(shutdownTelemetry()).resolves.toBeUndefined();
	});
});
