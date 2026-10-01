import { describe, expect, it } from 'vitest';
import type { ConstructManifest, MobileAppDeclaration } from '../declaration';
import { dependentsOf, publicEnvFor } from '../derive';
import { appScheme, isWebOrigin, mobileOrigins, schemeBase } from '../mobile';
import { cookieDomain } from '../naming';

const app: MobileAppDeclaration = {
	kind: 'mobile-app',
	id: 'App',
	flavour: 'expo',
	app: { path: 'apps/app' },
	dependencies: [
		{ target: 'Api', kind: 'rest-api' },
		{ target: 'Auth', kind: 'rest-api' },
	],
	provides: ['APP_SCHEME'],
} as unknown as MobileAppDeclaration;

const manifest = {
	Api: { kind: 'rest-api', id: 'Api', path: '.', endpoints: [] },
	Auth: { kind: 'rest-api', id: 'Auth', path: '.', endpoints: [] },
	App: app,
} as unknown as ConstructManifest;

describe('schemeBase', () => {
	it('is the project’s name, made a valid URL scheme', () => {
		expect(schemeBase('beetlefit')).toBe('beetlefit');
		expect(schemeBase('Beetle Fit')).toBe('beetle-fit');
		expect(schemeBase('@shop/app')).toBe('shop-app');
		// A scheme starts with a letter.
		expect(schemeBase('2fit')).toBe('app2fit');
	});

	it('is the one the app gave, when it gave one', () => {
		expect(schemeBase('beetlefit', 'fitbeetle')).toBe('fitbeetle');
	});
});

describe('appScheme', () => {
	it('suffixes a local stage, so a dev build never answers the store build’s links', () => {
		expect(appScheme('beetlefit', 'dev')).toBe('beetlefit-dev');
		expect(appScheme('beetlefit', 'test')).toBe('beetlefit-test');
	});

	it('is the bare base deployed — what the store build registers', () => {
		expect(appScheme('beetlefit')).toBe('beetlefit');
	});
});

describe('mobileOrigins', () => {
	it('trusts the scheme, with or without a path after it', () => {
		expect(mobileOrigins('beetlefit')).toEqual([
			'beetlefit://',
			'beetlefit://*',
		]);
	});

	it('adds the exact hosts Expo Go is served from, not a subnet', () => {
		expect(
			mobileOrigins('beetlefit-dev', { hosts: ['192.168.1.20', 'localhost'] }),
		).toEqual([
			'beetlefit-dev://',
			'beetlefit-dev://*',
			'exp://192.168.1.20:*',
			'exp://192.168.1.20:*/**',
			'exp://localhost:*',
			'exp://localhost:*/**',
		]);
	});

	it('is never a web origin, so it never widens a cookie', () => {
		const origins = mobileOrigins('beetlefit', { hosts: ['localhost'] });
		expect(origins.some(isWebOrigin)).toBe(false);
		expect(cookieDomain(['https://api.shop.com', 'https://shop.com'])).toBe(
			'.shop.com',
		);
	});
});

describe('a mobile app in the graph', () => {
	it('is a caller of what it depends on', () => {
		expect(dependentsOf(manifest, 'Auth')).toEqual(['App']);
		expect(dependentsOf(manifest, 'Api')).toEqual(['App']);
	});

	it('is built with its edges’ URLs under EXPO_PUBLIC_', () => {
		expect(publicEnvFor(app, manifest)).toEqual({
			EXPO_PUBLIC_API_URL: 'API_URL',
			EXPO_PUBLIC_AUTH_URL: 'AUTH_URL',
		});
	});
});
