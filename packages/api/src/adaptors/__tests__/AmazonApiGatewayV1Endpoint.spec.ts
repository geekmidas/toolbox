import { EnvironmentParser } from '@geekmidas/envkit';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Endpoint } from '../../constructs/Endpoint';
import { HttpError, UnauthorizedError } from '../../errors';
import type { Logger } from '../../logger';
import { HermodService } from '../../services';
import { AmazonApiGatewayV1Endpoint } from '../AmazonApiGatewayV1Endpoint';

// Mock logger
const createMockLogger = (): Logger => {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
};

// Mock service for testing
class TestService extends HermodService {
  static serviceName = 'TestService' as const;

  async register() {
    return this;
  }

  async cleanup() {}
}

// Mock context
const createMockContext = (): Context => ({
  awsRequestId: 'test-request-id',
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'test-function',
  functionVersion: '1',
  invokedFunctionArn:
    'arn:aws:lambda:us-east-1:123456789012:function:test-function',
  memoryLimitInMB: '128',
  logGroupName: '/aws/lambda/test-function',
  logStreamName: '2024/01/01/[$LATEST]abcdef123456',
  getRemainingTimeInMillis: () => 5000,
  done: vi.fn(),
  fail: vi.fn(),
  succeed: vi.fn(),
});

// Mock API Gateway event
const createMockEvent = (
  overrides: Partial<APIGatewayProxyEvent> = {},
): APIGatewayProxyEvent => ({
  body: null,
  headers: {
    'content-type': 'application/json',
    'user-agent': 'test-agent',
    host: 'test.example.com',
  },
  multiValueHeaders: {},
  httpMethod: 'GET',
  isBase64Encoded: false,
  path: '/test',
  pathParameters: null,
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  requestContext: {
    accountId: '123456789012',
    apiId: 'api-id',
    authorizer: null,
    protocol: 'HTTP/1.1',
    httpMethod: 'GET',
    path: '/test',
    stage: 'test',
    requestId: 'request-id',
    requestTime: '01/Jan/2024:00:00:00 +0000',
    requestTimeEpoch: 1704067200000,
    resourceId: 'resource-id',
    resourcePath: '/test',
    identity: {
      accessKey: null,
      accountId: null,
      apiKey: null,
      apiKeyId: null,
      caller: null,
      clientCert: null,
      cognitoAuthenticationProvider: null,
      cognitoAuthenticationType: null,
      cognitoIdentityId: null,
      cognitoIdentityPoolId: null,
      principalOrgId: null,
      sourceIp: '192.168.1.1',
      user: null,
      userAgent: 'test-agent',
      userArn: null,
    },
  },
  resource: '/test',
  ...overrides,
});

