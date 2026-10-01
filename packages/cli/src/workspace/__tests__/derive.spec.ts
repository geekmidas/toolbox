import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { appKey, derivedApps, hostOf } from '../derive';
import type { NormalizedWorkspace } from '../types';

/**
 * A workspace that declares no apps of its own.
 *
 * The normal case now: a `site` is an app and so is every `rest-api`, so the
 * list is read off the graph rather than written down.
 */
const workspace = (
	apps: Record<string, unknown> = {},
	root = '/tmp/shop',
): NormalizedWorkspace =>
	({
		name: 'shop',
		root,
		apps,
		deploy: { default: 'dokploy' },
		shared: { packages: [] },
		secrets: {},
	}) as unknown as NormalizedWorkspace;

const site = (
	id: string,
	app: Record<string, unknown>,
	extra: Record<string, unknown> = {},
) =>
	({
		kind: 'site',
		id,
		variant: 'static',
		app,
		dependencies: [],
		...extra,
	}) as const;

const surface = (id: string, extra: Record<string, unknown> = {}) =>
	({
		kind: 'rest-api',
		id,
		path: `apps/${id.toLowerCase()}`,
		endpoints: [],
		...extra,
	}) as const;

describe('derivedApps', () => {
	it('turns a site into an app the config never mentioned', () => {
		const manifest = {
			Web: site('Web', { path: 'apps/web' }),
		} as unknown as ConstructManifest;

		const apps = derivedApps(manifest, workspace());

		expect(apps.web).toMatchObject({
			type: 'web',
			path: 'apps/web',
			framework: 'vite',
		});
	});

	it('reads the framework off the variant rather than off config', () => {
		const manifest = {
			Web: site('Web', { path: 'apps/web' }),
			Admin: site('Admin', { path: 'apps/admin' }, { variant: 'next' }),
			Shop: site('Shop', { path: 'apps/shop' }, { variant: 'tanstack' }),
		} as unknown as ConstructManifest;

		const apps = derivedApps(manifest, workspace());

		expect(apps.web?.framework).toBe('vite');
		expect(apps.admin?.framework).toBe('nextjs');
		expect(apps.shop?.framework).toBe('tanstack-start');
	});

	it('places a surface at the path it declared, not where its id says', () => {
		// Nothing is inferred from the id or from what is on disk.
		const manifest = {
			Api: surface('Api', { path: 'services/public-api' }),
		} as unknown as ConstructManifest;

		expect(derivedApps(manifest, workspace()).api).toMatchObject({
			type: 'backend',
			path: 'services/public-api',
		});
	});

	it('carries the telescope a surface streams into', () => {
		const manifest = {
			Api: surface('Api', { telescope: true }),
		} as unknown as ConstructManifest;

		expect(derivedApps(manifest, workspace()).api?.telescope).toBe(true);
	});

	it('no longer fans a code glob into a field per kind', () => {
		// Six globs was six things to keep in step. One glob loads everything and
		// each generator picks out what it recognises, so an app carries none.
		const manifest = {
			Api: surface('Api'),
		} as unknown as ConstructManifest;

		const app = derivedApps(manifest, workspace()).api!;

		for (const kind of [
			'routes',
			'functions',
			'crons',
			'queues',
			'topics',
			'subscribers',
			'envParser',
			'logger',
		]) {
			expect(kind in app).toBe(false);
		}
	});

	it('gives an authenticator its own app without being asked', () => {
		// `.auth()` used to be enough to make Auth share the API's container,
		// and then — briefly — enough to make it an error. Neither: sharing a
		// process shares a filesystem, an environment and every credential
		// either surface holds, so Auth simply gets its own.
		const manifest = {
			Api: surface('Api', { auth: 'Auth' }),
			Auth: surface('Auth'),
		} as unknown as ConstructManifest;

		const apps = derivedApps(manifest, workspace());

		expect(Object.keys(apps).sort()).toEqual(['api', 'auth']);
		expect(apps.auth?.type).toBe('backend');
	});

	it('gives every surface its own container', () => {
		const manifest = {
			Api: surface('Api'),
			Auth: surface('Auth'),
		} as unknown as ConstructManifest;

		expect(Object.keys(derivedApps(manifest, workspace())).sort()).toEqual([
			'api',
			'auth',
		]);
	});

	it('assigns ports so that adding a site does not renumber the others', () => {
		// Backends, then the site holding the base domain, then the rest
		// alphabetically. A port that moves when an unrelated app appears is a
		// port nobody can bookmark.
		const manifest = {
			Api: surface('Api'),
			Web: site('Web', { path: 'apps/web' }),
			Admin: site('Admin', { path: 'apps/admin' }),
		} as unknown as ConstructManifest;

		const apps = derivedApps(manifest, workspace());

		expect(apps.api?.port).toBe(3000);
		expect(apps.web?.port).toBe(3001);
		expect(apps.admin?.port).toBe(3002);
	});

	it('keeps a port a site asked for, and works around it', () => {
		const manifest = {
			Api: surface('Api'),
			Web: site('Web', { path: 'apps/web', port: 3000 }),
		} as unknown as ConstructManifest;

		const apps = derivedApps(manifest, workspace());

		expect(apps.web?.port).toBe(3000);
		expect(apps.api?.port).not.toBe(3000);
	});

	it('gives the base domain to the site called web', () => {
		const manifest = {
			Web: site('Web', { path: 'apps/web' }),
			Admin: site('Admin', { path: 'apps/admin' }),
		} as unknown as ConstructManifest;

		const apps = derivedApps(manifest, workspace());

		expect(apps.web?.root).toBe(true);
		expect(apps.admin?.root).toBeUndefined();
	});

	it('lets a site claim the base domain when none is called web', () => {
		const manifest = {
			Storefront: site(
				'Storefront',
				{ path: 'apps/storefront' },
				{
					root: true,
				},
			),
			Admin: site('Admin', { path: 'apps/admin' }),
		} as unknown as ConstructManifest;

		const apps = derivedApps(manifest, workspace());

		expect(apps.storefront?.root).toBe(true);
		expect(apps.admin?.root).toBeUndefined();
	});

	it('needs no such claim when there is only one site', () => {
		const manifest = {
			Storefront: site('Storefront', { path: 'apps/storefront' }),
		} as unknown as ConstructManifest;

		expect(derivedApps(manifest, workspace()).storefront?.root).toBe(true);
	});

	it('reads build order off the edges rather than a hand-kept list', () => {
		const manifest = {
			Api: surface('Api'),
			Web: site(
				'Web',
				{ path: 'apps/web' },
				{
					dependencies: [{ target: 'Api', kind: 'rest-api' }],
				},
			),
		} as unknown as ConstructManifest;

		expect(derivedApps(manifest, workspace()).web?.dependencies).toEqual([
			'api',
		]);
	});

	it('points an edge at the container that serves the surface', () => {
		// `Web` calls `Auth`, which has its own container — so the edge resolves
		// to `auth`, and the build order says web waits on it.
		const manifest = {
			Api: surface('Api', { auth: 'Auth' }),
			Auth: surface('Auth'),
			Web: site(
				'Web',
				{ path: 'apps/web' },
				{
					dependencies: [{ target: 'Auth', kind: 'rest-api' }],
				},
			),
		} as unknown as ConstructManifest;

		expect(derivedApps(manifest, workspace()).web?.dependencies).toEqual([
			'auth',
		]);
	});

	it('never makes an app depend on itself', () => {
		const manifest = {
			Api: surface('Api', {
				calls: [{ target: 'Api', kind: 'rest-api' }],
			}),
		} as unknown as ConstructManifest;

		expect(derivedApps(manifest, workspace()).api?.dependencies).toEqual([]);
	});

	it('keeps an app the graph knows nothing about', () => {
		// Config is still the escape hatch for what no construct describes.
		const configured = {
			mobile: {
				type: 'mobile',
				path: 'apps/mobile',
				port: 8081,
				dependencies: [],
				resolvedDeployTarget: 'dokploy',
			},
		};

		const apps = derivedApps({} as ConstructManifest, workspace(configured));

		expect(apps.mobile).toMatchObject({ type: 'mobile', path: 'apps/mobile' });
	});

	it('lets config override one field without restating the app', () => {
		const configured = {
			web: {
				type: 'web',
				path: 'apps/web',
				port: 4321,
				framework: 'nextjs',
				dependencies: [],
				resolvedDeployTarget: 'vercel',
			},
		};

		const manifest = {
			Web: site('Web', { path: 'apps/web' }),
		} as unknown as ConstructManifest;

		const apps = derivedApps(manifest, workspace(configured));

		expect(apps.web?.port).toBe(4321);
		expect(apps.web?.framework).toBe('nextjs');
		expect(apps.web?.resolvedDeployTarget).toBe('vercel');
		// Still derived — the manifest says what it is.
		expect(apps.web?.type).toBe('web');
	});

	it('leaves a project that declares nothing alone', () => {
		expect(derivedApps({} as ConstructManifest, workspace())).toEqual({});
	});
});

