import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types';
import { deployUnits } from '../index';

/**
 * What gets a container is a declaration, not a config entry.
 *
 * The config used to decide, which is why a declared site nobody had listed as
 * an app was silently never deployed — and why a second surface could not be
 * its own process, because a surface is not an app and the list was apps.
 */
const workspace = {
	name: 'shop',
	root: '/tmp/shop',
	apps: {
		api: {
			type: 'backend',
			path: '.',
			port: 3000,
			dependencies: [],
			resolvedDeployTarget: 'dokploy',
		},
	},
	services: {},
	deploy: { default: 'dokploy' },
	shared: { packages: [] },
	secrets: {},
} as unknown as NormalizedWorkspace;

const surface = (id: string, path?: string) =>
	({ kind: 'rest-api', id, endpoints: [], ...(path ? { path } : {}) }) as const;

describe('deployUnits', () => {
	it('deploys a site the config never mentioned', () => {
		// The frontend gap: `Web` is declared, carries its own path and variant,
		// and was not in `workspace.apps` — so nothing ever built it.
		const manifest = {
			Web: {
				kind: 'site',
				id: 'Web',
				variant: 'static',
				path: '../web',
				dependencies: [],
			},
		} as unknown as ConstructManifest;

		const units = deployUnits(manifest, workspace);

		expect(units.web?.type).toBe('web');
		expect(units.web?.path).toBe('../web');
		expect(units.web?.framework).toBe('vite');
	});

	it('gives a surface its own container once it says where it is built from', () => {
		const manifest = {
			Api: surface('Api', 'apps/api'),
			Auth: surface('Auth', 'apps/auth'),
		} as unknown as ConstructManifest;

		expect(Object.keys(deployUnits(manifest, workspace)).sort()).toEqual([
			'api',
			'auth',
		]);
	});

	it('does not deploy one app twice for two surfaces it serves', () => {
		// Both are served by one process until the build emits a bundle per
		// surface. A unit each would deploy that whole app twice under two
		// names — worse than the shared container it was meant to replace.
		const manifest = {
			Api: surface('Api'),
			Auth: surface('Auth'),
		} as unknown as ConstructManifest;

		expect(Object.keys(deployUnits(manifest, workspace))).toEqual(['api']);
	});

	it('keeps what the config said about how to run a unit', () => {
		// The manifest says *what* to deploy; the config still says how. A
		// configured app is matched to its site by path, the one thing both name.
		const configured = {
			...workspace,
			apps: {
				...workspace.apps,
				web: {
					type: 'web',
					path: '../web',
					port: 4321,
					framework: 'nextjs',
					dependencies: [],
					resolvedDeployTarget: 'dokploy',
				},
			},
		} as unknown as NormalizedWorkspace;

		const manifest = {
			Web: {
				kind: 'site',
				id: 'Web',
				variant: 'static',
				path: '../web',
				dependencies: [],
			},
		} as unknown as ConstructManifest;

		const units = deployUnits(manifest, configured);

		expect(units.web?.port).toBe(4321);
		expect(units.web?.framework).toBe('nextjs');
	});

	it('leaves a project that declares no surfaces alone', () => {
		// Adopting constructs stays something done a piece at a time.
		expect(deployUnits({} as ConstructManifest, workspace)).toEqual({});
	});
});
