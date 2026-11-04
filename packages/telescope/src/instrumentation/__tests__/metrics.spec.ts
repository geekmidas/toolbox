import { metrics } from '@opentelemetry/api';
import {
	AggregationTemporality,
	type DataPoint,
	type Histogram,
	InMemoryMetricExporter,
	MeterProvider,
	PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import type { Context as LambdaContext } from 'aws-lambda';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { honoTelemetryMiddleware } from '../hono';
import { HTTP_SERVER_REQUEST_DURATION } from '../metrics';
import { telemetryMiddleware } from '../middleware';
import { OTelTelemetry } from '../otel';

let exporter: InMemoryMetricExporter;
let reader: PeriodicExportingMetricReader;
let provider: MeterProvider;

beforeEach(() => {
	exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
	reader = new PeriodicExportingMetricReader({
		exporter,
		exportIntervalMillis: 60_000,
	});
	provider = new MeterProvider({ readers: [reader] });
	metrics.setGlobalMeterProvider(provider);
});

afterEach(async () => {
	await provider.shutdown();
	metrics.disable();
});

/** Every recorded `http.server.request.duration` point, by its attributes. */
async function durations(): Promise<DataPoint<Histogram>[]> {
	await reader.forceFlush();
	return exporter
		.getMetrics()
		.flatMap((resource) => resource.scopeMetrics)
		.flatMap((scope) => scope.metrics)
		.filter((metric) => metric.descriptor.name === HTTP_SERVER_REQUEST_DURATION)
		.flatMap((metric) => metric.dataPoints as DataPoint<Histogram>[]);
}

describe('honoTelemetryMiddleware metrics', () => {
	it('records a request by method, route, status and scheme, in seconds', async () => {
		const app = new Hono();
		app.use('*', honoTelemetryMiddleware());
		app.get('/users/:id', (c) => c.json({ id: c.req.param('id') }));

		await app.request('http://api.test/users/42');

		const [point, ...rest] = await durations();
		expect(rest).toEqual([]);
		expect(point?.attributes).toEqual({
			'http.request.method': 'GET',
			'http.route': '/users/:id',
			'http.response.status_code': 200,
			'url.scheme': 'http',
		});
		expect(point?.value.count).toBe(1);
		expect(point?.value.sum).toBeLessThan(1);
	});

	it('leaves the route off a request no route matched', async () => {
		const app = new Hono();
		app.use('*', honoTelemetryMiddleware());

		await app.request('http://api.test/wp-admin/setup.php');

		const [point] = await durations();
		expect(point?.attributes).not.toHaveProperty('http.route');
		expect(point?.attributes['http.response.status_code']).toBe(404);
		expect(point?.attributes).not.toHaveProperty('error.type');
	});

	it('sets error.type on a server failure, from the error', async () => {
		const app = new Hono();
		app.use('*', honoTelemetryMiddleware());
		app.get('/boom', () => {
			throw new TypeError('nope');
		});

		const response = await app.request('http://api.test/boom');

		expect(response.status).toBe(500);
		const [point] = await durations();
		expect(point?.attributes['error.type']).toBe('TypeError');
		expect(point?.attributes['http.route']).toBe('/boom');
	});

	it('sets error.type to the status on a 5xx answered without throwing', async () => {
		const app = new Hono();
		app.use('*', honoTelemetryMiddleware());
		app.get('/down', (c) => c.json({}, 503));

		await app.request('http://api.test/down');

		const [point] = await durations();
		expect(point?.attributes['error.type']).toBe('503');
	});

	it('records nothing for an ignored path', async () => {
		const app = new Hono();
		app.use('*', honoTelemetryMiddleware({ ignorePaths: ['/health'] }));
		app.get('/health', (c) => c.text('ok'));

		await app.request('http://api.test/health');

		expect(await durations()).toEqual([]);
	});
});

const lambdaContext = {
	functionName: 'orders',
	awsRequestId: 'req-1',
} as LambdaContext;

const v2Event = () => ({
	rawPath: '/orders/7',
	routeKey: 'GET /orders/{id}',
	headers: { host: 'api.example.com' },
	requestContext: {
		requestId: 'req-1',
		http: { method: 'GET', path: '/orders/7', sourceIp: '10.0.0.1' },
	},
});

describe('Lambda telemetryMiddleware metrics', () => {
	it('records a request once it ends', async () => {
		const middleware = telemetryMiddleware();
		const event = v2Event();

		await middleware.before?.({ event, context: lambdaContext } as any);
		await middleware.after?.({
			event,
			context: lambdaContext,
			response: { statusCode: 201 },
		} as any);

		const [point, ...rest] = await durations();
		expect(rest).toEqual([]);
		expect(point?.attributes).toMatchObject({
			'http.request.method': 'GET',
			'http.route': '/orders/{id}',
			'http.response.status_code': 201,
		});
	});

	it('records a failed request with its status and error', async () => {
		const middleware = telemetryMiddleware();
		const event = v2Event();

		await middleware.before?.({ event, context: lambdaContext } as any);
		await middleware.onError?.({
			event,
			context: lambdaContext,
			error: new RangeError('bad'),
			response: { statusCode: 502 },
		} as any);

		const [point] = await durations();
		expect(point?.attributes['http.response.status_code']).toBe(502);
		expect(point?.attributes['error.type']).toBe('RangeError');
	});
});

describe('OTelTelemetry metrics', () => {
	it('records a request on end, and a failure as a 500', async () => {
		const telemetry = new OTelTelemetry();

		const ok = telemetry.onRequestStart({
			event: v2Event(),
			context: lambdaContext,
		});
		telemetry.onRequestEnd(ok, { statusCode: 200 });

		const failed = telemetry.onRequestStart({
			event: v2Event(),
			context: lambdaContext,
		});
		telemetry.onRequestError(failed, new Error('down'));

		const points = await durations();
		expect(
			points.map((point) => point.attributes['http.response.status_code']),
		).toEqual(expect.arrayContaining([200, 500]));
	});
});
