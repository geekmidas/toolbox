import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { derivedApps } from '../derive';
import {
	assertSubdomains,
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

	it("trusts the endpoint while the surface's globbed routes are not folded in", () => {
		// Discovery leaves a surface's endpoints empty until a build: the site
		// was handed the endpoint, which its construct checked is a GET there.
		const unbuilt = {
			...manifest,
			Api: { ...manifest.Api, endpoints: [] },
		} as ConstructManifest;

		expect(() => assertSubdomains(unbuilt)).not.toThrow();
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
