import { EnvironmentParser } from '@geekmidas/envkit';
import {
  BadRequestError,
  ConflictError,
  HttpError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from '@geekmidas/errors';
import type { Logger } from '@geekmidas/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Endpoint } from '../Endpoint';

import { createMockContext, createMockV1Event } from '@geekmidas/testkit/aws';

import { createMockLogger } from '@geekmidas/testkit/logger';
import { AmazonApiGatewayV1Endpoint } from '../AmazonApiGatewayV1EndpointAdaptor';
/**
 * Common test event types for AWS adapter testing
 */
export type TestEvent =
  | { type: 'user.created'; payload: { userId: string; email: string } }
  | { type: 'user.updated'; payload: { userId: string; changes: string[] } }
  | { type: 'notification.sent'; payload: { userId: string; type: string } };

/**
 * Mock service for testing
 */
export const TestService = {
  serviceName: 'TestService' as const,

  async register() {
    return this;
  },

  async cleanup() {},
};

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
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event();
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
        memorySize: undefined,
        status: 201,
        getSession: undefined,
        authorize: undefined,
        description: 'Create user endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event({
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
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'List items endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event({
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
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Get user endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event({
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
        memorySize: undefined,
        status: 204,
        getSession: undefined,
        authorize: undefined,
        description: 'Void endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event({ httpMethod: 'POST' });
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
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Logger test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event();
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
          ip: expect.any(String),
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
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Error test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event();
      const context = createMockContext();

      const response = await handler(event, context);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body!);
      expect(body).toMatchObject({
        message: 'An unknown error occurred',
      });

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should register services', async () => {
      const endpoint = new Endpoint({
        route: '/with-service',
        method: 'GET',
        fn: async ({ services }) => {
          const testService = await services.TestService;
          return { hasService: !!testService };
        },
        input: {},
        output: z.object({ hasService: z.boolean() }),
        services: [TestService],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Service test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler.bind(adapter);

      const event = createMockV1Event();
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
        memorySize: undefined,
        status: undefined,
        getSession: async () => mockSession,
        authorize: undefined,
        description: 'Session test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event();
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      // Session is currently hardcoded as empty object in the implementation
      expect(response.body).toBe(JSON.stringify({ session: mockSession }));
    });
  });

  describe('error handling', () => {
    it('should return correct status code for HttpError', async () => {
      const endpoint = new Endpoint({
        route: '/http-error',
        method: 'GET',
        fn: async () => {
          throw new HttpError(403, 'Forbidden', { code: 'FORBIDDEN_ACCESS' });
        },
        input: {},
        output: z.object({ message: z.string() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'HTTP error test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event();
      const context = createMockContext();

      const response = await handler(event, context);

      expect(response.statusCode).toBe(403);
      expect(response.body).toBe(
        JSON.stringify({
          message: 'Forbidden',
          code: 'FORBIDDEN_ACCESS',
        }),
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should return 500 for non-HttpError errors', async () => {
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
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Generic error test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event();
      const context = createMockContext();

      const response = await handler(event, context);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body!);
      expect(body).toMatchObject({
        message: 'An unknown error occurred',
      });

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should preserve status codes for various HttpError subclasses', async () => {
      const testCases = [
        {
          ErrorClass: UnauthorizedError,
          statusCode: 401,
          message: 'Unauthorized',
        },
        {
          ErrorClass: BadRequestError,
          statusCode: 400,
          message: 'Bad Request',
        },
        { ErrorClass: NotFoundError, statusCode: 404, message: 'Not Found' },
        { ErrorClass: ConflictError, statusCode: 409, message: 'Conflict' },
        {
          ErrorClass: InternalServerError,
          statusCode: 500,
          message: 'Internal Server Error',
        },
      ];

      for (const { ErrorClass, statusCode, message } of testCases) {
        const endpoint = new Endpoint({
          route: `/error-${statusCode}`,
          method: 'GET',
          fn: async () => {
            throw new ErrorClass(message);
          },
          input: {},
          output: z.object({ message: z.string() }),
          services: [],
          logger: mockLogger,
          timeout: undefined,
          memorySize: undefined,
          status: undefined,
          getSession: undefined,
          authorize: undefined,
          description: `${statusCode} error test endpoint`,
        });

        const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
        const handler = adapter.handler;

        const event = createMockV1Event();
        const context = createMockContext();

        const response = await handler(event, context);

        expect(response.statusCode).toBe(statusCode);
        expect(response.body).toBe(
          JSON.stringify({
            message,
            code: undefined,
          }),
        );
      }
    });

    it('should return 422 for body validation errors', async () => {
      const bodySchema = z.object({
        name: z.string().min(3),
        age: z.number().positive(),
      });

      const endpoint = new Endpoint({
        route: '/validation',
        method: 'POST',
        fn: async () => ({ success: true }),
        input: { body: bodySchema },
        output: z.object({ success: z.boolean() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Validation test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event({
        httpMethod: 'POST',
        body: JSON.stringify({ name: 'Jo', age: -5 }), // Invalid: name too short, age negative
      });
      const context = createMockContext();

      const response = await handler(event, context);

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body!);
      expect(body.message).toBe('Validation failed');
      expect(body.code).toBeUndefined();
    });

    it('should return 422 for query validation errors', async () => {
      const querySchema = z.object({
        page: z.string().transform(Number).pipe(z.number().positive()),
        limit: z.string().transform(Number).pipe(z.number().max(100)),
      });

      const endpoint = new Endpoint({
        route: '/items',
        method: 'GET',
        fn: async () => ({ items: [] }),
        input: { query: querySchema },
        output: z.object({ items: z.array(z.any()) }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Query validation test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event({
        queryStringParameters: { page: '0', limit: '200' }, // Invalid: page not positive, limit too high
      });
      const context = createMockContext();

      const response = await handler(event, context);

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body!);
      expect(body.message).toBe('Validation failed');
    });

    it('should return 422 for params validation errors', async () => {
      const paramsSchema = z.object({
        id: z.string().uuid(),
      });

      const endpoint = new Endpoint({
        route: '/users/:id',
        method: 'GET',
        fn: async ({ params }) => ({ id: params.id }),
        input: { params: paramsSchema },
        output: z.object({ id: z.string() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Params validation test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event({
        pathParameters: { id: 'not-a-uuid' }, // Invalid: not a valid UUID
      });
      const context = createMockContext();

      const response = await handler(event, context);

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body!);
      expect(body.message).toBe('Validation failed');
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
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Header test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event({
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
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Protected endpoint',
      });

      // Set authorize function that returns true
      endpoint.authorize = async () => true;

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event();
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
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Protected endpoint',
      });

      // Set authorize function that returns false
      endpoint.authorize = async () => false;

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event();
      const context = createMockContext();

      const response = await handler(event, context);

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body!);
      expect(body).toMatchObject({
        message: 'Unauthorized access to the endpoint',
      });
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
        memorySize: undefined,
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
      const validEvent = createMockV1Event({
        headers: {
          authorization: 'Bearer valid-token',
        },
      });
      const context = createMockContext();
      const response = await handler(validEvent, context);

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(JSON.stringify({ success: true }));

      // Test with invalid token
      const invalidEvent = createMockV1Event({
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });
      const invalidResponse = await handler(invalidEvent, context);
      const invalidResponseBody = JSON.parse(invalidResponse.body!);
      expect(invalidResponse.statusCode).toBe(401);
      expect(invalidResponseBody).toMatchObject({
        message: 'Unauthorized access to the endpoint',
      });
    });
  });

  describe('combined inputs', () => {
    it('should handle array query parameters', async () => {
      const querySchema = z.object({
        tags: z.array(z.string()),
        page: z.coerce.number().default(1),
      });
      const outputSchema = z.object({
        tags: z.array(z.string()),
        page: z.number(),
      });

      const endpoint = new Endpoint({
        route: '/items',
        method: 'GET',
        fn: async ({ query }) => ({
          tags: query.tags,
          page: query.page,
        }),
        input: { query: querySchema },
        output: outputSchema,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        authorize: undefined,
        description: 'List items with tags',
        getSession: () => ({}),
        status: 200,
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event({
        queryStringParameters: { tags: 'nodejs', page: '2' },
        multiValueQueryStringParameters: {
          tags: ['nodejs', 'typescript', 'javascript'],
          page: ['2'],
        },
      });
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body!);
      expect(body).toEqual({
        tags: ['nodejs', 'typescript', 'javascript'],
        page: 2,
      });
    });

    it('should handle object query parameters with dot notation', async () => {
      const querySchema = z.object({
        filter: z.object({
          name: z.string(),
          status: z.string(),
          priority: z.coerce.number(),
        }),
        sort: z.string().default('name'),
      });
      const outputSchema = z.object({
        filter: z.object({
          name: z.string(),
          status: z.string(),
          priority: z.number(),
        }),
        sort: z.string(),
      });

      const endpoint = new Endpoint({
        route: '/search',
        method: 'GET',
        fn: async ({ query }) => ({
          filter: query.filter,
          sort: query.sort,
        }),
        input: { query: querySchema },
        output: outputSchema,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        authorize: undefined,
        description: 'Search with filters',
        getSession: () => ({}),
        status: 200,
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event({
        queryStringParameters: {
          'filter.name': 'john',
          'filter.status': 'active',
          'filter.priority': '1',
          sort: 'priority',
        },
      });
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body!);
      expect(body).toEqual({
        filter: {
          name: 'john',
          status: 'active',
          priority: 1,
        },
        sort: 'priority',
      });
    });

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
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Complex input endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event({
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

  describe('response metadata', () => {
    it('should set response cookies', async () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async (_, response) => {
          response.cookie('session', 'abc123', {
            httpOnly: true,
            secure: true,
          });
          return { success: true };
        },
        input: {},
        output: z.object({ success: z.boolean() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event();
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.multiValueHeaders?.['Set-Cookie']).toEqual([
        'session=abc123; HttpOnly; Secure',
      ]);
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(JSON.stringify({ success: true }));
    });

    it('should set custom headers', async () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async (_, response) => {
          response.header('X-Custom-Header', 'custom-value');
          response.header('X-Request-Id', '12345');
          return { success: true };
        },
        input: {},
        output: z.object({ success: z.boolean() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event();
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.headers).toEqual({
        'X-Custom-Header': 'custom-value',
        'X-Request-Id': '12345',
      });
    });

    it('should set custom status code', async () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'POST',
        fn: async (_, response) => {
          response.status(201);
          return { id: '123' };
        },
        input: {},
        output: z.object({ id: z.string() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event({ httpMethod: 'POST' });
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(201);
    });

    it('should combine cookies, headers, and status', async () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'POST',
        fn: async (_, response) => {
          response
            .status(201)
            .header('Location', '/test/123')
            .cookie('session', 'abc123', { httpOnly: true })
            .cookie('theme', 'dark');
          return { id: '123' };
        },
        input: {},
        output: z.object({ id: z.string() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event({ httpMethod: 'POST' });
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(201);
      expect(response.headers).toEqual({ Location: '/test/123' });
      expect(response.multiValueHeaders?.['Set-Cookie']).toEqual([
        'session=abc123; HttpOnly',
        'theme=dark',
      ]);
    });

    it('should delete cookies', async () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async (_, response) => {
          response.deleteCookie('session', {
            path: '/',
            domain: '.example.com',
          });
          return { success: true };
        },
        input: {},
        output: z.object({ success: z.boolean() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event();
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.multiValueHeaders?.['Set-Cookie']).toEqual([
        'session=; Domain=.example.com; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0',
      ]);
    });

    it('should use send() method with metadata', async () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async (_, response) => {
          return response
            .status(201)
            .header('X-Custom', 'value')
            .cookie('session', 'abc123')
            .send({ id: '123' });
        },
        input: {},
        output: z.object({ id: z.string() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event();
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response.statusCode).toBe(201);
      expect(response.headers).toEqual({ 'X-Custom': 'value' });
      expect(response.multiValueHeaders?.['Set-Cookie']).toEqual([
        'session=abc123',
      ]);
      expect(response.body).toBe(JSON.stringify({ id: '123' }));
    });

    it('should return simple response without metadata when not using response builder', async () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: {},
        output: z.object({ success: z.boolean() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: 'Test endpoint',
      });

      const adapter = new AmazonApiGatewayV1Endpoint(envParser, endpoint);
      const handler = adapter.handler;

      const event = createMockV1Event();
      const context = createMockContext();
      const response = await handler(event, context);

      expect(response).toEqual({
        statusCode: 200,
        body: JSON.stringify({ success: true }),
      });
      expect(response.headers).toBeUndefined();
      expect(response.multiValueHeaders).toBeUndefined();
    });
  });
});
