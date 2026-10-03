import { describe, expect } from 'vitest';
import { z } from 'zod/v4';
import { RestApi } from '../../rest-api';
import { featureTest } from '../featureTest';
import type { TestManifest } from '../manifest';

/**
 * Each test's browser connects from an address of its own, as each person's
 * does — so what an app keys by client (an auth server's rate limit) never
 * makes concurrent tests contend for the same thing.
 */

const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });

const whoAmI = api
	.get('/whoami')
	.output(z.object({ address: z.string().nullable() }))
	.handle(async ({ header }) => ({
		address: header('x-forwarded-for') ?? null,
	}));

const manifest: TestManifest = {
	stage: 'test',
	constructs: {},
	endpoints: [
		{ surface: 'Api', source: { file: 'endpoints', export: 'whoAmI' } },
	],
	env: { API_URL: 'http://api.client.test' },
};

const it = featureTest({ manifest, modules: { endpoints: { whoAmI } } });

const addressOf = async (response: Response) =>
	((await response.json()) as { address: string | null }).address;

const seen: string[] = [];

describe('a test’s browser', () => {
	it('connects from an address of its own', async ({ browser }) => {
		const address = await addressOf(
			await browser.fetch('http://api.client.test/whoami'),
		);

		expect(address).toMatch(/^10\.\d+\.\d+\.\d+$/);
		// The same for every request the test makes.
		expect(
			await addressOf(await browser.fetch('http://api.client.test/whoami')),
		).toBe(address);
		seen.push(address!);
	});

	it('is a different person from the test before it', async ({ browser }) => {
		const address = await addressOf(
			await browser.fetch('http://api.client.test/whoami'),
		);

		expect(seen).toHaveLength(1);
		expect(address).not.toBe(seen[0]);
	});

	it('keeps an address the test chose — one that is several machines', async ({
		browser,
	}) => {
		const response = await browser.fetch('http://api.client.test/whoami', {
			headers: { 'x-forwarded-for': '203.0.113.7' },
		});

		expect(await addressOf(response)).toBe('203.0.113.7');
	});
});
