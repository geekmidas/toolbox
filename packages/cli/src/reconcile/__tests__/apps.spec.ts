import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types';
import { APPS_PROFILE, appServices, inNetworkEnv } from '../apps';
import { TEST_CREDENTIALS } from './__helpers__/credentials';

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
		const env = inNetworkEnv(workspace, manifest, TEST_CREDENTIALS);

		expect(env.ORDERS_URL).toMatch(/^postgres(ql)?:\/\/[^@]+@postgres:5432\//);
		expect(env.AUTH_URL).toMatch(/@postgres:5432\//);
		// Nothing the project did not declare.
		expect(env).not.toHaveProperty('DATABASE_URL');
		expect(env).not.toHaveProperty('REDIS_URL');
	});

	it('never points an app at the host', () => {
		const env = inNetworkEnv(workspace, manifest, TEST_CREDENTIALS);

		for (const value of Object.values(env)) {
			expect(value).not.toMatch(/localhost:\d+|127\.0\.0\.1:\d+/);
		}
	});

	it('addresses the local stage, whatever stage is being reconciled', () => {
		// `gkm test` rewrites the same file; the apps must still point at the
		// local stage's databases, not the test stage's suffixed ones.
		const env = inNetworkEnv(workspace, manifest, TEST_CREDENTIALS);

		expect(env.ORDERS_URL).not.toMatch(/_test\b|-test\b/);
	});
});

/**
 * The graph an app's environment is composed from: an API whose endpoints use
 * the `Auth` tenant — edges the glob finds, not the surface's own node — and a
 * site that calls the API. `Orders` is reached by nothing.
 */
const withApps = {
	...manifest,
	Api: {
		kind: 'rest-api',
		id: 'Api',
		path: 'apps/api',
		endpoints: [],
		provides: ['API_URL', 'API_TRUSTED_ORIGINS', 'API_COOKIE_DOMAIN'],
	},
	Web: {
		kind: 'site',
		id: 'Web',
		variant: 'static',
		app: { path: 'apps/web' },
		dependencies: [{ target: 'Api', kind: 'rest-api' }],
		provides: ['WEB_URL'],
	},
	Signer: {
		kind: 'rest-api',
		id: 'Signer',
		path: 'apps/signer',
		provides: ['SIGNER_URL'],
		endpoints: [
			{
				id: 'SignerHandler',
				handler: 'Signer.handler',
				method: 'ANY',
				path: '/*',
				dependencies: [],
				requires: ['SIGNER_SECRET'],
			},
		],
	},
	SignerSecret: {
		kind: 'secret',
		id: 'SignerSecret',
		provides: ['SIGNER_SECRET'],
	},
} as unknown as ConstructManifest;

const withAppsWorkspace = {
	...workspace,
	apps: {
		api: workspace.apps.api,
		web: { ...workspace.apps.api, type: 'web', path: 'apps/web', port: 3002 },
		signer: { ...workspace.apps.api, path: 'apps/signer', port: 3004 },
	},
} as unknown as NormalizedWorkspace;

/** What the glob found: the API's endpoints use the tenant. */
const runnables = { Api: ['Auth'] };

describe('appServices', () => {
	it('builds each app from its Dockerfile, behind the apps profile', () => {
		const services = appServices(
			withAppsWorkspace,
			withApps,
			['postgres'],
			TEST_CREDENTIALS,
			runnables,
		);

		expect(Object.keys(services)).toEqual(['api', 'web', 'signer']);
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
		expect(services.api?.environment?.AUTH_URL).toContain('@postgres:5432/');
	});

	// Every app used to be handed every key the workspace resolved — a site got
	// the database's owner URL. An app's environment is its edges.
	describe('an app gets what its edges reach, and nothing else', () => {
		const env = (app: string) =>
			appServices(
				withAppsWorkspace,
				withApps,
				['postgres'],
				TEST_CREDENTIALS,
				runnables,
			)[app]?.environment ?? {};

		it('gives the API the tenant its endpoints use, and not the database nothing reaches', () => {
			expect(env('api')).toHaveProperty('AUTH_URL');
			expect(env('api')).toHaveProperty('API_URL');
			expect(env('api')).not.toHaveProperty('ORDERS_URL');
			expect(env('api')).not.toHaveProperty('WEB_URL');
		});

		it('gives a surface what its own handler requires', () => {
			expect(env('signer')).toHaveProperty('SIGNER_SECRET');
			expect(env('signer')).not.toHaveProperty('AUTH_URL');
		});
	});

	// A static bundle is finished when it is built: a public URL handed to its
	// container at runtime reaches nothing, and the site was built against an
	// empty `VITE_API_URL`.
	describe('a site', () => {
		const web = () =>
			appServices(
				withAppsWorkspace,
				withApps,
				['postgres'],
				TEST_CREDENTIALS,
				runnables,
			).web;

		it('is built with its public URLs as build args, at addresses a browser opens', () => {
			expect(web()?.build?.args).toEqual({
				VITE_API_URL: 'http://localhost:3000',
			});
		});

		it('gets no server env and waits on no infrastructure', () => {
			expect(web()?.environment).toBeUndefined();
			expect(web()?.depends_on).toBeUndefined();
		});
	});

	it('builds a single-app project from its one Dockerfile', () => {
		const single = {
			...workspace,
			apps: {
				api: { ...workspace.apps.api, path: '.' },
			},
		} as NormalizedWorkspace;

		expect(
			appServices(single, manifest, [], TEST_CREDENTIALS).api?.build
				?.dockerfile,
		).toBe('.gkm/docker/Dockerfile');
	});

	it('does not depend on the local edge, which fronts the browser', () => {
		const services = appServices(
			workspace,
			manifest,
			['caddy', 'postgres'],
			TEST_CREDENTIALS,
		);

		expect(services.api?.depends_on).toEqual(['postgres']);
	});
});
