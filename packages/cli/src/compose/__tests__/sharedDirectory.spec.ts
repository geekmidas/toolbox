import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	buildApp,
	buildCommand,
	UnknownBuildApp,
	workspaceBuildCommand,
} from '../../build/index';
import { normalizeProductionConfig } from '../../dev/index';
import { appDockerfile, workerDockerfile } from '../../docker/index';
import { imageLayout } from '../../docker/layout';
import type { Sandbox } from '../../sandbox/sandbox';
import { getAppGkmConfig } from '../../workspace/index';
import type { NormalizedWorkspace } from '../../workspace/types';
import { loadComposeApp, writeComposeApp } from './__helpers__/composeApp';

/**
 * Two surfaces in one directory: the API, and `Webhooks` — a RestApi whose
 * `path` is also `apps/api`, with one endpoint built from it.
 *
 * Each is an app of its own, and each app's build serves its own surface's
 * endpoints. The directory names both, so it cannot be what says which is
 * being built; and each build writes a tree of its own, so neither removes or
 * overwrites what the other wrote.
 */

let dir: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;

beforeAll(async () => {
	dir = realpathSync(await createTempDir('gkm-shared-directory-'));
	writeComposeApp(dir, {
		registry: 'registry.example.com/acme',
		webhooks: true,
	});
	({ workspace, manifest } = await loadComposeApp(dir));
}, 60_000);

afterAll(async () => {
	await cleanupDir(dir);
});

const apiRoot = () => join(dir, 'apps', 'api');

const build = (
	app: string,
	target: 'server' | 'aws',
	options: { production?: boolean } = {},
) => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
	const production = normalizeProductionConfig(options.production ?? false);
	return buildApp({
		config: getAppGkmConfig(workspace, app)!,
		workspaceRoot: dir,
		appRoot: apiRoot(),
		app,
		target,
		enableOpenApi: false,
		cacheBackend: 'redis',
		eventsBackend: target === 'aws' ? 'sns' : 'pgboss',
		skipBundle: true,
		workspace,
		...(production ? { production } : {}),
	}).finally(() => vi.mocked(console.log).mockRestore());
};

