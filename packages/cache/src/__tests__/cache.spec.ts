import { describe, expect, it } from 'vitest';
import type { Cache } from '../';
import { getExpirationInSeconds } from '../';
import { InMemoryCache } from '../memory';
import { UpstashCache } from '../upstash';

describe('Cache Interface', () => {
	describe('interface compliance', () => {
		it('InMemoryCache should implement Cache interface', () => {
			const cache: Cache = new InMemoryCache();

			expect(typeof cache.get).toBe('function');
			expect(typeof cache.set).toBe('function');
			expect(typeof cache.delete).toBe('function');
		});

		it('UpstashCache should implement Cache interface', () => {
			const cache: Cache = new UpstashCache(
				'http://localhost:8079',
				'example_token',
			);

			expect(typeof cache.get).toBe('function');
			expect(typeof cache.set).toBe('function');
			expect(typeof cache.delete).toBe('function');
		});
	});

	describe('method signatures', () => {
		it('should have correct get method signature', () => {
			const cache: Cache = new InMemoryCache();

			// These should compile without errors
			const getResult: Promise<unknown> = cache.get('test');
			expect(getResult).toBeInstanceOf(Promise);
		});

		it('should have correct set method signature', () => {
			const cache: Cache = new InMemoryCache();

			// These should compile without errors
			const setResult: Promise<void> = cache.set('test', 'value');
			expect(setResult).toBeInstanceOf(Promise);
		});

		it('should have correct delete method signature', () => {
			const cache: Cache = new InMemoryCache();

			// These should compile without errors
			const deleteResult: Promise<void> = cache.delete('test');
			expect(deleteResult).toBeInstanceOf(Promise);
		});
	});

	describe('function-level generic type support', () => {
		it('should support string types with function-level generics', async () => {
			const cache: Cache = new InMemoryCache();

			await cache.set<string>('key', 'value');
			const result = await cache.get<string>('key');

			expect(typeof result === 'string' || result === undefined).toBe(true);
		});

		it('should support number types with function-level generics', async () => {
			const cache: Cache = new InMemoryCache();

			await cache.set<number>('key', 42);
			const result = await cache.get<number>('key');

			expect(typeof result === 'number' || result === undefined).toBe(true);
		});

		it('should support object types with function-level generics', async () => {
			interface User {
				id: number;
				name: string;
			}

			const cache: Cache = new InMemoryCache();
			const user: User = { id: 1, name: 'John' };

			await cache.set<User>('user', user);
			const result = await cache.get<User>('user');

			expect(
				result === undefined ||
					(typeof result === 'object' && 'id' in result && 'name' in result),
			).toBe(true);
		});

		it('should support mixed types in same cache instance', async () => {
			const cache: Cache = new InMemoryCache();

			await cache.set<string>('string', 'text');
			await cache.set<number>('number', 42);
			await cache.set<boolean>('boolean', true);

			const stringResult = await cache.get<string>('string');
			const numberResult = await cache.get<number>('number');
			const booleanResult = await cache.get<boolean>('boolean');

			expect(stringResult).toBe('text');
			expect(numberResult).toBe(42);
			expect(booleanResult).toBe(true);
		});
	});
});

describe('getExpirationInSeconds', () => {
	it('should return 0 for null', () => {
		expect(getExpirationInSeconds(null)).toBe(0);
	});

	it('should return 0 for undefined', () => {
		expect(getExpirationInSeconds(undefined)).toBe(0);
	});

	it('should return positive seconds for future date', () => {
		const futureDate = new Date(Date.now() + 60000); // 1 minute in the future
		const seconds = getExpirationInSeconds(futureDate);
		expect(seconds).toBeGreaterThan(0);
		expect(seconds).toBeLessThanOrEqual(60);
	});

	it('should return 0 for past date', () => {
		const pastDate = new Date(Date.now() - 60000); // 1 minute in the past
		expect(getExpirationInSeconds(pastDate)).toBe(0);
	});

	it('should handle ISO string dates', () => {
		const futureDate = new Date(Date.now() + 120000).toISOString(); // 2 minutes in the future
		const seconds = getExpirationInSeconds(futureDate);
		expect(seconds).toBeGreaterThan(0);
		expect(seconds).toBeLessThanOrEqual(120);
	});

	it('should handle timestamp numbers', () => {
		const futureTimestamp = Date.now() + 30000; // 30 seconds in the future
		const seconds = getExpirationInSeconds(futureTimestamp);
		expect(seconds).toBeGreaterThan(0);
		expect(seconds).toBeLessThanOrEqual(30);
	});
});
