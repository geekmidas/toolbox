import { execSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
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
import { dockerCommand, workspaceDockerCommand } from '../index';

// `docker build` / `docker push` are the only commands this module runs;
// everything else in child_process stays real.
vi.mock('node:child_process', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:child_process')>()),
	execSync: vi.fn(),
}));

const STAGES = { local: 'dev', deployed: ['prod'] };

describe('gkm docker', () => {
	let root: string;
	let cwd: string;
	let log: ReturnType<typeof vi.spyOn>;
	const printed = () => log.mock.calls.flat().join('\n');

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'gkm-docker-'));
		cwd = process.cwd();
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.mocked(execSync).mockReset();
	});

	afterEach(() => {
		process.chdir(cwd);
		vi.restoreAllMocks();
		rmSync(root, { recursive: true, force: true });
	});

	describe('a workspace', () => {
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

		const workspace = (apps: Record<string, NormalizedAppConfig>) =>
			({
				name: 'shop',
				root,
				apps,
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				stages: STAGES,
				secrets: {},
			}) as unknown as NormalizedWorkspace;

		it('writes one Dockerfile per deployable app, built for its kind', async () => {
			writeFileSync(join(root, 'pnpm-lock.yaml'), '');
			mkdirSync(join(root, 'apps/api'), { recursive: true });
			writeFileSync(
				join(root, 'apps/api/package.json'),
				JSON.stringify({ name: '@shop/api' }),
			);

			const result = await workspaceDockerCommand(
				workspace({
					api: app('backend', 'apps/api'),
					worker: app('backend', 'apps/worker', { entry: './src/main.ts' }),
					web: app('web', 'apps/web', { framework: 'nextjs' }),
					site: app('web', 'apps/site', { framework: 'vite' }),
					store: app('web', 'apps/store', { framework: 'tanstack-start' }),
					remix: app('web', 'apps/remix', { framework: 'remix' }),
					mobile: app('mobile', 'apps/mobile'),
				}),
			);

			// The mobile app ships through its own toolchain.
			expect(result.apps.map((a) => a.appName)).toEqual([
				'api',
				'worker',
				'web',
				'site',
				'store',
				'remix',
			]);
			const dockerfile = (name: string) =>
				readFileSync(join(root, `.gkm/docker/Dockerfile.${name}`), 'utf-8');

			// Pruned by the package.json name where there is one.
			expect(dockerfile('api')).toContain('@shop/api');
			expect(dockerfile('worker')).toContain('src/main.ts');
			expect(dockerfile('web')).toMatch(/next/i);
			expect(dockerfile('site')).toMatch(/nginx|static/i);
			expect(existsSync(join(root, '.dockerignore'))).toBe(true);
			expect(result.dockerCompose).toBe(
				join(root, 'docker-compose.constructs.yml'),
			);
			expect(printed()).toContain('Skipping Docker for mobile');
			expect(printed()).toContain('--profile apps up --build');
		});

		it("layers the project's own compose file in the run instructions", async () => {
			writeFileSync(join(root, 'docker-compose.yml'), 'services: {}\n');

			await workspaceDockerCommand(
				workspace({ api: app('backend', 'apps/api') }),
			);

			expect(printed()).toContain(
				'-f docker-compose.constructs.yml -f docker-compose.yml',
			);
		});
	});

	describe('a single app', () => {
		/** A one-app project the way `gkm init` lays one out. */
		function project(extra = '') {
			writeFileSync(
				join(root, 'gkm.config.ts'),
				`import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: './src/constructs/**/*.ts',
  // A process-level key: what makes this one app's config, not a workspace's.
  openapi: false,${extra}
});
`,
			);
			writeFileSync(
				join(root, 'package.json'),
				JSON.stringify({ name: '@shop/api', type: 'module' }),
			);
			writeFileSync(join(root, 'pnpm-lock.yaml'), '');
			process.chdir(root);
		}

		it('writes a multi-stage Dockerfile, the entrypoint and the ignore file', async () => {
			project();

			const result = (await dockerCommand({})) as {
				dockerfile: string;
				entrypoint: string;
				dockerignore: string;
			};

			expect(readFileSync(result.dockerfile, 'utf-8')).toContain('FROM');
			expect(existsSync(result.entrypoint)).toBe(true);
			expect(existsSync(result.dockerignore)).toBe(true);
			expect(printed()).toContain('multi-stage, pnpm');
			expect(execSync).not.toHaveBeenCalled();
		});

		it('refuses --slim without a built bundle, and uses one that exists', async () => {
			project();

			await expect(dockerCommand({ slim: true })).rejects.toThrow(
				'Slim Dockerfile requires a pre-built bundle',
			);

			mkdirSync(join(root, '.gkm/server/dist'), { recursive: true });
			writeFileSync(join(root, '.gkm/server/dist/server.mjs'), '');
			await dockerCommand({ slim: true });
			expect(printed()).toContain('(slim, pnpm)');
		});

		it('builds and pushes the image to the registry', async () => {
			project();

			await dockerCommand({
				build: true,
				push: true,
				registry: 'ghcr.io/acme',
				tag: 'v1',
			});

			const commands = vi.mocked(execSync).mock.calls.map((c) => c[0]);
			expect(commands).toEqual([
				expect.stringContaining('docker build'),
				'docker push ghcr.io/acme/api:v1',
			]);
			expect(commands[0]).toContain('-t ghcr.io/acme/api:v1');
		});

		it('refuses to push without a registry', async () => {
			project();

			await expect(dockerCommand({ push: true })).rejects.toThrow(
				'Registry is required to push',
			);
		});

		it('names the step that failed when docker does', async () => {
			project();
			vi.mocked(execSync).mockImplementation(() => {
				throw new Error('daemon down');
			});

			await expect(dockerCommand({ build: true })).rejects.toThrow(
				'Failed to build Docker image: daemon down',
			);
			await expect(
				dockerCommand({ push: true, registry: 'ghcr.io/acme' }),
			).rejects.toThrow('Failed to push Docker image: daemon down');
		});

		describe('inside a monorepo', () => {
			/** The app one level below a root that holds the lockfile. */
			function nested(turbo: boolean) {
				const app = join(root, 'apps/api');
				mkdirSync(app, { recursive: true });
				writeFileSync(join(root, 'pnpm-lock.yaml'), '');
				if (turbo) writeFileSync(join(root, 'turbo.json'), '{}');
				writeFileSync(
					join(app, 'gkm.config.ts'),
					`import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: './src/constructs/**/*.ts',
  openapi: false,
});
`,
				);
				writeFileSync(
					join(app, 'package.json'),
					JSON.stringify({ name: '@shop/api', type: 'module' }),
				);
				process.chdir(app);
				return app;
			}

			it('refuses a monorepo without turbo.json', async () => {
				nested(false);

				await expect(dockerCommand({})).rejects.toThrow(
					'Monorepo detected but turbo.json not found',
				);
			});

			it('prunes with turbo, and copies the root lockfile in for the build', async () => {
				const app = nested(true);
				let lockfileDuringBuild = false;
				vi.mocked(execSync).mockImplementation(() => {
					lockfileDuringBuild = existsSync(join(app, 'pnpm-lock.yaml'));
					return Buffer.from('');
				});

				await dockerCommand({ build: true });

				expect(printed()).toContain('Turbo package: @shop/api');
				expect(printed()).toContain('(turbo, pnpm)');
				expect(lockfileDuringBuild).toBe(true);
				// Copied for the build, and cleaned up after it.
				expect(existsSync(join(app, 'pnpm-lock.yaml'))).toBe(false);
			});
		});
	});
});
