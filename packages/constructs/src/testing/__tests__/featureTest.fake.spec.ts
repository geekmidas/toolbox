import { Hono } from 'hono';
import { describe, expect } from 'vitest';
import { z } from 'zod/v4';
import { ExternalApi, fake as fakes } from '../../external-api';
import { featureTest, ImageFakeHasNoState, NoFakeFor } from '../featureTest';
import type { TestManifest } from '../manifest';

/**
 * `fake(construct)`: what an external API's fake shares, read through the
 * construct — the same module instance the test stage serves, not a relative
 * import of it.
 */

const carrier = new ExternalApi('Carrier', {
	url: 'https://api.carrier.example',
	credentials: z.object({ key: z.string() }),
	client: ({ url }) => ({ url }),
});
const legacy = new ExternalApi('Legacy', {
	url: 'https://legacy.example',
	credentials: z.object({ key: z.string() }),
	client: ({ url }) => ({ url }),
});
const unfaked = new ExternalApi('Unfaked', {
	url: 'https://unfaked.example',
	credentials: z.object({ key: z.string() }),
	client: ({ url }) => ({ url }),
});

// test/fakes/carrier.ts, as a module: the served fake, and what it shares.
const asked: string[] = [];
const carrierFake = {
	asked,
	default: fakes.app(
		new Hono().post('/quotes', async (c) => {
			asked.push((await c.req.json<{ to: string }>()).to);
			return c.json({ amount: 1 });
		}),
		{ credentials: { key: 'fake' } },
	),
};
// A fake that runs as a container: no module state to read.
const legacyFake = {
	default: fakes.image('legacy/api:1', {
		port: 8080,
		credentials: { key: 'x' },
	}),
};

const manifest: TestManifest = {
	stage: 'test',
	constructs: {},
	endpoints: [],
	env: {
		CARRIER_URL: 'http://carrier.fake.test',
		LEGACY_URL: 'http://localhost:1',
	},
};

const it = featureTest({
	manifest,
	fakes: { Carrier: carrierFake, Legacy: legacyFake },
});

describe('fake(construct)', () => {
	it('reads what the served fake recorded, from the same module', async ({
		browser,
		fake,
	}) => {
		await browser.fetch('http://carrier.fake.test/quotes', {
			method: 'POST',
			body: JSON.stringify({ to: 'Cape Town' }),
			headers: { 'content-type': 'application/json' },
		});

		const shared = fake(carrier);

		expect(shared.asked).toContain('Cape Town');
		// Only what the fake shares — the served fake itself is not handed out.
		expect(shared).not.toHaveProperty('default');
	});

	it('names an external API with no fake', async ({ fake }) => {
		// A type error first — `Unfaked` has no fake module — and, past a cast,
		// a named one at runtime.
		// @ts-expect-error
		expect(() => fake(unfaked)).toThrow(NoFakeFor);
	});

	it('refuses an image fake, which holds no state to read', async ({
		fake,
	}) => {
		expect(() => fake(legacy)).toThrow(ImageFakeHasNoState);
	});
});