describe('hostOf', () => {
	it('answers with the surface itself', () => {
		const manifest = {
			Api: surface('Api'),
		} as unknown as ConstructManifest;

		expect(hostOf(manifest, 'Api')).toBe('Api');
	});

	it('does not treat `.auth()` as a place to run', () => {
		// Auth hosts itself, not the API that authenticates against it.
		const manifest = {
			Api: surface('Api', { auth: 'Auth' }),
			Auth: surface('Auth'),
		} as unknown as ConstructManifest;

		expect(hostOf(manifest, 'Auth')).toBe('Auth');
	});

	it('answers with nothing for a kind that is not a surface', () => {
		const manifest = {
			Web: site('Web', { path: 'apps/web' }),
		} as unknown as ConstructManifest;

		expect(hostOf(manifest, 'Web')).toBeUndefined();
		expect(hostOf(manifest, 'Nothing')).toBeUndefined();
	});
});

describe('appKey', () => {
	it('is the kebab form every physical name is built from', () => {
		expect(appKey('Api')).toBe('api');
		expect(appKey('AdminConsole')).toBe('admin-console');
	});
});

describe('a mobile app', () => {
	const manifest = {
		Api: surface('Api'),
		App: {
			kind: 'mobile-app',
			id: 'App',
			flavour: 'expo',
			app: { path: 'apps/app' },
			dependencies: [{ target: 'Api', kind: 'rest-api' }],
			provides: ['APP_SCHEME'],
		},
	} as unknown as ConstructManifest;

	it('is an Expo app at the path it declared', () => {
		expect(derivedApps(manifest, workspace()).app).toMatchObject({
			type: 'mobile',
			framework: 'expo',
			path: 'apps/app',
		});
	});

	it('takes none of the ports the servers answer on — Metro has its own', () => {
		const apps = derivedApps(manifest, workspace());

		expect(apps.app?.port).toBe(0);
		expect(apps.api?.port).toBe(3000);
	});
});
