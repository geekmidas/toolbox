import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { appEnvKeys } from '../apps';

/**
 * A `Maps` construct's keys, as each process's environment holds them: every
 * caller its own, and none of another's.
 */
const edge = { target: 'Maps', kind: 'maps' };
const manifest = {
	Maps: {
		kind: 'maps',
		id: 'Maps',
		apis: ['maps', 'geocoding'],
		provides: [
			'MAPS_API_KEY',
			'MAPS_BROWSER_KEY',
			'MAPS_ANDROID_KEY',
			'MAPS_IOS_KEY',
		],
	},
	Api: {
		kind: 'rest-api',
		id: 'Api',
		path: 'apps/api',
		endpoints: [
			{
				id: 'ApiGET/geocode',
				handler: 'endpoints/geocode.ts#geocode',
				method: 'GET',
				path: '/geocode',
				dependencies: [edge],
			},
		],
		provides: ['API_URL'],
	},
	Web: {
		kind: 'site',
		id: 'Web',
		variant: 'static',
		app: { path: 'apps/web' },
		dependencies: [edge],
		provides: ['WEB_URL'],
	},
	App: {
		kind: 'mobile-app',
		id: 'App',
		variant: 'expo',
		app: { path: 'apps/app' },
		dependencies: [edge],
	},
} as unknown as ConstructManifest;

const mapsKeys = (app: string) =>
	[...(appEnvKeys(manifest, app) ?? [])].filter((key) => key.includes('MAPS_'));

describe("a Maps construct's keys in each caller's environment", () => {
	it('hands a server process the server key alone', () => {
		expect(mapsKeys('api')).toEqual(['MAPS_API_KEY']);
	});

	it('hands a site the browser key, under its bundle prefix', () => {
		expect(mapsKeys('web').sort()).toEqual([
			'MAPS_BROWSER_KEY',
			'VITE_MAPS_BROWSER_KEY',
		]);
	});

	it('hands a mobile app its Android and iOS keys', () => {
		expect(mapsKeys('app').sort()).toEqual([
			'EXPO_PUBLIC_MAPS_ANDROID_KEY',
			'EXPO_PUBLIC_MAPS_IOS_KEY',
			'MAPS_ANDROID_KEY',
			'MAPS_IOS_KEY',
		]);
	});
});
