import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types';
import { backendsOf, constructGlobs, surfaceAddresses } from '../workspace';

/** A workspace deploying to `target`, declaring nothing. */
function deployingTo(target?: 'dokploy'): NormalizedWorkspace {
	return {
		stages: { local: 'development', deployed: ['production'] },
		name: 'test',
		root: '/tmp/test',
		apps: {},
		deploy: target ? { default: target } : {},
		shared: { packages: [] },
		secrets: {},
	} as NormalizedWorkspace;
}

/**
 * The backends reconcile plans with come from where the project deploys —
 * there is no `services:` block left to name one.
 */
describe('backendsOf', () => {
	it('keeps a server project on the Postgres it already runs', () => {
		expect(backendsOf(deployingTo('dokploy'))).toEqual({
			events: 'pgboss',
			cache: 'db',
		});
	});

	it('gives an AWS project the protocols it deploys to', () => {
		// The same backends locally as deployed: the emulator stands in for
		// SNS, and the cache speaks the Upstash protocol.
		expect(backendsOf(deployingTo())).toEqual({
			events: 'sns',
			cache: 'upstash',
		});
	});
});

/**
 * Where a workspace's constructs live.
 *
 * Infrastructure is a fact about the product, not about the process that
 * imports it — so a database two apps share is declared once, at the top. An
 * app's own glob is additive rather than replaced, for something only it uses.
 */
describe('constructGlobs', () => {
	const ws = (overrides: Partial<NormalizedWorkspace>): NormalizedWorkspace =>
		({
			name: 'shop',
			root: '/ws',
			apps: {},
			deploy: { default: 'dokploy' },
			shared: { packages: [] },
			secrets: {},
			...overrides,
		}) as NormalizedWorkspace;

	it('resolves the workspace glob against the workspace root', () => {
		expect(constructGlobs(ws({ constructs: './constructs/**/*.ts' }))).toEqual([
			'/ws/constructs/**/*.ts',
		]);
	});

	it('keeps an app glob alongside it, resolved against the app', () => {
		// Additive, so adopting a shared folder does not silently drop whatever
		// an app was already declaring for itself.
		const globs = constructGlobs(
			ws({
				constructs: './constructs/**/*.ts',
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						resolvedDeployTarget: 'dokploy',
						constructs: './src/**/*.ts',
					},
				} as NormalizedWorkspace['apps'],
			}),
		);

		expect(globs).toEqual([
			'/ws/constructs/**/*.ts',
			'/ws/apps/api/src/**/*.ts',
		]);
	});

	it('is empty for a workspace that declares nothing', () => {
		// The hard switch reconcile reads: a project that has not adopted
		// constructs is untouched.
		expect(constructGlobs(ws({}))).toEqual([]);
	});
});

/**
 * Where each declared surface and site answers: at the port the workspace gave
 * the app serving it, and nowhere when no app serves it.
 */
describe('surfaceAddresses', () => {
	const manifest = {
		Api: {
			kind: 'rest-api',
			id: 'Api',
			path: '.',
			endpoints: [],
			provides: ['API_URL'],
		},
		Console: {
			kind: 'site',
			id: 'Console',
			variant: 'static',
			app: { path: 'apps/console' },
			dependencies: [],
			provides: ['CONSOLE_URL'],
		},
		Billing: {
			kind: 'rest-api',
			id: 'Billing',
			path: '.',
			endpoints: [],
			provides: ['BILLING_URL'],
		},
		Orders: { kind: 'database', id: 'Orders', provides: ['ORDERS_URL'] },
	} as unknown as ConstructManifest;

	const workspace = {
		name: 'shop',
		root: '/ws',
		apps: {
			api: { type: 'backend', path: 'apps/api', port: 3000 },
			console: { type: 'frontend', path: 'apps/console', port: 3001 },
		},
	} as unknown as NormalizedWorkspace;

	it('addresses a surface and a site at their apps, skipping the unserved', () => {
		// Billing has no app in the workspace, and a database is not a surface.
		expect(surfaceAddresses(workspace, manifest)).toEqual({
			Api: 'http://localhost:3000',
			Console: 'http://localhost:3001',
		});
	});

	it('addresses apps however the caller reaches them', () => {
		expect(
			surfaceAddresses(
				workspace,
				manifest,
				(app, port) => `http://${app}:${port}`,
			),
		).toEqual({ Api: 'http://api:3000', Console: 'http://console:3001' });
	});
});
