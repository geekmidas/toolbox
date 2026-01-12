import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UpstashCache } from '../upstash';

describe('UpstashCache', () => {
	let cache: UpstashCache;
	const testKeyPrefix = `test:${Date.now()}:`;
	let testKeys: string[] = [];

	beforeEach(() => {
		cache = new UpstashCache('http://localhost:8079', 'example_token');
		testKeys = [];
	});

	afterEach(async () => {
		// Clean up test keys
		for (const key of testKeys) {
			try {
				await cache.delete(key);
			} catch (_error) {
				// Ignore cleanup errors
			}
		}
	});

	const getTestKey = (suffix: string): string => {
		const key = `${testKeyPrefix}${suffix}`;
		testKeys.push(key);
		return key;
	};

	describe('get', () => {
		it('should return undefined for non-existent key', async () => {
			const key = getTestKey('non-existent');
			const result = await cache.get(key);

			expect(result).toBeUndefined();
		});

		it('should parse and return JSON value', async () => {
			const key = getTestKey('object');
			const testValue = { id: 1, name: 'test' };

			await cache.set(key, testValue);
			const result = await cache.get(key);

			expect(result).toEqual(testValue);
		});

		it('should handle string values', async () => {
			const key = getTestKey('string');
			const testValue = 'simple string';

			await cache.set(key, testValue);
			const result = await cache.get(key);

			expect(result).toBe(testValue);
		});

		it('should handle number values', async () => {
			const key = getTestKey('number');
			const testValue = 42;

			await cache.set(key, testValue);
			const result = await cache.get(key);

			expect(result).toBe(testValue);
		});

		it('should handle boolean values', async () => {
			const key = getTestKey('boolean');
			const testValue = true;

			await cache.set(key, testValue);
			const result = await cache.get(key);

			expect(result).toBe(testValue);
		});

		it('should handle array values', async () => {
			const key = getTestKey('array');
			const testArray = [1, 2, 3, 'test'];

			await cache.set(key, testArray);
			const result = await cache.get(key);

			expect(result).toEqual(testArray);
		});

		it('should handle null values as undefined', async () => {
			const key = getTestKey('null');

			await cache.set(key, null);
			const result = await cache.get(key);

			expect(result).toBeUndefined();
		});
	});

	describe('set', () => {
		it('should store and retrieve object value', async () => {
			const key = getTestKey('set-object');
			const testValue = { id: 1, name: 'test' };

			await cache.set(key, testValue);
			const result = await cache.get(key);

			expect(result).toEqual(testValue);
		});

		it('should store and retrieve string values', async () => {
			const key = getTestKey('set-string');
			const testValue = 'test string';

			await cache.set(key, testValue);
			const result = await cache.get(key);

			expect(result).toBe(testValue);
		});

		it('should store and retrieve number values', async () => {
			const key = getTestKey('set-number');
			const testValue = 42;

			await cache.set(key, testValue);
			const result = await cache.get(key);

			expect(result).toBe(testValue);
		});

		it('should store and retrieve boolean values', async () => {
			const key = getTestKey('set-boolean');
			const testValue = true;

			await cache.set(key, testValue);
			const result = await cache.get(key);

			expect(result).toBe(testValue);
		});

		it('should store and retrieve array values', async () => {
			const key = getTestKey('set-array');
			const testArray = [1, 2, 3];

			await cache.set(key, testArray);
			const result = await cache.get(key);

			expect(result).toEqual(testArray);
		});

		it('should not store and retrieve null values', async () => {
			const key = getTestKey('set-null');

			await cache.set(key, null);
			const result = await cache.get(key);

			expect(result).toBeUndefined();
		});

		it('should overwrite existing values', async () => {
			const key = getTestKey('overwrite');

			await cache.set(key, 'initial');
			await cache.set(key, 'updated');
			const result = await cache.get(key);

			expect(result).toBe('updated');
		});
	});

	describe('delete', () => {
		it('should delete existing key', async () => {
			const key = getTestKey('delete-test');

			await cache.set(key, 'value-to-delete');
			await cache.delete(key);
			const result = await cache.get(key);

			expect(result).toBeUndefined();
		});

		it('should handle deletion of non-existent key', async () => {
			const key = getTestKey('non-existent-delete');

			await expect(cache.delete(key)).resolves.not.toThrow();
		});

		it('should only delete specified key', async () => {
			const key1 = getTestKey('delete-key1');
			const key2 = getTestKey('delete-key2');

			await cache.set(key1, 'value1');
			await cache.set(key2, 'value2');

			await cache.delete(key1);

			expect(await cache.get(key1)).toBeUndefined();
			expect(await cache.get(key2)).toBe('value2');
		});
	});

	describe('ttl', () => {
		it('should return 0 for non-existent key', async () => {
			const key = getTestKey('ttl-non-existent');
			const result = await cache.ttl(key);

			expect(result).toBe(0);
		});

		it('should return positive TTL for existing key with expiry', async () => {
			const key = getTestKey('ttl-with-expiry');

			await cache.set(key, 'test-value', 3600);
			const result = await cache.ttl(key);

			expect(result).toBeGreaterThan(0);
			expect(result).toBeLessThanOrEqual(3600);
		});

		it('should return TTL in seconds', async () => {
			const key = getTestKey('ttl-seconds');

			await cache.set(key, 'test-value', 60); // 60 seconds
			const result = await cache.ttl(key);

			expect(result).toBeGreaterThan(0);
			expect(result).toBeLessThanOrEqual(60);
		});
	});

	describe('integration scenarios', () => {
		it('should handle round-trip operations', async () => {
			const key = getTestKey('user-session');
			const testData = {
				user: { id: 1, name: 'John' },
				preferences: ['dark-mode', 'notifications'],
				count: 42,
			};

			await cache.set(key, testData);
			const result = await cache.get(key);

			expect(result).toEqual(testData);
		});

		it('should handle complex nested objects', async () => {
			const key = getTestKey('complex');
			const complexObject = {
				level1: {
					level2: {
						level3: {
							data: 'deep nested value',
							array: [{ id: 1 }, { id: 2 }],
						},
					},
				},
			};

			await cache.set(key, complexObject);
			const result = await cache.get(key);

			expect(result).toEqual(complexObject);
		});

		it('should handle concurrent operations', async () => {
			const keys = ['concurrent1', 'concurrent2', 'concurrent3'].map((suffix) =>
				getTestKey(suffix),
			);
			const values = ['value1', 'value2', 'value3'];

			await Promise.all(keys.map((key, i) => cache.set(key, values[i])));
			const results = await Promise.all(keys.map((key) => cache.get(key)));

			expect(results).toEqual(values);
		});
	});
});
