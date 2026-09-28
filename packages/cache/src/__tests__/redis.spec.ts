import type { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { REDIS_PORT } from '../../../testkit/test/ports';
import { RedisCache, redisCacheDriver, redissCacheDriver } from '../redis';

/**
 * The wire-protocol cache against the Redis container — the same server
 * ElastiCache runs, so what passes here is what a deployed stage does.
 */

const URL = `redis://localhost:${REDIS_PORT}`;
const clientOf = (cache: unknown) =>
	(cache as unknown as { client: Redis }).client;

const cache = redisCacheDriver.create(URL) as RedisCache;
const prefix = `redis-spec:${Date.now()}:`;
const key = (name: string) => `${prefix}${name}`;

afterAll(async () => {
	const keys = await clientOf(cache).keys(`${prefix}*`);
	if (keys.length) await clientOf(cache).del(...keys);
	await clientOf(cache).quit();
});

describe('RedisCache', () => {
	it('answers the first call of a fresh client, before it has connected', async () => {
		// A cold start: nothing has waited for the socket. This must not fail.
		expect(await cache.get(key('cold'))).toBeUndefined();
	});

	it('gives up on an unreachable server rather than hanging', async () => {
		// Nothing listens on port 1.
		const dead = redisCacheDriver.create('redis://localhost:1');

		await expect(dead.get(key('x'))).rejects.toThrow();
		clientOf(dead).disconnect();
	});

	it('round-trips structured values', async () => {
		await cache.set(key('user'), { id: 1, roles: ['admin'] });

		expect(await cache.get(key('user'))).toEqual({ id: 1, roles: ['admin'] });
	});

	it('reports a missing key as undefined', async () => {
		expect(await cache.get(key('missing'))).toBeUndefined();
	});

	it('returns a value written outside `set` as the raw string', async () => {
		await clientOf(cache).set(key('raw'), 'not json');

		expect(await cache.get(key('raw'))).toBe('not json');
	});

	it('expires an entry given a TTL, and reports the time left', async () => {
		await cache.set(key('ttl'), 'v', 60);

		const left = await cache.ttl(key('ttl'));
		expect(left).toBeGreaterThan(55);
		expect(left).toBeLessThanOrEqual(60);
	});

	it('reports zero rather than Redis’s sentinels', async () => {
		await cache.set(key('forever'), 'v');

		// -1: no expiry. -2: no key.
		expect(await cache.ttl(key('forever'))).toBe(0);
		expect(await cache.ttl(key('nothing'))).toBe(0);
	});

	it('deletes', async () => {
		await cache.set(key('gone'), 'v');
		await cache.delete(key('gone'));

		expect(await cache.get(key('gone'))).toBeUndefined();
	});
});

describe('the redis drivers', () => {
	it('share one connection per URL', () => {
		const again = redisCacheDriver.create(URL);

		expect(clientOf(again)).toBe(clientOf(cache));
	});

	it('answer to both the plain and the TLS scheme', () => {
		expect(redisCacheDriver.scheme).toBe('redis:');
		expect(redissCacheDriver.scheme).toBe('rediss:');

		const tls = redissCacheDriver.create(`rediss://localhost:${REDIS_PORT}`);
		// The container speaks no TLS, so stop before the handshake is retried.
		clientOf(tls).disconnect();

		expect(tls).toBeInstanceOf(RedisCache);
		expect(clientOf(tls)).not.toBe(clientOf(cache));
	});
});
