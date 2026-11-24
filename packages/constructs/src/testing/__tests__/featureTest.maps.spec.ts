import { describe, expect } from 'vitest';
import { Maps } from '../../maps';
import { FAKE_MAPS_KEY } from '../../maps/fake';
import { type ClientOf, featureTest } from '../featureTest';
import type { TestManifest } from '../manifest';

/**
 * A `Maps` under `gkm test`: a stage set up fresh holds no key Google issued,
 * and nothing in the suite calls Google. Its client is handed the fake key,
 * and Google's hosts are answered in-process by the default fake.
 */

const maps = new Maps('Maps', { apis: ['geocoding', 'places', 'routes'] });

const manifest: TestManifest = {
	stage: 'test',
	constructs: {
		Maps: { kind: 'maps', source: { file: 'constructs', export: 'maps' } },
	},
	endpoints: [],
	env: {},
};

const it = featureTest<
	import('@geekmidas/testkit/browser').Browser,
	{},
	{},
	{ maps: ClientOf<typeof maps> }
>({ manifest, modules: { constructs: { maps } } });

describe('a Maps under featureTest', () => {
	it('hands its client the fake key, with no key on the stage', async ({
		services,
	}) => {
		const client = await services.get('maps');

		expect(client.apiKey).toBe(FAKE_MAPS_KEY);
	});

	it('answers geocoding from the fake, the same point every time', async ({
		services,
	}) => {
		const client = await services.get('maps');

		const [first] = await client.geocode('1 Main Road, Woodstock');
		const [again] = await client.geocode('1 Main Road, Woodstock');

		expect(first).toEqual(again);
	});

	it('answers places and routes from the fake', async ({ services }) => {
		const client = await services.get('maps');

		const [place] = await client.searchPlaces('coffee in Woodstock');
		const [route] = await client.computeRoutes({
			origin: 'Woodstock',
			destination: 'Observatory',
		});

		expect({
			name: place?.displayName?.text,
			hasDistance: (route?.distanceMeters ?? 0) > 0,
		}).toEqual({ name: 'coffee in Woodstock', hasDistance: true });
	});
});
