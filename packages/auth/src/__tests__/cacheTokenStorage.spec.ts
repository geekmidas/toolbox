import type { Cache } from '@geekmidas/cache';
import { InMemoryCache } from '@geekmidas/cache/memory';
import { beforeEach, describe, expect, it } from 'vitest';
import { CacheTokenStorage } from '../cacheTokenStorage.ts';

describe('CacheTokenStorage', () => {
	let storage: CacheTokenStorage;
	let cache: Cache<string>;

	beforeEach(() => {
		cache = new InMemoryCache<string>();
		storage = new CacheTokenStorage(cache);
	});

	describe('access token operations', () => {
		it('should store and retrieve access token', async () => {
			await storage.setAccessToken('test-access-token');

			const token = await storage.getAccessToken();

			expect(token).toBe('test-access-token');
		});

		it('should return null when no access token exists', async () => {
			const token = await storage.getAccessToken();

			expect(token).toBeNull();
		});

		it('should store access token with TTL', async () => {
			await storage.setAccessToken('test-access-token', 3600);

			const token = await storage.getAccessToken();

			expect(token).toBe('test-access-token');
		});

		it('should overwrite existing access token', async () => {
			await storage.setAccessToken('first-token');
			await storage.setAccessToken('second-token');

			const token = await storage.getAccessToken();

			expect(token).toBe('second-token');
		});
	});

	describe('refresh token operations', () => {
		it('should store and retrieve refresh token', async () => {
			await storage.setRefreshToken('test-refresh-token');

			const token = await storage.getRefreshToken();

			expect(token).toBe('test-refresh-token');
		});

		it('should return null when no refresh token exists', async () => {
			const token = await storage.getRefreshToken();

			expect(token).toBeNull();
		});

		it('should store refresh token with TTL', async () => {
			await storage.setRefreshToken('test-refresh-token', 7200);

			const token = await storage.getRefreshToken();

			expect(token).toBe('test-refresh-token');
		});

		it('should overwrite existing refresh token', async () => {
			await storage.setRefreshToken('first-refresh-token');
			await storage.setRefreshToken('second-refresh-token');

			const token = await storage.getRefreshToken();

			expect(token).toBe('second-refresh-token');
		});
	});

	describe('token lifecycle', () => {
		it('should store both tokens independently', async () => {
			await storage.setAccessToken('access-token');
			await storage.setRefreshToken('refresh-token');

			const accessToken = await storage.getAccessToken();
			const refreshToken = await storage.getRefreshToken();

			expect(accessToken).toBe('access-token');
			expect(refreshToken).toBe('refresh-token');
		});

		it('should clear both tokens', async () => {
			await storage.setAccessToken('access-token');
			await storage.setRefreshToken('refresh-token');

			await storage.clearTokens();

			const accessToken = await storage.getAccessToken();
			const refreshToken = await storage.getRefreshToken();

			expect(accessToken).toBeNull();
			expect(refreshToken).toBeNull();
		});

		it('should clear tokens when some are missing', async () => {
			await storage.setAccessToken('access-token');

			await storage.clearTokens();

			const accessToken = await storage.getAccessToken();
			const refreshToken = await storage.getRefreshToken();

			expect(accessToken).toBeNull();
			expect(refreshToken).toBeNull();
		});
	});

	describe('custom storage keys', () => {
		it('should use custom keys for token storage', async () => {
			const customStorage = new CacheTokenStorage(
				cache,
				'custom_access_key',
				'custom_refresh_key',
			);

			await customStorage.setAccessToken('access-token');
			await customStorage.setRefreshToken('refresh-token');

			const accessToken = await customStorage.getAccessToken();
			const refreshToken = await customStorage.getRefreshToken();

			expect(accessToken).toBe('access-token');
			expect(refreshToken).toBe('refresh-token');
		});

		it('should isolate tokens between different storage instances', async () => {
			const defaultStorage = new CacheTokenStorage(cache);
			const customStorage = new CacheTokenStorage(
				cache,
				'custom_access',
				'custom_refresh',
			);

			await defaultStorage.setAccessToken('default-access');
			await customStorage.setAccessToken('custom-access');

			const defaultToken = await defaultStorage.getAccessToken();
			const customToken = await customStorage.getAccessToken();

			expect(defaultToken).toBe('default-access');
			expect(customToken).toBe('custom-access');
		});

		it('should clear tokens independently with custom keys', async () => {
			const defaultStorage = new CacheTokenStorage(cache);
			const customStorage = new CacheTokenStorage(
				cache,
				'custom_access',
				'custom_refresh',
			);

			await defaultStorage.setAccessToken('default-access');
			await customStorage.setAccessToken('custom-access');

			await defaultStorage.clearTokens();

			const defaultToken = await defaultStorage.getAccessToken();
			const customToken = await customStorage.getAccessToken();

			expect(defaultToken).toBeNull();
			expect(customToken).toBe('custom-access');
		});
	});

	describe('integration with real cache', () => {
		it('should work with multiple cache instances', async () => {
			const cache1 = new InMemoryCache<string>();
			const cache2 = new InMemoryCache<string>();

			const storage1 = new CacheTokenStorage(cache1);
			const storage2 = new CacheTokenStorage(cache2);

			await storage1.setAccessToken('token-1');
			await storage2.setAccessToken('token-2');

			const token1 = await storage1.getAccessToken();
			const token2 = await storage2.getAccessToken();

			expect(token1).toBe('token-1');
			expect(token2).toBe('token-2');
		});

		it('should maintain token state across operations', async () => {
			await storage.setAccessToken('initial-access');
			await storage.setRefreshToken('initial-refresh');

			let accessToken = await storage.getAccessToken();
			let refreshToken = await storage.getRefreshToken();

			expect(accessToken).toBe('initial-access');
			expect(refreshToken).toBe('initial-refresh');

			await storage.setAccessToken('updated-access');

			accessToken = await storage.getAccessToken();
			refreshToken = await storage.getRefreshToken();

			expect(accessToken).toBe('updated-access');
			expect(refreshToken).toBe('initial-refresh');
		});
	});
});
