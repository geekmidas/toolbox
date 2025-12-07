import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { ServiceDiscovery } from '@geekmidas/services';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { Endpoint } from '../Endpoint';

describe('Endpoint', () => {
  describe('toOpenApi3Route', () => {
    it('should generate basic OpenAPI spec for GET endpoint', async () => {
      const endpoint = new Endpoint({
        route: '/users',
        method: 'GET',
        authorize: undefined,
        description: 'Get all users',
        fn: async () => [],
        input: undefined,
        status: undefined,
        getSession: undefined,
        output: undefined,
        services: [],
        logger: {} as any,
        timeout: undefined,
        memorySize: undefined,
      });

      const spec = await endpoint.toOpenApi3Route();

      expect(spec).toEqual({
        '/users': {
          get: {
            description: 'Get all users',
            responses: {
              '200': {
                description: 'Successful response',
              },
            },
          },
        },
      });
    });

    it('should include response schema when output is defined', async () => {
      const outputSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      const endpoint = new Endpoint({
        route: '/users/:id',
        method: 'GET',
        description: 'Get user by ID',
        fn: async () => ({ id: '1', name: 'John' }),
        input: undefined,
        output: outputSchema,
        authorize: undefined,
        services: [],
        status: undefined,
        getSession: undefined,
        logger: {} as any,
        timeout: undefined,
        memorySize: undefined,
      });

      const spec = await endpoint.toOpenApi3Route();
      const doc = spec['/users/{id}'];
      expect(doc.get.responses?.['200']).toHaveProperty('content');
      expect(
        (doc.get.responses?.['200'] as any).content['application/json'].schema,
      ).toMatchObject({
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id', 'name'],
      });
    });

    it('should include request body for POST endpoint', async () => {
      const bodySchema = z.object({
        name: z.string(),
        email: z.string().email(),
      });

      const endpoint = new Endpoint({
        route: '/users',
        method: 'POST',
        authorize: undefined,
        description: 'Create a new user',
        fn: async (ctx) => ({ id: '1', ...(ctx as any).body }),
        input: {
          body: bodySchema,
        },
        output: undefined,
        status: undefined,
        getSession: undefined,
        services: [],
        logger: {} as any,
        timeout: undefined,
        memorySize: undefined,
      });

      const spec = await endpoint.toOpenApi3Route();

      expect(spec['/users']!.post).toHaveProperty('requestBody');
      expect((spec['/users']!.post! as any).requestBody).toMatchObject({
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                email: { type: 'string', format: 'email' },
              },
              required: ['name', 'email'],
            },
          },
        },
      });
    });

    it('should include path parameters at route level', async () => {
      const paramsSchema = z.object({
        id: z.string(),
        subId: z.string().optional(),
      });

      const endpoint = new Endpoint({
        route: '/users/:id/items/:subId',
        method: 'GET',
        status: undefined,
        authorize: undefined,
        getSession: undefined,
        description: 'Get user item',
        fn: async (ctx) => ({
          userId: (ctx as any).params.id,
          itemId: (ctx as any).params.subId,
        }),
        input: {
          params: paramsSchema,
        },
        output: undefined,
        services: [],
        logger: {} as any,
        timeout: undefined,
        memorySize: undefined,
      });

      const spec = await endpoint.toOpenApi3Route();

      const doc = spec['/users/{id}/items/{subId}'];

      // Path parameters should be at route level, not method level
      expect(doc).toHaveProperty('parameters');
      const parameters = doc.parameters;

      expect(parameters).toHaveLength(2);
      expect(parameters).toContainEqual({
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      });
      expect(parameters).toContainEqual({
        name: 'subId',
        in: 'path',
        required: false,
        schema: { type: 'string' },
      });

      // Method should not have path parameters
      expect(doc.get.parameters).toBeUndefined();
    });

    it('should include query parameters', async () => {
      const searchSchema = z.object({
        page: z.number().optional(),
        limit: z.number().optional(),
        sort: z.enum(['asc', 'desc']),
      });

      const endpoint = new Endpoint({
        route: '/users',
        method: 'GET',
        authorize: undefined,
        description: 'List users with pagination',
        fn: async (ctx) => [],
        input: {
          query: searchSchema,
        },
        output: undefined,
        services: [],
        logger: {} as any,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
      });

      const spec = await endpoint.toOpenApi3Route();

      expect(spec['/users']!.get).toHaveProperty('parameters');
      const parameters = (spec['/users']!.get! as any).parameters;

      expect(parameters).toHaveLength(3);
      expect(parameters).toContainEqual({
        name: 'page',
        in: 'query',
        required: false,
        schema: { type: 'number' },
      });
      expect(parameters).toContainEqual({
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'number' },
      });
      expect(parameters).toContainEqual({
        name: 'sort',
        in: 'query',
        required: true,
        schema: { type: 'string', enum: ['asc', 'desc'] },
      });
    });

    it('should handle PUT endpoint with body and params', async () => {
      const bodySchema = z.object({
        name: z.string(),
        email: z.string().email(),
      });
      const paramsSchema = z.object({
        id: z.string(),
      });
      const outputSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
        updatedAt: z.string(),
      });

      const endpoint = new Endpoint({
        route: '/users/:id',
        method: 'PUT',
        description: 'Update user',
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        fn: async (ctx) => ({
          id: (ctx as any).params.id,
          ...(ctx as any).body,
          updatedAt: new Date().toISOString(),
        }),
        input: {
          body: bodySchema,
          params: paramsSchema,
        },
        output: outputSchema,
        services: [],
        logger: {} as any,
        timeout: undefined,
        memorySize: undefined,
      });

      const spec = await endpoint.toOpenApi3Route();
      const doc = spec['/users/{id}'];

      // Check request body
      expect(doc.put).toHaveProperty('requestBody');
      expect(
        (doc.put as any).requestBody.content['application/json'].schema,
      ).toMatchObject({
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
        },
      });

      // Check path parameters at route level
      expect(doc).toHaveProperty('parameters');
      expect(doc.parameters).toHaveLength(1);
      expect(doc.parameters?.[0]).toEqual({
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      });

      // Method should not have path parameters
      expect((doc.put as any).parameters).toBeUndefined();

      // Check response
      expect(
        (doc.put.responses?.['200'] as any).content['application/json'].schema,
      ).toMatchObject({
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          updatedAt: { type: 'string' },
        },
      });
    });

    it('should handle endpoint without any schemas', async () => {
      const endpoint = new Endpoint({
        route: '/health',
        method: 'GET',
        authorize: undefined,
        fn: async () => ({ status: 'ok' }),
        status: undefined,
        getSession: undefined,
        input: undefined,
        output: undefined,
        services: [],
        logger: {} as any,
        timeout: undefined,
        memorySize: undefined,
        description: undefined,
      });

      const spec = await endpoint.toOpenApi3Route();

      expect(spec).toEqual({
        '/health': {
          get: {
            responses: {
              '200': {
                description: 'Successful response',
              },
            },
          },
        },
      });
    });

    it('should not include body for GET endpoint even if provided', async () => {
      const bodySchema = z.object({ invalid: z.string() });

      const endpoint = new Endpoint({
        route: '/users',
        method: 'GET',
        status: undefined,
        getSession: undefined,
        authorize: undefined,
        output: z.object({
          users: z.array(z.object({ id: z.string(), name: z.string() })),
        }),
        fn: async ({}) => ({
          users: [],
        }),
        input: {
          body: bodySchema,
        },
        services: [],
        logger: {} as any,
        timeout: undefined,
        memorySize: undefined,
        description: undefined,
      });

      const spec = await endpoint.toOpenApi3Route();

      expect(spec['/users']!.get).not.toHaveProperty('requestBody');
    });

    it('should correctly separate path and query parameters', async () => {
      const paramsSchema = z.object({
        userId: z.string(),
        itemId: z.string(),
      });
      const querySchema = z.object({
        limit: z.number().optional(),
        offset: z.number().optional(),
        filter: z.string(),
      });

      const endpoint = new Endpoint({
        route: '/users/:userId/items/:itemId',
        method: 'GET',
        description: 'Get user item with pagination',
        fn: async () => ({}),
        input: {
          params: paramsSchema,
          query: querySchema,
        },
        output: undefined,
        services: [],
        logger: {} as any,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        authorize: undefined,
      });

      const spec = await endpoint.toOpenApi3Route();
      const doc = spec['/users/{userId}/items/{itemId}'];

      // Path parameters should be at route level
      expect(doc.parameters).toBeDefined();
      expect(doc.parameters).toHaveLength(2);
      expect(doc.parameters).toContainEqual({
        name: 'userId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      });
      expect(doc.parameters).toContainEqual({
        name: 'itemId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      });

      // Query parameters should be at method level
      expect(doc.get.parameters).toBeDefined();
      expect(doc.get.parameters).toHaveLength(3);
      expect(doc.get.parameters).toContainEqual({
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'number' },
      });
      expect(doc.get.parameters).toContainEqual({
        name: 'offset',
        in: 'query',
        required: false,
        schema: { type: 'number' },
      });
      expect(doc.get.parameters).toContainEqual({
        name: 'filter',
        in: 'query',
        required: true,
        schema: { type: 'string' },
      });
    });
  });

  describe('authorize property', () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(() => mockLogger),
    };

    const services = ServiceDiscovery.getInstance(
      mockLogger,
      new EnvironmentParser({}),
    );

    it('should have default authorize function that returns true', async () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: undefined,
        output: undefined,
        services: [],
        authorize: undefined,
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const result = await endpoint.authorize({
        header: vi.fn(),
        services,
        logger: mockLogger,
        session: {},
        cookie: vi.fn(),
      });

      expect(result).toBe(true);
    });

    it('should allow custom authorize function', async () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: undefined,
        output: undefined,
        services: [],
        logger: mockLogger,
        authorize: undefined,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const customAuthFn = vi.fn().mockResolvedValue(false);
      endpoint.authorize = customAuthFn;

      const mockContext = {
        header: vi.fn(),
        services,
        logger: mockLogger,
        session: {},
        cookie: vi.fn(),
      };

      const result = await endpoint.authorize(mockContext);

      expect(result).toBe(false);
      expect(customAuthFn).toHaveBeenCalledWith(mockContext);
    });

    it('should support synchronous authorize function', () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: undefined,
        output: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        authorize: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const syncAuthFn = vi.fn().mockReturnValue(true);
      endpoint.authorize = syncAuthFn;

      const mockContext = {
        header: vi.fn(),
        services,
        logger: mockLogger,
        session: {},
        cookie: vi.fn(),
      };

      const result = endpoint.authorize(mockContext);

      expect(result).toBe(true);
      expect(syncAuthFn).toHaveBeenCalledWith(mockContext);
    });

    it('should receive header function in context', async () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: undefined,
        output: undefined,
        services: [],
        authorize: undefined,
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const headerFn = vi.fn().mockReturnValue('Bearer token123');

      endpoint.authorize = ({ header }) => {
        return header('authorization') === 'Bearer token123';
      };

      const result = await endpoint.authorize({
        header: headerFn,
        services,
        logger: mockLogger,
        session: {},
        cookie: vi.fn(),
      });

      expect(result).toBe(true);
      expect(headerFn).toHaveBeenCalledWith('authorization');
    });

    it('should receive services in context', async () => {
      const TestService = {
        serviceName: 'TestService' as const,
        register() {
          return {
            validateUser(id: string) {
              return id === 'valid';
            },
          };
        },
      };

      await services.register([TestService]);
      const endpoint = new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: undefined,
        output: undefined,
        services: [TestService],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        authorize: async ({ services }) => {
          return services.TestService.validateUser('valid');
        },
        getSession: undefined,
        description: undefined,
      });

      const result = await endpoint.authorize({
        header: vi.fn(),
        services: { TestService: TestService.register() },
        logger: mockLogger,
        session: {},
        cookie: vi.fn(),
      });

      expect(result).toBe(true);
    });

    it('should receive logger in context', async () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: undefined,
        output: undefined,
        authorize: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      const loggerSpy = vi.fn();
      const testLogger = {
        ...mockLogger,
        info: loggerSpy,
      };

      endpoint.authorize = ({ logger }) => {
        logger.info('Authorization check');
        return true;
      };

      const result = await endpoint.authorize({
        header: vi.fn(),
        services,
        logger: testLogger,
        cookie: vi.fn(),
        session: {},
      });

      expect(result).toBe(true);
      expect(loggerSpy).toHaveBeenCalledWith('Authorization check');
    });

    it('should receive session in context', async () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: undefined,
        output: undefined,
        authorize: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: () => ({ role: 'admin' }),
        description: undefined,
      });

      const mockSession = { userId: 'user123', role: 'admin' };

      endpoint.authorize = ({ session }) => {
        return session.role === 'admin';
      };

      const result = await endpoint.authorize({
        header: vi.fn(),
        services,
        logger: mockLogger,
        session: mockSession,
        cookie: vi.fn(),
      });

      expect(result).toBe(true);
    });

    it('should handle authorize function that throws error', async () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: undefined,
        output: undefined,
        services: [],
        authorize: async () => {
          throw new Error('Authorization failed');
        },

        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      await expect(() =>
        endpoint.authorize({
          header: vi.fn(),
          services,
          logger: mockLogger,
          session: {},
          cookie: vi.fn(),
        }),
      ).rejects.toThrow('Authorization failed');
    });

    it('should handle async authorize function that throws error', async () => {
      const endpoint = new Endpoint({
        route: '/test',
        method: 'GET',
        fn: async () => ({ success: true }),
        input: undefined,
        output: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        authorize: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      endpoint.authorize = async () => {
        throw new Error('Async authorization failed');
      };

      await expect(
        endpoint.authorize({
          header: vi.fn(),
          services,
          logger: mockLogger,
          session: {},
          cookie: vi.fn(),
        }),
      ).rejects.toThrow('Async authorization failed');
    });

    it('should work with complex authorization logic', async () => {
      const endpoint = new Endpoint({
        route: '/admin/users',
        method: 'GET',
        authorize: undefined,
        fn: async () => ({ users: [] }),
        input: undefined,
        output: undefined,
        services: [],
        logger: mockLogger,
        timeout: undefined,
        memorySize: undefined,
        status: undefined,
        getSession: undefined,
        description: undefined,
      });

      endpoint.authorize = async ({ header, session }) => {
        // Simulate complex authorization logic
        const token = header('authorization');
        if (!token) return false;

        const user = session as any;
        if (!user?.role) return false;

        return user.role === 'admin' || user.role === 'superuser';
      };

      // Test with admin role
      const adminResult = await endpoint.authorize({
        header: vi.fn().mockReturnValue('Bearer admin-token'),
        services,
        logger: mockLogger,
        cookie: vi.fn(),
        session: { userId: 'admin1', role: 'admin' },
      });

      expect(adminResult).toBe(true);

      // Test with user role
      const userResult = await endpoint.authorize({
        header: vi.fn().mockReturnValue('Bearer user-token'),
        services,
        cookie: vi.fn(),
        logger: mockLogger,
        session: { userId: 'user1', role: 'user' },
      });

      expect(userResult).toBe(false);

      // Test with no token
      const noTokenResult = await endpoint.authorize({
        header: vi.fn().mockReturnValue(undefined),
        services,
        logger: mockLogger,
        session: { userId: 'user1', role: 'admin' },
        cookie: vi.fn(),
      });

      expect(noTokenResult).toBe(false);
    });
  });
});
