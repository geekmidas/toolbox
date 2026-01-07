import type { Context as LambdaContext } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Telescope } from '../../Telescope';
import { InMemoryStorage } from '../../storage/memory';
import {
  LambdaAdapter,
  detectLambdaResources,
  extractLambdaInvocationContext,
  wrapLambdaHandler,
} from '../lambda';

describe('Lambda Adapter', () => {
  let telescope: Telescope;
  let storage: InMemoryStorage;
  let mockContext: LambdaContext;

  beforeEach(() => {
    storage = new InMemoryStorage();
    telescope = new Telescope({ storage });

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
  });

  describe('detectLambdaResources', () => {
    it('should detect Lambda environment variables', () => {
      const originalEnv = { ...process.env };

      process.env.AWS_REGION = 'us-west-2';
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'my-function';
      process.env.AWS_LAMBDA_FUNCTION_VERSION = '$LATEST';
      process.env.AWS_LAMBDA_LOG_STREAM_NAME = 'log-stream-123';
      process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = '512';

      const resources = detectLambdaResources();

      expect(resources['cloud.provider']).toBe('aws');
      expect(resources['cloud.region']).toBe('us-west-2');
      expect(resources['faas.name']).toBe('my-function');
      expect(resources['faas.version']).toBe('$LATEST');
      expect(resources['faas.instance']).toBe('log-stream-123');
      expect(resources['faas.max_memory']).toBe(512);

      process.env = originalEnv;
    });

    it('should return defaults when environment variables are missing', () => {
      const originalEnv = { ...process.env };

      delete process.env.AWS_REGION;
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      delete process.env.AWS_LAMBDA_FUNCTION_VERSION;
      delete process.env.AWS_LAMBDA_LOG_STREAM_NAME;
      delete process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;

      const resources = detectLambdaResources();

      expect(resources['cloud.provider']).toBe('aws');
      expect(resources['cloud.region']).toBe('unknown');
      expect(resources['faas.name']).toBe('unknown');
      expect(resources['faas.version']).toBe('unknown');
      expect(resources['faas.instance']).toBe('unknown');
      expect(resources['faas.max_memory']).toBe(128); // Default memory

      process.env = originalEnv;
    });
  });

  describe('extractLambdaInvocationContext', () => {
    it('should extract invocation context from Lambda context', () => {
      const result = extractLambdaInvocationContext({}, mockContext);

      expect(result.requestId).toBe('test-request-id-123');
      expect(result.remainingTimeMs).toBe(10000);
      expect(result.memoryLimitMB).toBe(256);
      expect(result.functionName).toBe('test-function');
      expect(result.functionVersion).toBe('1');
    });
  });

  describe('LambdaAdapter', () => {
    it('should create adapter with default config', () => {
      const adapter = new LambdaAdapter(telescope);

      expect(adapter.config.environment).toBe('lambda');
      expect(adapter.config.autoFlush).toBe(true);
      expect(adapter.config.detectResource).toBe(true);
      expect(adapter.config.spanProcessor?.strategy).toBe('simple');
    });

    it('should merge custom config with defaults', () => {
      const adapter = new LambdaAdapter(telescope, {
        autoFlush: false,
      });

      expect(adapter.config.autoFlush).toBe(false);
      expect(adapter.config.environment).toBe('lambda'); // Default preserved
    });

    describe('extractRequestContext', () => {
      it('should extract context from API Gateway v1 event', () => {
        const adapter = new LambdaAdapter(telescope);
        const event = {
          httpMethod: 'POST',
          path: '/api/users',
          headers: { 'Content-Type': 'application/json' },
          queryStringParameters: { page: '1' },
          body: JSON.stringify({ name: 'John' }),
          requestContext: {
            requestId: 'req-123',
            identity: { sourceIp: '192.168.1.1' },
          },
        };

        const context = adapter.extractRequestContext(event);

        expect(context.method).toBe('POST');
        expect(context.path).toBe('/api/users');
        expect(context.query).toEqual({ page: '1' });
        expect(context.body).toEqual({ name: 'John' });
        expect(context.ip).toBe('192.168.1.1');
        expect(context.id).toBe('req-123');
      });

      it('should extract context from API Gateway v2 event', () => {
        const adapter = new LambdaAdapter(telescope);
        const event = {
          rawPath: '/api/items',
          headers: { 'content-type': 'application/json' },
          queryStringParameters: { limit: '10' },
          body: JSON.stringify({ data: 'test' }),
          requestContext: {
            requestId: 'req-456',
            http: {
              method: 'GET',
              sourceIp: '10.0.0.1',
            },
          },
        };

        const context = adapter.extractRequestContext(event);

        expect(context.method).toBe('GET');
        expect(context.path).toBe('/api/items');
        expect(context.query).toEqual({ limit: '10' });
        expect(context.body).toEqual({ data: 'test' });
        expect(context.ip).toBe('10.0.0.1');
      });

      it('should extract context from ALB event', () => {
        const adapter = new LambdaAdapter(telescope);
        // ALB events don't have requestContext, so the adapter falls back to generic handling
        const event = {
          httpMethod: 'DELETE',
          path: '/api/resource/123',
          headers: {},
          queryStringParameters: null,
          body: null,
        };

        const context = adapter.extractRequestContext(event);

        expect(context.method).toBe('DELETE');
        expect(context.path).toBe('/api/resource/123');
        // ALB without x-forwarded-for will have undefined IP
        expect(context.ip).toBeUndefined();
      });

      it('should handle generic Lambda invocation', () => {
        const adapter = new LambdaAdapter(telescope);
        const event = { customField: 'value' };

        const context = adapter.extractRequestContext(event);

        expect(context.method).toBe('INVOKE');
        expect(context.path).toBe('/');
        expect(context.body).toEqual({ customField: 'value' });
      });

      it('should handle base64 encoded body', () => {
        const adapter = new LambdaAdapter(telescope);
        const bodyContent = { encoded: true };
        const event = {
          httpMethod: 'POST',
          path: '/upload',
          headers: {},
          body: Buffer.from(JSON.stringify(bodyContent)).toString('base64'),
          isBase64Encoded: true,
        };

        const context = adapter.extractRequestContext(event);

        expect(context.body).toEqual({ encoded: true });
      });
    });

    describe('extractResponseContext', () => {
      it('should extract context from API Gateway response', () => {
        const adapter = new LambdaAdapter(telescope);
        const response = {
          statusCode: 201,
          headers: { 'x-custom': 'header' },
          body: JSON.stringify({ created: true }),
        };
        const startTime = Date.now() - 100;

        const context = adapter.extractResponseContext(response, startTime);

        expect(context.status).toBe(201);
        expect(context.headers).toEqual({ 'x-custom': 'header' });
        expect(context.body).toBe('{"created":true}');
        expect(context.duration).toBeGreaterThanOrEqual(100);
      });

      it('should handle generic response', () => {
        const adapter = new LambdaAdapter(telescope);
        const response = { data: 'raw' };
        const startTime = Date.now() - 50;

        const context = adapter.extractResponseContext(response, startTime);

        expect(context.status).toBe(200);
        expect(context.body).toEqual({ data: 'raw' });
        expect(context.duration).toBeGreaterThanOrEqual(50);
      });
    });

    describe('onSetup', () => {
      it('should detect resources when detectResource is true', async () => {
        const adapter = new LambdaAdapter(telescope, { detectResource: true });

        await adapter.onSetup();

        expect(adapter.getResourceAttributes()).not.toBeNull();
      });

      it('should not detect resources when detectResource is false', async () => {
        const adapter = new LambdaAdapter(telescope, { detectResource: false });

        await adapter.onSetup();

        expect(adapter.getResourceAttributes()).toBeNull();
      });
    });
  });

  describe('wrapLambdaHandler', () => {
    it('should wrap handler and record successful request', async () => {
      const baseHandler = async () => ({
        statusCode: 200,
        body: JSON.stringify({ ok: true }),
      });

      const wrappedHandler = wrapLambdaHandler(telescope, baseHandler);

      const event = {
        httpMethod: 'GET',
        path: '/health',
        headers: {},
        queryStringParameters: null,
        body: null,
      };

      const result = await wrappedHandler(event, mockContext);

      expect(result).toEqual({
        statusCode: 200,
        body: JSON.stringify({ ok: true }),
      });

      const requests = await storage.getRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0].method).toBe('GET');
      expect(requests[0].path).toBe('/health');
      expect(requests[0].status).toBe(200);
    });

    it('should record exception and rethrow on error', async () => {
      const error = new Error('Handler error');
      const baseHandler = async () => {
        throw error;
      };

      const wrappedHandler = wrapLambdaHandler(telescope, baseHandler);

      await expect(wrappedHandler({}, mockContext)).rejects.toThrow(
        'Handler error',
      );

      const exceptions = await storage.getExceptions();
      expect(exceptions).toHaveLength(1);
      expect(exceptions[0].message).toBe('Handler error');
    });

    it('should pass event and context to handler', async () => {
      const baseHandler = vi.fn().mockResolvedValue({ statusCode: 200 });
      const wrappedHandler = wrapLambdaHandler(telescope, baseHandler);

      const event = { test: 'event' };
      await wrappedHandler(event, mockContext);

      expect(baseHandler).toHaveBeenCalledWith(event, mockContext);
    });
  });
});
