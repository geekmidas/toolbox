import { EnvironmentParser } from '@geekmidas/envkit';
import { Credentials } from '@geekmidas/envkit/credentials';
import { provideKey } from '@geekmidas/manifest';
import { auth } from '@kitchen-sink/constructs/auth.js';
import { describe, expect } from 'vitest';
import { it } from '#test';

/**
 * The application, wired: the smallest requests that each prove one piece of
 * what the app declares came together.
 *
 * How the *generated entry* wires them — CORS from the surface, the auth
 * server mounted through its server hook — is the build's, and is tested with
 * the build in `@geekmidas/cli`, not here.
 */
describe('the application', () => {
	it('answers on the health endpoint', async ({ browser }) => {
		expect(await browser.api.get('/health')).toMatchObject({ status: 'ok' });
	});

	it('resolves its cache through a driver that matches the URL it was given', async ({
		browser,
	}) => {
		// The list is cached. A driver for the wrong scheme fails the first
		// request with `UnregisteredCacheScheme` rather than serving it.
		expect(await browser.api.get('/users')).toHaveProperty('users');
	});

	it('serves the auth server at its own URL', async ({ browser }) => {
		// No session yet, so better-auth answers null — from its own route.
		const { data, error } = await browser.auth.getSession();

		expect(error).toBeNull();
		expect(data).toBeNull();
	});

	it('scopes a cookie to the domain its callers share', () => {
		// Derived from the graph: the API and the web app both call the auth
		// server, so the cookie has to be readable on both hosts.
		const { domain } = new EnvironmentParser({ ...process.env, ...Credentials })
			.create((get) => ({
				domain: get(provideKey(auth.id, 'cookieDomain')).string().optional(),
			}))
			.parse();

		expect(domain).toMatch(/^\.[^.]+\.localhost$/);
	});
});
