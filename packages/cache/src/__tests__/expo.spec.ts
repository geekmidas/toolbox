import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The device keychain is native, so it is stood in for by a map — the same
 * role a temp directory plays for the file cache. Time is faked, because
 * expiry is the behaviour under test.
 */
const keychain = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
	getItemAsync: async (key: string) => keychain.get(key) ?? null,
	setItemAsync: async (key: string, value: string) => {
		keychain.set(key, value);
	},
	deleteItemAsync: async (key: string) => {
		keychain.delete(key);
	},
}));

const { ExpoSecureCache } = await import('../expo');

describe('ExpoSecureCache', () => {
	const cache = new ExpoSecureCache();

	beforeEach(() => {
		keychain.clear();
		vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
	});
	afterEach(() => vi.useRealTimers());

	it('keeps the value and its expiry side by side', async () => {
		await cache.set('token', { access: 'a' }, 60);

		expect(keychain.get('token')).toBe('{"access":"a"}');
		expect(keychain.get(ExpoSecureCache.getExpiryKey('token'))).toBe(
			'2026-01-01T00:01:00.000Z',
		);
		expect(await cache.get('token')).toEqual({ access: 'a' });
		expect(await cache.ttl('token')).toBe(60);
	});

	it('defaults to ten minutes', async () => {
		await cache.set('token', 'v');

		expect(await cache.ttl('token')).toBe(600);
	});

	it('stops returning an entry once it has expired', async () => {
		await cache.set('token', 'v', 60);
		vi.advanceTimersByTime(61_000);

		expect(await cache.get('token')).toBeUndefined();
		expect(await cache.ttl('token')).toBe(0);
	});

	it('treats a value with no recorded expiry as absent', async () => {
		keychain.set('orphan', '"v"');

		expect(await cache.get('orphan')).toBeUndefined();
		expect(await cache.get('missing')).toBeUndefined();
		expect(await cache.ttl('missing')).toBe(0);
	});

	it('deletes the value and its expiry', async () => {
		await cache.set('token', 'v', 60);
		await cache.delete('token');

		expect([...keychain.keys()]).toEqual([]);
	});
});
