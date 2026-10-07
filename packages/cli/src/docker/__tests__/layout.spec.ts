import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
	NormalizedAppConfig,
	NormalizedWorkspace,
} from '../../workspace/types';
import {
	appImageOptions,
	composeBuildPaths,
	constructRoots,
	imageLayout,
	MonorepoNeedsTurbo,
} from '../layout';
import {
	findBuildRoot,
	resolveBuildTools,
	resolveTurboVersion,
	TURBO_VERSION,
} from '../templates';

let root: string;

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-layout-')));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: unknown) {
	const file = join(root, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(
		file,
		typeof content === 'string' ? content : JSON.stringify(content),
	);
}

const app = (
	type: NormalizedAppConfig['type'],
	path: string,
): NormalizedAppConfig =>
	({
		type,
		path,
		port: 3000,
		dependencies: [],
		resolvedDeployTarget: 'dokploy',
	}) as NormalizedAppConfig;

const workspace = (
	at: string,
	apps: Record<string, NormalizedAppConfig>,
): NormalizedWorkspace =>
	({
		name: 'shop',
		root: at,
		apps,
		constructs: ['./constructs/**/*.ts', './apps/*/endpoints/**/*.ts'],
		services: {},
		deploy: { default: 'dokploy' },
		shared: { packages: [] },
		stages: { local: 'dev', deployed: ['prod'] },
		secrets: {},
	}) as unknown as NormalizedWorkspace;

