import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryCache } from '../memory';

describe('InMemoryCache', () => {
  let cache: InMemoryCache<any>;

  beforeEach(() => {
    cache = new InMemoryCache();
  });

  describe('get', () => {
    it('should return undefined for non-existent key', async () => {
      const result = await cache.get('non-existent');
      expect(result).toBeUndefined();
    });

    it('should return value for existing key', async () => {
      await cache.set('test-key', 'test-value');
      const result = await cache.get('test-key');
      expect(result).toBe('test-value');
    });

    it('should handle different data types', async () => {
      const objectValue = { id: 1, name: 'test' };
      const arrayValue = [1, 2, 3];
      const numberValue = 42;
      const booleanValue = true;

      await cache.set('object', objectValue);
      await cache.set('array', arrayValue);
      await cache.set('number', numberValue);
      await cache.set('boolean', booleanValue);

      expect(await cache.get('object')).toEqual(objectValue);
      expect(await cache.get('array')).toEqual(arrayValue);
      expect(await cache.get('number')).toBe(numberValue);
      expect(await cache.get('boolean')).toBe(booleanValue);
    });
  });

  describe('set', () => {
    it('should store string value', async () => {
      await cache.set('string-key', 'string-value');
      const result = await cache.get('string-key');
      expect(result).toBe('string-value');
    });

    it('should store object value', async () => {
      const value = { id: 1, data: 'test' };
      await cache.set('object-key', value);
      const result = await cache.get('object-key');
      expect(result).toEqual(value);
    });

    it('should overwrite existing value', async () => {
      await cache.set('key', 'initial-value');
      await cache.set('key', 'updated-value');
      const result = await cache.get('key');
      expect(result).toBe('updated-value');
    });

    it('should handle null values', async () => {
      await cache.set('null-key', null);
      const result = await cache.get('null-key');
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should remove existing key', async () => {
      await cache.set('to-delete', 'value');
      await cache.delete('to-delete');
      const result = await cache.get('to-delete');
      expect(result).toBeUndefined();
    });

    it('should not throw error for non-existent key', async () => {
      await expect(cache.delete('non-existent')).resolves.not.toThrow();
    });

    it('should only delete specified key', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.delete('key1');
      
      expect(await cache.get('key1')).toBeUndefined();
      expect(await cache.get('key2')).toBe('value2');
    });
  });

  describe('multiple operations', () => {
    it('should handle multiple keys independently', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');

      expect(await cache.get('key1')).toBe('value1');
      expect(await cache.get('key2')).toBe('value2');
      expect(await cache.get('key3')).toBe('value3');
    });

    it('should maintain data integrity across operations', async () => {
      const data = { count: 0 };
      await cache.set('counter', data);
      
      const retrieved = await cache.get('counter');
      retrieved.count = 5;
      
      const original = await cache.get('counter');
      expect(original.count).toBe(5); // Reference equality in memory
    });
  });

  describe('edge cases', () => {
    it('should handle empty string as key', async () => {
      await cache.set('', 'empty-key-value');
      const result = await cache.get('');
      expect(result).toBe('empty-key-value');
    });

    it('should handle special characters in keys', async () => {
      const specialKey = 'key!@#$%^&*()_+{}|:"<>?[]\\;\',./?`~';
      await cache.set(specialKey, 'special-value');
      const result = await cache.get(specialKey);
      expect(result).toBe('special-value');
    });

    it('should handle undefined values', async () => {
      await cache.set('undefined-key', undefined);
      const result = await cache.get('undefined-key');
      expect(result).toBeUndefined();
    });
  });
});