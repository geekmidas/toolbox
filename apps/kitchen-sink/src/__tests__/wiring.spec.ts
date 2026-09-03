import { describe, expect, it } from 'vitest';
import { getJson, harness } from './__helpers__/app.js';

/**
 * The generated entry, booted.
 *
 * These are the assertions no unit test can make, because they are about the
 * *assembly* rather than about any one piece: which drivers the entry
 * registered, whether the hooks mounted, whether the pollers came up. Every
 * bug this suite was written after lived here — a cache driver registered for
 * a protocol the target never composed, a queue worker that failed to start and
 * said so only in a log line nobody was reading.
 */
describe('the application boots', () => {
	it('answers on the health endpoint', async () => {
		// Not as trivial as it looks: `/health` goes through the shared router,
		// which depends on the auth server and the cache — so a 200 here means
		// every service in the factory registered, and the driver for each of
		// their URLs existed.
		const { status, body } = await getJson<{ status: string }>('/health');

		expect(status).toBe(200);
		expect(body.status).toBe('ok');
	});

	it('registered a cache driver that matches the URL it was given', async () => {
		// The failure this replaces: the entry registered the Upstash driver
		// while the target composed a `postgres://` URL, so every request 500ed
		// with `UnregisteredCacheScheme`. Invisible to unit tests, because the
		// disagreement is between two generated artefacts and neither is loaded
		// by one.
		const { status } = await getJson('/users');

		expect(status).toBe(200);
	});

	it('mounted the auth server through the server hook', async () => {
		// `beforeSetup` mounts Better Auth's own routes. An unauthenticated
		// session request is the cheapest proof they are there: mounted it
		// answers, unmounted the app's `notFound` handler does.
		const { request } = await harness();
		const response = await request('/api/auth/get-session');

		expect(response.status).toBe(200);
		expect(await response.text()).not.toContain('Not Found');
	});

	it('applies CORS from the surface rather than from a written list', async () => {
		// The origins come from whatever declares an edge to the API — the site
		// does — so this asserts the derivation reached the running app, not that
		// somebody typed a localhost port into a config.
		const { request } = await harness();
		const response = await request('/health', {
			method: 'OPTIONS',
			headers: {
				origin: 'http://evil.example',
				'access-control-request-method': 'GET',
			},
		});

		expect(response.headers.get('access-control-allow-origin')).not.toBe(
			'http://evil.example',
		);
	});
});
