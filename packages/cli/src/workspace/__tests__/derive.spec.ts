import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { appKey, derivedApps, hostOf } from '../derive';
import type { NormalizedWorkspace } from '../types';

/**
 * A workspace that declares no apps of its own.
 *
 * The normal case now: a `site` is an app and so is a `rest-api` that named
 * one, so the list is read off the graph rather than written down.
 */
const workspace = (apps: Record<string, unknown> = {}): NormalizedWorkspace =>
	({
		name: 'shop',
		root: '/tmp/shop',
		apps,
		services: {},
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
	({ kind: 'rest-api', id, endpoints: [], ...extra }) as const;

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

	it('carries an app spec onto the app it describes', () => {
		const manifest = {
			Api: surface('Api', {
				app: {
					path: 'apps/api',
					routes: './endpoints/**/*.ts',
					crons: './crons/**/*.ts',
					envParser: './config/env#envParser',
					runtime: 'bun',
					openapi: true,
					env: ['.env'],
				},
			}),
		} as unknown as ConstructManifest;

		const apps = derivedApps(manifest, workspace());

		expect(apps.api).toMatchObject({
			type: 'backend',
			path: 'apps/api',
			routes: './endpoints/**/*.ts',
			crons: './crons/**/*.ts',
			envParser: './config/env#envParser',
			runtime: 'bun',
			openapi: true,
			env: ['.env'],
		});
		// Absent from the spec, so absent from the app — rather than present and
		// undefined, which reads as "configured to nothing".
		expect('functions' in apps.api!).toBe(false);
	});

	it('gives no app to a surface that declared none', () => {
		// The auth-server arrangement: `Auth` is served by the API that named it,
		// so it is not a second container nobody asked for.
		const manifest = {
			Api: surface('Api', { app: { path: 'apps/api' }, auth: 'Auth' }),
			Auth: surface('Auth'),
		} as unknown as ConstructManifest;

		expect(Object.keys(derivedApps(manifest, workspace()))).toEqual(['api']);
	});

	it('assigns ports so that adding a site does not renumber the others', () => {
		// Backends, then the site holding the base domain, then the rest
		// alphabetically. A port that moves when an unrelated app appears is a
		// port nobody can bookmark.
		const manifest = {
			Api: surface('Api', { app: { path: 'apps/api' } }),
			Web: site('Web', { path: 'apps/web' }),
			Admin: site('Admin', { path: 'apps/admin' }),
		} as unknown as ConstructManifest;

		const apps = derivedApps(manifest, workspace());

		expect(apps.api?.port).toBe(3000);
		expect(apps.web?.port).toBe(3001);
		expect(apps.admin?.port).toBe(3002);
	});

	it('keeps a port a construct asked for, and works around it', () => {
		const manifest = {
			Api: surface('Api', { app: { path: 'apps/api', port: 3001 } }),
			Web: site('Web', { path: 'apps/web' }),
		} as unknown as ConstructManifest;

		const apps = derivedApps(manifest, workspace());

		expect(apps.api?.port).toBe(3001);
		expect(apps.web?.port).not.toBe(3001);
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
			Api: surface('Api', { app: { path: 'apps/api' } }),
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

	it('points an edge at the app that serves a mounted surface', () => {
		// `Web` calls `Auth`, which has no container of its own — so the edge
		// resolves to the API that hosts it, not to an app that does not exist.
		const manifest = {
			Api: surface('Api', { app: { path: 'apps/api' }, auth: 'Auth' }),
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
			'api',
		]);
	});

	it('never makes an app depend on itself', () => {
		const manifest = {
			Api: surface('Api', {
				app: { path: 'apps/api' },
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
	it('answers with the surface itself when it has an app', () => {
		const manifest = {
			Api: surface('Api', { app: { path: 'apps/api' } }),
		} as unknown as ConstructManifest;

		expect(hostOf(manifest, 'Api')).toBe('Api');
	});

	it('follows a mount to the surface that authenticates through it', () => {
		const manifest = {
			Api: surface('Api', { app: { path: 'apps/api' }, auth: 'Auth' }),
			Auth: surface('Auth'),
		} as unknown as ConstructManifest;

		expect(hostOf(manifest, 'Auth')).toBe('Api');
	});

	it('answers with nothing when no surface hosts it', () => {
		const manifest = {
			Auth: surface('Auth'),
		} as unknown as ConstructManifest;

		expect(hostOf(manifest, 'Auth')).toBeUndefined();
	});

	it('terminates on a cycle rather than hanging', () => {
		// Two surfaces naming each other as their authenticator is nonsense, but
		// it is nonsense a config file can express.
		const manifest = {
			A: surface('A', { auth: 'B' }),
			B: surface('B', { auth: 'A' }),
		} as unknown as ConstructManifest;

		expect(hostOf(manifest, 'A')).toBeUndefined();
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
