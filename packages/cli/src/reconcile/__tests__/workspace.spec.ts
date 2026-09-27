import { describe, expect, it } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types';
import { backendsOf, constructGlobs } from '../workspace';

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
