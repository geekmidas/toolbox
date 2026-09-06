import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import {
	generateNextjsDockerfile,
	generateViteStaticDockerfile,
} from '../../docker/templates';
import type { NormalizedWorkspace } from '../../workspace/types';
import { isMainFrontendApp, resolveHost } from '../domain';
import { deployUnits } from '../index';

/**
 * Two sites, two variants, two hostnames — the case kitchen-sink now runs.
 *
 * A `variant` selects an env prefix and a Dockerfile template, and neither
 * selection means anything until there are two of them to choose between. This
 * is the shape that proves the choice happens rather than being asserted.
 */
const workspace = {
	name: 'acme',
	root: '/tmp/acme',
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
	deploy: {
		default: 'dokploy',
		dokploy: { domains: { production: 'acme.com' } },
	},
	shared: { packages: [] },
	secrets: {},
} as unknown as NormalizedWorkspace;

const manifest = {
	Api: { kind: 'rest-api', id: 'Api', endpoints: [] },
	Web: {
		kind: 'site',
		id: 'Web',
		variant: 'static',
		path: '../acme-web',
		dependencies: [],
	},
	Admin: {
		kind: 'site',
		id: 'Admin',
		variant: 'next',
		path: '../acme-admin',
		dependencies: [],
	},
} as unknown as ConstructManifest;

describe('two sites of different variants', () => {
	const units = deployUnits(manifest, workspace);

	it('each becomes its own deploy unit', () => {
		expect(Object.keys(units).sort()).toEqual(['admin', 'api', 'web']);
	});

	it('carries the framework its variant implies', () => {
		expect(units.web?.framework).toBe('vite');
		expect(units.admin?.framework).toBe('nextjs');
	});

	it('puts the conventional site on the base domain and the other on a subdomain', () => {
		// The construct id is the subdomain — `Admin` is what makes it `admin.`,
		// with no hostname written down anywhere.
		const host = (name: string) =>
			resolveHost(
				name,
				units[name]!,
				'production',
				workspace.deploy?.dokploy,
				isMainFrontendApp(name, units[name]!, units),
			);

		expect(host('web')).toBe('acme.com');
		expect(host('admin')).toBe('admin.acme.com');
		expect(host('api')).toBe('api.acme.com');
	});

	it('builds a static image for one and a server image for the other', () => {
		// The point of two variants: a Vite site is files behind nginx, a Next
		// site is a Node process. One template could not be right for both.
		const opts = {
			imageName: 'x',
			baseImage: 'node:22-alpine',
			port: 3001,
			appPath: 'apps/x',
			turboPackage: '@acme/x',
			packageManager: 'pnpm' as const,
			publicUrlArgs: [],
		};

		expect(generateViteStaticDockerfile(opts)).toMatch(/nginx/i);
		expect(generateNextjsDockerfile(opts)).toMatch(/standalone|server\.js/i);
	});
});
