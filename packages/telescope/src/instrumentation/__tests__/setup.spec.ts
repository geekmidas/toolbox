import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { context, diag, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
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
import {
	InvalidSampleRatio,
	setupTelemetry,
	shutdownTelemetry,
} from '../setup';

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
		logs.disable();
		received.length = 0;
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
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

	it(
		'labels the resource with its namespace and stage',
		{ timeout: 20_000 },
		async () => {
			setupTelemetry({
				serviceName: 'Api',
				serviceNamespace: 'shop',
				deploymentEnvironment: 'production',
				endpoint: ENDPOINT,
				autoInstrument: false,
				instrumentPino: false,
				spanProcessorStrategy: 'simple',
			});

			trace.getTracer('test').startSpan('labelled').end();
			await flushTelemetry(5000);

			const body = received
				.filter((r) => r.path.endsWith('/traces'))
				.map((t) => t.body)
				.join('');
			const attributes = resourceAttributes(body);
			expect(attributes['service.name']).toBe('Api');
			expect(attributes['service.namespace']).toBe('shop');
			expect(attributes['deployment.environment.name']).toBe('production');
			expect(attributes['deployment.environment']).toBe('production');
		},
	);

	it(
		'reads the collector from OTEL_EXPORTER_OTLP_ENDPOINT when no endpoint is passed',
		{ timeout: 20_000 },
		async () => {
			vi.stubEnv(
				'OTEL_EXPORTER_OTLP_ENDPOINT',
				ENDPOINT.replace(/\/__telescope\/v1$/, ''),
			);

			setupTelemetry({
				serviceName: 'from-env',
				autoInstrument: false,
				instrumentPino: false,
				spanProcessorStrategy: 'simple',
			});

			trace.getTracer('test').startSpan('env-span').end();
			logs.getLogger('test').emit({ body: 'env-log' });
			await flushTelemetry(5000);

			// The spec's paths, not telescope's own `/traces` and `/logs`.
			const traces = received.filter((r) => r.path === '/v1/traces');
			const logRecords = received.filter((r) => r.path === '/v1/logs');
			expect(traces.map((t) => t.body).join('')).toContain('env-span');
			expect(logRecords.map((l) => l.body).join('')).toContain('env-log');
		},
	);

	it('exports log records to the endpoint', { timeout: 20_000 }, async () => {
		setupTelemetry({
			serviceName: 'logs-api',
			endpoint: ENDPOINT,
			autoInstrument: false,
			instrumentPino: false,
			spanProcessorStrategy: 'simple',
		});

		logs.getLogger('test').emit({ body: 'a log line' });
		await flushTelemetry(5000);

		const body = received
			.filter((r) => r.path.endsWith('/logs'))
			.map((l) => l.body)
			.join('');
		expect(body).toContain('a log line');
		expect(body).toContain('logs-api');
	});

	it('samples no traces with a sampleRatio of 0', async () => {
		setupTelemetry({
			serviceName: 'sampled',
			endpoint: ENDPOINT,
			autoInstrument: false,
			instrumentPino: false,
			spanProcessorStrategy: 'simple',
			sampleRatio: 0,
		});

		const span = trace.getTracer('test').startSpan('dropped');
		span.end();
		await flushTelemetry(5000);

		expect(span.isRecording()).toBe(false);
		expect(received.filter((r) => r.path.endsWith('/traces'))).toEqual([]);
	});

	it('samples every trace with a sampleRatio of 1', async () => {
		setupTelemetry({
			serviceName: 'sampled',
			endpoint: ENDPOINT,
			autoInstrument: false,
			instrumentPino: false,
			spanProcessorStrategy: 'simple',
			sampleRatio: 1,
		});

		trace.getTracer('test').startSpan('kept').end();
		await flushTelemetry(5000);

		const body = received.map((r) => r.body).join('');
		expect(body).toContain('kept');
	});

	it('follows OTEL_TRACES_SAMPLER when no sampleRatio is passed', async () => {
		vi.stubEnv('OTEL_TRACES_SAMPLER', 'traceidratio');
		vi.stubEnv('OTEL_TRACES_SAMPLER_ARG', '0');

		setupTelemetry({
			serviceName: 'env-sampled',
			endpoint: ENDPOINT,
			autoInstrument: false,
			instrumentPino: false,
			spanProcessorStrategy: 'simple',
		});

		const span = trace.getTracer('test').startSpan('dropped-by-env');
		span.end();
		await flushTelemetry(5000);

		expect(span.isRecording()).toBe(false);
		expect(received.filter((r) => r.path.endsWith('/traces'))).toEqual([]);
	});

	it('refuses a sampleRatio outside 0 to 1, before starting anything', () => {
		expect(() =>
			setupTelemetry({
				serviceName: 'bad',
				autoInstrument: false,
				instrumentPino: false,
				sampleRatio: 1.5,
			}),
		).toThrow(InvalidSampleRatio);

		// Nothing was set up, so a corrected call still takes effect.
		expect(() =>
			setupTelemetry({
				serviceName: 'good',
				autoInstrument: false,
				instrumentPino: false,
				sampleRatio: 0.5,
			}),
		).not.toThrow();
	});

	it('leaves SIGTERM to the process when handleSignals is false', () => {
		const before = process.listenerCount('SIGTERM');

		setupTelemetry({
			serviceName: 'quiet',
			autoInstrument: false,
			instrumentPino: false,
			handleSignals: false,
		});

		expect(process.listenerCount('SIGTERM')).toBe(before);
	});
});

/** The resource attributes in an OTLP/JSON export body, as strings. */
function resourceAttributes(body: string): Record<string, string> {
	const out: Record<string, string> = {};
	const parsed = JSON.parse(body) as {
		resourceSpans: {
			resource: {
				attributes: { key: string; value: { stringValue?: string } }[];
			};
		}[];
	};
	for (const { key, value } of parsed.resourceSpans[0]!.resource.attributes) {
		if (value.stringValue !== undefined) out[key] = value.stringValue;
	}
	return out;
}
