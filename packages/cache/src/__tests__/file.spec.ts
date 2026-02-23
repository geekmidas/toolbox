import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileCache } from '../file';

describe('FileCache', () => {
	let dir: string;
	let cachePath: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'file-cache-test-'));
		cachePath = join(dir, 'cache.json');
	});

	afterEach(async () => {
		vi.useRealTimers();
		await rm(dir, { recursive: true, force: true });
	});

	describe('get', () => {
		it('should return undefined for non-existent key', async () => {
			const cache = new FileCache({ path: cachePath });
			const result = await cache.get('non-existent');
			expect(result).toBeUndefined();
		});

		it('should return undefined when file does not exist', async () => {
			const cache = new FileCache({
				path: join(dir, 'subdir', 'cache.json'),
			});
			const result = await cache.get('any-key');
			expect(result).toBeUndefined();
		});

		it('should return stored value', async () => {
			const cache = new FileCache({ path: cachePath });
			await cache.set('key', 'hello');
			const result = await cache.get('key');
			expect(result).toBe('hello');
		});

		it('should handle different data types', async () => {
			const cache = new FileCache({ path: cachePath });

			await cache.set('string', 'value');
			await cache.set('number', 42);
			await cache.set('boolean', true);
			await cache.set('object', { id: 1, name: 'test' });
			await cache.set('array', [1, 2, 3]);
			await cache.set('null', null);

			expect(await cache.get('string')).toBe('value');
			expect(await cache.get('number')).toBe(42);
			expect(await cache.get('boolean')).toBe(true);
			expect(await cache.get('object')).toEqual({ id: 1, name: 'test' });
			expect(await cache.get('array')).toEqual([1, 2, 3]);
			expect(await cache.get('null')).toBeNull();
		});

		it('should return undefined for expired entries', async () => {
			const cache = new FileCache({ path: cachePath });

			vi.useFakeTimers();
			await cache.set('expiring', 'value', 1);

			// Advance past expiration
			vi.advanceTimersByTime(2000);

			const result = await cache.get('expiring');
			expect(result).toBeUndefined();

			vi.useRealTimers();
		});
	});

	describe('set', () => {
		it('should create file and parent directory', async () => {
			const nested = join(dir, 'nested', 'dir', 'cache.json');
			const cache = new FileCache({ path: nested });

			await cache.set('key', 'value');

			expect(existsSync(nested)).toBe(true);
		});

		it('should overwrite existing value', async () => {
			const cache = new FileCache({ path: cachePath });

			await cache.set('key', 'first');
			await cache.set('key', 'second');

			expect(await cache.get('key')).toBe('second');
		});

		it('should persist data in valid JSON format', async () => {
			const cache = new FileCache({ path: cachePath });

			await cache.set('test', { hello: 'world' });

			const raw = await readFile(cachePath, 'utf-8');
			const parsed = JSON.parse(raw);

			expect(parsed.test).toBeDefined();
			expect(parsed.test.value).toEqual({ hello: 'world' });
			expect(parsed.test.expiresAt).toBeDefined();
		});

		it('should use custom default TTL', async () => {
			const cache = new FileCache({ path: cachePath, ttl: 3600 });

			await cache.set('key', 'value');

			const remaining = await cache.ttl('key');
			expect(remaining).toBeGreaterThan(3500);
			expect(remaining).toBeLessThanOrEqual(3600);
		});
	});

	describe('delete', () => {
		it('should remove existing key', async () => {
			const cache = new FileCache({ path: cachePath });

			await cache.set('key', 'value');
			await cache.delete('key');

			expect(await cache.get('key')).toBeUndefined();
		});

		it('should not throw for non-existent key', async () => {
			const cache = new FileCache({ path: cachePath });
			await expect(cache.delete('non-existent')).resolves.not.toThrow();
		});

		it('should only delete specified key', async () => {
			const cache = new FileCache({ path: cachePath });

			await cache.set('key1', 'value1');
			await cache.set('key2', 'value2');
			await cache.delete('key1');

			expect(await cache.get('key1')).toBeUndefined();
			expect(await cache.get('key2')).toBe('value2');
		});
	});

	describe('ttl', () => {
		it('should return 0 for non-existent key', async () => {
			const cache = new FileCache({ path: cachePath });
			expect(await cache.ttl('non-existent')).toBe(0);
		});

		it('should return remaining seconds for existing key', async () => {
			const cache = new FileCache({ path: cachePath });
			await cache.set('key', 'value', 300);

			const remaining = await cache.ttl('key');
			expect(remaining).toBeGreaterThan(298);
			expect(remaining).toBeLessThanOrEqual(300);
		});
	});

	describe('concurrency', () => {
		it('should handle concurrent writes without corruption', async () => {
			const cache = new FileCache({ path: cachePath });

			// Write 10 keys concurrently
			await Promise.all(
				Array.from({ length: 10 }, (_, i) =>
					cache.set(`key-${i}`, `value-${i}`),
				),
			);

			// Verify all keys were written
			for (let i = 0; i < 10; i++) {
				const value = await cache.get(`key-${i}`);
				expect(value).toBe(`value-${i}`);
			}
		});
	});

	describe('persistence', () => {
		it('should persist across cache instances', async () => {
			const cache1 = new FileCache({ path: cachePath });
			await cache1.set('persistent', 'data');

			const cache2 = new FileCache({ path: cachePath });
			expect(await cache2.get('persistent')).toBe('data');
		});
	});
});
