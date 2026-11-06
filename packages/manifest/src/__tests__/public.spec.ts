import { describe, expect, it } from 'vitest';
import type {
	ConstructManifest,
	Declaration,
	SiteDeclaration,
} from '../declaration';
import {
	dependenciesOf,
	imageOriginSources,
	imageOrigins,
	provisionOrder,
	publicEnvFor,
	publicValues,
	reachesServerHalf,
} from '../derive';
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
			VITE_WEB_URL: 'WEB_URL',
			VITE_API_URL: 'API_URL',
			VITE_UPLOADS_URL: 'UPLOADS_URL',
		});
	});

	it('uses the framework prefix for each variant', () => {
		expect(publicEnvFor(site('next', ['Login']), manifest)).toEqual({
			NEXT_PUBLIC_WEB_URL: 'WEB_URL',
			NEXT_PUBLIC_LOGIN_ISSUER: 'LOGIN_ISSUER',
			NEXT_PUBLIC_LOGIN_AUDIENCE: 'LOGIN_AUDIENCE',
		});
		expect(
			Object.keys(publicEnvFor(site('tanstack', ['Api']), manifest)),
		).toEqual(['VITE_WEB_URL', 'VITE_API_URL']);
	});

	it("inlines a bucket's file server and signed origin, never its connection", () => {
		// A full-stack site's `.dependsOn([assets.server])`: its server half
		// holds the bucket, its bundle still shows the objects from where they
		// are served.
		const served = {
			Assets: {
				kind: 'objects',
				id: 'Assets',
				provides: ['ASSETS_CONNECTION_STRING'],
			},
			AssetsServer: { kind: 'file-server', id: 'AssetsServer', of: 'Assets' },
		} as unknown as ConstructManifest;

		// Either edge also gets where the bucket's signed links point: an
		// origin, no credentials.
		const expected = {
			NEXT_PUBLIC_WEB_URL: 'WEB_URL',
			NEXT_PUBLIC_ASSETS_SIGNED_ORIGIN: 'ASSETS_SIGNED_ORIGIN',
			NEXT_PUBLIC_ASSETS_URL: 'ASSETS_URL',
		};
		expect(publicEnvFor(site('next', ['Assets']), served)).toEqual(expected);
		expect(publicEnvFor(site('next', ['AssetsServer']), served)).toEqual(
			expected,
		);
		expect(
			Object.keys(publicEnvFor(site('next', ['Assets']), served)),
		).not.toContain('NEXT_PUBLIC_ASSETS_CONNECTION_STRING');
	});

	it('skips an edge to something the manifest does not have', () => {
		expect(publicEnvFor(site('static', ['Gone']), manifest)).toEqual({
			VITE_WEB_URL: 'WEB_URL',
		});
	});

	it('gives a site its own address, edges or none', () => {
		// What a page links to itself with — a canonical URL, an Open Graph
		// image. A site that depends on nothing used to get nothing at all.
		expect(publicEnvFor(site('next', []), manifest)).toEqual({
			NEXT_PUBLIC_WEB_URL: 'WEB_URL',
		});
	});
});

describe('dependenciesOf', () => {
	it("includes a surface's authenticator alongside its handlers' edges", () => {
		const api = {
			kind: 'rest-api',
			id: 'Api',
			auth: { target: 'Auth', kind: 'rest-api' },
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

describe('image origins', () => {
	const files = {
		Assets: {
			kind: 'objects',
			id: 'Assets',
			provides: ['ASSETS_CONNECTION_STRING'],
		},
		AssetsServer: { kind: 'file-server', id: 'AssetsServer', of: 'Assets' },
		Exports: {
			kind: 'objects',
			id: 'Exports',
			provides: ['EXPORTS_CONNECTION_STRING'],
		},
		Api: { kind: 'rest-api', id: 'Api', path: '.', endpoints: [] },
	} as unknown as ConstructManifest;

	it('are the file servers and signed-link hosts a site reaches, not its APIs', () => {
		expect(
			imageOriginSources(
				site('next', ['Api', 'AssetsServer', 'Exports']),
				files,
			),
		).toEqual(['ASSETS_SIGNED_ORIGIN', 'ASSETS_URL', 'EXPORTS_SIGNED_ORIGIN']);
	});

	it('compose to one sorted list of origins, or nothing', () => {
		const values: Record<string, string> = {
			ASSETS_URL: 'https://assets.example.com/',
			ASSETS_SIGNED_ORIGIN: 'https://acme-assets.s3.eu-west-1.amazonaws.com',
		};
		const sources = [
			'ASSETS_SIGNED_ORIGIN',
			'ASSETS_URL',
			'EXPORTS_SIGNED_ORIGIN',
		];

		expect(imageOrigins(sources, (key) => values[key])).toBe(
			'https://acme-assets.s3.eu-west-1.amazonaws.com,https://assets.example.com',
		);
		expect(imageOrigins(sources, () => undefined)).toBeUndefined();
	});
});

describe('publicValues', () => {
	const files = {
		Assets: { kind: 'objects', id: 'Assets' },
		AssetsServer: { kind: 'file-server', id: 'AssetsServer', of: 'Assets' },
		Api: { kind: 'rest-api', id: 'Api', path: '.', endpoints: [] },
		Orders: { kind: 'database', id: 'Orders' },
	} as unknown as ConstructManifest;

	it('is each public role an edge reaches, a bucket and its server as one', () => {
		const expected = [
			{
				id: 'AssetsServer',
				kind: 'file-server',
				role: 'url',
				key: 'ASSETS_URL',
			},
			{
				id: 'Assets',
				kind: 'objects',
				role: 'signedOrigin',
				key: 'ASSETS_SIGNED_ORIGIN',
			},
		];

		expect(
			publicValues(site('next', ['Api', 'AssetsServer', 'Orders']), files),
		).toEqual([
			{ id: 'Api', kind: 'rest-api', role: 'url', key: 'API_URL' },
			...expected,
		]);
		// From the bucket's side, the same two values: one construct to a page.
		expect(
			new Set(publicValues(site('next', ['Assets']), files).map((v) => v.key)),
		).toEqual(new Set(expected.map((v) => v.key)));
	});
});

describe('reachesServerHalf', () => {
	const bucket = { target: 'Documents', kind: 'objects' } as const;
	const server = { ...bucket, server: true } as const;
	const api = { kind: 'rest-api', id: 'Api' } as unknown as Declaration;
	const app = { kind: 'mobile-app', id: 'App' } as unknown as Declaration;

	it("is every server process's edge, plain or not", () => {
		expect(reachesServerHalf(api, bucket)).toBe(true);
		expect(reachesServerHalf(api, server)).toBe(true);
	});

	it("is a frontend's edge only when it named the server half", () => {
		for (const frontend of [site('next', []), app]) {
			expect(reachesServerHalf(frontend, bucket)).toBe(false);
			expect(reachesServerHalf(frontend, server)).toBe(true);
		}
	});
});
