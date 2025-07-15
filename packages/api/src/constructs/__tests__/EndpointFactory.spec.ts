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
});
