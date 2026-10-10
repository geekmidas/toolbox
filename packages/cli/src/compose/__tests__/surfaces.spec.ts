import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { buildApp } from '../../build/index';
import { loadWorkspaceSettings } from '../../config';
import { deployIdentity } from '../../deploy/identity';
import { normalizeProductionConfig } from '../../dev/index';
import { TEST_CREDENTIALS } from '../../reconcile/__tests__/__helpers__/credentials';
import { appEnvKeys, workerEnvKeys } from '../../reconcile/apps';
import { FileSecretsStore } from '../../secrets/file';
import { keystoreProject } from '../../secrets/keystore';
import { workspaceStageKeys } from '../../secrets/stageKeys';
import { initStageSecrets } from '../../secrets/storage';
import { getAppGkmConfig } from '../../workspace/index';
import type { NormalizedWorkspace } from '../../workspace/types';
import { composeCommand } from '../index';
import { composeStack } from '../stack';
import {
	loadComposeApp,
	resolvesHere,
	writeComposeApp,
} from './__helpers__/composeApp';
import { fakeDocker } from './__helpers__/fakeDocker';

/**
 * Two surfaces and a worker: the API, whose endpoints send to the worker's
 * queue, and a second, small RestApi — `Reviewer` — whose one endpoint reads
 * the auth tenant. The worker runs a queue consumer and a cron, both declared
 * in the API's directory.
 *
 * A surface's process runs its own endpoints and reads its own edges; the
 * worker's crons and consumers run in the worker's process, with the worker's
 * keys. Neither surface is handed the worker because its endpoints were found
 * by a glob.
 */

let dir: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let runnables: Record<string, string[]>;
let background: Record<string, string[]>;

beforeAll(async () => {
	dir = realpathSync(await createTempDir('gkm-two-surfaces-'));
	writeComposeApp(dir, {
		registry: 'registry.example.com/acme',
		reviewer: true,
	});
	({ workspace, manifest, runnables, background } = await loadComposeApp(dir));
});

afterAll(async () => {
	await cleanupDir(dir);
});

/** What belongs to the worker, and must reach no surface. */
const WORKER_KEYS = [
	'NOTES_PUBLISHER_CONNECTION_STRING',
	'EVENT_PUBLISHER_CONNECTION_STRING',
	'PUSH_CREDENTIALS',
];

describe('two surfaces and a worker', () => {
	it('hands the second surface only its own edge', () => {
		const keys = [...(appEnvKeys(manifest, 'reviewer', runnables) ?? [])];

		expect(keys).toContain('AUTH_DATABASE_URL');
		for (const key of [...WORKER_KEYS, 'DATABASE_URL', 'SESSIONS_URL']) {
			expect(keys).not.toContain(key);
		}
	});

	it('hands the API its endpoints’ edges, and none of the worker’s own', () => {
		const keys = [...(appEnvKeys(manifest, 'api', runnables) ?? [])];

		// It sends to the queue, so it reaches it; the cron's credential and the
		// broker the cron schedules through are the worker's.
		expect(keys).toEqual(
			expect.arrayContaining([
				'DATABASE_URL',
				'SESSIONS_URL',
				'NOTES_PUBLISHER_CONNECTION_STRING',
			]),
		);
		expect(keys).not.toContain('PUSH_CREDENTIALS');
		expect(keys).not.toContain('AUTH_DATABASE_URL');
	});

	it('composes each service with its own keys', () => {
		const stack = composeStack({
			workspace,
			manifest,
			runnables,
			background,
			stage: 'development',
			identity: deployIdentity(workspace, 'development'),
			images: { mode: 'build', tag: 'abc1234' },
			ports: { https: 8443, http: 8080 },
			localCredentials: TEST_CREDENTIALS,
			secrets: {
				...initStageSecrets('development'),
				custom: { PUSH_CREDENTIALS: '{"key":"k"}' },
			},
		});
		const reviewer = stack.apps.find((app) => app.name === 'reviewer');
		const jobs = stack.workers.find((worker) => worker.name === 'jobs');

		expect(Object.keys(reviewer?.env ?? {})).toContain('AUTH_DATABASE_URL');
		for (const key of [...WORKER_KEYS, 'DATABASE_URL', 'SESSIONS_URL']) {
			expect(reviewer?.env).not.toHaveProperty(key);
		}
		// Built from the app that holds its work.
		expect(jobs?.host).toBe('api');
		for (const key of ['NOTES_PUBLISHER_CONNECTION_STRING', 'DATABASE_URL']) {
			expect(jobs?.env).toHaveProperty(key);
		}
		expect(jobs?.env).not.toHaveProperty('AUTH_DATABASE_URL');

		// What the worker's process reads: its queue, its cron's credential,
		// its database and the broker its cron schedules through.
		const keys = [...(workerEnvKeys(manifest, 'Jobs', runnables) ?? [])];
		expect(keys).toEqual(
			expect.arrayContaining([...WORKER_KEYS, 'DATABASE_URL']),
		);
		expect(keys).not.toContain('AUTH_DATABASE_URL');
		expect(keys).not.toContain('SESSIONS_URL');
	});

	it('asks the stage for the cron’s credential for the worker alone', () => {
		const keys = workspaceStageKeys({
			manifest,
			runnables,
			local: false,
			supplied: {},
		});

		expect(keys.find((key) => key.key === 'PUSH_CREDENTIALS')).toMatchObject({
			apps: ['jobs'],
		});
	});
});

