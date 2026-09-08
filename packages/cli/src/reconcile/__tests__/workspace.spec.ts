import { describe, expect, it } from 'vitest';
import type {
	NormalizedWorkspace,
	ServicesConfig,
} from '../../workspace/types';
import { constructGlobs, imagePins } from '../workspace';

/** A workspace that declares nothing but the services under test. */
function workspaceWith(services: ServicesConfig): NormalizedWorkspace {
	return {
		name: 'test',
		root: '/tmp/test',
		apps: {},
		services,
		deploy: { default: 'dokploy' },
		shared: { packages: [] },
		secrets: {},
	};
}

/**
 * `extraContainers` used to live here, and its removal is the point.
 *
 * It existed so `services: { cache: true }` could start a Redis for a project
 * that declared no cache — the last way a container could exist because config
 * asked for one rather than because something declared it. A declared cache
 * implies its container the way a declared database implies Postgres, so there
 * is no longer a second list to keep in step with the first.
 */
describe('imagePins', () => {
	it('reads a whole image reference, per container', () => {
		expect(
			imagePins(workspaceWith({ images: { redis: 'redis:7-alpine' } })),
		).toEqual({ redis: 'redis:7-alpine' });
	});

	it('is empty when nothing is pinned', () => {
		expect(imagePins(workspaceWith({}))).toEqual({});
	});

	it('is not the same key as the backend name beside it', () => {
		// The two answer unrelated questions — where a cache lives, and which
		// image runs locally — and sharing one key is what made `cache: true`
		// mean "start a Redis". Naming a backend pins nothing.
		expect(imagePins(workspaceWith({ cache: 'db' }))).toEqual({});
		expect(
			imagePins(
				workspaceWith({ cache: 'elasticache', images: { redis: 'redis:6' } }),
			),
		).toEqual({ redis: 'redis:6' });
	});

	it('accepts a pin for a container nothing declares, and does nothing with it', () => {
		// A no-op rather than an error: it says which image *would* run, and
		// whether anything runs is not this key's question.
		expect(
			imagePins(workspaceWith({ images: { minio: 'minio/minio:RELEASE' } })),
		).toEqual({ minio: 'minio/minio:RELEASE' });
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
			services: {},
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