describe('two surfaces in one directory', () => {
	it('derives an app for each, at the same path', () => {
		expect(workspace.apps.api?.path).toBe('apps/api');
		expect(workspace.apps.webhooks?.path).toBe('apps/api');
		expect(workspace.apps.webhooks?.subdomain).toBe('wh');
	});

	it('builds each server from its own surface’s endpoints, in a tree of its own', async () => {
		const webhooks = await build('webhooks', 'server');
		const api = await build('api', 'server');

		expect(webhooks.built?.surface).toBe('Webhooks');
		expect(webhooks.built?.routes.map((route) => route.path)).toEqual([
			'/payments',
		]);
		expect(api.built?.surface).toBe('Api');
		const apiPaths = api.built?.routes.map((route) => route.path) ?? [];
		expect(apiPaths).toContain('/ping');
		expect(apiPaths).not.toContain('/payments');

		// Each app's entry is its own, and the second build left the first's.
		const read = (app: string, file: string) =>
			readFileSync(join(apiRoot(), '.gkm', 'server', app, file), 'utf-8');
		expect(read('webhooks', 'endpoints.ts')).toContain('paymentsWebhook');
		expect(read('webhooks', 'endpoints.ts')).not.toContain('ping');
		expect(read('api', 'endpoints.ts')).toContain('ping');
		expect(read('api', 'endpoints.ts')).not.toContain('paymentsWebhook');
		expect(webhooks.built?.routes[0]?.handler).toBe(
			'apps/api/.gkm/server/webhooks/app.ts',
		);
		expect(existsSync(join(apiRoot(), '.gkm', 'server', 'app.ts'))).toBe(false);
	});

	it('runs the worker’s work in the one app that hosts it', async () => {
		const webhooks = await build('webhooks', 'server');
		const api = await build('api', 'server');

		expect(api.workers).toEqual(['Jobs']);
		expect(webhooks.workers).toBeUndefined();
	});

	it('writes each worker’s entry beside its host’s server alone', async () => {
		await build('webhooks', 'server', { production: true });
		await build('api', 'server', { production: true });

		expect(
			existsSync(join(apiRoot(), '.gkm', 'server', 'api', 'workers', 'jobs')),
		).toBe(true);
		expect(
			existsSync(join(apiRoot(), '.gkm', 'server', 'webhooks', 'workers')),
		).toBe(false);
	});

	it('builds each one’s Lambdas without removing the other’s', async () => {
		const webhooks = await build('webhooks', 'aws');
		const api = await build('api', 'aws');

		expect(webhooks.built?.routes).toEqual([
			expect.objectContaining({
				path: '/payments',
				handler: 'apps/api/.gkm/aws/webhooks/routes/paymentsWebhook.handler',
			}),
		]);
		expect(api.built?.routes.map((route) => route.path)).not.toContain(
			'/payments',
		);
		// Built second, the API's tree is new; the webhooks' is still there.
		expect(
			existsSync(
				join(apiRoot(), '.gkm/aws/webhooks/routes/paymentsWebhook.ts'),
			),
		).toBe(true);
		expect(existsSync(join(apiRoot(), '.gkm/aws/api/routes/ping.ts'))).toBe(
			true,
		);
	});

	it('puts a built handler on every endpoint of both surfaces in the AWS manifest', async () => {
		// The sites are turbo's; nothing here needs them built.
		const sandbox: Sandbox = {
			root: dir,
			isolating: false,
			env: {},
			exec: async () => ({
				exitCode: 0,
				signal: null,
				stdout: '',
				stderr: '',
			}),
		};
		vi.spyOn(console, 'log').mockImplementation(() => {});
		await workspaceBuildCommand(workspace, {
			provider: 'aws',
			sandbox,
		}).finally(() => vi.mocked(console.log).mockRestore());

		const { constructs } = await import(
			`${join(dir, '.gkm/manifest/aws.ts')}?t=${Date.now()}`
		);
		const handlers = (id: string) =>
			(constructs[id].endpoints as { path: string; handler: string }[]).map(
				({ path, handler }) => ({ path, handler }),
			);

		expect(handlers('Webhooks')).toEqual([
			{
				path: '/payments',
				handler: 'apps/api/.gkm/aws/webhooks/routes/paymentsWebhook.handler',
			},
		]);
		const api = handlers('Api');
		expect(api.length).toBeGreaterThan(0);
		for (const { handler } of api) {
			expect(handler).toMatch(/^apps\/api\/\.gkm\/aws\/api\/routes\//);
		}
	}, 60_000);

	it('builds the app `--app` names from the directory both share, as an image does', async () => {
		const cwd = process.cwd();
		process.chdir(apiRoot());
		vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			await buildCommand({ provider: 'server', app: 'webhooks' });
			await expect(
				buildCommand({ provider: 'server', app: 'payments' }),
			).rejects.toBeInstanceOf(UnknownBuildApp);
		} finally {
			process.chdir(cwd);
			vi.mocked(console.log).mockRestore();
		}

		const endpoints = readFileSync(
			join(apiRoot(), '.gkm', 'server', 'webhooks', 'endpoints.ts'),
			'utf-8',
		);
		expect(endpoints).toContain('paymentsWebhook');
		expect(endpoints).not.toContain('ping');
	});

	it('tells each image’s build which app it is, and copies that app’s bundle', () => {
		const layout = imageLayout(workspace);
		const dockerfile = (app: string) =>
			appDockerfile(app, workspace.apps[app]!, {
				layout,
				workspaceRoot: workspace.root,
				apps: workspace.apps,
				manifest,
			});

		const webhooks = dockerfile('webhooks');
		expect(webhooks).toContain(
			'build --provider server --production --app webhooks',
		);
		expect(webhooks).toContain(
			'/app/apps/api/.gkm/server/webhooks/dist/server.mjs',
		);
		expect(webhooks).not.toContain('.gkm/server/dist/');
		const api = dockerfile('api');
		expect(api).toContain('--app api');
		expect(api).toContain('/app/apps/api/.gkm/server/api/dist/server.mjs');

		// The worker the API hosts is built by the API's build, and copied out
		// of the API's tree.
		const jobs = workerDockerfile(
			{ id: 'Jobs', name: 'jobs', app: 'api' },
			workspace.apps.api!,
			{ layout, workspaceRoot: workspace.root, manifest },
		);
		expect(jobs).toContain('--app api');
		expect(jobs).toContain(
			'/app/apps/api/.gkm/server/api/dist/worker-jobs.mjs',
		);
		// An app alone in its directory is pinned by the templates' snapshots.
	});
});
