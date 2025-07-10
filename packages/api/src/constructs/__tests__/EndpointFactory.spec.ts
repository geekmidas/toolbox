import { describe, expect, it } from 'vitest';
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
});
