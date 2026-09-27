import { execSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	NoReleaseOnTag,
	resolveTarget,
	upgradeCommand,
	WouldDowngrade,
} from '../index';

vi.mock('node:child_process', () => ({
	execSync: vi.fn(),
}));

const server = setupServer();

/** What the v10 alpha line looks like on npm while v9 is `latest`. */
const TAGS = { latest: '9.0.2', alpha: '10.0.0-alpha.8' };

/**
 * An npm registry holding `@geekmidas` packages at `TAGS`, each declaring
 * `peers` at the alpha version.
 */
function registry(peers: Record<string, string> = {}) {
	server.use(
		http.get('https://registry.npmjs.org/*', ({ request }) => {
			const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
			if (!name.startsWith('@geekmidas/')) {
				return new HttpResponse(null, { status: 404 });
			}
			return HttpResponse.json({
				'dist-tags': TAGS,
				versions: {
					'9.0.2': {},
					'10.0.0-alpha.8': { peerDependencies: peers },
				},
			});
		}),
	);
}

const write = (path: string, content: unknown) =>
	writeFileSync(
		path,
		typeof content === 'string' ? content : JSON.stringify(content, null, 2),
	);
const read = (path: string) => JSON.parse(readFileSync(path, 'utf-8'));

describe('upgradeCommand', () => {
	let dir: string;
	let cwd: string;
	let log: ReturnType<typeof vi.spyOn>;
	const output = () => log.mock.calls.flat().join('\n');

	beforeEach(async () => {
		dir = join(tmpdir(), `gkm-upgrade-${Date.now()}-${Math.random()}`);
		await mkdir(dir, { recursive: true });
		// macOS's tmpdir is a symlink; the command sees the resolved path.
		dir = realpathSync(dir);
		cwd = process.cwd();
		process.chdir(dir);
		server.listen({ onUnhandledRequest: 'error' });
		vi.mocked(execSync).mockReset();
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(async () => {
		process.chdir(cwd);
		server.resetHandlers();
		server.close();
		log.mockRestore();
		await rm(dir, { recursive: true, force: true });
	});

	/** A pnpm workspace with a root and one app. */
	async function workspace(
		rootDeps: Record<string, unknown>,
		appDeps: Record<string, unknown> = {},
		yaml = "packages:\n  - 'apps/*'\n",
	) {
		write(join(dir, 'pnpm-lock.yaml'), '');
		write(join(dir, 'pnpm-workspace.yaml'), yaml);
		write(join(dir, 'package.json'), { name: 'shop', ...rootDeps });
		await mkdir(join(dir, 'apps', 'api'), { recursive: true });
		write(join(dir, 'apps', 'api', 'package.json'), {
			name: '@shop/api',
			...appDeps,
		});
	}

	it('reports a project with no @geekmidas packages', async () => {
		await workspace({ dependencies: { lodash: '^4.0.0' } });

		await upgradeCommand();

		expect(output()).toContain('No @geekmidas packages found');
		expect(execSync).not.toHaveBeenCalled();
	});

	it('follows the alpha line a project is on, not latest', async () => {
		// `latest` is 9.x: following it from an alpha would be a downgrade.
		registry();
		await workspace({
			devDependencies: { '@geekmidas/cli': '~10.0.0-alpha.6' },
		});

		await upgradeCommand();

		expect(read(join(dir, 'package.json')).devDependencies).toEqual({
			'@geekmidas/cli': '~10.0.0-alpha.8',
		});
		expect(output()).toContain('Target: 10.0.0-alpha.8 (npm "alpha")');
		expect(execSync).toHaveBeenCalledWith(
			'pnpm install',
			expect.objectContaining({ cwd: dir }),
		);
	});

	it('follows latest for a project on a release', async () => {
		registry();
		await workspace({ devDependencies: { '@geekmidas/cli': '^9.0.0' } });

		await upgradeCommand();

		expect(read(join(dir, 'package.json')).devDependencies).toEqual({
			'@geekmidas/cli': '^9.0.2',
		});
	});

	it('moves only the CLI without --all, and says what comes next', async () => {
		registry();
		await workspace(
			{ devDependencies: { '@geekmidas/cli': '~10.0.0-alpha.6' } },
			{ dependencies: { '@geekmidas/constructs': '~10.0.0-alpha.6' } },
		);

		await upgradeCommand();

		expect(read(join(dir, 'apps/api/package.json')).dependencies).toEqual({
			'@geekmidas/constructs': '~10.0.0-alpha.6',
		});
		expect(output()).toContain('run `gkm upgrade --all` with the new CLI');
	});

	it('moves every @geekmidas package to one version with --all', async () => {
		registry();
		await workspace(
			{ devDependencies: { '@geekmidas/cli': '~10.0.0-alpha.6' } },
			{
				dependencies: {
					'@geekmidas/constructs': '^10.0.0-alpha.5',
					'@geekmidas/envkit': '10.0.0-alpha.6',
				},
			},
		);

		await upgradeCommand({ all: true });

		// Each keeps the operator it was written with.
		expect(read(join(dir, 'apps/api/package.json')).dependencies).toEqual({
			'@geekmidas/constructs': '^10.0.0-alpha.8',
			'@geekmidas/envkit': '10.0.0-alpha.8',
		});
	});

	it('reports a hand-written range rather than flattening it', async () => {
		registry();
		await workspace(
			{ devDependencies: { '@geekmidas/cli': '~10.0.0-alpha.6' } },
			{ peerDependencies: { '@geekmidas/schema': '>=8.0.0 <10' } },
		);

		await upgradeCommand({ all: true });

		expect(read(join(dir, 'apps/api/package.json')).peerDependencies).toEqual({
			'@geekmidas/schema': '>=8.0.0 <10',
		});
		expect(output()).toContain(
			'@geekmidas/schema >=8.0.0 <10 is not a simple range; left as is',
		);
	});

	it('leaves workspace references alone', async () => {
		registry();
		await workspace(
			{ devDependencies: { '@geekmidas/cli': '~10.0.0-alpha.6' } },
			{ dependencies: { '@geekmidas/models': 'workspace:*' } },
		);

		await upgradeCommand({ all: true });

		expect(read(join(dir, 'apps/api/package.json')).dependencies).toEqual({
			'@geekmidas/models': 'workspace:*',
		});
	});

	it('rewrites pnpm catalog entries, keeping the file as written', async () => {
		registry();
		await workspace(
			{ devDependencies: { '@geekmidas/cli': 'catalog:' } },
			{ dependencies: { '@geekmidas/constructs': 'catalog:geekmidas' } },
			[
				'packages:',
				"  - 'apps/*'",
				'# The toolchain, pinned once.',
				'catalog:',
				"  '@geekmidas/cli': ~10.0.0-alpha.6",
				'catalogs:',
				'  geekmidas:',
				"    '@geekmidas/constructs': ~10.0.0-alpha.6",
				'',
			].join('\n'),
		);

		await upgradeCommand({ all: true });

		const yaml = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf-8');
		expect(yaml).toContain('# The toolchain, pinned once.');
		expect(yaml).toMatch(/'@geekmidas\/cli': ~10\.0\.0-alpha\.8/);
		expect(yaml).toMatch(/'@geekmidas\/constructs': ~10\.0\.0-alpha\.8/);
		// The references themselves stay references.
		expect(read(join(dir, 'package.json')).devDependencies).toEqual({
			'@geekmidas/cli': 'catalog:',
		});
	});

	it('raises third-party packages to the peer floor with --all', async () => {
		registry({
			kysely: '~0.29.6',
			hono: '>=4.13.8',
			pg: '>=8.23.0',
			'@types/aws-lambda': '>=8.10.163',
		});
		await workspace(
			{ devDependencies: { '@geekmidas/cli': '~10.0.0-alpha.6' } },
			{
				dependencies: {
					'@geekmidas/constructs': '~10.0.0-alpha.6',
					kysely: '~0.28.2',
					// Already past the floor: never lowered.
					hono: '^4.14.0',
					// Not one operator and one version: reported, not rewritten.
					pg: '>=8.0.0 <9',
				},
			},
		);

		await upgradeCommand({ all: true });

		expect(read(join(dir, 'apps/api/package.json')).dependencies).toEqual({
			'@geekmidas/constructs': '~10.0.0-alpha.8',
			kysely: '~0.29.6',
			hono: '^4.14.0',
			pg: '>=8.0.0 <9',
		});
		// A peer the project does not list is not added.
		expect(
			read(join(dir, 'apps/api/package.json')).dependencies,
		).not.toHaveProperty('@types/aws-lambda');
		expect(output()).toContain('pg >=8.0.0 <9 is not a simple range');
	});

	it('refuses to move a project backwards', async () => {
		registry();
		await workspace({
			devDependencies: { '@geekmidas/cli': '~10.0.0-alpha.6' },
		});

		await expect(upgradeCommand({ tag: 'latest' })).rejects.toThrow(
			WouldDowngrade,
		);
		expect(read(join(dir, 'package.json')).devDependencies).toEqual({
			'@geekmidas/cli': '~10.0.0-alpha.6',
		});
	});

	it('changes nothing on --dry-run', async () => {
		registry();
		await workspace({
			devDependencies: { '@geekmidas/cli': '~10.0.0-alpha.6' },
		});

		await upgradeCommand({ dryRun: true });

		expect(output()).toContain('@geekmidas/cli');
		expect(output()).toContain('~10.0.0-alpha.6 → ~10.0.0-alpha.8');
		expect(read(join(dir, 'package.json')).devDependencies).toEqual({
			'@geekmidas/cli': '~10.0.0-alpha.6',
		});
		expect(execSync).not.toHaveBeenCalled();
	});

	it('does nothing when already on the target', async () => {
		registry();
		await workspace({
			devDependencies: { '@geekmidas/cli': '~10.0.0-alpha.8' },
		});

		await upgradeCommand();

		expect(output()).toContain('already on the target version');
		expect(execSync).not.toHaveBeenCalled();
	});
});

describe('resolveTarget', () => {
	it('uses the prerelease tag of the highest installed version', () => {
		expect(resolveTarget(TAGS, ['9.0.2', '10.0.0-alpha.6'])).toEqual({
			tag: 'alpha',
			version: '10.0.0-alpha.8',
		});
	});

	it('names the tags npm has when asked for one it does not', () => {
		expect(() => resolveTarget(TAGS, ['9.0.2'], 'beta')).toThrow(
			NoReleaseOnTag,
		);
		expect(() => resolveTarget(TAGS, ['9.0.2'], 'beta')).toThrow(
			'npm has no "beta" release of @geekmidas/cli. Tags: latest, alpha.',
		);
	});
});
