import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../../run';
import type {
	NormalizedAppConfig,
	NormalizedWorkspace,
} from '../../workspace/types';
import {
	dockerCommand,
	ImageRefInvalid,
	MonorepoNeedsTurbo,
	workspaceDockerCommand,
} from '../index';

// `docker build` / `docker push` are the only commands this module runs, and
// both go through `run` — recorded here as the argv docker would receive.
vi.mock('../../run', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../run')>()),
	run: vi.fn(),
}));

/** Every `docker …` invocation, as [program, ...argv]. */
const commands = () =>
	vi.mocked(run).mock.calls.map(([command, args]) => [command, ...args]);

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
		vi.mocked(run).mockReset();
		vi.mocked(run).mockResolvedValue();
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
			writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: [apps/*]\n');
			writeFileSync(join(root, 'turbo.json'), '{}');
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
			expect(dockerfile('site')).toMatch(/FROM caddy:/);
			expect(existsSync(join(root, '.dockerignore'))).toBe(true);
			expect(result.dockerCompose).toBe(
				join(root, 'docker-compose.constructs.yml'),
			);
			expect(printed()).toContain('Skipping Docker for mobile');
			expect(printed()).toContain('--profile apps up --build');
		});

		it("writes each Worker's Dockerfile, built from the app that holds its work", async () => {
			writeFileSync(join(root, 'pnpm-lock.yaml'), '');
			writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: [apps/*]\n');
			writeFileSync(join(root, 'turbo.json'), '{}');
			mkdirSync(join(root, 'apps/api'), { recursive: true });
			writeFileSync(
				join(root, 'apps/api/package.json'),
				JSON.stringify({ name: '@shop/api' }),
			);

			const result = await workspaceDockerCommand(
				workspace({
					api: app('backend', 'apps/api'),
					admin: app('backend', 'apps/admin'),
				}),
				{
					Api: { kind: 'rest-api', id: 'Api', path: 'apps/api', endpoints: [] },
					Jobs: { kind: 'worker', id: 'Jobs' },
					// Declared, with nothing to run: no image.
					Idle: { kind: 'worker', id: 'Idle' },
				} as never,
				{},
				{ Jobs: [join(root, 'apps/api/queues/emails.ts')] },
			);

			expect(result.apps.map((a) => a.appName)).toEqual([
				'api',
				'admin',
				'jobs',
			]);
			const dockerfile = readFileSync(
				join(root, '.gkm/docker/Dockerfile.jobs'),
				'utf-8',
			);
			expect(dockerfile).toContain('prune @shop/api --docker');
			expect(dockerfile).toContain(
				'/app/apps/api/.gkm/server/dist/worker-jobs.mjs ./worker.mjs',
			);
			expect(dockerfile).toContain('CMD ["node", "worker.mjs"]');
			expect(printed()).toContain('worker Jobs, built from api');
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

		it("writes the app's Dockerfile, which builds it inside Docker, and the ignore file", async () => {
			project();

			const result = await dockerCommand({});

			const [api] = result.apps;
			expect(api?.dockerfile).toBe(
				join(realpathSync(root), '.gkm/docker/Dockerfile'),
			);
			const dockerfile = readFileSync(api!.dockerfile, 'utf-8');
			// A single package: copied whole, built in the image, no bundle from
			// the host.
			expect(dockerfile).toContain('cp -a . /tmp/out/full/');
			expect(dockerfile).toContain(
				'node "$GKM_BIN" build --provider server --production',
			);
			expect(existsSync(result.dockerignore)).toBe(true);
			expect(run).not.toHaveBeenCalled();
		});

		it('builds and pushes the image to the registry', async () => {
			project();

			await dockerCommand({
				build: true,
				push: true,
				registry: 'ghcr.io/acme',
				tag: 'v1',
			});

			expect(commands()).toEqual([
				[
					'docker',
					'build',
					'--file=.gkm/docker/Dockerfile',
					'--tag=ghcr.io/acme/api:v1',
					'.',
				],
				['docker', 'push', 'ghcr.io/acme/api:v1'],
			]);
			expect(vi.mocked(run).mock.calls[0]![2]).toMatchObject({
				cwd: realpathSync(root),
				env: expect.objectContaining({ DOCKER_BUILDKIT: '1' }),
			});
		});

		it.each([
			['a shell separator', 'v1;id'],
			['a command substitution', '$(id)'],
			['a space', 'v1 --push'],
			['a leading dash', '-v1'],
		])('refuses a tag holding %s before running docker', async (_, tag) => {
			project();

			await expect(
				dockerCommand({ build: true, registry: 'ghcr.io/acme', tag }),
			).rejects.toBeInstanceOf(ImageRefInvalid);
			await expect(
				dockerCommand({ push: true, registry: 'ghcr.io/acme', tag }),
			).rejects.toBeInstanceOf(ImageRefInvalid);
			expect(run).not.toHaveBeenCalled();
		});

		it('refuses to push without a registry', async () => {
			project();

			await expect(dockerCommand({ push: true })).rejects.toThrow(
				'Registry is required to push',
			);
		});

		it('names the step that failed when docker does', async () => {
			project();
			vi.mocked(run).mockRejectedValue(new Error('daemon down'));

			await expect(dockerCommand({ build: true })).rejects.toThrow(
				'Failed to build Docker image: daemon down',
			);
			await expect(
				dockerCommand({ push: true, registry: 'ghcr.io/acme' }),
			).rejects.toThrow('Failed to push Docker image: daemon down');
		});

		describe('inside a monorepo', () => {
			/** The app one level below a workspace root that holds the lockfile. */
			function nested(turbo: boolean) {
				const app = join(root, 'apps/api');
				mkdirSync(app, { recursive: true });
				writeFileSync(join(root, 'pnpm-lock.yaml'), '');
				writeFileSync(
					join(root, 'pnpm-workspace.yaml'),
					'packages:\n  - apps/*\n',
				);
				writeFileSync(
					join(root, 'package.json'),
					JSON.stringify({
						name: 'shop',
						private: true,
						packageManager: 'pnpm@10.30.1+sha512.abc',
					}),
				);
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

				await expect(dockerCommand({})).rejects.toBeInstanceOf(
					MonorepoNeedsTurbo,
				);
			});

			it('builds from the root, pruned to the app, with the root’s pnpm', async () => {
				const app = nested(true);

				await dockerCommand({ build: true });

				expect(commands()).toEqual([
					[
						'docker',
						'build',
						'--file=apps/api/.gkm/docker/Dockerfile',
						'--tag=api:latest',
						'.',
					],
				]);
				expect(vi.mocked(run).mock.calls[0]![2]).toMatchObject({
					cwd: realpathSync(root),
				});
				const dockerfile = readFileSync(
					join(app, '.gkm/docker/Dockerfile'),
					'utf-8',
				);
				expect(dockerfile).toContain('prune @shop/api --docker');
				expect(dockerfile).toContain(
					'corepack prepare pnpm@10.30.1 --activate',
				);
				expect(dockerfile).toContain('cd /app/apps/api && GKM_BIN=');
				// Nothing is copied into the app for the build: the root is the
				// context.
				expect(existsSync(join(app, 'pnpm-lock.yaml'))).toBe(false);
				expect(existsSync(join(root, '.dockerignore'))).toBe(true);
			});
		});
	});
});
