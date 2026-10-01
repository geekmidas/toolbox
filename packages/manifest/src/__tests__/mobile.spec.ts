import { describe, expect, it } from 'vitest';
import type { ConstructManifest, MobileAppDeclaration } from '../declaration';
import { dependentsOf, publicEnvFor } from '../derive';
import { isWebOrigin, mobileOrigins, schemeBase } from '../mobile';
import { cookieDomain } from '../naming';

const app: MobileAppDeclaration = {
	kind: 'mobile-app',
	id: 'App',
	variant: 'expo',
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
		expect(schemeBase('shop')).toBe('shop');
		expect(schemeBase('Corner Shop')).toBe('corner-shop');
		expect(schemeBase('@shop/app')).toBe('shop-app');
		// A scheme starts with a letter.
		expect(schemeBase('2fit')).toBe('app2fit');
	});

	it('is the one the app gave, when it gave one', () => {
		expect(schemeBase('shop', 'storefront')).toBe('storefront');
	});
});

describe('mobileOrigins', () => {
	it('trusts the scheme, with or without a path after it', () => {
		expect(mobileOrigins('shop')).toEqual(['shop://', 'shop://*']);
	});

	it('adds the exact hosts Expo Go is served from, not a subnet', () => {
		expect(
			mobileOrigins('shop', { hosts: ['192.168.1.20', 'localhost'] }),
		).toEqual([
			'shop://',
			'shop://*',
			'exp://192.168.1.20:*',
			'exp://192.168.1.20:*/**',
			'exp://localhost:*',
			'exp://localhost:*/**',
		]);
	});

	it('names Metro’s port when the target placed it', () => {
		expect(
			mobileOrigins('shop', { hosts: ['192.168.1.20'], port: 8081 }),
		).toEqual([
			'shop://',
			'shop://*',
			'exp://192.168.1.20:8081',
			'exp://192.168.1.20:8081/**',
		]);
	});

	it('is never a web origin, so it never widens a cookie', () => {
		const origins = mobileOrigins('shop', { hosts: ['localhost'] });
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
