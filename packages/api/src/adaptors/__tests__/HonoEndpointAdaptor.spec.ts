import { EnvironmentParser } from '@geekmidas/envkit';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Endpoint, type EndpointContext } from '../../constructs/Endpoint';
import type { Logger } from '../../logger';
import { HermodService, HermodServiceDiscovery } from '../../services';
import { HonoEndpointAdaptor } from '../HonoEndpointAdaptor';

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
  const serviceDiscovery = HermodServiceDiscovery.getInstance(
    mockLogger,
    envParser,
  );

  describe('addRoute', () => {
    it('should register a GET endpoint', async () => {
      const endpoint = new Endpoint({
        route: '/users',
        method: 'GET',
        fn: async () => ({ users: [] }),
        input: undefined,
        output: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpointAdaptor(endpoint);
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
        output: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpointAdaptor(endpoint);
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
        output: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpointAdaptor(endpoint);
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
        output: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpointAdaptor(endpoint);
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
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpointAdaptor(endpoint);
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
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpointAdaptor(endpoint);
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
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpointAdaptor(endpoint);
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
        output: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpointAdaptor(endpoint);
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
        output: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpointAdaptor(endpoint);
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
        output: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpointAdaptor(endpoint);
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
        output: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpointAdaptor(endpoint);
      const app = new Hono();

      adaptor.addRoute(serviceDiscovery, app);

      const response = await app.request('/auth/check', {
        headers: { Authorization: 'Bearer valid-token' },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ authorized: true });
    });

    it('should provide services to endpoint handler', async () => {
      class TestService extends HermodService {
        static readonly serviceName = 'test' as const;

        async register() {
          return {
            getMessage: () => 'Hello from service',
          };
        }
      }

      const endpoint = new Endpoint({
        route: '/service-test',
        method: 'GET',
        fn: async ({
          services,
        }: EndpointContext<{}, [typeof TestService], Logger>) => ({
          message: services.test.getMessage(),
        }),
        input: undefined,
        output: undefined,
        services: [TestService],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpointAdaptor(endpoint);
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
        output: undefined,
        services: [],
        logger: customLogger as Logger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpointAdaptor(endpoint);
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
        output: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const adaptor = new HonoEndpointAdaptor(endpoint);
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

  describe('validate', () => {
    it('should return undefined when no schema is provided', async () => {
      const mockContext: any = {
        json: vi.fn(),
      };

      const result = await HonoEndpointAdaptor.validate(
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

      const result = await HonoEndpointAdaptor.validate(
        mockContext,
        { name: 'John', age: 30 },
        schema,
      );

      expect(result).toEqual({ name: 'John', age: 30 });
      expect(mockContext.json).not.toHaveBeenCalled();
    });
  });
});
