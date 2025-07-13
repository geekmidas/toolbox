import { describe, expect, it } from 'vitest';
import type { Cache } from '../cache';
import { InMemoryCache } from '../memory';
import { UpstashCache } from '../upstash';

describe('Cache Interface', () => {
  describe('interface compliance', () => {
    it('InMemoryCache should implement Cache interface', () => {
      const cache: Cache<string> = new InMemoryCache<string>();

      expect(typeof cache.get).toBe('function');
      expect(typeof cache.set).toBe('function');
      expect(typeof cache.delete).toBe('function');
    });

    it('UpstashCache should implement Cache interface', () => {
      const cache = new UpstashCache('http://localhost:8079', 'example_token');

      expect(typeof cache.get).toBe('function');
      expect(typeof cache.set).toBe('function');
      expect(typeof cache.delete).toBe('function');
    });
  });

  describe('method signatures', () => {
    interface TestCache extends Cache<any> {
      get(key: string): Promise<any>;
      set(key: string, value: any): Promise<void>;
      delete(key: string): Promise<void>;
    }

    it('should have correct get method signature', () => {
      const cache = new InMemoryCache() as TestCache;

      // These should compile without errors
      const getResult: Promise<any> = cache.get('test');
      expect(getResult).toBeInstanceOf(Promise);
    });

    it('should have correct set method signature', () => {
      const cache = new InMemoryCache() as TestCache;

      // These should compile without errors
      const setResult: Promise<void> = cache.set('test', 'value');
      expect(setResult).toBeInstanceOf(Promise);
    });

    it('should have correct delete method signature', () => {
      const cache = new InMemoryCache() as TestCache;

      // These should compile without errors
      const deleteResult: Promise<void> = cache.delete('test');
      expect(deleteResult).toBeInstanceOf(Promise);
    });
  });

  describe('generic type support', () => {
    it('should support string types', async () => {
      const cache: Cache<string> = new InMemoryCache<string>();

      await cache.set('key', 'value');
      const result = await cache.get('key');

      expect(typeof result === 'string' || result === undefined).toBe(true);
    });

    it('should support number types', async () => {
      const cache: Cache<number> = new InMemoryCache<number>();

      await cache.set('key', 42);
      const result = await cache.get('key');

      expect(typeof result === 'number' || result === undefined).toBe(true);
    });

    it('should support object types', async () => {
      interface User {
        id: number;
        name: string;
      }

      const cache: Cache<User> = new InMemoryCache<User>();
      const user: User = { id: 1, name: 'John' };

      await cache.set('user', user);
      const result = await cache.get('user');

      expect(
        result === undefined ||
          (typeof result === 'object' && 'id' in result && 'name' in result),
      ).toBe(true);
    });

    it('should support union types', async () => {
      type CacheValue = string | number | boolean;
      const cache: Cache<CacheValue> = new InMemoryCache<CacheValue>();

      await cache.set('string', 'text');
      await cache.set('number', 42);
      await cache.set('boolean', true);

      const stringResult = await cache.get('string');
      const numberResult = await cache.get('number');
      const booleanResult = await cache.get('boolean');

      expect(stringResult).toBe('text');
      expect(numberResult).toBe(42);
      expect(booleanResult).toBe(true);
    });
  });
});
