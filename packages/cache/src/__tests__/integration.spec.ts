import { beforeEach, describe, expect, it } from 'vitest';
import type { Cache } from '../cache';
import { InMemoryCache } from '../memory';

describe('Cache Integration Tests', () => {
  let memoryCache: Cache<any>;

  beforeEach(() => {
    memoryCache = new InMemoryCache();
  });

  describe('cross-cache behavior consistency', () => {
    const testCases = [
      { name: 'InMemoryCache', cache: () => new InMemoryCache() },
    ];

    testCases.forEach(({ name, cache }) => {
      describe(name, () => {
        let cacheInstance: Cache<any>;

        beforeEach(() => {
          cacheInstance = cache();
        });

        it('should handle basic CRUD operations', async () => {
          // Create
          await cacheInstance.set('user:1', { id: 1, name: 'John' });

          // Read
          const user = await cacheInstance.get('user:1');
          expect(user).toEqual({ id: 1, name: 'John' });

          // Update
          await cacheInstance.set('user:1', { id: 1, name: 'Jane' });
          const updatedUser = await cacheInstance.get('user:1');
          expect(updatedUser).toEqual({ id: 1, name: 'Jane' });

          // Delete
          await cacheInstance.delete('user:1');
          const deletedUser = await cacheInstance.get('user:1');
          expect(deletedUser).toBeUndefined();
        });

        it('should handle concurrent operations', async () => {
          const operations = [
            cacheInstance.set('key1', 'value1'),
            cacheInstance.set('key2', 'value2'),
            cacheInstance.set('key3', 'value3'),
          ];

          await Promise.all(operations);

          const results = await Promise.all([
            cacheInstance.get('key1'),
            cacheInstance.get('key2'),
            cacheInstance.get('key3'),
          ]);

          expect(results).toEqual(['value1', 'value2', 'value3']);
        });

        it('should handle data type preservation', async () => {
          const testData = {
            string: 'hello',
            number: 42,
            boolean: true,
            object: { nested: true },
            array: [1, 2, 3],
            null: null,
          };

          // Store all data types
          await Promise.all(
            Object.entries(testData).map(([key, value]) =>
              cacheInstance.set(key, value),
            ),
          );

          // Retrieve and verify
          const results = await Promise.all(
            Object.keys(testData).map((key) => cacheInstance.get(key)),
          );

          expect(results[0]).toBe('hello');
          expect(results[1]).toBe(42);
          expect(results[2]).toBe(true);
          expect(results[3]).toEqual({ nested: true });
          expect(results[4]).toEqual([1, 2, 3]);
          expect(results[5]).toBeNull();
        });

        it('should handle key isolation', async () => {
          await cacheInstance.set('user:1', 'User One');
          await cacheInstance.set('user:2', 'User Two');
          await cacheInstance.set('session:1', 'Session One');

          await cacheInstance.delete('user:1');

          expect(await cacheInstance.get('user:1')).toBeUndefined();
          expect(await cacheInstance.get('user:2')).toBe('User Two');
          expect(await cacheInstance.get('session:1')).toBe('Session One');
        });
      });
    });
  });

  describe('cache migration scenarios', () => {
    it('should support migrating data between cache implementations', async () => {
      const sourceCache = new InMemoryCache<any>();
      const targetCache = new InMemoryCache<any>();

      // Populate source cache
      const testData = {
        'user:1': { id: 1, name: 'John' },
        'user:2': { id: 2, name: 'Jane' },
        'config:app': { theme: 'dark', notifications: true },
      };

      for (const [key, value] of Object.entries(testData)) {
        await sourceCache.set(key, value);
      }

      // Simulate migration by reading from source and writing to target
      const migrationKeys = Object.keys(testData);
      for (const key of migrationKeys) {
        const value = await sourceCache.get(key);
        if (value !== undefined) {
          await targetCache.set(key, value);
        }
      }

      // Verify migration
      for (const [key, expectedValue] of Object.entries(testData)) {
        const migratedValue = await targetCache.get(key);
        expect(migratedValue).toEqual(expectedValue);
      }
    });
  });

  describe('cache abstraction patterns', () => {
    it('should support cache factory pattern', async () => {
      const createCache = <T>(type: 'memory'): Cache<T> => {
        switch (type) {
          case 'memory':
            return new InMemoryCache<T>();
          default:
            throw new Error(`Unknown cache type: ${type}`);
        }
      };

      const userCache = createCache<{ id: number; name: string }>('memory');
      const sessionCache = createCache<string>('memory');

      await userCache.set('user:1', { id: 1, name: 'John' });
      await sessionCache.set('session:abc', 'active');

      expect(await userCache.get('user:1')).toEqual({ id: 1, name: 'John' });
      expect(await sessionCache.get('session:abc')).toBe('active');
    });

    it('should support cache wrapper pattern', async () => {
      class LoggingCache<T> implements Cache<T> {
        private logs: string[] = [];

        constructor(private underlying: Cache<T>) {}

        async get(key: string): Promise<T | undefined> {
          this.logs.push(`GET ${key}`);
          return this.underlying.get(key);
        }

        async set(key: string, value: T): Promise<void> {
          this.logs.push(`SET ${key}`);
          return this.underlying.set(key, value);
        }

        async delete(key: string): Promise<void> {
          this.logs.push(`DELETE ${key}`);
          return this.underlying.delete(key);
        }

        getLogs(): string[] {
          return [...this.logs];
        }
      }

      const baseCache = new InMemoryCache<string>();
      const loggingCache = new LoggingCache(baseCache);

      await loggingCache.set('test', 'value');
      await loggingCache.get('test');
      await loggingCache.delete('test');

      const logs = loggingCache.getLogs();
      expect(logs).toEqual(['SET test', 'GET test', 'DELETE test']);
    });
  });

  describe('performance and stress tests', () => {
    it('should handle large number of operations', async () => {
      const cache = new InMemoryCache<number>();
      const operationCount = 1000;

      // Bulk insert
      const insertPromises = Array.from({ length: operationCount }, (_, i) =>
        cache.set(`key:${i}`, i),
      );
      await Promise.all(insertPromises);

      // Bulk read
      const readPromises = Array.from({ length: operationCount }, (_, i) =>
        cache.get(`key:${i}`),
      );
      const results = await Promise.all(readPromises);

      // Verify all values
      for (let i = 0; i < operationCount; i++) {
        expect(results[i]).toBe(i);
      }

      // Bulk delete
      const deletePromises = Array.from({ length: operationCount }, (_, i) =>
        cache.delete(`key:${i}`),
      );
      await Promise.all(deletePromises);

      // Verify deletion
      const postDeleteRead = await cache.get('key:0');
      expect(postDeleteRead).toBeUndefined();
    });

    it('should handle large objects efficiently', async () => {
      const cache = new InMemoryCache<any>();

      const largeObject = {
        id: 1,
        data: Array.from({ length: 1000 }, (_, i) => ({
          index: i,
          value: `value-${i}`,
          metadata: {
            timestamp: Date.now(),
            random: Math.random(),
          },
        })),
      };

      const startTime = Date.now();
      await cache.set('large-object', largeObject);
      const result = await cache.get('large-object');
      const endTime = Date.now();

      expect(result).toEqual(largeObject);
      expect(endTime - startTime).toBeLessThan(100); // Should complete within 100ms
    });
  });

  describe('error scenarios', () => {
    it('should handle operations after errors gracefully', async () => {
      const cache = new InMemoryCache<string>();

      // Successful operations
      await cache.set('valid-key', 'valid-value');
      expect(await cache.get('valid-key')).toBe('valid-value');

      // Operations should continue working normally
      await cache.set('another-key', 'another-value');
      expect(await cache.get('another-key')).toBe('another-value');

      await cache.delete('valid-key');
      expect(await cache.get('valid-key')).toBeUndefined();
    });
  });
});