describe('two surfaces and a worker, built', () => {
	const build = (app: string, production = false) => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const appRoot = join(dir, 'apps', app);
		const productionConfig = normalizeProductionConfig(production);
		return buildApp({
			config: getAppGkmConfig(workspace, app)!,
			workspaceRoot: dir,
			appRoot,
			target: 'server',
			enableOpenApi: false,
			cacheBackend: 'redis',
			eventsBackend: 'pgboss',
			skipBundle: true,
			workspace,
			...(productionConfig ? { production: productionConfig } : {}),
		}).finally(() => vi.mocked(console.log).mockRestore());
	};
	const read = (app: string, file: string) =>
		readFileSync(join(dir, 'apps', app, '.gkm', 'server', file), 'utf-8');

	it('serves the second surface’s endpoints alone, and runs none of the worker’s work', async () => {
		const built = await build('reviewer');

		expect(built.built?.routes.map((route) => route.path)).toEqual(['/review']);
		expect(read('reviewer', 'endpoints.ts')).not.toContain('sendNote');
		expect(read('reviewer', 'crons.ts')).not.toContain('sweep');
		expect(read('reviewer', 'queues.ts')).not.toContain('notes');
		// It reaches no cache and no broker, so it resolves neither client.
		expect(read('reviewer', 'app.ts')).not.toContain('@geekmidas/cache');
		expect(read('reviewer', 'app.ts')).not.toContain('@geekmidas/events');
		expect(built.workers).toBeUndefined();
	});

	it('runs the worker’s work under `gkm dev` in the one app that hosts it', async () => {
		const built = await build('api');

		expect(built.built?.routes.map((route) => route.path)).not.toContain(
			'/review',
		);
		expect(read('api', 'crons.ts')).toContain('sweep');
		expect(read('api', 'queues.ts')).toContain('notes');
		expect(built.workers).toEqual(['Jobs']);
	});

	it('builds the worker’s entry beside its host’s server, and none beside the second surface’s', async () => {
		await build('reviewer', true);
		await build('api', true);

		expect(existsSync(join(dir, 'apps/reviewer/.gkm/server/workers'))).toBe(
			false,
		);
		expect(read('reviewer', 'crons.ts')).not.toContain('sweep');
		expect(read('api', 'crons.ts')).not.toContain('sweep');
		expect(read('api', 'workers/jobs/crons.ts')).toContain('sweep');
		expect(read('api', 'workers/jobs/queues.ts')).toContain('notes');
	});
});

describe('two surfaces and a worker, composed', { timeout: 60_000 }, () => {
	let root: string;
	let home: string;

	beforeAll(async () => {
		root = realpathSync(await createTempDir('gkm-two-surfaces-compose-'));
		home = realpathSync(await createTempDir('gkm-two-surfaces-home-'));
		vi.stubEnv('GKM_HOME', home);
		writeComposeApp(root, {
			registry: 'registry.example.com/acme',
			reviewer: true,
		});
		// The cron's credential, which the worker alone is handed.
		await new FileSecretsStore(
			root,
			keystoreProject(await loadWorkspaceSettings(root), home),
		).write('development', {
			...initStageSecrets('development'),
			custom: { PUSH_CREDENTIALS: '{"key":"k"}' },
		});
		// The Redis client where the cache is reached — the API's process, and
		// the worker's, whose image is built from the API — and nowhere else.
		writeFileSync(
			join(root, 'package.json'),
			JSON.stringify({ name: 'compose-app', private: true, type: 'module' }),
		);
		writeFileSync(
			join(root, 'apps', 'api', 'package.json'),
			JSON.stringify({
				name: '@compose-app/api',
				private: true,
				type: 'module',
				dependencies: { ioredis: '~6.0.0' },
			}),
		);
	});

	afterAll(async () => {
		vi.unstubAllEnvs();
		await cleanupDir(root);
		await cleanupDir(home);
	});

	it('builds a stack whose second surface reaches no cache without a Redis client there', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const { docker, ops } = fakeDocker();

		const result = await composeCommand(
			{ cwd: root, stage: 'development', dryRun: true },
			{ lookup: resolvesHere, docker, revision: async () => 'abc1234' },
		).finally(() => vi.mocked(console.log).mockRestore());

		expect(ops()).toEqual([]);
		const reviewerEnv = readFileSync(
			join(root, '.gkm', 'compose', 'development', 'reviewer.env'),
			'utf-8',
		);
		expect(reviewerEnv).toContain('AUTH_DATABASE_URL=');
		for (const key of [...WORKER_KEYS, 'DATABASE_URL', 'SESSIONS_URL']) {
			expect(reviewerEnv).not.toMatch(new RegExp(`^${key}=`, 'm'));
		}
		expect(result?.files.map((file) => file.slice(root.length + 1))).toContain(
			'.gkm/compose/development/jobs.env',
		);
	});
});
