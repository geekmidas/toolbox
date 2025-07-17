import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ConsoleLogger, type Logger } from '../../logger';
import { HermodService } from '../../services';
import { EndpointFactory } from '../EndpointFactory';

describe('EndpointFactory', () => {
  describe('joinPaths', () => {
    it('should join simple paths', () => {
      expect(EndpointFactory.joinPaths('/users', '/api')).toBe('/api/users');
      expect(EndpointFactory.joinPaths('users', '/api')).toBe('/api/users');
      expect(EndpointFactory.joinPaths('/users', 'api')).toBe('/api/users');
      expect(EndpointFactory.joinPaths('users', 'api')).toBe('/api/users');
    });

    it('should handle empty base path', () => {
      expect(EndpointFactory.joinPaths('/users', '')).toBe('/users');
      expect(EndpointFactory.joinPaths('users', '')).toBe('/users');
    });

    it('should handle empty segment path', () => {
      expect(EndpointFactory.joinPaths('', '/api')).toBe('/api');
      expect(EndpointFactory.joinPaths('', 'api')).toBe('/api');
    });

    it('should handle both paths empty', () => {
      expect(EndpointFactory.joinPaths('', '')).toBe('/');
    });

    it('should handle trailing slashes in base path', () => {
      expect(EndpointFactory.joinPaths('/users', '/api/')).toBe('/api/users');
      expect(EndpointFactory.joinPaths('users', '/api/')).toBe('/api/users');
      expect(EndpointFactory.joinPaths('/users', 'api/')).toBe('/api/users');
      expect(EndpointFactory.joinPaths('users', 'api/')).toBe('/api/users');
    });

    it('should handle root paths', () => {
      expect(EndpointFactory.joinPaths('/users', '/')).toBe('/users');
      expect(EndpointFactory.joinPaths('users', '/')).toBe('/users');
      expect(EndpointFactory.joinPaths('/', '/')).toBe('/');
    });

    it('should handle multiple slashes', () => {
      expect(EndpointFactory.joinPaths('//users', '/api')).toBe('/api//users');
      expect(EndpointFactory.joinPaths('/users', '//api')).toBe('/api/users');
    });

    it('should handle complex paths', () => {
      expect(EndpointFactory.joinPaths('/users/:id', '/api/v1')).toBe(
        '/api/v1/users/:id',
      );
      expect(
        EndpointFactory.joinPaths(
          '/posts/:postId/comments/:commentId',
          '/blog',
        ),
      ).toBe('/blog/posts/:postId/comments/:commentId');
    });

    it('should handle paths with query parameters notation', () => {
      expect(EndpointFactory.joinPaths('/users?page=1', '/api')).toBe(
        '/api/users?page=1',
      );
      expect(EndpointFactory.joinPaths('/search', '/api')).toBe('/api/search');
    });

    it('should handle nested segments', () => {
      expect(EndpointFactory.joinPaths('/admin/users', '/api')).toBe(
        '/api/admin/users',
      );
      expect(EndpointFactory.joinPaths('/v2/resources/items', '/api/v1')).toBe(
        '/api/v1/v2/resources/items',
      );
    });

    it('should not add extra slashes when paths already have them', () => {
      expect(EndpointFactory.joinPaths('/users', '/api')).toBe('/api/users');
      expect(EndpointFactory.joinPaths('/', '/api')).toBe('/api');
    });

    it('should preserve path parameters', () => {
      expect(EndpointFactory.joinPaths('/:id', '/users')).toBe('/users/:id');
      expect(
        EndpointFactory.joinPaths('/:userId/posts/:postId', '/api/users'),
      ).toBe('/api/users/:userId/posts/:postId');
    });

    it('should work with undefined base path (default parameter)', () => {
      expect(EndpointFactory.joinPaths('/users')).toBe('/users');
      expect(EndpointFactory.joinPaths('users')).toBe('/users');
      expect(EndpointFactory.joinPaths('')).toBe('/');
    });
  });

  describe('authorize', () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(() => mockLogger),
    };

    it('should create a factory with authorization function', () => {
      const factory = new EndpointFactory();
      const authFn = async () => true;

      const authorizedFactory = factory.authorize(authFn);

      expect(authorizedFactory).toBeInstanceOf(EndpointFactory);
      expect(authorizedFactory).not.toBe(factory);
    });

    it('should apply authorization to created endpoints', async () => {
      const authFn = vi.fn().mockResolvedValue(true);
      const factory = new EndpointFactory()
        .services([])
        .logger(mockLogger)
        .authorize(authFn);

      const endpoint = factory
        .get('/test')
        .handle(async () => ({ success: true }));

      expect(endpoint.authorize).toBe(authFn);
    });

    it('should handle authorization with different service types', async () => {
      class AuthService extends HermodService {
        static serviceName = 'AuthService' as const;

        async register() {
          return { validateToken: (token: string) => token === 'valid' };
        }
      }

      const authFn = async ({ header, services }: any) => {
        const token = header('authorization')?.replace('Bearer ', '');
        return services.AuthService.validateToken(token);
      };

      const factory = new EndpointFactory()
        .services([AuthService])
        .logger(mockLogger)
        .authorize(authFn);

      const endpoint = factory
        .post('/protected')
        .body(z.object({ data: z.string() }))
        .handle(async () => ({ success: true }));

      expect(endpoint.authorize).toBe(authFn);
    });

    it('should chain with other factory methods', () => {
      const authFn = async () => true;
      const sessionFn = async () => ({ userId: 'user1' });

      const factory = new EndpointFactory()
        .route('/api')
        .services([])
        .logger(mockLogger)
        .authorize(authFn)
        .session(sessionFn);

      const endpoint = factory
        .get('/test')
        .handle(async () => ({ success: true }));

      expect(endpoint.authorize).toBe(authFn);
      expect(endpoint.getSession).toBe(sessionFn);
    });

    it('should preserve authorization in factory chains', () => {
      const authFn = async () => true;
      const newLogger = new ConsoleLogger();

      const factory = new EndpointFactory()
        .services([])
        .authorize(authFn)
        .logger(newLogger); // Chain after authorize

      const endpoint = factory
        .get('/test')
        .handle(async () => ({ success: true }));

      expect(endpoint.authorize).toBe(authFn);
      expect(endpoint.logger).toBe(newLogger);
    });

    it('should handle authorization function returning boolean', async () => {
      const authFn = ({ header }: any) => {
        return header('authorization') === 'Bearer valid-token';
      };

      const factory = new EndpointFactory()
        .services([])
        .logger(mockLogger)
        .authorize(authFn);

      const endpoint = factory
        .get('/test')
        .handle(async () => ({ success: true }));

      expect(endpoint.authorize).toBe(authFn);
    });

    it('should handle authorization function returning Promise<boolean>', async () => {
      const authFn = async ({ header }: any) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return header('authorization') === 'Bearer valid-token';
      };

      const factory = new EndpointFactory()
        .services([])
        .logger(mockLogger)
        .authorize(authFn);

      const endpoint = factory
        .get('/test')
        .handle(async () => ({ success: true }));

      expect(endpoint.authorize).toBe(authFn);
    });
  });

  describe('route', () => {
    it('should create a sub-factory with path prefix', () => {
      const factory = new EndpointFactory();
      const apiFactory = factory.route('/api');
      const v1Factory = apiFactory.route('/v1');

      const endpoint = v1Factory.get('/users').handle(async () => []);

      expect(endpoint.route).toBe('/api/v1/users');
    });

    it('should preserve services, auth, and logger in sub-routes', () => {
      const authFn = async () => true;
      const sessionFn = async () => ({ userId: 'user1' });
      
      class TestService extends HermodService {
        static serviceName = 'TestService' as const;
        async register() {
          return {};
        }
      }

      const factory = new EndpointFactory()
        .services([TestService])
        .authorize(authFn)
        .session(sessionFn)
        .route('/api');

      const endpoint = factory.get('/test').handle(async () => ({}));

      expect(endpoint.route).toBe('/api/test');
      expect(endpoint.authorize).toBe(authFn);
      expect(endpoint.getSession).toBe(sessionFn);
    });
  });

  describe('services', () => {
    class Service1 extends HermodService {
      static serviceName = 'Service1' as const;
      async register() {
        return { method1: () => 'service1' };
      }
    }

    class Service2 extends HermodService {
      static serviceName = 'Service2' as const;
      async register() {
        return { method2: () => 'service2' };
      }
    }

    it('should add services to factory', () => {
      const factory = new EndpointFactory().services([Service1, Service2]);
      const endpoint = factory.get('/test').handle(async ({ services }) => ({
        result1: services.Service1.method1(),
        result2: services.Service2.method2(),
      }));

      expect(endpoint.services).toEqual([Service1, Service2]);
    });

    it('should handle duplicate services', () => {
      const factory = new EndpointFactory()
        .services([Service1])
        .services([Service1, Service2]);

      const endpoint = factory.get('/test').handle(async () => ({}));

      // Should contain unique services
      const serviceNames = endpoint.services.map((s) => s.serviceName);
      expect(serviceNames).toContain('Service1');
      expect(serviceNames).toContain('Service2');
    });

    it('should merge services in options', () => {
      const factory = new EndpointFactory({
        defaultServices: [Service1],
      }).services([Service2]);

      const endpoint = factory.get('/test').handle(async () => ({}));

      expect(endpoint.services).toEqual([Service2, Service1]);
    });
  });

  describe('logger', () => {
    it('should set custom logger', () => {
      const customLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(),
      };

      const factory = new EndpointFactory().logger(customLogger);
      const endpoint = factory.get('/test').handle(async () => ({}));

      expect(endpoint.logger).toBe(customLogger);
    });

    it('should use default logger when not specified', () => {
      const factory = new EndpointFactory();
      const endpoint = factory.get('/test').handle(async () => ({}));

      expect(endpoint.logger).toBeDefined();
      expect(endpoint.logger).toBeInstanceOf(ConsoleLogger);
    });
  });

  describe('session', () => {
    it('should set session extractor', () => {
      const sessionFn = async () => ({ userId: '123', role: 'admin' });
      const factory = new EndpointFactory().session(sessionFn);

      const endpoint = factory.get('/test').handle(async ({ session }) => ({
        session,
      }));

      expect(endpoint.getSession).toBe(sessionFn);
    });

    it('should handle session with services', () => {
      class SessionService extends HermodService {
        static serviceName = 'SessionService' as const;
        async register() {
          return {
            getSession: (token: string) => ({ userId: token }),
          };
        }
      }

      const sessionFn = async ({ header, services }: any) => {
        const token = header('authorization');
        return services.SessionService.getSession(token);
      };

      const factory = new EndpointFactory()
        .services([SessionService])
        .session(sessionFn);

      const endpoint = factory.get('/test').handle(async () => ({}));

      expect(endpoint.getSession).toBe(sessionFn);
    });
  });

  describe('HTTP method builders', () => {
    const testMethods = [
      { method: 'get', httpMethod: 'GET' },
      { method: 'post', httpMethod: 'POST' },
      { method: 'put', httpMethod: 'PUT' },
      { method: 'delete', httpMethod: 'DELETE' },
      { method: 'patch', httpMethod: 'PATCH' },
      { method: 'options', httpMethod: 'OPTIONS' },
    ] as const;

    testMethods.forEach(({ method, httpMethod }) => {
      it(`should create ${httpMethod} endpoint`, () => {
        const factory = new EndpointFactory();
        const builder = (factory as any)[method]('/test');
        const endpoint = builder.handle(async () => ({}));

        expect(endpoint.method).toBe(httpMethod);
        expect(endpoint.route).toBe('/test');
      });
    });

    it('should apply basePath to all HTTP methods', () => {
      const factory = new EndpointFactory().route('/api/v1');

      testMethods.forEach(({ method, httpMethod }) => {
        const builder = (factory as any)[method]('/test');
        const endpoint = builder.handle(async () => ({}));

        expect(endpoint.method).toBe(httpMethod);
        expect(endpoint.route).toBe('/api/v1/test');
      });
    });
  });

  describe('constructor options', () => {
    it('should initialize with all options', () => {
      const authFn = async () => true;
      const sessionFn = async () => ({ userId: '123' });
      const logger: Logger = new ConsoleLogger();

      class TestService extends HermodService {
        static serviceName = 'TestService' as const;
        async register() {
          return {};
        }
      }

      const factory = new EndpointFactory({
        basePath: '/api',
        defaultServices: [TestService],
        defaultAuthorizeFn: authFn,
        defaultLogger: logger,
        defaultSessionExtractor: sessionFn,
      });

      const endpoint = factory.get('/test').handle(async () => ({}));

      expect(endpoint.route).toBe('/api/test');
      expect(endpoint.authorize).toBe(authFn);
      expect(endpoint.getSession).toBe(sessionFn);
      expect(endpoint.logger).toBe(logger);
      expect(endpoint.services).toEqual([TestService]);
    });

    it('should handle empty options', () => {
      const factory = new EndpointFactory({});
      const endpoint = factory.get('/test').handle(async () => ({}));

      expect(endpoint.route).toBe('/test');
      expect(endpoint.services).toEqual([]);
    });
  });

  describe('type safety', () => {
    it('should maintain type information through chains', () => {
      class TypedService extends HermodService {
        static serviceName = 'TypedService' as const;
        async register() {
          return { getData: () => ({ value: 42 }) };
        }
      }

      const factory = new EndpointFactory()
        .services([TypedService])
        .session(async () => ({ userId: '123' }));

      const endpoint = factory
        .post('/data')
        .body(z.object({ input: z.number() }))
        .output(z.object({ result: z.number() }))
        .handle(async ({ body, services }) => ({
          result: body.input + services.TypedService.getData().value,
        }));

      // Type assertions to ensure type safety
      expect(endpoint.route).toBe('/data');
      expect(endpoint.method).toBe('POST');
    });
  });
});
