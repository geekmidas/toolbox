import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { ServiceDiscovery } from '@geekmidas/services';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Endpoint, type EndpointContext } from '../Endpoint';
import { HonoEndpoint } from '../HonoEndpointAdaptor';

describe('HonoEndpointAdaptor', () => {
  const mockLogger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => mockLogger),
  };
  const envParser = new EnvironmentParser({});
  const serviceDiscovery = ServiceDiscovery.getInstance(mockLogger, envParser);

  describe('addRoute', () => {
    it('should register a GET endpoint', async () => {
      const endpoint = new Endpoint({
        route: '/users',
        method: 'GET',
        fn: async () => ({ users: [] }),
        input: undefined,
        output: z.object({ users: z.array(z.any()) }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/users');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ users: [] });
    });

    it('should register a POST endpoint with body validation', async () => {
      const bodySchema = z.object({
        name: z.string(),
        email: z.string().email(),
      });

      const endpoint = new Endpoint({
        route: '/users',
        method: 'POST',
        fn: async ({ body }) => ({ id: '123', ...body }),
        input: {
          body: bodySchema,
        },
        output: z.object({
          id: z.string(),
          name: z.string(),
          email: z.string(),
        }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: '123',
        name: 'John',
        email: 'john@example.com',
      });
    });

    it('should validate query parameters', async () => {
      const querySchema = z.object({
        page: z.string().transform(Number),
        limit: z.string().transform(Number),
      });

      const endpoint = new Endpoint({
        route: '/users',
        method: 'GET',
        fn: async ({ query }) => ({
          page: query.page,
          limit: query.limit,
          users: [],
        }),
        input: {
          query: querySchema,
        },
        output: z.object({
          page: z.number(),
          limit: z.number(),
          users: z.array(z.any()),
        }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/users?page=1&limit=10');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        page: 1,
        limit: 10,
        users: [],
      });
    });

    it('should validate path parameters', async () => {
      const paramsSchema = z.object({
        id: z.string().uuid(),
      });

      const endpoint = new Endpoint({
        route: '/users/:id',
        method: 'GET',
        fn: async ({ params }) => ({
          id: params.id,
          name: 'John Doe',
        }),
        input: {
          params: paramsSchema,
        },
        output: z.object({ id: z.string(), name: z.string() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request(
        '/users/550e8400-e29b-41d4-a716-446655440000',
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'John Doe',
      });
    });

    it('should return 422 for invalid body', async () => {
      const bodySchema = z.object({
        name: z.string().min(3),
        age: z.number().min(18),
      });

      const endpoint = new Endpoint({
        route: '/users',
        method: 'POST',
        fn: async ({ body }) => ({ id: '123', ...body }),
        input: {
          body: bodySchema,
        },
        output: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'Jo', age: 'not a number' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(422);
      const error = await response.json();
      expect(error).toMatchSnapshot();
    });

    it('should return 422 for invalid query parameters', async () => {
      const querySchema = z.object({
        page: z.string().regex(/^\d+$/).transform(Number),
      });

      const endpoint = new Endpoint({
        route: '/users',
        method: 'GET',
        fn: async ({ query }) => ({ page: query.page }),
        input: {
          query: querySchema,
        },
        output: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/users?page=abc');
      expect(response.status).toBe(422);
      const error = await response.json();
      expect(error).toMatchSnapshot();
    });

    it('should return 422 for invalid path parameters', async () => {
      const paramsSchema = z.object({
        id: z.string().uuid(),
      });

      const endpoint = new Endpoint({
        route: '/users/:id',
        method: 'GET',
        fn: async ({ params }) => ({ id: params.id }),
        input: {
          params: paramsSchema,
        },
        output: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/users/not-a-uuid');

      expect(response.status).toBe(422);
      const error = await response.json();

      expect(error).toMatchSnapshot();
    });

    it('should handle PUT method', async () => {
      const bodySchema = z.object({
        name: z.string(),
      });
      const paramsSchema = z.object({
        id: z.string(),
      });

      const endpoint = new Endpoint({
        route: '/users/:id',
        method: 'PUT',
        fn: async ({ params, body }) => ({ id: params.id, ...body }),
        input: {
          body: bodySchema,
          params: paramsSchema,
        },
        output: z.object({ id: z.string(), name: z.string() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/users/123', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Updated Name' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: '123',
        name: 'Updated Name',
      });
    });

    it('should handle DELETE method', async () => {
      const paramsSchema = z.object({
        id: z.string(),
      });

      const endpoint = new Endpoint({
        route: '/users/:id',
        method: 'DELETE',
        fn: async ({ params }) => ({ deleted: true, id: params.id }),
        input: {
          params: paramsSchema,
        },
        output: z.object({ deleted: z.boolean(), id: z.string() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/users/123', {
        method: 'DELETE',
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        deleted: true,
        id: '123',
      });
    });

    it('should handle PATCH method', async () => {
      const bodySchema = z.object({
        name: z.string().optional(),
        email: z.string().email().optional(),
      });
      const paramsSchema = z.object({
        id: z.string(),
      });

      const endpoint = new Endpoint({
        route: '/users/:id',
        method: 'PATCH',
        fn: async ({ params, body }) => ({
          id: params.id,
          updated: true,
          ...body,
        }),
        input: {
          body: bodySchema,
          params: paramsSchema,
        },
        output: z.object({
          id: z.string(),
          updated: z.boolean(),
          name: z.string().optional(),
          email: z.string().optional(),
        }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/users/123', {
        method: 'PATCH',
        body: JSON.stringify({ email: 'new@example.com' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: '123',
        updated: true,
        email: 'new@example.com',
      });
    });

    it('should pass headers to endpoint handler', async () => {
      const endpoint = new Endpoint({
        route: '/auth/check',
        method: 'GET',
        fn: async ({ header }) => ({
          authorized: header('authorization') === 'Bearer valid-token',
        }),
        input: undefined,
        output: z.object({ authorized: z.boolean() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/auth/check', {
        headers: { Authorization: 'Bearer valid-token' },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ authorized: true });
    });

    it('should provide services to endpoint handler', async () => {
      const service = {
        getMessage: () => 'Hello from service',
      };
      const TestService = {
        serviceName: 'test' as const,

        async register() {
          return service;
        },
      };

      await serviceDiscovery.register([TestService]);

      const endpoint = new Endpoint({
        route: '/service-test',
        method: 'GET',
        fn: async ({
          services,
        }: EndpointContext<{}, [typeof TestService], Logger>) => {
          return {
            message: await services.test.getMessage(),
          };
        },
        input: undefined,
        output: z.object({ message: z.string() }),
        services: [TestService],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
        publisherService: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/service-test');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        message: 'Hello from service',
      });
    });

    it('should provide logger to endpoint handler', async () => {
      let loggedMessage: string | undefined;

      const customLogger: Logger = {
        ...mockLogger,
        info: vi.fn((obj: any, msg?: string) => {
          loggedMessage = msg || obj.message;
        }),
      };

      const endpoint = new Endpoint({
        route: '/log-test',
        method: 'GET',
        fn: async ({ logger }) => {
          logger.info({ action: 'test' }, 'Test log message');
          return { logged: true };
        },
        input: undefined,
        output: z.object({ logged: z.boolean() }),
        services: [],
        logger: customLogger as Logger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
        publisherService: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/log-test');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ logged: true });
    });

    it('should handle endpoints with all input types combined', async () => {
      const bodySchema = z.object({
        content: z.string(),
      });
      const querySchema = z.object({
        format: z.enum(['json', 'xml']),
      });
      const paramsSchema = z.object({
        userId: z.string(),
        postId: z.string(),
      });

      const endpoint = new Endpoint({
        route: '/users/:userId/posts/:postId',
        method: 'PUT',
        fn: async ({ params, query, body, ...rest }) => {
          return {
            userId: params.userId,
            postId: params.postId,
            format: query.format,
            content: body.content,
            updated: true,
          };
        },
        input: {
          body: bodySchema,
          query: querySchema,
          params: paramsSchema,
        },
        output: z.object({
          userId: z.string(),
          postId: z.string(),
          format: z.enum(['json', 'xml']),
          content: z.string(),
          updated: z.boolean(),
        }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        publisherService: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request(
        '/users/user123/posts/post456?format=json',
        {
          method: 'PUT',
          body: JSON.stringify({ content: 'Updated content' }),
          headers: { 'Content-Type': 'application/json' },
        },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        userId: 'user123',
        postId: 'post456',
        format: 'json',
        content: 'Updated content',
        updated: true,
      });
    });
  });

  describe('query parameter handling', () => {
    it('should handle array query parameters', async () => {
      const querySchema = z.object({
        tags: z.array(z.string()),
        limit: z.coerce.number().default(10),
      });
      const outputSchema = z.object({
        tags: z.array(z.string()),
        limit: z.number(),
      });

      const endpoint = new Endpoint({
        route: '/search',
        method: 'GET',
        fn: async ({ query }) => ({
          tags: query.tags,
          limit: query.limit,
        }),
        input: {
          query: querySchema,
        },
        output: outputSchema,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        authorize: undefined,
        status: 200,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request(
        '/search?tags=nodejs&tags=typescript&tags=javascript&limit=20',
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        tags: ['nodejs', 'typescript', 'javascript'],
        limit: 20,
      });
    });

    it('should handle object query parameters with dot notation', async () => {
      const querySchema = z.object({
        filter: z.object({
          category: z.string(),
          active: z.coerce.boolean(),
          minPrice: z.coerce.number(),
        }),
        sort: z.string().default('name'),
      });
      const outputSchema = z.object({
        filter: z.object({
          category: z.string(),
          active: z.boolean(),
          minPrice: z.number(),
        }),
        sort: z.string(),
      });

      const endpoint = new Endpoint({
        route: '/products',
        method: 'GET',
        fn: async ({ query }) => ({
          filter: query.filter,
          sort: query.sort,
        }),
        input: {
          query: querySchema,
        },
        output: outputSchema,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        authorize: undefined,
        status: 200,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request(
        '/products?filter.category=electronics&filter.active=true&filter.minPrice=100&sort=price',
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        filter: {
          category: 'electronics',
          active: true,
          minPrice: 100,
        },
        sort: 'price',
      });
    });
  });

  describe('validate', () => {
    it('should return undefined when no schema is provided', async () => {
      const mockContext: any = {
        json: vi.fn(),
      };

      const result = await HonoEndpoint.validate(
        mockContext,
        { any: 'data' },
        undefined,
      );

      expect(result).toBeUndefined();
      expect(mockContext.json).not.toHaveBeenCalled();
    });

    it('should validate data against schema and return parsed value', async () => {
      const mockContext: any = {
        json: vi.fn(),
      };

      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const result = await HonoEndpoint.validate(
        mockContext,
        { name: 'John', age: 30 },
        schema,
      );

      expect(result).toEqual({ name: 'John', age: 30 });
      expect(mockContext.json).not.toHaveBeenCalled();
    });
  });

  describe('authorization', () => {
    it('should allow requests when authorize returns true', async () => {
      const endpoint = new Endpoint({
        route: '/protected',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: undefined,
        output: z.object({ success: z.boolean() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      // Set authorize function that returns true
      endpoint.authorize = async () => true;

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/protected');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true });
    });

    it('should return 401 when authorize returns false', async () => {
      const endpoint = new Endpoint({
        route: '/protected',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: undefined,
        output: z.object({ success: z.boolean() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      // Set authorize function that returns false
      endpoint.authorize = async () => false;

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/protected');
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Unauthorized' });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Unauthorized access attempt',
      );
    });

    it('should handle async authorize functions with headers', async () => {
      const endpoint = new Endpoint({
        route: '/protected',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: undefined,
        output: z.object({ success: z.boolean() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      // Set async authorize function that checks bearer token
      endpoint.authorize = async ({ header }) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return header('authorization') === 'Bearer valid-token';
      };

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      // Test with valid token
      const validResponse = await app.request('/protected', {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(validResponse.status).toBe(200);
      expect(await validResponse.json()).toEqual({ success: true });

      // Test with invalid token
      const invalidResponse = await app.request('/protected', {
        headers: { Authorization: 'Bearer invalid-token' },
      });
      expect(invalidResponse.status).toBe(401);
      expect(await invalidResponse.json()).toEqual({ error: 'Unauthorized' });
    });

    it('should authorize with services available', async () => {
      const service = {
        isValidToken: (token: string) => token === 'valid-token',
      };
      const AuthService = {
        serviceName: 'authService' as const,

        async register() {
          return service;
        },
      };

      const endpoint = new Endpoint({
        route: '/protected',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: undefined,
        output: z.object({ success: z.boolean() }),
        services: [AuthService],
        logger: mockLogger,
        authorize: async ({ header, services }) => {
          const token = header('authorization')?.replace('Bearer ', '') || '';
          return services.authService.isValidToken(token);
        },
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      // Test with valid token
      const validResponse = await app.request('/protected', {
        headers: { Authorization: 'Bearer valid-token' },
      });

      expect(validResponse.status).toBe(200);

      // Test with invalid token
      const invalidResponse = await app.request('/protected', {
        headers: { Authorization: 'Bearer invalid-token' },
      });
      expect(invalidResponse.status).toBe(401);
    });

    it('should authorize with session', async () => {
      const endpoint = new Endpoint({
        route: '/protected',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: undefined,
        output: z.object({ success: z.boolean() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: async ({ header }) => {
          const token = header('authorization');
          return token === 'Bearer user-token'
            ? { userId: 'user-123', role: 'user' }
            : null;
        },
        authorize: undefined,
        description: undefined,
      });

      endpoint.authorize = async ({ session }) => {
        return session?.role === 'user' || session?.role === 'admin';
      };

      const adaptor = new HonoEndpoint(endpoint as any);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      // Test with valid user token
      const validResponse = await app.request('/protected', {
        headers: { Authorization: 'Bearer user-token' },
      });
      expect(validResponse.status).toBe(200);

      // Test with no token (no session)
      const noTokenResponse = await app.request('/protected');
      expect(noTokenResponse.status).toBe(401);
    });

    it('should handle authorization errors', async () => {
      const endpoint = new Endpoint({
        route: '/protected',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: undefined,
        output: z.object({ success: z.boolean() }),
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: async () => {
          throw new Error('Authorization service unavailable');
        },
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/protected');
      expect(response.status).toBe(500);
    });
  });

  describe('output validation', () => {
    it('should validate output against schema and return validated response', async () => {
      const outputSchema = z.object({
        id: z.string(),
        name: z.string(),
        age: z.number(),
      });

      const endpoint = new Endpoint({
        route: '/users/validated',
        method: 'GET',
        fn: async () => ({ id: '123', name: 'John', age: 30 }),
        input: undefined,
        output: outputSchema,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: 200,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/users/validated');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: '123',
        name: 'John',
        age: 30,
      });
    });

    it('should return 422 when output validation fails', async () => {
      const outputSchema = z.object({
        id: z.string(),
        name: z.string(),
        age: z.number(),
      });

      const endpoint = new Endpoint({
        route: '/users/invalid-output',
        method: 'GET',
        // @ts-ignore
        fn: async () => ({ id: 123, name: 'John', age: 'not-a-number' }), // Invalid output
        input: undefined,
        output: outputSchema,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: 200,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/users/invalid-output');
      expect(response.status).toBe(422);

      const error = await response.json();
      expect(error).toHaveProperty('statusCode', 422);
      expect(error).toHaveProperty('message', 'Validation failed');
    });

    it('should return empty object when no output schema is defined', async () => {
      const endpoint = new Endpoint({
        route: '/users/no-schema',
        method: 'GET',
        fn: async () => ({ anything: 'goes', here: true, number: 42 }),
        input: undefined,
        output: undefined, // No output schema
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: 200,
        getSession: undefined,
        authorize: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpoint(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/users/no-schema');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
    });
  });
});
