import { describe, expect } from 'vitest';
import { Maps } from '../../maps';
import { defaultMapsHandler, mapsFake } from '../../maps/fake';
import { type ClientOf, featureTest } from '../featureTest';
import type { TestManifest } from '../manifest';

/**
 * A project's own Maps fake — `test/fakes/maps.ts`, which the harness hands
 * over — answers in place of the default, and a key the stage does hold is
 * the one its client is handed.
 */

const maps = new Maps('Maps', { apis: ['geocoding'] });

const own = mapsFake({
	async fetch(request) {
		const url = new URL(request.url);
		if (url.searchParams.get('address') === 'nowhere') {
			return Response.json({ status: 'ZERO_RESULTS', results: [] });
		}
		return defaultMapsHandler.fetch(request);
	},
});

const manifest: TestManifest = {
	stage: 'test',
	constructs: {
		Maps: { kind: 'maps', source: { file: 'constructs', export: 'maps' } },
	},
	endpoints: [],
	env: { MAPS_API_KEY: 'the-stage-key' },
};

const it = featureTest<
	import('@geekmidas/testkit/browser').Browser,
	{},
	{},
	{ maps: ClientOf<typeof maps> }
>({ manifest, modules: { constructs: { maps } }, fakes: { Maps: own } });

describe("a project's own Maps fake", () => {
	it('answers in place of the default', async ({ services }) => {
		const client = await services.get('maps');

		expect(await client.geocode('nowhere')).toEqual([]);
	});

	it('falls through to the default where it says so', async ({ services }) => {
		const client = await services.get('maps');

		expect(await client.geocode('Woodstock')).toHaveLength(1);
	});

	it("keeps the stage's own key", async ({ services }) => {
		const client = await services.get('maps');

		expect(client.apiKey).toBe('the-stage-key');
	});
});