describe('a project of its own', () => {
	beforeEach(() => {
		write('package.json', {
			name: 'shop',
			packageManager: 'pnpm@10.30.1+sha512.deadbeef',
		});
		write('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
		write('pnpm-workspace.yaml', 'packages:\n  - apps/*\n');
		write('turbo.json', '{}');
		write('apps/api/package.json', { name: '@shop/api' });
		write('node_modules/turbo/package.json', { version: '2.6.1' });
	});

	it('is built from its own root, with the tools that root pins', () => {
		const layout = imageLayout(
			workspace(root, { api: app('backend', 'apps/api') }),
		);

		expect(layout.buildRoot).toBe(root);
		expect(layout.gkmRoot).toBe('.');
		expect(layout.workspacePackage).toBeUndefined();
		expect(layout.tools).toEqual({
			packageManager: 'pnpm',
			packageManagerVersion: '10.30.1',
			turboVersion: '2.6.1',
			monorepo: true,
		});
		expect(layout.gkmPaths).toEqual(['gkm.config.*', 'apps', 'constructs']);
	});

	it("gives each app's paths from the root, pruned to its own package", () => {
		const ws = workspace(root, { api: app('backend', 'apps/api') });
		const options = appImageOptions(imageLayout(ws), 'api', ws.apps.api!, root);

		expect(options).toMatchObject({
			appPath: 'apps/api',
			turboPackage: '@shop/api',
			gkmRoot: '.',
			packageManagerVersion: '10.30.1',
			turboVersion: '2.6.1',
		});
		expect(options.prunePackages).toBeUndefined();
	});

	it('refuses a workspace of packages with no turbo.json', () => {
		rmSync(join(root, 'turbo.json'));

		expect(() => imageLayout(workspace(root, {}))).toThrow(MonorepoNeedsTurbo);
	});
});

describe('a gkm workspace nested in a monorepo', () => {
	let shop: string;

	beforeEach(() => {
		write('package.json', { name: 'monorepo', packageManager: 'pnpm@9.15.0' });
		write('pnpm-workspace.yaml', 'packages:\n  - examples/**\n');
		write(
			'pnpm-lock.yaml',
			"lockfileVersion: '9.0'\npackages:\n\n  turbo@2.5.8:\n    resolution: {}\n",
		);
		write('turbo.json', '{}');
		// The workspace is a package of the monorepo's, with no lockfile of its
		// own: its dependencies are the monorepo's `workspace:*` packages.
		write('examples/shop/package.json', { name: '@shop/workspace' });
		write('examples/shop/apps/api/package.json', { name: '@shop/api' });
		write('examples/shop/apps/web/package.json', { name: '@shop/web' });
		shop = join(root, 'examples/shop');
	});

	it("is built from the monorepo's root", () => {
		expect(findBuildRoot(shop)).toBe(root);
		expect(findBuildRoot(join(shop, 'apps/api'))).toBe(root);

		const layout = imageLayout(workspace(shop, {}));
		expect(layout.buildRoot).toBe(root);
		expect(layout.gkmRoot).toBe('examples/shop');
		expect(layout.workspacePackage).toBe('@shop/workspace');
		expect(layout.tools).toMatchObject({
			packageManagerVersion: '9.15.0',
			// From the lockfile: nothing is installed.
			turboVersion: '2.5.8',
		});
	});

	it("keeps the workspace's package in a backend's slice, and not in a site's", () => {
		const ws = workspace(shop, {
			api: app('backend', 'apps/api'),
			web: app('web', 'apps/web'),
		});
		const layout = imageLayout(ws);

		const api = appImageOptions(layout, 'api', ws.apps.api!, shop);
		expect(api).toMatchObject({
			appPath: 'examples/shop/apps/api',
			turboPackage: '@shop/api',
			prunePackages: ['@shop/workspace'],
			gkmRoot: 'examples/shop',
			gkmPaths: ['gkm.config.*', 'apps', 'constructs'],
		});

		const web = appImageOptions(layout, 'web', ws.apps.web!, shop);
		expect(web.appPath).toBe('examples/shop/apps/web');
		expect(web.prunePackages).toBeUndefined();
		expect(web.gkmPaths).toBeUndefined();
	});

	it('builds from the root in a compose file written under the workspace', () => {
		expect(
			composeBuildPaths({
				composeDir: join(shop, '.gkm/compose/production'),
				buildRoot: root,
				workspaceRoot: shop,
				dockerfile: '.gkm/compose/production/Dockerfile.api',
			}),
		).toEqual({
			context: '../../../../..',
			dockerfile: 'examples/shop/.gkm/compose/production/Dockerfile.api',
		});
		expect(
			composeBuildPaths({
				composeDir: shop,
				buildRoot: root,
				workspaceRoot: shop,
				dockerfile: '.gkm/docker/Dockerfile.api',
			}),
		).toEqual({
			context: '../..',
			dockerfile: 'examples/shop/.gkm/docker/Dockerfile.api',
		});
	});
});

describe('the build root', () => {
	it('is the nearest directory with a pnpm-workspace.yaml, even without a lockfile', () => {
		write('pnpm-workspace.yaml', 'packages: []\n');
		write('apps/api/package.json', {});

		expect(findBuildRoot(join(root, 'apps/api'))).toBe(root);
	});

	it('is a single package when it declares no workspace', () => {
		write('package.json', { name: 'api' });
		write('package-lock.json', JSON.stringify({ packages: {} }));

		expect(resolveBuildTools(root)).toEqual({
			packageManager: 'npm',
			turboVersion: TURBO_VERSION,
			monorepo: false,
		});
	});
});

describe('the turbo a build root resolves', () => {
	it('is what is installed first', () => {
		write('node_modules/turbo/package.json', { version: '2.6.0' });
		write('pnpm-lock.yaml', '  turbo@2.5.0:\n');

		expect(resolveTurboVersion(root)).toBe('2.6.0');
	});

	it("is the lockfile's, for npm and yarn", () => {
		write(
			'package-lock.json',
			JSON.stringify({
				packages: { 'node_modules/turbo': { version: '2.4.4' } },
			}),
		);
		expect(resolveTurboVersion(root)).toBe('2.4.4');

		rmSync(join(root, 'package-lock.json'));
		write('yarn.lock', 'turbo@^2.3.0:\n  version "2.3.3"\n');
		expect(resolveTurboVersion(root)).toBe('2.3.3');
	});

	it('is none when the repository has no turbo', () => {
		write('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");

		expect(resolveTurboVersion(root)).toBeUndefined();
	});
});

describe('the directories a workspace declares its constructs in', () => {
	it('are where each glob starts, under the workspace', () => {
		const ws = workspace(root, {});
		ws.constructs = [
			'./constructs/**/*.ts',
			'src/*/handlers/*.ts',
			'**/*.x.ts',
		];

		expect(constructRoots(ws)).toEqual(['constructs', 'src']);
	});
});
