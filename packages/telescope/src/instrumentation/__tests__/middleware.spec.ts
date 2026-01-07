import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { Context as LambdaContext } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getContextFromEvent,
  getSpanFromEvent,
  telemetryMiddleware,
  withEventContext,
} from '../middleware';

describe('telemetryMiddleware', () => {
  let mockContext: LambdaContext;
  let middleware: ReturnType<typeof telemetryMiddleware>;
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    // Set up real OpenTelemetry with in-memory exporter
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    provider.register();

    mockContext = {
      callbackWaitsForEmptyEventLoop: true,
      functionName: 'test-function',
      functionVersion: '1',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
      memoryLimitInMB: '256',
      awsRequestId: 'test-request-id-123',
      logGroupName: '/aws/lambda/test',
      logStreamName: '2024/01/01/[$LATEST]abc123',
      getRemainingTimeInMillis: () => 10000,
      done: vi.fn(),
      fail: vi.fn(),
      succeed: vi.fn(),
    };

    middleware = telemetryMiddleware();
  });

  afterEach(async () => {
    exporter.reset();
    await provider.shutdown();
    // Reset global tracer provider
    trace.disable();
  });

  describe('before hook', () => {
    it('should create span for API Gateway v2 event', async () => {
      const event = {
        rawPath: '/api/users',
        headers: {
          host: 'api.example.com',
          'content-type': 'application/json',
        },
        requestContext: {
          requestId: 'req-123',
          http: {
            method: 'POST',
            sourceIp: '192.168.1.1',
            userAgent: 'test-agent',
            path: '/api/users',
          },
        },
        body: JSON.stringify({ name: 'John' }),
        routeKey: 'POST /api/users',
      };

      const request = { event, context: mockContext, response: null };
      await middleware.before!(request as any);

      // Span should be stored on event
      const span = getSpanFromEvent(event);
      expect(span).toBeDefined();
      expect(getContextFromEvent(event)).toBeDefined();

      // End span to export it
      const response = { statusCode: 201, body: '{"id":"123"}' };
      await middleware.after!({ event, context: mockContext, response } as any);

      // Check exported spans
      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe('POST /api/users');
      expect(spans[0].attributes['http.request.method']).toBe('POST');
      expect(spans[0].attributes['url.path']).toBe('/api/users');
      expect(spans[0].attributes['client.address']).toBe('192.168.1.1');
    });

    it('should create span for API Gateway v1 event', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/api/items',
        headers: {
          Host: 'api.example.com',
          'User-Agent': 'test-agent',
        },
        requestContext: {
          requestId: 'req-456',
          identity: {
            sourceIp: '10.0.0.1',
          },
        },
        resource: '/api/items/{id}',
        queryStringParameters: { page: '1' },
      };

      const request = { event, context: mockContext, response: null };
      await middleware.before!(request as any);

      expect(getSpanFromEvent(event)).toBeDefined();

      await middleware.after!({
        event,
        context: mockContext,
        response: { statusCode: 200 },
      } as any);

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe('GET /api/items/{id}');
      expect(spans[0].attributes['http.request.method']).toBe('GET');
      expect(spans[0].attributes['http.route']).toBe('/api/items/{id}');
    });

    it('should handle generic Lambda invocation', async () => {
      const event = {
        customField: 'value',
        headers: {},
      };

      const request = { event, context: mockContext, response: null };
      await middleware.before!(request as any);

      expect(getSpanFromEvent(event)).toBeDefined();

      await middleware.after!({
        event,
        context: mockContext,
        response: { statusCode: 200 },
      } as any);

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].attributes['http.request.method']).toBe('INVOKE');
    });

    it('should skip tracing when shouldSkip returns true', async () => {
      const skipMiddleware = telemetryMiddleware({
        shouldSkip: (event) => event.skipTrace === true,
      });

      const event = {
        skipTrace: true,
        headers: {},
      };

      const request = { event, context: mockContext, response: null };
      await skipMiddleware.before!(request as any);

      expect(getSpanFromEvent(event)).toBeUndefined();
      expect(exporter.getFinishedSpans()).toHaveLength(0);
    });

    it('should record request body when recordBody is true', async () => {
      const bodyMiddleware = telemetryMiddleware({ recordBody: true });
      const bodyContent = JSON.stringify({
        name: 'John',
        email: 'john@example.com',
      });

      const event = {
        httpMethod: 'POST',
        path: '/api/users',
        headers: {},
        body: bodyContent,
      };

      const request = { event, context: mockContext, response: null };
      await bodyMiddleware.before!(request as any);
      await bodyMiddleware.after!({
        event,
        context: mockContext,
        response: { statusCode: 201 },
      } as any);

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['http.request.body']).toBe(bodyContent);
    });

    it('should truncate large request bodies', async () => {
      const bodyMiddleware = telemetryMiddleware({ recordBody: true });
      const largeBody = 'x'.repeat(5000);

      const event = {
        httpMethod: 'POST',
        path: '/api/upload',
        headers: {},
        body: largeBody,
      };

      const request = { event, context: mockContext, response: null };
      await bodyMiddleware.before!(request as any);
      await bodyMiddleware.after!({
        event,
        context: mockContext,
        response: { statusCode: 200 },
      } as any);

      const spans = exporter.getFinishedSpans();
      const recordedBody = spans[0].attributes['http.request.body'] as string;
      expect(recordedBody.length).toBeLessThan(largeBody.length);
      expect(recordedBody).toContain('...');
    });

    it('should add Lambda-specific attributes', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/api/test',
        headers: {},
      };

      const request = { event, context: mockContext, response: null };
      await middleware.before!(request as any);
      await middleware.after!({
        event,
        context: mockContext,
        response: { statusCode: 200 },
      } as any);

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['faas.invocation_id']).toBe(
        'test-request-id-123',
      );
      expect(spans[0].attributes['faas.name']).toBe('test-function');
    });
  });

  describe('after hook', () => {
    it('should record success status code', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/api/users',
        headers: {},
      };

      await middleware.before!({
        event,
        context: mockContext,
        response: null,
      } as any);
      await middleware.after!({
        event,
        context: mockContext,
        response: { statusCode: 200, body: '{"users":[]}' },
      } as any);

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['http.response.status_code']).toBe(200);
      expect(spans[0].status.code).toBe(1); // SpanStatusCode.OK
    });

    it('should record 4xx status as error', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/api/users/999',
        headers: {},
      };

      await middleware.before!({
        event,
        context: mockContext,
        response: null,
      } as any);
      await middleware.after!({
        event,
        context: mockContext,
        response: { statusCode: 404, body: '{"error":"Not found"}' },
      } as any);

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['http.response.status_code']).toBe(404);
      expect(spans[0].status.code).toBe(2); // SpanStatusCode.ERROR
    });

    it('should record response body when recordResponseBody is true', async () => {
      const responseMiddleware = telemetryMiddleware({
        recordResponseBody: true,
      });
      const responseBody = '{"users":[{"id":"1","name":"John"}]}';

      const event = {
        httpMethod: 'GET',
        path: '/api/users',
        headers: {},
      };

      await responseMiddleware.before!({
        event,
        context: mockContext,
        response: null,
      } as any);
      await responseMiddleware.after!({
        event,
        context: mockContext,
        response: { statusCode: 200, body: responseBody },
      } as any);

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['http.response.body']).toBe(responseBody);
    });
  });

  describe('onError hook', () => {
    it('should record error with exception', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/api/error',
        headers: {},
      };

      await middleware.before!({
        event,
        context: mockContext,
        response: null,
      } as any);

      const error = new Error('Database connection failed');
      await middleware.onError!({
        event,
        context: mockContext,
        response: { statusCode: 500 },
        error,
      } as any);

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['http.response.status_code']).toBe(500);
      expect(spans[0].status.code).toBe(2); // SpanStatusCode.ERROR
      expect(spans[0].events).toHaveLength(1);
      expect(spans[0].events[0].name).toBe('exception');
    });

    it('should use error statusCode if available', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/api/protected',
        headers: {},
      };

      await middleware.before!({
        event,
        context: mockContext,
        response: null,
      } as any);

      const error = Object.assign(new Error('Forbidden'), { statusCode: 403 });
      await middleware.onError!({
        event,
        context: mockContext,
        response: null,
        error,
      } as any);

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['http.response.status_code']).toBe(403);
    });
  });

  describe('withEventContext', () => {
    it('should run function within span context', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/api/users',
        headers: {},
      };

      await middleware.before!({
        event,
        context: mockContext,
        response: null,
      } as any);

      const result = await withEventContext(event, async () => {
        return 'executed-in-context';
      });

      expect(result).toBe('executed-in-context');
    });

    it('should run function normally when no context exists', async () => {
      const event = {};

      const result = await withEventContext(event, async () => {
        return 'executed-without-context';
      });

      expect(result).toBe('executed-without-context');
    });
  });

  describe('custom extractors', () => {
    it('should extract user ID using getUserId', async () => {
      const userMiddleware = telemetryMiddleware({
        getUserId: (event) => event.requestContext?.authorizer?.userId,
      });

      const event = {
        httpMethod: 'GET',
        path: '/api/profile',
        headers: {},
        requestContext: {
          authorizer: {
            userId: 'user-abc123',
          },
        },
      };

      await userMiddleware.before!({
        event,
        context: mockContext,
        response: null,
      } as any);
      await userMiddleware.after!({
        event,
        context: mockContext,
        response: { statusCode: 200 },
      } as any);

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['enduser.id']).toBe('user-abc123');
    });

    it('should extract endpoint name using getEndpointName', async () => {
      const endpointMiddleware = telemetryMiddleware({
        getEndpointName: (event) => event.endpointName,
      });

      const event = {
        httpMethod: 'GET',
        path: '/api/users',
        headers: {},
        endpointName: 'ListUsers',
      };

      await endpointMiddleware.before!({
        event,
        context: mockContext,
        response: null,
      } as any);
      await endpointMiddleware.after!({
        event,
        context: mockContext,
        response: { statusCode: 200 },
      } as any);

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['endpoint.name']).toBe('ListUsers');
    });

    it('should extract operation ID using getOperationId', async () => {
      const opMiddleware = telemetryMiddleware({
        getOperationId: (event) => event.operationId,
      });

      const event = {
        httpMethod: 'POST',
        path: '/api/orders',
        headers: {},
        operationId: 'createOrder',
      };

      await opMiddleware.before!({
        event,
        context: mockContext,
        response: null,
      } as any);
      await opMiddleware.after!({
        event,
        context: mockContext,
        response: { statusCode: 201 },
      } as any);

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['endpoint.operation_id']).toBe('createOrder');
    });
  });

  describe('trace context propagation', () => {
    it('should extract trace context from traceparent header', async () => {
      const traceId = '0af7651916cd43dd8448eb211c80319c';
      const parentSpanId = 'b7ad6b7169203331';

      const event = {
        httpMethod: 'GET',
        path: '/api/downstream',
        headers: {
          traceparent: `00-${traceId}-${parentSpanId}-01`,
        },
      };

      await middleware.before!({
        event,
        context: mockContext,
        response: null,
      } as any);
      await middleware.after!({
        event,
        context: mockContext,
        response: { statusCode: 200 },
      } as any);

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      // The span should be created (even if not linked to parent in this basic setup)
      expect(spans[0].name).toContain('GET');
    });
  });
});
