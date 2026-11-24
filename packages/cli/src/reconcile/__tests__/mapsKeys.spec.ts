import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { processEnvKeys } from '../apps';
import {
	appCaller,
	callerSecrets,
	mapsHolders,
	mapsValue,
	storedMapsKey,
} from '../mapsKeys';

/**
 * Who holds each `Maps` key, and what one of them reads: every caller its
 * own key, under the role's name.
 */
const edge = { target: 'Maps', kind: 'maps' };
const site = (id: string) => ({
	kind: 'site',
	id,
	variant: 'static',
	app: { path: `apps/${id.toLowerCase()}` },
	dependencies: [edge],
});
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
	Jobs: { kind: 'worker', id: 'Jobs', dependencies: [] },
	Nightly: {
		kind: 'cron',
		id: 'Nightly',
		handler: 'crons/nightly.ts#nightly',
		schedule: 'rate(1 day)',
		owner: 'Jobs',
		dependencies: [edge],
	},
	Geocode: {
		kind: 'function',
		id: 'Geocode',
		handler: 'functions/geocode.ts#geocode',
		dependencies: [edge],
	},
	Web: site('Web'),
	Admin: site('Admin'),
	App: {
		kind: 'mobile-app',
		id: 'App',
		variant: 'expo',
		app: { path: 'apps/app' },
		android: { package: 'com.shop.app' },
		dependencies: [edge],
	},
} as unknown as ConstructManifest;

describe("who holds a Maps construct's keys", () => {
	it('is each process that reads one, by the role it reads', () => {
		expect(
			mapsHolders(manifest).map(({ role, caller }) => `${role}:${caller}`),
		).toEqual([
			'apiKey:Api',
			'apiKey:Geocode',
			'apiKey:Jobs',
			'browserKey:Admin',
			'browserKey:Web',
			'androidKey:App',
		]);
	});

	it('holds no phone key for a platform the app does not declare', () => {
		expect(
			mapsHolders(manifest).some(
				(holder) => holder.caller === 'App' && holder.role === 'iosKey',
			),
		).toBe(false);
	});

	it('narrows to one construct', () => {
		expect(mapsHolders(manifest, 'Other')).toEqual([]);
	});
});

describe("where a caller's key is kept", () => {
	const web = { maps: 'Maps', role: 'browserKey', caller: 'Web' } as const;

	it.for([
		[true, 'MAPS_BROWSER_KEY'],
		[false, 'MAPS_BROWSER_KEY_WEB'],
	] as const)('local %s: %s', ([local, key]) => {
		expect(storedMapsKey(web, local)).toBe(key);
	});

	it.for([
		[
			'its own, deployed',
			{ MAPS_BROWSER_KEY_WEB: 'own', MAPS_BROWSER_KEY: 'shared' },
			false,
			'own',
		],
		[
			'the shared one, deployed',
			{ MAPS_BROWSER_KEY: 'shared' },
			false,
			'shared',
		],
		['the role’s, locally', { MAPS_BROWSER_KEY: 'by-hand' }, true, 'by-hand'],
		['nothing', {}, false, undefined],
	] as const)('reads %s', ([, stored, local, value]) => {
		expect(mapsValue(stored, web, local)).toBe(value);
	});
});

describe("the stage's secrets as one process reads them", () => {
	const stored = {
		STRIPE_KEY: 'sk',
		MAPS_API_KEY_API: 'api-own',
		MAPS_API_KEY_JOBS: 'jobs-own',
		MAPS_BROWSER_KEY_WEB: 'web-own',
		MAPS_BROWSER_KEY_ADMIN: 'admin-own',
	};

	it.for([
		['Api', { MAPS_API_KEY: 'api-own' }],
		['Jobs', { MAPS_API_KEY: 'jobs-own' }],
		['Admin', { MAPS_BROWSER_KEY: 'admin-own' }],
		[undefined, {}],
	] as const)('%s: its own keys under their roles, and no one else’s', ([
		caller,
		own,
	]) => {
		expect(callerSecrets(manifest, caller, stored, false)).toEqual({
			STRIPE_KEY: 'sk',
			...own,
		});
	});

	it('hands no process a caller’s own key as a stage key', () => {
		const keys = processEnvKeys(manifest, { app: 'api' }, Object.keys(stored));

		expect({
			stage: keys?.has('STRIPE_KEY'),
			callers: [...(keys ?? [])].filter((key) => /^MAPS_[A-Z]+_KEY_/.test(key)),
		}).toEqual({ stage: true, callers: [] });
	});
});

describe('the construct an app is', () => {
	it.for([
		['api', 'Api'],
		['admin', 'Admin'],
		['jobs', undefined],
	] as const)('%s is %s', ([app, id]) => {
		expect(appCaller(manifest, app)).toBe(id);
	});
});
