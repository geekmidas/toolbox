import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { derivedApps } from '../derive';
import {
	assertSubdomains,
	FileServerHostTaken,
	HostLabelTaken,
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

describe('aliases and redirects', () => {
	const aliased = {
		...manifest,
		Api: { ...manifest.Api, aliases: ['rest'] },
		AdminConsole: { ...manifest.AdminConsole, redirects: ['backoffice'] },
	} as ConstructManifest;

	it('are labels no tenant may take', () => {
		expect(protectedSubdomains(aliased)).toEqual([
			'admin',
			'api',
			'backoffice',
			'jobs',
			'login',
			'rest',
		]);
	});

	it('refuses a protected name that is an alias or a redirect', () => {
		for (const label of ['rest', 'backoffice']) {
			try {
				assertSubdomains(aliased, [label]);
				expect.unreachable();
			} catch (error) {
				expect(error).toBeInstanceOf(ProtectedSubdomainIsAnApp);
				expect((error as Error).message).toContain('protectedSubdomains');
			}
		}
	});

	it("refuses an alias that is another app's own label", () => {
		const clash = {
			...manifest,
			Api: { ...manifest.Api, aliases: ['login'] },
		} as ConstructManifest;

		try {
			assertSubdomains(clash);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(HostLabelTaken);
			expect((error as HostLabelTaken).label).toBe('login');
			expect([
				(error as HostLabelTaken).first,
				(error as HostLabelTaken).second,
			]).toEqual(['Api', 'Auth']);
		}
	});

	it('refuses one label listed by two apps', () => {
		const clash = {
			...manifest,
			Api: { ...manifest.Api, aliases: ['rest'] },
			AdminConsole: { ...manifest.AdminConsole, aliases: ['rest'] },
		} as ConstructManifest;

		expect(() => assertSubdomains(clash)).toThrow(HostLabelTaken);
	});

	it("claims a Telemetry node's label: no tenant takes it, and no app shares it", () => {
		const observed = {
			...manifest,
			Telemetry: { kind: 'telemetry', id: 'Telemetry' },
		} as ConstructManifest;
		expect(protectedSubdomains(observed)).toContain('telemetry');

		const clash = {
			...observed,
			Telemetry: { kind: 'telemetry', id: 'Telemetry', subdomain: 'api' },
		} as ConstructManifest;
		expect(() => assertSubdomains(clash)).toThrow(HostLabelTaken);

		// Two nodes on one label are the stack's one log UI.
		const two = {
			...observed,
			Traces: { kind: 'telemetry', id: 'Traces', subdomain: 'telemetry' },
		} as ConstructManifest;
		expect(() => assertSubdomains(two)).not.toThrow();
	});

	it("refuses an alias on a file server's host", () => {
		const clash = {
			...manifest,
			Api: { ...manifest.Api, aliases: ['assets'] },
			Assets: { kind: 'file-server', id: 'Assets', of: 'Uploads' },
		} as ConstructManifest;

		expect(() => assertSubdomains(clash)).toThrow(FileServerHostTaken);
	});
});
