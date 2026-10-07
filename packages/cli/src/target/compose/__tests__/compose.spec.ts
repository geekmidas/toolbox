import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDir, createTempDir } from '../../../__tests__/test-helpers';
import { writeComposeApp } from '../../../compose/__tests__/__helpers__/composeApp';
import {
	answering,
	fakeDocker,
} from '../../../compose/__tests__/__helpers__/fakeDocker';
import { ImageTagNotFound } from '../../../compose/images';
import { deploy } from '../../../deploy/deploy';
import type { DeployEvent } from '../../../deploy/events';
import type { SqlClient } from '../../../reconcile/provision';
import { UndeclaredStage } from '../../../workspace/stages';
import { resolveTarget } from '../../resolve';
import {
	ComposeAppsUnhealthy,
	type ComposeDeps,
	composeTarget,
} from '../index';

/**
 * `gkm deploy --target compose`: the compose target run by `deploy()`, the
 * way any target is — its phases in order, its events, its refusals. Docker,
 * the registry, Postgres and the probe are recorders; the
 * workspace, its sandboxed load, the stage's secrets and its state are real.
 */

const RUN_TIMEOUT = 60_000;

let dir: string;

beforeEach(async () => {
	dir = realpathSync(await createTempDir('gkm-compose-target-'));
	writeComposeApp(dir, { registry: 'registry.example.com/acme' });
});

afterEach(async () => {
	vi.restoreAllMocks();
	await cleanupDir(dir);
});

/** Everything but docker and the probe, standing in for the real ones. */
function quiet(): Partial<ComposeDeps> {
	return {
		revision: async () => 'abc1234',
		sql: () => ({ query: async () => [] }) satisfies SqlClient,
		migrate: async () => [],
		healthIntervalMs: 0,
	};
}

async function events(run: ReturnType<typeof deploy>): Promise<DeployEvent[]> {
	const seen: DeployEvent[] = [];
	for await (const event of run) seen.push(event);
	return seen;
}