describe('AmazonApiGatewayV1Endpoint', () => {
  let mockLogger: Logger;
  let envParser: EnvironmentParser<{}>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
    envParser = new EnvironmentParser({});
  });

  describe('handler', () => {
    it('should handle a simple GET request', async () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async () => ({ message: 'Hello, World!' }),
        input: {},
        output: z.object({ message: z.string() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockEvent();
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(JSON.stringify({ message: 'Hello, World!' }));
    });

    it('should handle POST request with body', async () => {
      const inputSchema = z.object({ name: z.string() });
      const outputSchema = z.object({ id: z.string(), name: z.string() });

      const endpoint = new Endpoint({
        route: '/users',
        method: 'POST',
        fn: async ({ body }) => ({ id: '123', name: body.name }),
        input: { body: inputSchema },
        output: outputSchema,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: 201,
        getSession: undefined,
        authorize: undefined,
        description: 'Create user endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ name: 'John Doe' }),
      });
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(201);
      expect(response.body).toBe(
        JSON.stringify({ id: '123', name: 'John Doe' }),
      );
    });

    it('should handle query parameters', async () => {
      const querySchema = z.object({ page: z.string().transform(Number) });
      const outputSchema = z.object({
        page: z.number(),
        items: z.array(z.string()),
      });

      const endpoint = new Endpoint({
        route: '/items',
        method: 'GET',
        fn: async ({ query }) => ({
          page: query.page,
          items: ['item1', 'item2'],
        }),
        input: { query: querySchema },
        output: outputSchema,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'List items endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockEvent({
        queryStringParameters: { page: '2' },
      });
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(
        JSON.stringify({ page: 2, items: ['item1', 'item2'] }),
      );
    });

    it('should handle path parameters', async () => {
      const paramsSchema = z.object({ id: z.string() });
      const outputSchema = z.object({ id: z.string(), name: z.string() });

      const endpoint = new Endpoint({
        route: '/users/:id',
        method: 'GET',
        fn: async ({ params }) => ({ id: params.id, name: 'John Doe' }),
        input: { params: paramsSchema },
        output: outputSchema,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Get user endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockEvent({
        pathParameters: { id: '123' },
      });
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(
        JSON.stringify({ id: '123', name: 'John Doe' }),
      );
    });

    it('should handle endpoint without output', async () => {
      const endpoint = new Endpoint({
        route: '/void',
        method: 'POST',
        fn: async () => {},
        input: {},
        output: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: 204,
        getSession: undefined,
        authorize: undefined,
        description: 'Void endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockEvent({ httpMethod: 'POST' });
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(204);
      expect(response.body).toBeUndefined();
    });
  });

  describe('middleware', () => {
    it('should inject logger with context', async () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async ({ logger }) => {
          logger.info('Test log');
          return { success: true };
        },
        input: {},
        output: z.object({ success: z.boolean() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Logger test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockEvent();
      const context = createMockContext();
      await handler(event, context);

      expect(mockLogger.child).toHaveBeenCalledWith({
        route: '/test',
        host: 'test.example.com',
        method: 'GET',
        fn: {
          name: 'test-function',
          version: '1',
        },
        req: {
          ip: '192.168.1.1',
          awsRequestId: 'test-request-id',
          id: 'request-id',
          userAgent: 'test-agent',
          path: '/test',
        },
      });
    });

    it('should handle errors and wrap them', async () => {
      const endpoint = new Endpoint({
        route: '/error',
        method: 'GET',
        fn: async () => {
          throw new Error('Test error');
        },
        input: {},
        output: z.object({ message: z.string() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Error test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockEvent();
      const context = createMockContext();

      await expect(handler(event, context)).rejects.toThrow();
    });

    it('should register services', async () => {
      const endpoint = new Endpoint({
        route: '/with-service',
        method: 'GET',
        fn: async ({ services }) => {
          const testService = services.TestService;
          return { hasService: !!testService };
        },
        input: {},
        output: z.object({ hasService: z.boolean() }),
        services: [TestService],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Service test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler.bind(adapter);

      const event = createMockEvent();
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(JSON.stringify({ hasService: true }));
    });

    it('should handle session', async () => {
      const mockSession = { userId: 'user-123', role: 'admin' };

      const endpoint = new Endpoint({
        route: '/with-session',
        method: 'GET',
        fn: async ({ session }) => ({ session }),
        input: {},
        output: z.object({ session: z.any() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: async () => mockSession,
        authorize: undefined,
        description: 'Session test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockEvent();
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      // Session is currently hardcoded as empty object in the implementation
      expect(response.body).toBe(JSON.stringify({ session: mockSession }));
    });
  });

  describe('error handling', () => {
    it('should handle HttpError properly', async () => {
      const endpoint = new Endpoint({
        route: '/http-error',
        method: 'GET',
        fn: async () => {
          throw new HttpError(403, 'Forbidden');
        },
        input: {},
        output: z.object({ message: z.string() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'HTTP error test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockEvent();
      const context = createMockContext();

      await expect(handler(event, context)).rejects.toThrow(HttpError);
    });

    it('should wrap non-HttpError errors', async () => {
      const endpoint = new Endpoint({
        route: '/generic-error',
        method: 'GET',
        fn: async () => {
          throw new TypeError('Type mismatch');
        },
        input: {},
        output: z.object({ message: z.string() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Generic error test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockEvent();
      const context = createMockContext();

      await expect(handler(event, context)).rejects.toThrow();
    });
  });

  describe('header handling', () => {
    it('should provide header function to handler', async () => {
      const endpoint = new Endpoint({
        route: '/headers',
        method: 'GET',
        fn: async ({ header }) => ({
          authorization: header('authorization'),
          contentType: header('content-type'),
        }),
        input: {},
        output: z.object({
          authorization: z.string().optional(),
          contentType: z.string().optional(),
        }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Header test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockEvent({
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token123',
        },
      });
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(
        JSON.stringify({
          authorization: 'Bearer token123',
          contentType: 'application/json',
        }),
      );
    });
  });

  describe('authorization', () => {
    it('should allow requests when authorize returns true', async () => {
      const endpoint = new Endpoint({
        route: '/protected',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: {},
        output: z.object({ success: z.boolean() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Protected endpoint',
      });

      // Set authorize function that returns true
      endpoint.authorize = async () => true;

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockEvent();
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(JSON.stringify({ success: true }));
    });

    it('should reject requests when authorize returns false', async () => {
      const endpoint = new Endpoint({
        route: '/protected',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: {},
        output: z.object({ success: z.boolean() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Protected endpoint',
      });

      // Set authorize function that returns false
      endpoint.authorize = async () => false;

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockEvent();
      const context = createMockContext();

      await expect(handler(event, context)).rejects.toThrow(UnauthorizedError);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Unauthorized access attempt',
      );
    });

    it('should handle async authorize functions', async () => {
      const endpoint = new Endpoint({
        route: '/protected',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: {},
        output: z.object({ success: z.boolean() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Protected endpoint',
      });

      // Set async authorize function with delay
      endpoint.authorize = async ({ header }) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return header('authorization') === 'Bearer valid-token';
      };

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      // Test with valid token
      const validEvent = createMockEvent({
        headers: {
          authorization: 'Bearer valid-token',
        },
      });
      const context = createMockContext();
      const response = await handler(validEvent, context);

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(JSON.stringify({ success: true }));

      // Test with invalid token
      const invalidEvent = createMockEvent({
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });
      await expect(handler(invalidEvent, context)).rejects.toThrow(
        UnauthorizedError,
      );
    });
  });

  describe('combined inputs', () => {
    it('should handle body, query, and params together', async () => {
      const bodySchema = z.object({ name: z.string() });
      const querySchema = z.object({ filter: z.string() });
      const paramsSchema = z.object({ id: z.string() });
      const outputSchema = z.object({
        id: z.string(),
        name: z.string(),
        filter: z.string(),
      });

      const endpoint = new Endpoint({
        route: '/complex/:id',
        method: 'PUT',
        fn: async ({ body, query, params }) => ({
          id: params.id,
          name: body.name,
          filter: query.filter,
        }),
        input: {
          body: bodySchema,
          query: querySchema,
          params: paramsSchema,
        },
        output: outputSchema,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Complex input endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({ name: 'Updated Name' }),
        queryStringParameters: { filter: 'active' },
        pathParameters: { id: '456' },
      });
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(
        JSON.stringify({
          id: '456',
          name: 'Updated Name',
          filter: 'active',
        }),
      );
    });
  });
});
