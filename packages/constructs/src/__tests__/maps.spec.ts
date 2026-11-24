import { EnvironmentParser } from '@geekmidas/envkit';
import { describe, expect, it } from 'vitest';
import { edgeTo } from '../construct-interface';
import { Maps, MapsApiUnknown, MapsHasNoApis } from '../maps';
import { MobileApp } from '../mobile-app';

describe('Maps', () => {
	const maps = new Maps('Maps', { apis: ['places', 'maps', 'places'] });

	it('declares its APIs, once each, and a key for every kind of caller', () => {
		expect(maps.declare()).toEqual([
			{
				kind: 'maps',
				id: 'Maps',
				apis: ['maps', 'places'],
				provides: [
					'MAPS_API_KEY',
					'MAPS_BROWSER_KEY',
					'MAPS_ANDROID_KEY',
					'MAPS_IOS_KEY',
				],
			},
		]);
	});

	it('hands a server process its key', async () => {
		const client = await maps.service.register({
			envParser: new EnvironmentParser({ MAPS_API_KEY: 'AIza-server' }),
		} as never);

		expect(client).toEqual({ apiKey: 'AIza-server' });
	});

	it('is an edge a mobile app can take', () => {
		const app = new MobileApp('App', { path: 'apps/app' }).dependsOn([maps]);

		expect(app.declare()[0]).toMatchObject({
			dependencies: [edgeTo(maps)],
		});
	});

	it('refuses to call no API', () => {
		expect(() => new Maps('Maps', { apis: [] })).toThrow(MapsHasNoApis);
	});

	it('refuses an API it cannot restrict a key to', () => {
		expect(() => new Maps('Maps', { apis: ['streetview' as never] })).toThrow(
			MapsApiUnknown,
		);
	});
});
