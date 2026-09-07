import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types';
import { turboFilters, writeTurboConfigs } from '../index';

/**
 * A repo with a turbo root above the workspace, which is the layout that made
 * this necessary: an app's constructs live above the app, and turbo hashes a
 * package's own files.
 */
let root: string;
let wsRoot: string;

const workspace = (
	apps: Record<string, unknown>,
	constructs?: string,
): NormalizedWorkspace =>
	({
		name: 'shop',
		root: wsRoot,
		apps,
		...(constructs ? { constructs } : {}),
		services: {},
		deploy: { default: 'dokploy' },
		shared: { packages: [] },
		secrets: {},
	}) as unknown as NormalizedWorkspace;

const app = (path: string, type = 'backend') => ({
	type,
	path,
	port: 3000,
	dependencies: [],
	resolvedDeployTarget: 'dokploy',
});

/** An app directory that is a real package, since turbo only runs packages. */
function packageAt(path: string, name: string): void {
	const dir = join(wsRoot, path);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }));
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'turbo-config-'));
	writeFileSync(join(root, 'turbo.json'), '{"tasks":{"build":{}}}');
	wsRoot = join(root, 'apps', 'shop');
	mkdirSync(wsRoot, { recursive: true });
});

describe('turboFilters', () => {
	it('names each app by the package name turbo knows it by', () => {
		packageAt('apps/api', '@shop/api');
		packageAt('apps/web', '@shop/web');

		const { filters, unpackaged } = turboFilters(
			workspace({ api: app('apps/api'), web: app('apps/web', 'web') }),
		);

		expect(filters.sort()).toEqual(['@shop/api', '@shop/web']);
		expect(unpackaged).toEqual([]);
	});

	it('reports an app that is not a package rather than skipping it', () => {
		// Silently dropping it deploys nothing and says nothing.
		packageAt('apps/api', '@shop/api');

		const { filters, unpackaged } = turboFilters(
			workspace({ api: app('apps/api'), web: app('apps/web', 'web') }),
		);

		expect(filters).toEqual(['@shop/api']);
		expect(unpackaged).toEqual(['web']);
	});

	it('reports a package.json with no name', () => {
		mkdirSync(join(wsRoot, 'apps/api'), { recursive: true });
		writeFileSync(join(wsRoot, 'apps/api/package.json'), '{"private":true}');

		expect(
			turboFilters(workspace({ api: app('apps/api') })).unpackaged,
		).toEqual(['api']);
	});
});

describe('writeTurboConfigs', async () => {
	it('names the workspace constructs as inputs, above the package', async () => {
		// The whole point: turbo hashes a package's own files, so without this an
		// edit to a construct leaves the cached build in place.
		packageAt('apps/api', '@shop/api');
		writeFileSync(join(wsRoot, 'gkm.config.ts'), 'export default {}');

		await writeTurboConfigs(
			workspace({ api: app('apps/api') }, './constructs/**/*.ts'),
		);

		const written = JSON.parse(
			readFileSync(join(wsRoot, 'apps/api/turbo.json'), 'utf8').replace(
				/^\s*\/\/.*$/gm,
				'',
			),
		);

		expect(written.tasks.build.inputs).toContain('$TURBO_DEFAULT$');
		expect(written.tasks.build.inputs).toContain(
			'$TURBO_ROOT$/apps/shop/constructs/**/*.ts',
		);
		expect(written.tasks.build.inputs).toContain(
			'$TURBO_ROOT$/apps/shop/gkm.config.ts',
		);
		expect(written.tasks.build.outputs).toEqual(['.gkm/**']);
	});

	it('declares the outputs each kind of app actually produces', async () => {
		packageAt('apps/web', '@shop/web');

		await writeTurboConfigs(
			workspace({ web: app('apps/web', 'web') }, './constructs/**/*.ts'),
		);

		const written = JSON.parse(
			readFileSync(join(wsRoot, 'apps/web/turbo.json'), 'utf8').replace(
				/^\s*\/\/.*$/gm,
				'',
			),
		);

		expect(written.tasks.build.outputs).toEqual([
			'dist/**',
			'.next/**',
			'!.next/cache/**',
		]);
	});

	it('leaves a file someone has taken ownership of', async () => {
		packageAt('apps/api', '@shop/api');
		const file = join(wsRoot, 'apps/api/turbo.json');
		writeFileSync(file, '{"mine":true}');

		await writeTurboConfigs(
			workspace({ api: app('apps/api') }, './constructs/**/*.ts'),
		);

		expect(readFileSync(file, 'utf8')).toBe('{"mine":true}');
	});

	it('writes nothing when no constructs are declared', async () => {
		// Nothing above the package to hash, so nothing to say.
		packageAt('apps/api', '@shop/api');

		await writeTurboConfigs(workspace({ api: app('apps/api') }));

		expect(() =>
			readFileSync(join(wsRoot, 'apps/api/turbo.json'), 'utf8'),
		).toThrow();
	});

	it('skips an app that is not a package', async () => {
		mkdirSync(join(wsRoot, 'apps/api'), { recursive: true });

		await writeTurboConfigs(
			workspace({ api: app('apps/api') }, './constructs/**/*.ts'),
		);

		expect(() =>
			readFileSync(join(wsRoot, 'apps/api/turbo.json'), 'utf8'),
		).toThrow();
	});
});
