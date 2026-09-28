import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache } from '../memory';
import type * as Registry from '../registry';

/**
 * Picking a client by URL scheme. The registry is module state, so each test
 * starts from a fresh copy of the module — the way a fresh process would.
 */

let registry: typeof Registry;

beforeEach(async () => {
	vi.resetModules();
	registry = await import('../registry');
});

const driver = (scheme: string) => {
	const created: string[] = [];
	return {
		created,
		scheme,
		create(url: string) {
			created.push(url);
			return new InMemoryCache();
		},
	};
};

describe('createCacheClient', () => {
	it('hands the URL to the driver registered for its scheme', () => {
		const memory = driver('memory:');
		registry.registerCacheDriver(memory);

		const client = registry.createCacheClient('memory://local');

		expect(client).toBeInstanceOf(InMemoryCache);
		expect(memory.created).toEqual(['memory://local']);
	});

	it('lets a later registration of the same scheme win', () => {
		const first = driver('memory:');
		const second = driver('memory:');
		registry.registerCacheDriver(first);
		registry.registerCacheDriver(second);

		registry.createCacheClient('memory://local');

		expect(first.created).toEqual([]);
		expect(second.created).toEqual(['memory://local']);
	});

	it('names the schemes it does have when the URL’s is not one', () => {
		registry.registerCacheDriver(driver('redis:'));
		registry.registerCacheDriver(driver('https:'));

		const attempt = () => registry.createCacheClient('postgres://db/app');

		expect(attempt).toThrow(registry.UnregisteredCacheScheme);
		expect(attempt).toThrow(/'postgres:'.*Registered: https:, redis:/);
		expect(registry.registeredCacheSchemes()).toEqual(['https:', 'redis:']);
	});

	it('says nothing is registered when nothing is', () => {
		let error: unknown;
		try {
			registry.createCacheClient('no-scheme-here');
		} catch (caught) {
			error = caught;
		}

		expect(error).toBeInstanceOf(registry.UnregisteredCacheScheme);
		expect(error).toMatchObject({
			scheme: '',
			url: 'no-scheme-here',
			registered: [],
			message: expect.stringContaining('Nothing is registered.'),
		});
	});
});
