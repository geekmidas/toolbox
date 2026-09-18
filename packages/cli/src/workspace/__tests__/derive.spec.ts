import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { DEFAULT_APP_CODE } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { appKey, derivedApps, hostOf, resolveAppSpec } from '../derive';
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

	it('gives an authenticator its own app without being asked', () => {
		// `.auth()` used to be enough to make Auth share the API's container,
		// and then — briefly — enough to make it an error. Neither: sharing a
		// process shares a filesystem, an environment and every credential
		// either surface holds, so Auth simply gets its own.
		const manifest = {
			Api: surface('Api', { app: { path: 'apps/api' }, auth: 'Auth' }),
			Auth: surface('Auth'),
		} as unknown as ConstructManifest;

		const apps = derivedApps(manifest, workspace());

		expect(Object.keys(apps).sort()).toEqual(['api', 'auth']);
		expect(apps.auth?.type).toBe('backend');
	});

	it('gives an auth server its own container once it has an app', () => {
		const manifest = {
			Api: surface('Api', { app: { path: 'apps/api' } }),
			Auth: surface('Auth', { app: { path: 'apps/auth' } }),
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

	it('points an edge at the container that serves the surface', () => {
		// `Web` calls `Auth`, which has its own container — so the edge resolves
		// to `auth`, and the build order says web waits on it.
		const manifest = {
			Api: surface('Api', { app: { path: 'apps/api' }, auth: 'Auth' }),
			Auth: surface('Auth', { app: { path: 'apps/auth' } }),
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

	it('does not treat `.auth()` as a place to run', () => {
		// Auth hosts itself, not the API that authenticates against it.
		const manifest = {
			Api: surface('Api', { app: { path: 'apps/api' }, auth: 'Auth' }),
			Auth: surface('Auth'),
		} as unknown as ConstructManifest;

		expect(hostOf(manifest, 'Auth')).toBe('Auth');
	});

	it('answers with the surface itself even when it named no app', () => {
		// `app` is an override, so having none is the ordinary case rather
		// than a surface with nowhere to run.
		const manifest = {
			A: surface('A'),
		} as unknown as ConstructManifest;

		expect(hostOf(manifest, 'A')).toBe('A');
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

describe('resolveAppSpec', () => {
	/** A workspace root with `apps/<name>` actually present. */
	const rootWith = (...names: string[]): string => {
		const root = mkdtempSync(join(tmpdir(), 'gkm-derive-'));
		for (const name of names)
			mkdirSync(join(root, 'apps', name), { recursive: true });
		return root;
	};

	it('reads the path off the id when the directory is there', () => {
		const root = rootWith('api');

		expect(resolveAppSpec('Api', true, root, 'rest-api').path).toBe('apps/api');
	});

	it('falls back to the workspace root for a single-app project', () => {
		// No `apps/` at all: one app, and it is the project.
		const root = mkdtempSync(join(tmpdir(), 'gkm-derive-'));

		expect(resolveAppSpec('Api', true, root, 'rest-api').path).toBe('.');
	});

	it('kebab-cases a multi-word id the way every other physical name is', () => {
		const root = rootWith('admin-api');

		expect(resolveAppSpec('AdminApi', true, root, 'rest-api').path).toBe(
			'apps/admin-api',
		);
	});

	it('keeps a path that was written down', () => {
		const root = rootWith('api');

		expect(
			resolveAppSpec('Api', { path: 'services/api' }, root, 'rest-api').path,
		).toBe('services/api');
	});

	it('gives a surface the conventional code glob', () => {
		const root = rootWith('api');

		expect(resolveAppSpec('Api', true, root, 'rest-api').code).toBe(
			DEFAULT_APP_CODE,
		);
	});

	it('does not default the glob over one that was given', () => {
		const root = rootWith('api');

		expect(
			resolveAppSpec('Api', { code: './src/**/*.ts' }, root, 'rest-api').code,
		).toBe('./src/**/*.ts');
	});

	it('leaves the glob alone when a per-kind field named one', () => {
		// The per-kind fields still win, so defaulting `code` here would add a
		// second pattern the first one has to be reconciled with.
		const root = rootWith('api');
		const spec = resolveAppSpec(
			'Api',
			{ routes: './src/endpoints/**/*.ts' },
			root,
			'rest-api',
		);

		expect(spec.code).toBeUndefined();
		expect(spec.routes).toBe('./src/endpoints/**/*.ts');
	});

	it("gives a site no code glob — its build is its framework's", () => {
		const root = rootWith('web');

		expect(resolveAppSpec('Web', true, root, 'site').code).toBeUndefined();
	});
});
