import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types';
import { APPS_PROFILE, appServices, inNetworkEnv } from '../apps';

/**
 * A database that is not called `Database`, and a schema tenant inside it —
 * the two cases the old hand-written compose got wrong: it wired every app to
 * `DATABASE_URL` at `postgres:5432/app`, whatever the project declared.
 */
const manifest = {
	Orders: { kind: 'database', id: 'Orders', provides: ['ORDERS_URL'] },
	Auth: {
		kind: 'database-schema',
		id: 'Auth',
		of: 'Orders',
		schema: 'auth',
		provides: ['AUTH_URL'],
	},
} as unknown as ConstructManifest;

const workspace = {
	name: 'shop',
	root: '/tmp/shop',
	stages: { local: 'dev', deployed: ['prod'] },
	deploy: { default: 'dokploy' },
	shared: { packages: [] },
	secrets: {},
	apps: {
		api: {
			type: 'backend',
			path: 'apps/api',
			port: 3000,
			dependencies: [],
			resolvedDeployTarget: 'dokploy',
		},
		mobile: {
			type: 'mobile',
			path: 'apps/mobile',
			port: 8081,
			dependencies: [],
			resolvedDeployTarget: 'dokploy',
		},
	},
} as unknown as NormalizedWorkspace;

describe('inNetworkEnv', () => {
	it('gives each construct its own key, at the container on the network', () => {
		const env = inNetworkEnv(workspace, manifest);

		expect(env.ORDERS_URL).toMatch(/^postgres(ql)?:\/\/[^@]+@postgres:5432\//);
		expect(env.AUTH_URL).toMatch(/@postgres:5432\//);
		// Nothing the project did not declare.
		expect(env).not.toHaveProperty('DATABASE_URL');
		expect(env).not.toHaveProperty('REDIS_URL');
	});

	it('never points an app at the host', () => {
		const env = inNetworkEnv(workspace, manifest);

		for (const value of Object.values(env)) {
			expect(value).not.toMatch(/localhost:\d+|127\.0\.0\.1:\d+/);
		}
	});

	it('addresses the local stage, whatever stage is being reconciled', () => {
		// `gkm test` rewrites the same file; the apps must still point at the
		// local stage's databases, not the test stage's suffixed ones.
		const env = inNetworkEnv(workspace, manifest);

		expect(env.ORDERS_URL).not.toMatch(/_test\b|-test\b/);
	});
});

describe('appServices', () => {
	it('builds each app from its Dockerfile, behind the apps profile', () => {
		const services = appServices(workspace, manifest, ['postgres']);

		expect(Object.keys(services)).toEqual(['api']);
		expect(services.api).toMatchObject({
			build: { context: '.', dockerfile: '.gkm/docker/Dockerfile.api' },
			profiles: [APPS_PROFILE],
			ports: ['3000:3000'],
			depends_on: ['postgres'],
		});
		expect(services.api?.environment).toMatchObject({
			NODE_ENV: 'production',
			PORT: '3000',
		});
		expect(services.api?.environment?.ORDERS_URL).toContain('@postgres:5432/');
	});

	it('builds a single-app project from its one Dockerfile', () => {
		const single = {
			...workspace,
			apps: {
				api: { ...workspace.apps.api, path: '.' },
			},
		} as NormalizedWorkspace;

		expect(appServices(single, manifest, []).api?.build?.dockerfile).toBe(
			'.gkm/docker/Dockerfile',
		);
	});

	it('does not depend on the local edge, which fronts the browser', () => {
		const services = appServices(workspace, manifest, ['caddy', 'postgres']);

		expect(services.api?.depends_on).toEqual(['postgres']);
	});
});
