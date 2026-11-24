import { describe, expect, it } from 'vitest';
import type { ConstructManifest, PublicDeclaration } from '../declaration';
import { mapsCallers, publicEnvFor } from '../derive';
import { mapsKeysFor, mapsRolesFor } from '../maps';

const edge = { target: 'Maps', kind: 'maps' } as const;
const site = {
	kind: 'site',
	id: 'Web',
	variant: 'next',
	app: { path: 'apps/web' },
	dependencies: [edge],
} as unknown as PublicDeclaration;
const app = {
	kind: 'mobile-app',
	id: 'App',
	variant: 'expo',
	app: { path: 'apps/app' },
	dependencies: [edge],
} as unknown as PublicDeclaration;

const manifest = {
	Maps: { kind: 'maps', id: 'Maps', apis: ['maps'] },
	Geocode: {
		kind: 'function',
		id: 'Geocode',
		handler: 'geocode.ts#handler',
		dependencies: [edge],
	},
	Web: site,
	App: app,
} as unknown as ConstructManifest;

describe("who holds a Maps construct's keys", () => {
	it.for([
		['site', ['browserKey']],
		['mobile-app', ['androidKey', 'iosKey']],
		['rest-api', ['apiKey']],
		['cron', ['apiKey']],
	] as const)('a %s holds %j', ([kind, roles]) => {
		expect(mapsRolesFor(kind)).toEqual(roles);
	});

	it('names the keys after the construct', () => {
		expect(mapsKeysFor('Places', 'mobile-app')).toEqual([
			'PLACES_ANDROID_KEY',
			'PLACES_IOS_KEY',
		]);
	});

	it('reads each role off the graph, with its callers', () => {
		expect(mapsCallers(manifest, 'Maps')).toEqual({
			apiKey: ['Geocode'],
			browserKey: ['Web'],
			androidKey: ['App'],
			iosKey: ['App'],
		});
	});

	it("inlines a site's browser key, and no other", () => {
		expect(publicEnvFor(site, manifest)).toMatchObject({
			NEXT_PUBLIC_MAPS_BROWSER_KEY: 'MAPS_BROWSER_KEY',
		});
		expect(Object.keys(publicEnvFor(site, manifest))).not.toContain(
			'NEXT_PUBLIC_MAPS_ANDROID_KEY',
		);
	});

	it("inlines a mobile app's own keys, and not the browser's", () => {
		expect(Object.keys(publicEnvFor(app, manifest)).sort()).toEqual([
			'EXPO_PUBLIC_MAPS_ANDROID_KEY',
			'EXPO_PUBLIC_MAPS_IOS_KEY',
		]);
	});
});
