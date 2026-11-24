import { describe, expect, it } from 'vitest';
import type { ConstructManifest, PublicDeclaration } from '../declaration';
import { publicEnvFor } from '../derive';
import { isMapsCallerKey, mapsKeyOf, mapsRoleOf, mapsRolesFor } from '../maps';

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

	it("keeps each caller's own key under the role's name and the caller's", () => {
		expect(mapsKeyOf('Maps', 'browserKey', 'Web')).toBe(
			'MAPS_BROWSER_KEY__WEB',
		);
		expect(mapsKeyOf('StoreMaps', 'apiKey', 'AdminApi')).toBe(
			'STORE_MAPS_API_KEY__ADMIN_API',
		);
	});

	it.for([
		['MAPS_ANDROID_KEY', 'androidKey'],
		['MAPS_API_KEY', 'apiKey'],
		['MAPS_BROWSER_KEY__WEB', undefined],
		['ORDERS_URL', undefined],
	] as const)('reads %s as the role %s', ([key, role]) => {
		expect(mapsRoleOf('Maps', key)).toBe(role);
	});

	it.for([
		['MAPS_BROWSER_KEY__WEB', true],
		['MAPS_API_KEY__JOBS', true],
		['MAPS_API_KEY', false],
		['OTHER_API_KEY__WEB', false],
		['STRIPE__KEY', false],
	] as const)('%s is a caller key: %s', ([key, expected]) => {
		expect(isMapsCallerKey(manifest, key)).toBe(expected);
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
