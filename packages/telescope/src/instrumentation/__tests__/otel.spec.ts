import { trace } from '@opentelemetry/api';
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { Context } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OTelTelemetry } from '../otel';

describe('OTelTelemetry', () => {
	let exporter: InMemorySpanExporter;
	let provider: BasicTracerProvider;

	const mockLambdaContext: Context = {
		awsRequestId: 'test-request-id',
		functionName: 'test-function',
		functionVersion: '1',
		invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
		memoryLimitInMB: '128',
		logGroupName: '/aws/lambda/test',
		logStreamName: '2024/01/01/[$LATEST]abc123',
		callbackWaitsForEmptyEventLoop: true,
		getRemainingTimeInMillis: () => 30000,
		done: () => {},
		fail: () => {},
		succeed: () => {},
	};

	beforeEach(() => {
		exporter = new InMemorySpanExporter();
		provider = new BasicTracerProvider();
		provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
		provider.register();
	});

	afterEach(async () => {
		exporter.reset();
		await provider.shutdown();
		trace.disable();
	});

	describe('API Gateway v2 events', () => {
		it('should create span for API Gateway v2 request', () => {
			const telemetry = new OTelTelemetry();

			const event = {
				requestContext: {
					http: {
						method: 'GET',
						path: '/api/users',
						sourceIp: '192.168.1.1',
						userAgent: 'test-agent',
					},
					requestId: 'apigw-request-id',
				},
				rawPath: '/api/users',
				rawQueryString: 'page=1',
				headers: { host: 'api.example.com' },
			};

			const ctx = telemetry.onRequestStart({
				event,
				context: mockLambdaContext,
			});

			telemetry.onRequestEnd(ctx, { statusCode: 200 });

			const spans = exporter.getFinishedSpans();
			expect(spans).toHaveLength(1);
			expect(spans[0].name).toBe('GET /api/users');
			expect(spans[0].attributes['http.request.method']).toBe('GET');
			expect(spans[0].attributes['url.path']).toBe('/api/users');
			expect(spans[0].attributes['faas.invocation_id']).toBe('test-request-id');
			expect(spans[0].attributes['faas.name']).toBe('test-function');
		});

		it('should record error on request failure', () => {
			const telemetry = new OTelTelemetry();

			const event = {
				requestContext: {
					http: { method: 'POST', path: '/api/users', sourceIp: '10.0.0.1' },
					requestId: 'req-123',
				},
				rawPath: '/api/users',
				headers: {},
			};

			const ctx = telemetry.onRequestStart({
				event,
				context: mockLambdaContext,
			});

			telemetry.onRequestError(ctx, new Error('Database connection failed'));

			const spans = exporter.getFinishedSpans();
			expect(spans).toHaveLength(1);
			expect(spans[0].status.code).toBe(2); // SpanStatusCode.ERROR
			expect(spans[0].events).toHaveLength(1);
			expect(spans[0].events[0].name).toBe('exception');
		});
	});

	describe('API Gateway v1 events', () => {
		it('should create span for API Gateway v1 request', () => {
			const telemetry = new OTelTelemetry();

			const event = {
				httpMethod: 'POST',
				path: '/api/orders',
				resource: '/api/orders',
				requestContext: {
					requestId: 'v1-request-id',
					identity: { sourceIp: '10.0.0.1' },
				},
				headers: {
					Host: 'api.example.com',
					'User-Agent': 'test-client',
				},
			};

			const ctx = telemetry.onRequestStart({
				event,
				context: mockLambdaContext,
			});

			telemetry.onRequestEnd(ctx, { statusCode: 201 });

			const spans = exporter.getFinishedSpans();
			expect(spans).toHaveLength(1);
			expect(spans[0].attributes['http.request.method']).toBe('POST');
			expect(spans[0].attributes['url.path']).toBe('/api/orders');
			expect(spans[0].attributes['http.route']).toBe('/api/orders');
		});
	});

	describe('options', () => {
		it('should record request body when recordBody is true', () => {
			const telemetry = new OTelTelemetry({ recordBody: true });

			const event = {
				requestContext: {
					http: { method: 'POST', path: '/api/users', sourceIp: '10.0.0.1' },
					requestId: 'req-123',
				},
				rawPath: '/api/users',
				headers: {},
				body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
			};

			const ctx = telemetry.onRequestStart({
				event,
				context: mockLambdaContext,
			});

			telemetry.onRequestEnd(ctx, { statusCode: 200 });

			const spans = exporter.getFinishedSpans();
			expect(spans[0].attributes['http.request.body']).toContain('John');
		});

		it('should record response body when recordResponseBody is true', () => {
			const telemetry = new OTelTelemetry({ recordResponseBody: true });

			const event = {
				requestContext: {
					http: { method: 'GET', path: '/api/users', sourceIp: '10.0.0.1' },
					requestId: 'req-123',
				},
				rawPath: '/api/users',
				headers: {},
			};

			const ctx = telemetry.onRequestStart({
				event,
				context: mockLambdaContext,
			});

			telemetry.onRequestEnd(ctx, {
				statusCode: 200,
				body: JSON.stringify({ users: [{ id: '1', name: 'John' }] }),
			});

			const spans = exporter.getFinishedSpans();
			expect(spans[0].attributes['http.response.body']).toContain('John');
		});

		it('should extract user ID using custom function', () => {
			const telemetry = new OTelTelemetry({
				getUserId: (event) => event.requestContext?.authorizer?.userId,
			});

			const event = {
				requestContext: {
					http: { method: 'GET', path: '/api/profile', sourceIp: '10.0.0.1' },
					requestId: 'req-123',
					authorizer: { userId: 'user-456' },
				},
				rawPath: '/api/profile',
				headers: {},
			};

			const ctx = telemetry.onRequestStart({
				event,
				context: mockLambdaContext,
			});

			telemetry.onRequestEnd(ctx, { statusCode: 200 });

			const spans = exporter.getFinishedSpans();
			expect(spans[0].attributes['enduser.id']).toBe('user-456');
		});

		it('should extract endpoint name using custom function', () => {
			const telemetry = new OTelTelemetry({
				getEndpointName: (event) => event.endpointName,
			});

			const event = {
				requestContext: {
					http: { method: 'GET', path: '/api/users', sourceIp: '10.0.0.1' },
					requestId: 'req-123',
				},
				rawPath: '/api/users',
				headers: {},
				endpointName: 'ListUsers',
			};

			const ctx = telemetry.onRequestStart({
				event,
				context: mockLambdaContext,
			});

			telemetry.onRequestEnd(ctx, { statusCode: 200 });

			const spans = exporter.getFinishedSpans();
			expect(spans[0].attributes['endpoint.name']).toBe('ListUsers');
		});
	});

	describe('ALB events', () => {
		it('should create span for ALB request', () => {
			const telemetry = new OTelTelemetry();

			const event = {
				httpMethod: 'GET',
				path: '/health',
				headers: {
					host: 'alb.example.com',
					'user-agent': 'ALB-HealthChecker',
					'x-forwarded-for': '10.0.0.1, 10.0.0.2',
				},
			};

			const ctx = telemetry.onRequestStart({
				event,
				context: mockLambdaContext,
			});

			telemetry.onRequestEnd(ctx, { statusCode: 200 });

			const spans = exporter.getFinishedSpans();
			expect(spans).toHaveLength(1);
			expect(spans[0].attributes['http.request.method']).toBe('GET');
			expect(spans[0].attributes['url.path']).toBe('/health');
		});
	});

	describe('direct Lambda invocation', () => {
		it('should create span for direct invocation', () => {
			const telemetry = new OTelTelemetry();

			const event = {
				action: 'processJob',
				data: { jobId: '123' },
			};

			const ctx = telemetry.onRequestStart({
				event,
				context: mockLambdaContext,
			});

			telemetry.onRequestEnd(ctx, { statusCode: 200 });

			const spans = exporter.getFinishedSpans();
			expect(spans).toHaveLength(1);
			expect(spans[0].attributes['http.request.method']).toBe('INVOKE');
		});
	});
});
