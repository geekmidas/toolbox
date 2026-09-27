import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types';
import { turboFilters } from '../index';

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
