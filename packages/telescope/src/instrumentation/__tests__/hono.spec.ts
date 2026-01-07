import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getSpanFromContext,
  getTraceContextFromHono,
  honoTelemetryMiddleware,
  withHonoSpanContext,
} from '../hono';

describe('honoTelemetryMiddleware', () => {
  let app: Hono;
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    // Set up real OpenTelemetry with in-memory exporter
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    provider.register();

    app = new Hono();
  });

  afterEach(async () => {
    exporter.reset();
    await provider.shutdown();
    trace.disable();
  });

  describe('span creation', () => {
    it('should create span for GET requests', async () => {
      app.use('*', honoTelemetryMiddleware());
      app.get('/api/users', (c) => {
        const span = getSpanFromContext(c);
        expect(span).toBeDefined();
        return c.json({ users: [] });
      });

      const response = await app.request('/api/users');

      expect(response.status).toBe(200);
      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe('GET /api/users');
      expect(spans[0].attributes['http.request.method']).toBe('GET');
    });

    it('should create span for POST requests with attributes', async () => {
      app.use('*', honoTelemetryMiddleware());
      app.post('/api/users', (c) => c.json({ id: '123' }, 201));

      const response = await app.request('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'test-agent',
        },
        body: JSON.stringify({ name: 'John' }),
      });

      expect(response.status).toBe(201);
      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['http.request.method']).toBe('POST');
      expect(spans[0].attributes['http.response.status_code']).toBe(201);
      expect(spans[0].attributes['user_agent.original']).toBe('test-agent');
    });

    it('should handle errors and record error status', async () => {
      // Note: Hono catches errors internally before they propagate to middleware,
      // so we can only detect the 500 status code, not record the actual exception
      app.use('*', honoTelemetryMiddleware());
      app.get('/api/error', () => {
        throw new Error('Test error');
      });

      const response = await app.request('/api/error');

      expect(response.status).toBe(500);
      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].attributes['http.response.status_code']).toBe(500);
      expect(spans[0].status.code).toBe(2); // SpanStatusCode.ERROR
    });

    it('should record 4xx status codes', async () => {
      app.use('*', honoTelemetryMiddleware());
      app.get('/api/users/:id', (c) => c.json({ error: 'Not found' }, 404));

      const response = await app.request('/api/users/999');

      expect(response.status).toBe(404);
      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['http.response.status_code']).toBe(404);
      expect(spans[0].status.code).toBe(2); // SpanStatusCode.ERROR
    });
  });

  describe('path filtering', () => {
    it('should skip paths in ignorePaths (exact match)', async () => {
      app.use(
        '*',
        honoTelemetryMiddleware({
          ignorePaths: ['/health', '/metrics'],
        }),
      );
      app.get('/health', (c) => c.json({ status: 'ok' }));

      await app.request('/health');

      expect(exporter.getFinishedSpans()).toHaveLength(0);
    });

    it('should skip paths matching wildcard patterns', async () => {
      app.use(
        '*',
        honoTelemetryMiddleware({
          ignorePaths: ['/__telescope/*'],
        }),
      );
      app.get('/__telescope/requests', (c) => c.json({ requests: [] }));

      await app.request('/__telescope/requests');

      expect(exporter.getFinishedSpans()).toHaveLength(0);
    });

    it('should trace paths not in ignorePaths', async () => {
      app.use(
        '*',
        honoTelemetryMiddleware({
          ignorePaths: ['/health'],
        }),
      );
      app.get('/api/users', (c) => c.json({ users: [] }));

      await app.request('/api/users');

      expect(exporter.getFinishedSpans()).toHaveLength(1);
    });
  });

  describe('custom shouldSkip', () => {
    it('should skip requests when shouldSkip returns true', async () => {
      app.use(
        '*',
        honoTelemetryMiddleware({
          shouldSkip: (c) => c.req.header('x-skip-trace') === 'true',
        }),
      );
      app.get('/api/users', (c) => c.json({ users: [] }));

      await app.request('/api/users', {
        headers: { 'x-skip-trace': 'true' },
      });

      expect(exporter.getFinishedSpans()).toHaveLength(0);
    });

    it('should trace requests when shouldSkip returns false', async () => {
      app.use(
        '*',
        honoTelemetryMiddleware({
          shouldSkip: (c) => c.req.header('x-skip-trace') === 'true',
        }),
      );
      app.get('/api/users', (c) => c.json({ users: [] }));

      await app.request('/api/users');

      expect(exporter.getFinishedSpans()).toHaveLength(1);
    });
  });

  describe('user ID extraction', () => {
    it('should extract user ID using custom function', async () => {
      app.use(
        '*',
        honoTelemetryMiddleware({
          getUserId: (c) => c.req.header('x-user-id'),
        }),
      );
      app.get('/api/profile', (c) => c.json({ name: 'John' }));

      await app.request('/api/profile', {
        headers: { 'x-user-id': 'user-123' },
      });

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['enduser.id']).toBe('user-123');
    });

    it('should not add user attribute when getUserId returns undefined', async () => {
      app.use(
        '*',
        honoTelemetryMiddleware({
          getUserId: () => undefined,
        }),
      );
      app.get('/api/users', (c) => c.json({ users: [] }));

      await app.request('/api/users');

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['enduser.id']).toBeUndefined();
    });
  });

  describe('client IP extraction', () => {
    it('should extract IP from x-forwarded-for header', async () => {
      app.use('*', honoTelemetryMiddleware());
      app.get('/api/users', (c) => c.json({ users: [] }));

      await app.request('/api/users', {
        headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1' },
      });

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['client.address']).toBe('192.168.1.1');
    });

    it('should extract IP from x-real-ip header', async () => {
      app.use('*', honoTelemetryMiddleware());
      app.get('/api/users', (c) => c.json({ users: [] }));

      await app.request('/api/users', {
        headers: { 'x-real-ip': '10.0.0.5' },
      });

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['client.address']).toBe('10.0.0.5');
    });

    it('should extract IP from cf-connecting-ip header (Cloudflare)', async () => {
      app.use('*', honoTelemetryMiddleware());
      app.get('/api/users', (c) => c.json({ users: [] }));

      await app.request('/api/users', {
        headers: { 'cf-connecting-ip': '203.0.113.195' },
      });

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['client.address']).toBe('203.0.113.195');
    });
  });

  describe('trace context helpers', () => {
    it('should provide trace context via getTraceContextFromHono', async () => {
      let traceContext: any;

      app.use('*', honoTelemetryMiddleware());
      app.get('/api/users', (c) => {
        traceContext = getTraceContextFromHono(c);
        return c.json({ users: [] });
      });

      await app.request('/api/users');

      expect(traceContext).toBeDefined();
    });

    it('should run function within span context via withHonoSpanContext', async () => {
      let result: string | undefined;

      app.use('*', honoTelemetryMiddleware());
      app.get('/api/users', async (c) => {
        result = await withHonoSpanContext(c, async () => 'executed');
        return c.json({ users: [] });
      });

      await app.request('/api/users');

      expect(result).toBe('executed');
    });
  });

  describe('request ID extraction', () => {
    it('should extract request ID from x-request-id header', async () => {
      app.use('*', honoTelemetryMiddleware());
      app.get('/api/users', (c) => c.json({ users: [] }));

      await app.request('/api/users', {
        headers: { 'x-request-id': 'req-abc123' },
      });

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['http.request.id']).toBe('req-abc123');
    });

    it('should extract request ID from x-amzn-requestid header', async () => {
      app.use('*', honoTelemetryMiddleware());
      app.get('/api/users', (c) => c.json({ users: [] }));

      await app.request('/api/users', {
        headers: { 'x-amzn-requestid': 'amzn-req-456' },
      });

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['http.request.id']).toBe('amzn-req-456');
    });
  });

  describe('URL attributes', () => {
    it('should capture full URL and path', async () => {
      app.use('*', honoTelemetryMiddleware());
      app.get('/api/users', (c) => c.json({ users: [] }));

      await app.request('http://localhost/api/users?page=1');

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['url.full']).toContain('/api/users');
      expect(spans[0].attributes['url.path']).toBe('/api/users');
      expect(spans[0].attributes['server.address']).toBe('localhost');
    });

    it('should capture scheme', async () => {
      app.use('*', honoTelemetryMiddleware());
      app.get('/api/users', (c) => c.json({ users: [] }));

      await app.request('https://api.example.com/api/users');

      const spans = exporter.getFinishedSpans();
      expect(spans[0].attributes['url.scheme']).toBe('https');
    });
  });

  describe('multiple requests', () => {
    it('should create separate spans for each request', async () => {
      app.use('*', honoTelemetryMiddleware());
      app.get('/api/users', (c) => c.json({ users: [] }));
      app.post('/api/users', (c) => c.json({ id: '1' }, 201));

      await app.request('/api/users');
      await app.request('/api/users', { method: 'POST' });

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(2);
      expect(spans[0].attributes['http.request.method']).toBe('GET');
      expect(spans[1].attributes['http.request.method']).toBe('POST');
    });
  });
});
