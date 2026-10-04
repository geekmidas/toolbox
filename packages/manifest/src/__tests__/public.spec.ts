import { describe, expect, it } from 'vitest';
import type { ConstructManifest, SiteDeclaration } from '../declaration';
import { dependenciesOf, provisionOrder, publicEnvFor } from '../derive';
import { cloudName, cookieDomain, providedKeyFor } from '../naming';

const manifest = {
	Api: { kind: 'rest-api', id: 'Api', path: '.', endpoints: [] },
	Uploads: { kind: 'file-server', id: 'Uploads', of: 'Bucket' },
	Orders: { kind: 'database', id: 'Orders', engine: 'postgres' },
	Login: { kind: 'oidc', id: 'Login' },
} as unknown as ConstructManifest;

const site = (
	variant: SiteDeclaration['variant'],
	targets: string[],
): SiteDeclaration =>
	({
		kind: 'site',
		id: 'Web',
		variant,
		app: { path: 'apps/web' },
		dependencies: targets.map((target) => ({ target, kind: 'x' })),
	}) as unknown as SiteDeclaration;

describe('publicEnvFor', () => {
	it('ships only what a browser may hold, under the variant prefix', () => {
		expect(
			publicEnvFor(site('static', ['Api', 'Uploads', 'Orders']), manifest),
		).toEqual({
			VITE_API_URL: 'API_URL',
			VITE_UPLOADS_URL: 'UPLOADS_URL',
		});
	});

	it('uses the framework prefix for each variant', () => {
		expect(publicEnvFor(site('next', ['Login']), manifest)).toEqual({
			NEXT_PUBLIC_LOGIN_ISSUER: 'LOGIN_ISSUER',
			NEXT_PUBLIC_LOGIN_AUDIENCE: 'LOGIN_AUDIENCE',
		});
		expect(
			Object.keys(publicEnvFor(site('tanstack', ['Api']), manifest)),
		).toEqual(['VITE_API_URL']);
	});

	it('skips an edge to something the manifest does not have', () => {
		expect(publicEnvFor(site('static', ['Gone']), manifest)).toEqual({});
	});
});

describe('dependenciesOf', () => {
	it("includes a surface's calls alongside its handlers' edges", () => {
		const api = {
			kind: 'rest-api',
			id: 'Api',
			calls: [{ target: 'Auth', kind: 'rest-api' }],
			endpoints: [
				{ id: 'e', dependencies: [{ target: 'Orders', kind: 'database' }] },
			],
		} as never;

		expect(dependenciesOf(api).map((d) => d.target)).toEqual([
			'Auth',
			'Orders',
		]);
	});

	it('is empty for a kind that carries no edges', () => {
		expect(dependenciesOf({ kind: 'secret', id: 'S' } as never)).toEqual([]);
	});
});

describe('provisionOrder', () => {
	it('places what it can when a parent is missing', () => {
		// assertDerivations would refuse this; provisionOrder must not hang.
		expect(
			provisionOrder({
				Reader: { kind: 'database-reader', id: 'Reader', of: 'Gone' },
			} as unknown as ConstructManifest),
		).toEqual(['Reader']);
	});
});

describe('naming helpers', () => {
	it('keys a secret by its own name and anything else by its role', () => {
		expect(providedKeyFor('AuthSecret', 'secret', 'value')).toBe('AUTH_SECRET');
		expect(providedKeyFor('Orders', 'database', 'url')).toBe('ORDERS_URL');
	});

	it('scopes a cloud name by stage and app', () => {
		expect(cloudName({ stage: 'prod', app: 'Shop' }, 'UserUploads')).toBe(
			'prod-shop-user-uploads',
		);
	});

	it('scopes no cookie for nothing, or for something that is not an address', () => {
		expect(cookieDomain([])).toBeUndefined();
		expect(cookieDomain(['not a url', 'https://a.shop.test'])).toBeUndefined();
	});
});
