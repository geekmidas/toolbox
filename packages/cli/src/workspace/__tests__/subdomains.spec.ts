import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { derivedApps } from '../derive';
import {
	assertSubdomains,
	FileServerHostTaken,
	ProtectedSubdomainIsAnApp,
	protectedSubdomains,
	SecondWildcardSite,
	SiteHostsEndpointMissing,
	wildcardSite,
} from '../subdomains';
import type { NormalizedWorkspace } from '../types';

const hostsRoute = {
	method: 'GET',
	path: '/tenants/hosts',
	handler: 'src/hosts.ts#hosts',
	dependencies: [],
};

const manifest = {
	Api: {
		kind: 'rest-api',
		id: 'Api',
		path: 'apps/api',
		endpoints: [hostsRoute],
	},
	Auth: {
		kind: 'rest-api',
		id: 'Auth',
		path: 'apps/auth',
		subdomain: 'login',
		endpoints: [],
	},
	Jobs: { kind: 'worker', id: 'Jobs' },
	App: {
		kind: 'site',
		id: 'App',
		variant: 'next',
		subdomain: '*',
		hosts: { surface: 'Api', path: '/tenants/hosts' },
		app: { path: 'apps/app' },
		dependencies: [],
	},
	AdminConsole: {
		kind: 'site',
		id: 'AdminConsole',
		variant: 'static',
		subdomain: 'admin',
		app: { path: 'apps/admin' },
		dependencies: [],
	},
} as const satisfies ConstructManifest;

const workspace = (protectedSubdomains?: string[]) =>
	({
		name: 'shop',
		root: '/tmp/shop',
		apps: {},
		deploy: { default: 'dokploy' },
		shared: { packages: [] },
		stages: { local: 'dev', deployed: ['production'] },
		secrets: {},
		test: {},
		...(protectedSubdomains ? { protectedSubdomains } : {}),
	}) as unknown as NormalizedWorkspace;

describe('the subdomains no tenant may take', () => {
	it("are every app's own label and the workspace's list", () => {
		expect(protectedSubdomains(manifest, ['www', 'mail'])).toEqual([
			'admin',
			'api',
			'jobs',
			'login',
			'mail',
			'www',
		]);
	});

	it('finds the one wildcard site', () => {
		expect(wildcardSite(manifest)?.id).toBe('App');
	});
});

describe('loading a project with a wildcard site', () => {
	it('accepts it', () => {
		expect(() => assertSubdomains(manifest, ['www'])).not.toThrow();
	});

	it('refuses a protected name an app already answers on', () => {
		expect(() => assertSubdomains(manifest, ['www', 'login'])).toThrow(
			ProtectedSubdomainIsAnApp,
		);
	});

	it('refuses a second wildcard site', () => {
		const two = {
			...manifest,
			Shop: { ...manifest.App, id: 'Shop', app: { path: 'apps/shop' } },
		} as ConstructManifest;

		expect(() => assertSubdomains(two)).toThrow(SecondWildcardSite);
	});

	it('refuses a hosts check no surface serves', () => {
		const missing = {
			...manifest,
			App: {
				...manifest.App,
				hosts: { surface: 'Api', path: '/nowhere' },
			},
		} as ConstructManifest;

		expect(() => assertSubdomains(missing)).toThrow(SiteHostsEndpointMissing);
	});

	it('refuses a hosts check on something that is not a surface', () => {
		const onWorker = {
			...manifest,
			App: { ...manifest.App, hosts: { surface: 'Jobs', path: '/hosts' } },
		} as ConstructManifest;

		expect(() => assertSubdomains(onWorker)).toThrow(SiteHostsEndpointMissing);
	});

	it('is refused when the apps are derived, before anything else', () => {
		expect(() => derivedApps(manifest, workspace(['admin']))).toThrow(
			ProtectedSubdomainIsAnApp,
		);
	});

	it('never gives the wildcard site the base domain', () => {
		const apps = derivedApps(manifest, workspace());

		expect(apps.app?.root).toBeUndefined();
		expect(apps['admin-console']?.root).toBe(true);
	});
});

describe("a file server's host", () => {
	const assets = {
		Assets: { kind: 'objects', id: 'Assets' },
		AssetsServer: {
			kind: 'file-server',
			id: 'AssetsServer',
			of: 'Assets',
			processors: [
				{
					id: 'thumbnails',
					handler: 'processors/thumbnails.ts#thumbnails',
					path: '/i/:width/*',
					prefix: '/i/',
					dependencies: [],
				},
			],
		},
	} as const satisfies ConstructManifest;

	it("is the construct's own name, and its processors' origin follows it", () => {
		expect(protectedSubdomains({ ...manifest, ...assets })).toEqual(
			expect.arrayContaining(['assets', 'assets-processors']),
		);
		expect(protectedSubdomains({ ...manifest, ...assets })).not.toContain(
			'assets-server',
		);
	});

	it('is refused when an app of the same name answers on it', () => {
		const clash = {
			...assets,
			Assets2: {
				kind: 'rest-api',
				id: 'Assets2',
				path: 'apps/assets',
				subdomain: 'assets',
				endpoints: [],
			},
		} as ConstructManifest;

		const error = (() => {
			try {
				assertSubdomains(clash);
			} catch (e) {
				return e;
			}
		})() as FileServerHostTaken;
		expect(error).toBeInstanceOf(FileServerHostTaken);
		expect(error).toMatchObject({
			fileServer: 'AssetsServer',
			subdomain: 'assets',
			app: 'Assets2',
		});
	});

	it('is refused whichever of the two the manifest lists first', () => {
		const clash = {
			Media: {
				kind: 'site',
				id: 'Media',
				variant: 'static',
				app: { path: 'apps/media' },
				dependencies: [],
			},
			MediaBucket: { kind: 'objects', id: 'MediaBucket' },
			MediaServer: {
				kind: 'file-server',
				id: 'MediaServer',
				of: 'MediaBucket',
			},
		} as ConstructManifest;

		expect(() => assertSubdomains(clash)).toThrow(FileServerHostTaken);
	});

	it("is refused when an app takes its processors' origin", () => {
		const clash = {
			...assets,
			AssetsProcessors: { kind: 'worker', id: 'AssetsProcessors' },
		} as ConstructManifest;

		expect(() => assertSubdomains(clash)).toThrow(FileServerHostTaken);
	});

	it('is refused when the apps are derived', () => {
		const clash = {
			...manifest,
			...assets,
			AdminConsole: { ...manifest.AdminConsole, subdomain: 'assets' },
		} as ConstructManifest;

		expect(() => derivedApps(clash, workspace())).toThrow(FileServerHostTaken);
	});

	it('leaves an app named for the surface node alone, since it answers elsewhere', () => {
		const beside = {
			...assets,
			AssetsServerApi: {
				kind: 'rest-api',
				id: 'AssetsServerApi',
				path: 'apps/api',
				subdomain: 'assets-server',
				endpoints: [],
			},
		} as ConstructManifest;

		expect(() => assertSubdomains(beside)).not.toThrow();
	});
});