describe('the compose target', { timeout: RUN_TIMEOUT }, () => {
	it('is built in, runs on a server, migrates, and can run the local stage', async () => {
		const resolved = await resolveTarget('compose', {
			workspace: { root: dir },
			stage: 'development',
		});

		expect(resolved.source).toBe('builtin');
		expect(resolved.target.runtime).toBe('server');
		expect(resolved.target.capabilities).toEqual({
			rollback: false,
			migrations: 'target',
			images: true,
			localStage: true,
		});
	});

	it('deploys the local stage through every phase, reporting each app', async () => {
		const fake = fakeDocker();
		const run = deploy({
			cwd: dir,
			stage: 'development',
			target: 'compose',
			targets: {
				compose: composeTarget({
					...quiet(),
					docker: fake.docker,
					probe: answering(fake.calls),
				}),
			},
		});
		const seen = await events(run);
		const result = await run.result;

		expect(
			seen
				.filter((e) => e.type === 'phase.finished')
				.map((e) => (e as { phase: string }).phase),
		).toEqual(['validate', 'provision', 'build', 'release', 'verify']);

		// The tag a build is named after is the commit's, not `<stage>-<time>`.
		expect(seen.find((e) => e.type === 'deploy.started')).toMatchObject({
			target: 'compose',
			tag: 'abc1234',
			apps: expect.arrayContaining(['api', 'auth', 'web']),
		});

		const built = seen.filter((e) => e.type === 'artifact.built');
		expect(built.map((e) => (e as { app: string }).app).sort()).toEqual([
			'api',
			'auth',
			'web',
		]);
		expect(built[0]).toMatchObject({
			digest: expect.stringMatching(/^sha256:/),
		});

		const applied = seen
			.filter((e) => e.type === 'resource.applied')
			.map((e) => (e as { key: string }).key);
		expect(applied).toEqual(
			expect.arrayContaining([
				'service:postgres',
				'service:api',
				'service:auth',
				'service:web',
			]),
		);

		const checked = seen.filter((e) => e.type === 'health.checked');
		expect(checked).toHaveLength(3);
		expect(checked).toContainEqual({
			type: 'health.checked',
			app: 'api',
			url: 'https://api.compose-app.localhost/health',
			healthy: true,
			status: 200,
			attempt: 1,
		});

		expect(result).toMatchObject({
			stage: 'development',
			tag: 'abc1234',
			dryRun: false,
			successCount: 3,
			urls: { web: 'https://compose-app.localhost' },
		});
	});

	it('pulls a given tag, and refuses one the registry lacks before anything changes', async () => {
		const fake = fakeDocker({
			registry: [
				'registry.example.com/acme/compose-app/compose-app-api:v1.4.0',
			],
		});
		const run = deploy({
			cwd: dir,
			stage: 'production',
			target: 'compose',
			tag: 'v1.4.0',
			targets: {
				compose: composeTarget({ ...quiet(), docker: fake.docker }),
			},
		});
		const seen = await events(run);

		await expect(run.result).rejects.toBeInstanceOf(ImageTagNotFound);
		expect(seen).toContainEqual(
			expect.objectContaining({ type: 'phase.failed', phase: 'validate' }),
		);
		expect(new Set(fake.ops())).toEqual(new Set(['lookup']));
		expect(existsSync(join(dir, '.gkm', 'compose'))).toBe(false);
		expect(existsSync(join(dir, '.gkm', 'secrets', 'production.json'))).toBe(
			false,
		);
		expect(existsSync(join(dir, '.gkm', 'deploy-production.json'))).toBe(false);
	});

	it('fails verify naming every app that does not answer through Caddy', async () => {
		const fake = fakeDocker();
		const run = deploy({
			cwd: dir,
			stage: 'development',
			target: 'compose',
			targets: {
				compose: composeTarget({
					...quiet(),
					docker: fake.docker,
					healthAttempts: 2,
					probe: async ({ url }) => (url.includes('api.') ? 502 : 200),
				}),
			},
		});
		const seen = await events(run);
		const error = await run.result.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ComposeAppsUnhealthy);
		expect((error as ComposeAppsUnhealthy).apps).toEqual([
			{
				app: 'api',
				url: 'https://api.compose-app.localhost/health',
				last: 'HTTP 502',
			},
		]);
		expect(
			seen
				.filter((e) => e.type === 'health.checked' && e.app === 'api')
				.map((e) => (e as { attempt: number }).attempt),
		).toEqual([1, 2]);
		// Nothing to roll back to: the target says it cannot.
		expect(seen).not.toContainEqual(
			expect.objectContaining({ type: 'phase.started', phase: 'rollback' }),
		);
	});

	it('checks the log UI in verify and reports where it is', async () => {
		writeComposeApp(dir, {
			registry: 'registry.example.com/acme',
			logs: { port: 5099 },
		});
		const fake = fakeDocker();
		const run = deploy({
			cwd: dir,
			stage: 'development',
			target: 'compose',
			targets: {
				compose: composeTarget({
					...quiet(),
					docker: fake.docker,
					probe: answering(fake.calls),
				}),
			},
		});
		const seen = await events(run);
		await run.result;

		expect(seen).toContainEqual({
			type: 'health.checked',
			app: 'openobserve',
			url: 'docker:openobserve',
			healthy: true,
			attempt: 1,
		});
		expect(seen).toContainEqual({
			type: 'logs.ready',
			service: 'openobserve',
			access: 'tunnel',
			url: 'http://localhost:5099',
			port: 5099,
			email: 'admin@gkm.localhost',
		});
		expect(
			seen
				.filter((e) => e.type === 'resource.applied')
				.map((e) => (e as { key: string }).key),
		).toContain('service:openobserve');
	});

	it('fails verify when the log UI never turns healthy', async () => {
		writeComposeApp(dir, { logs: true });
		const fake = fakeDocker();
		const run = deploy({
			cwd: dir,
			stage: 'development',
			target: 'compose',
			targets: {
				compose: composeTarget({
					...quiet(),
					docker: { ...fake.docker, health: async () => 'unhealthy' },
					probe: answering(fake.calls),
					healthAttempts: 2,
				}),
			},
		});
		const seen = await events(run);
		const error = await run.result.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ComposeAppsUnhealthy);
		expect((error as ComposeAppsUnhealthy).apps).toEqual([
			{ app: 'openobserve', url: 'docker:openobserve', last: 'unhealthy' },
		]);
		expect(seen.some((e) => e.type === 'logs.ready')).toBe(false);
	});

	it('leaves the local stage to targets that run it here', async () => {
		const run = deploy({ cwd: dir, stage: 'development', target: 'dokploy' });

		await expect(run.result).rejects.toBeInstanceOf(UndeclaredStage);
	});
});
