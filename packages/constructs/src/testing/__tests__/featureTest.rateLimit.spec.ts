import { InMemoryCache } from '@geekmidas/cache/memory';
import { describe, expect } from 'vitest';
import { z } from 'zod/v4';
import { RestApi } from '../../rest-api';
import { featureTest } from '../featureTest';
import type { TestManifest } from '../manifest';

/**
 * A feature test sees what a client of the deployed API sees when it is over
 * an endpoint's `.rateLimit()`: a 429, and when it may come back.
 */

const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });

const ping = api
	.post('/ping')
	.rateLimit({ limit: 1, windowMs: 60_000, cache: new InMemoryCache() })
	.output(z.object({ ok: z.boolean() }))
	.handle(() => ({ ok: true }));

const manifest: TestManifest = {
	stage: 'test',
	constructs: {},
	endpoints: [
		{ surface: 'Api', source: { file: 'endpoints', export: 'ping' } },
	],
	env: { API_URL: 'http://api.rate-limit.test' },
};

const it = featureTest({ manifest, modules: { endpoints: { ping } } });

describe('a rate-limited endpoint in a feature test', () => {
	it('answers 429 with Retry-After once the limit is spent', async ({
		browser,
	}) => {
		const ping = () =>
			browser.fetch('http://api.rate-limit.test/ping', { method: 'POST' });

		expect((await ping()).status).toBe(200);

		const refused = await ping();
		expect(refused.status).toBe(429);
		expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
		expect(refused.headers.get('x-ratelimit-remaining')).toBe('0');
	});
});
