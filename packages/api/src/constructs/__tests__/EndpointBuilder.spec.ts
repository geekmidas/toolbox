import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ConsoleLogger, type Logger } from '../../logger';
import { HermodService } from '../../services';
import { Endpoint } from '../Endpoint';
import { EndpointBuilder } from '../EndpointBuilder';
import { FunctionType } from '../types';

describe('EndpointBuilder', () => {
  describe('constructor', () => {
    it('should create builder with route and method', () => {
      const builder = new EndpointBuilder('/users', 'GET');

      expect(builder.route).toBe('/users');
      expect(builder.method).toBe('GET');
    });

    it('should initialize with FunctionType.Endpoint', () => {
      const builder = new EndpointBuilder('/users', 'POST');

      // Access protected member through inheritance
      expect((builder as any).type).toBe(FunctionType.Endpoint);
    });
  });

  describe('description', () => {
    it('should set endpoint description', () => {
      const builder = new EndpointBuilder('/users', 'GET');
      const result = builder.description('Get all users');

      expect(result).toBe(builder); // Should return this for chaining
      expect((builder as any)._description).toBe('Get all users');
    });

    it('should pass description to endpoint', () => {
      const endpoint = new EndpointBuilder('/users', 'GET')
        .description('Get all users')
        .handle(async () => []);

      expect(endpoint.description).toBe('Get all users');
    });
  });

  describe('status', () => {
    it('should set success status code', () => {
      const builder = new EndpointBuilder('/users', 'POST');
      const result = builder.status(201);

      expect(result).toBe(builder); // Should return this for chaining
      expect((builder as any)._status).toBe(201);
    });

    it('should pass status to endpoint', () => {
      const endpoint = new EndpointBuilder('/users', 'POST')
        .status(201)
        .handle(async () => ({ id: '123' }));

      expect(endpoint.status).toBe(201);
    });

    it('should accept different success status codes', () => {
      const statuses = [200, 201, 202, 204] as const;

      statuses.forEach((status) => {
        const endpoint = new EndpointBuilder('/test', 'POST')
          .status(status)
          .handle(async () => ({}));

        expect(endpoint.status).toBe(status);
      });
    });
  });

  describe('services', () => {
    class TestService extends HermodService {
      static serviceName = 'TestService' as const;
      async register() {
        return { getData: () => 'test data' };
      }
    }

    class AnotherService extends HermodService {
      static serviceName = 'AnotherService' as const;
      async register() {
        return { process: (input: string) => input.toUpperCase() };
      }
    }

    it('should add services to builder', () => {
      const builder = new EndpointBuilder('/users', 'GET').services([
        TestService,
        AnotherService,
      ]);

      expect((builder as any)._services).toEqual([TestService, AnotherService]);
    });

    it('should allow chaining multiple service calls', () => {
      const builder = new EndpointBuilder('/users', 'GET')
        .services([TestService])
        .services([AnotherService]);

      expect((builder as any)._services).toEqual([
        TestService,
        AnotherService,
      ]);
    });

    it('should pass services to endpoint', () => {
      const endpoint = new EndpointBuilder('/users', 'GET')
        .services([TestService, AnotherService])
        .handle(async ({ services }) => ({
          test: services.TestService.getData(),
          another: services.AnotherService.process('hello'),
        }));

      expect(endpoint.services).toEqual([TestService, AnotherService]);
    });

    it('should maintain type safety with services', () => {
      const builder = new EndpointBuilder('/test', 'POST').services([
        TestService,
      ]);

      // This should compile and provide type-safe access
      const endpoint = builder.handle(async ({ services }) => ({
        result: services.TestService.getData(),
      }));

      expect(endpoint.services).toEqual([TestService]);
    });
  });

  describe('output', () => {
    it('should set output schema', () => {
      const schema = z.object({ id: z.string(), name: z.string() });
      const builder = new EndpointBuilder('/users', 'GET').output(schema);

      expect((builder as any).outputSchema).toBe(schema);
    });

    it('should pass output schema to endpoint', () => {
      const schema = z.object({ success: z.boolean() });
      const endpoint = new EndpointBuilder('/test', 'POST')
        .output(schema)
        .handle(async () => ({ success: true }));

      expect(endpoint.outputSchema).toBe(schema);
    });

    it('should work with different schema libraries', () => {
      // Mock a different schema library
      const customSchema = {
        '~standard': {
          vendor: 'custom',
          version: 1,
        },
        '~vendor': {
          validate: vi.fn(),
        },
      };

      const endpoint = new EndpointBuilder('/test', 'GET')
        .output(customSchema as any)
        .handle(async () => ({}));

      expect(endpoint.outputSchema).toBe(customSchema);
    });
  });

  describe('body', () => {
    it('should set body schema', () => {
      const schema = z.object({ username: z.string(), password: z.string() });
      const builder = new EndpointBuilder('/login', 'POST').body(schema);

      expect((builder as any).schemas.body).toBe(schema);
    });

    it('should pass body schema to endpoint', () => {
      const schema = z.object({ data: z.string() });
      const endpoint = new EndpointBuilder('/test', 'POST')
        .body(schema)
        .handle(async ({ body }) => ({ received: body.data }));

      expect(endpoint.input?.body).toBe(schema);
    });

    it('should allow chaining with other methods', () => {
      const bodySchema = z.object({ name: z.string() });
      const outputSchema = z.object({ id: z.string() });

      const endpoint = new EndpointBuilder('/users', 'POST')
        .body(bodySchema)
        .output(outputSchema)
        .status(201)
        .handle(async () => ({ id: '123' }));

      expect(endpoint.input?.body).toBe(bodySchema);
      expect(endpoint.outputSchema).toBe(outputSchema);
      expect(endpoint.status).toBe(201);
    });
  });

  describe('search/query', () => {
    it('should set query schema using search method', () => {
      const schema = z.object({ page: z.number(), limit: z.number() });
      const builder = new EndpointBuilder('/users', 'GET').search(schema);

      expect((builder as any).schemas.query).toBe(schema);
    });

    it('should set query schema using query method', () => {
      const schema = z.object({ filter: z.string() });
      const builder = new EndpointBuilder('/users', 'GET').query(schema);

      expect((builder as any).schemas.query).toBe(schema);
    });

    it('query should call search internally', () => {
      const schema = z.object({ sort: z.string() });
      const searchSpy = vi.spyOn(EndpointBuilder.prototype, 'search');

      new EndpointBuilder('/users', 'GET').query(schema);

      expect(searchSpy).toHaveBeenCalledWith(schema);
      searchSpy.mockRestore();
    });

    it('should pass query schema to endpoint', () => {
      const schema = z.object({ search: z.string().optional() });
      const endpoint = new EndpointBuilder('/search', 'GET')
        .query(schema)
        .handle(async ({ query }) => ({
          results: query.search ? ['result1'] : [],
        }));

      expect(endpoint.input?.query).toBe(schema);
    });
  });

  describe('params', () => {
    it('should set params schema', () => {
      const schema = z.object({ id: z.string(), subId: z.string() });
      const builder = new EndpointBuilder(
        '/users/:id/items/:subId',
        'GET',
      ).params(schema);

      expect((builder as any).schemas.params).toBe(schema);
    });

    it('should pass params schema to endpoint', () => {
      const schema = z.object({ userId: z.string() });
      const endpoint = new EndpointBuilder('/users/:userId', 'GET')
        .params(schema)
        .handle(async ({ params }) => ({ userId: params.userId }));

      expect(endpoint.input?.params).toBe(schema);
    });

    it('should work with complex route patterns', () => {
      const schema = z.object({
        orgId: z.string(),
        projectId: z.string(),
        taskId: z.string(),
      });

      const endpoint = new EndpointBuilder(
        '/orgs/:orgId/projects/:projectId/tasks/:taskId',
        'PUT',
      )
        .params(schema)
        .handle(async ({ params }) => ({ ...params }));

      expect(endpoint.input?.params).toBe(schema);
    });
  });

  describe('handle', () => {
    it('should create an Endpoint instance', () => {
      const endpoint = new EndpointBuilder('/test', 'GET').handle(
        async () => ({}),
      );

      expect(endpoint).toBeInstanceOf(Endpoint);
    });

    it('should pass all configurations to endpoint', () => {
      const bodySchema = z.object({ data: z.string() });
      const querySchema = z.object({ filter: z.string() });
      const paramsSchema = z.object({ id: z.string() });
      const outputSchema = z.object({ result: z.string() });

      class Service extends HermodService {
        static serviceName = 'Service' as const;
        async register() {
          return {};
        }
      }

      const logger: Logger = new ConsoleLogger();
      const authFn = async () => true;
      const sessionFn = async () => ({ userId: '123' });
      const handler = async () => ({ result: 'success' });

      const builder = new EndpointBuilder('/items/:id', 'POST');

      // Set all properties
      builder
        .body(bodySchema)
        .query(querySchema)
        .params(paramsSchema)
        .output(outputSchema)
        .services([Service])
        .status(201)
        .description('Test endpoint');

      // Set protected properties
      (builder as any)._logger = logger;
      (builder as any)._authorize = authFn;
      (builder as any)._getSession = sessionFn;
      (builder as any)._timeout = 5000;

      const endpoint = builder.handle(handler);

      // Verify all properties are passed correctly
      expect(endpoint.route).toBe('/items/:id');
      expect(endpoint.method).toBe('POST');
      expect(endpoint.description).toBe('Test endpoint');
      expect(endpoint.input?.body).toBe(bodySchema);
      expect(endpoint.input?.query).toBe(querySchema);
      expect(endpoint.input?.params).toBe(paramsSchema);
      expect(endpoint.outputSchema).toBe(outputSchema);
      expect(endpoint.services).toEqual([Service]);
      expect(endpoint.logger).toBe(logger);
      expect(endpoint.status).toBe(201);
      expect(endpoint.authorize).toBe(authFn);
      expect(endpoint.getSession).toBe(sessionFn);
      expect(endpoint.timeout).toBe(5000);
    });

    it('should handle async handlers', async () => {
      const endpoint = new EndpointBuilder('/async', 'GET').handle(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { delayed: true };
        },
      );

      expect(endpoint).toBeInstanceOf(Endpoint);
    });

    it('should maintain type safety through the chain', () => {
      const endpoint = new EndpointBuilder('/typed', 'POST')
        .body(z.object({ input: z.number() }))
        .output(z.object({ doubled: z.number() }))
        .handle(async ({ body }) => ({
          doubled: body.input * 2,
        }));

      expect(endpoint.route).toBe('/typed');
      expect(endpoint.method).toBe('POST');
    });
  });

  describe('inherited authorization and session', () => {
    it('should have default authorization that returns true', () => {
      const builder = new EndpointBuilder('/test', 'GET');
      const defaultAuth = (builder as any)._authorize;

      expect(defaultAuth()).toBe(true);
    });

    it('should have default session that returns empty object', () => {
      const builder = new EndpointBuilder('/test', 'GET');
      const defaultSession = (builder as any)._getSession;

      expect(defaultSession()).toEqual({});
    });

    it('should allow setting custom authorization', () => {
      const customAuth = async () => false;
      const builder = new EndpointBuilder('/test', 'GET');
      (builder as any)._authorize = customAuth;

      const endpoint = builder.handle(async () => ({}));
      expect(endpoint.authorize).toBe(customAuth);
    });

    it('should allow setting custom session extractor', () => {
      const customSession = async () => ({ userId: '123', role: 'admin' });
      const builder = new EndpointBuilder('/test', 'GET');
      (builder as any)._getSession = customSession;

      const endpoint = builder.handle(async () => ({}));
      expect(endpoint.getSession).toBe(customSession);
    });
  });

  describe('method chaining', () => {
    it('should support fluent interface pattern', () => {
      const endpoint = new EndpointBuilder('/users', 'POST')
        .description('Create a new user')
        .status(201)
        .body(z.object({ name: z.string(), email: z.string().email() }))
        .output(z.object({ id: z.string(), created: z.boolean() }))
        .handle(async () => ({
          id: '123',
          created: true,
        }));

      expect(endpoint.description).toBe('Create a new user');
      expect(endpoint.status).toBe(201);
      expect(endpoint.input?.body).toBeDefined();
      expect(endpoint.outputSchema).toBeDefined();
    });

    it('should maintain builder type through chains', () => {
      const builder1 = new EndpointBuilder('/test', 'GET');
      const builder2 = builder1.description('Test');
      const builder3 = builder2.status(200);

      expect(builder1).toBe(builder2);
      expect(builder2).toBe(builder3);
    });
  });

  describe('edge cases', () => {
    it('should handle empty route', () => {
      const endpoint = new EndpointBuilder('', 'GET').handle(async () => ({}));
      expect(endpoint.route).toBe('');
    });

    it('should handle root route', () => {
      const endpoint = new EndpointBuilder('/', 'GET').handle(async () => ({}));
      expect(endpoint.route).toBe('/');
    });

    it('should handle routes with special characters', () => {
      const endpoint = new EndpointBuilder(
        '/users/:id/items/:item-id',
        'GET',
      ).handle(async () => ({}));
      expect(endpoint.route).toBe('/users/:id/items/:item-id');
    });

    it('should handle all HTTP methods', () => {
      const methods = [
        'GET',
        'POST',
        'PUT',
        'DELETE',
        'PATCH',
        'OPTIONS',
      ] as const;

      methods.forEach((method) => {
        const endpoint = new EndpointBuilder('/test', method).handle(
          async () => ({}),
        );
        expect(endpoint.method).toBe(method);
      });
    });

    it('should handle undefined schemas', () => {
      const endpoint = new EndpointBuilder('/test', 'GET').handle(
        async () => ({}),
      );

      expect(endpoint.input || {}).toEqual({});
      expect(endpoint.outputSchema).toBeUndefined();
    });

    it('should handle complex nested schemas', () => {
      const complexSchema = z.object({
        user: z.object({
          profile: z.object({
            name: z.string(),
            settings: z.array(
              z.object({
                key: z.string(),
                value: z.unknown(),
              }),
            ),
          }),
        }),
      });

      const endpoint = new EndpointBuilder('/complex', 'POST')
        .body(complexSchema)
        .handle(async ({ body }) => ({ received: body }));

      expect(endpoint.input?.body).toBe(complexSchema);
    });
  });
});