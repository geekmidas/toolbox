import { describe, test } from 'vitest';
import { InMemoryCache } from '../memory';

describe('InMemoryCache', () => {
	const cache = new InMemoryCache();

	test('set with TTL', async ({ bench }) => {
		await bench('set with TTL', async () => {
			await cache.set('key', 'value', 3600);
		}).run();
	});

	test('get (cache hit)', async ({ bench }) => {
		await bench('get (cache hit)', async () => {
			await cache.set('hit-key', 'value', 3600);
			await cache.get('hit-key');
		}).run();
	});

	test('get (cache miss)', async ({ bench }) => {
		await bench('get (cache miss)', async () => {
			await cache.get('nonexistent-key');
		}).run();
	});

	test('delete', async ({ bench }) => {
		await bench('delete', async () => {
			await cache.set('delete-key', 'value', 3600);
			await cache.delete('delete-key');
		}).run();
	});

	test('set + get cycle', async ({ bench }) => {
		await bench('set + get cycle', async () => {
			const key = `cycle-${Math.random()}`;
			await cache.set(key, 'value', 3600);
			await cache.get(key);
		}).run();
	});
});

describe('InMemoryCache - Large Scale', () => {
	test('1000 sequential sets', async ({ bench }) => {
		await bench('1000 sequential sets', async () => {
			const cache = new InMemoryCache();
			for (let i = 0; i < 1000; i++) {
				await cache.set(`key-${i}`, `value-${i}`, 3600);
			}
		}).run();
	});

	test('1000 sequential gets', async ({ bench }) => {
		await bench('1000 sequential gets', async () => {
			const cache = new InMemoryCache();
			// Pre-populate
			for (let i = 0; i < 1000; i++) {
				await cache.set(`key-${i}`, `value-${i}`, 3600);
			}
			// Benchmark gets
			for (let i = 0; i < 1000; i++) {
				await cache.get(`key-${i}`);
			}
		}).run();
	});
});
