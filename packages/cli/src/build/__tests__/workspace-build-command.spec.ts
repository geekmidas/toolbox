import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
	NormalizedAppConfig,
	NormalizedWorkspace,
} from '../../workspace/types';
import { workspaceBuildCommand } from '../index';

// Turbo is the one process a workspace build starts; everything it decides
// before and after is what these tests are about.
vi.mock('node:child_process', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:child_process')>()),
	spawn: vi.fn(),
}));

/** A child process that ends however the test says, on the next tick. */
function turboExits(outcome: { code?: number; error?: Error }) {
	vi.mocked(spawn).mockImplementation(() => {
		const child = new EventEmitter();
		setImmediate(() => {
			if (outcome.error) child.emit('error', outcome.error);
			else child.emit('close', outcome.code ?? 0);
		});
		return child as never;
	});
}

const app = (
	type: NormalizedAppConfig['type'],
	path: string,
	extra: Partial<NormalizedAppConfig> = {},
) =>
	({
		type,
		path,
		port: 3000,
		dependencies: [],
		resolvedDeployTarget: 'dokploy',
		...extra,
	}) as NormalizedAppConfig;

describe('workspaceBuildCommand', () => {
	let root: string;
	let log: ReturnType<typeof vi.spyOn>;
	const printed = () => log.mock.calls.flat().join('\n');

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'gkm-ws-build-'));
		writeFileSync(join(root, 'pnpm-lock.yaml'), '');
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.mocked(spawn).mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(root, { recursive: true, force: true });
	});

	/** A workspace whose apps each have the package.json turbo needs. */
	function workspace(apps: Record<string, NormalizedAppConfig>) {
		for (const [name, a] of Object.entries(apps)) {
			mkdirSync(join(root, a.path), { recursive: true });
			writeFileSync(
				join(root, a.path, 'package.json'),
				JSON.stringify({ name: `@shop/${name}` }),
			);
		}
		return {
			name: 'shop',
			root,
			apps,
			stages: { local: 'dev', deployed: ['prod'] },
			deploy: { default: 'dokploy' },
			shared: { packages: [] },
			secrets: {},
		} as unknown as NormalizedWorkspace;
	}

	it('builds the backends itself, the rest through turbo, and reports where each went', async () => {
		turboExits({ code: 0 });

		const result = await workspaceBuildCommand(
			workspace({
				api: app('backend', 'apps/api'),
				web: app('web', 'apps/web', {
					framework: 'nextjs',
					dependencies: ['api'],
				}),
				site: app('web', 'apps/site', { framework: 'vite' }),
				store: app('web', 'apps/store', { framework: 'tanstack-start' }),
				remix: app('web', 'apps/remix', { framework: 'remix' }),
				mobile: app('mobile', 'apps/mobile'),
			}),
			{ production: true },
		);

		const out = Object.fromEntries(
			result.apps.map((a) => [a.appName, a.outputPath]),
		);
		expect(out).toEqual({
			api: join(root, 'apps/api/.gkm'),
			web: join(root, 'apps/web/.next'),
			site: join(root, 'apps/site/dist'),
			store: join(root, 'apps/store/dist'),
			remix: join(root, 'apps/remix/build'),
			// Built by its own toolchain.
			mobile: '',
		});
		expect(result.apps.every((a) => a.success)).toBe(true);

		const [command, spawnOptions] = vi.mocked(spawn).mock.calls[0]!;
		expect(command).toContain('turbo run build');
		expect(command).toContain('--filter=@shop/web');
		// The backend is the root's to build, and nothing pulls it back in.
		expect(command).not.toContain('--filter=@shop/api');
		expect(command).toContain('--only');
		expect(spawnOptions).toMatchObject({
			cwd: root,
			env: expect.objectContaining({ NODE_ENV: 'production' }),
		});
		expect(printed()).toContain('Production mode enabled');
		expect(printed()).toContain('Backend apps: api');
		expect(printed()).toContain('Build order:');
	});

	it('builds for development unless asked for production', async () => {
		turboExits({ code: 0 });

		await workspaceBuildCommand(
			workspace({ web: app('web', 'apps/web', { framework: 'vite' }) }),
			{},
		);

		expect(vi.mocked(spawn).mock.calls[0]![1]).toMatchObject({
			env: expect.objectContaining({ NODE_ENV: 'development' }),
		});
		expect(printed()).toContain('Backend apps: none');
	});

	it('writes the application’s one manifest at the root, and starts no turbo for backends alone', async () => {
		mkdirSync(join(root, '.gkm/manifest'), { recursive: true });
		writeFileSync(join(root, '.gkm/manifest/aws.ts'), 'export {};');

		await workspaceBuildCommand(
			workspace({
				api: app('backend', 'apps/api'),
				admin: app('backend', 'apps/admin'),
			}),
			{},
		);

		expect(spawn).not.toHaveBeenCalled();
		expect(existsSync(join(root, '.gkm/manifest/server.ts'))).toBe(true);
		// Only the target being built has a manifest.
		expect(existsSync(join(root, '.gkm/manifest/aws.ts'))).toBe(false);
		expect(existsSync(join(root, 'apps/api/.gkm/manifest'))).toBe(false);
	});

	it('fails every app when turbo exits non-zero', async () => {
		turboExits({ code: 2 });

		await expect(
			workspaceBuildCommand(
				workspace({ web: app('web', 'apps/web', { framework: 'vite' }) }),
				{},
			),
		).rejects.toThrow('Turbo build failed with exit code 2');
		expect(printed()).toContain('Build failed: Turbo build failed');
	});

	it('fails when turbo cannot be started', async () => {
		turboExits({ error: new Error('spawn ENOENT') });

		await expect(
			workspaceBuildCommand(
				workspace({ web: app('web', 'apps/web', { framework: 'vite' }) }),
				{},
			),
		).rejects.toThrow('spawn ENOENT');
	});

	it('refuses an app turbo could not build, before starting it', async () => {
		const ws = workspace({ api: app('backend', 'apps/api') });
		ws.apps.site = app('web', 'apps/site', { framework: 'vite' });

		await expect(workspaceBuildCommand(ws, {})).rejects.toThrow(
			'No package.json for workspace app(s): site',
		);
		expect(spawn).not.toHaveBeenCalled();
	});
});
