import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { migrationTargets } from '@geekmidas/manifest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDir, createTempDir } from '../../../__tests__/test-helpers';
import {
	resolvesHere,
	SERVER_IPV4,
	serveFrom,
	stageGenerated,
	writeComposeApp,
} from '../../../compose/__tests__/__helpers__/composeApp';
import {
	answering,
	fakeDocker,
} from '../../../compose/__tests__/__helpers__/fakeDocker';
import {
	HostNotPointingAtServer,
	ServerAddressMissing,
} from '../../../compose/dns';
import { ImageTagNotFound } from '../../../compose/images';
import { currentActor } from '../../../deploy/actor';
import { deploy } from '../../../deploy/deploy';
import type { DeployEvent } from '../../../deploy/events';
import { LocalStateInCi } from '../../../deploy/StateStore';
import { SeedFailed } from '../../../migrate/databases';
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
		// No Postgres runs here: its login is taken as the one it was given.
		logins: async ({ login }) => ({
			service: 'postgres',
			status: 'current',
			login,
		}),
		migrate: async () => [],
		seed: async () => [],
		healthIntervalMs: 0,
		lookup: resolvesHere,
	};
}

async function events(run: ReturnType<typeof deploy>): Promise<DeployEvent[]> {
	const seen: DeployEvent[] = [];
	for await (const event of run) seen.push(event);
	return seen;
}

describe("the stage's migrations and seeds", { timeout: RUN_TIMEOUT }, () => {
	/** The run's events, with Postgres migrated and seeded by `migrate` and `seed`. */
	async function deployWith(
		deps: Partial<ComposeDeps>,
	): Promise<{ seen: DeployEvent[]; ops: string[] }> {
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
					...deps,
				}),
			},
		});
		const seen = await events(run);
		await run.result.catch(() => {});
		return { seen, ops: fake.ops() };
	}

	const target = (manifest: Parameters<typeof migrationTargets>[0]) =>
		migrationTargets(manifest).find((t) => t.id === 'Database')!;

	it('reports what was applied and seeded, before any app is built or started', async () => {
		const { seen, ops } = await deployWith({
			migrate: async ({ manifest }) => [
				{ target: target(manifest), applied: ['20261008120000_notes'] },
			],
			seed: async ({ manifest, stage }) => {
				expect(stage).toBe('development');
				return [{ target: target(manifest), seeded: ['001_welcome_note'] }];
			},
		});

		const types = seen.map((e) => e.type);
		expect(seen).toContainEqual({
			type: 'migration.applied',
			construct: 'Database',
			folder: 'db/database/migrations',
			applied: ['20261008120000_notes'],
		});
		expect(seen).toContainEqual({
			type: 'seed.ran',
			construct: 'Database',
			folder: 'db/database/seeds',
			seeded: ['001_welcome_note'],
		});
		expect(types.indexOf('migration.applied')).toBeLessThan(
			types.indexOf('seed.ran'),
		);
		expect(types.indexOf('seed.ran')).toBeLessThan(
			types.indexOf('artifact.built'),
		);
		expect(seen).toContainEqual({
			type: 'log',
			level: 'info',
			message: '🌱 db/database/seeds: ran 1',
		});
		expect(ops).toContain('probe');
	});

	it('fails provision on a failing seed, and releases nothing', async () => {
		const { seen, ops } = await deployWith({
			seed: async () => {
				throw new SeedFailed(
					'Database',
					'001_welcome_note',
					new Error('duplicate key value violates unique constraint'),
				);
			},
		});

		expect(seen).toContainEqual({
			type: 'phase.failed',
			phase: 'provision',
			error: {
				name: 'DeploySeedsFailed',
				message: expect.stringContaining(
					"Database's seed '001_welcome_note' failed — duplicate key value",
				),
			},
		});
		expect(seen.some((e) => e.type === 'artifact.built')).toBe(false);
		expect(ops).not.toContain('build');
		expect(ops).not.toContain('probe');
	});
});

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
			selfHostedTelemetry: true,
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
		// The worker's image is built beside the apps'.
		expect(built.map((e) => (e as { app: string }).app).sort()).toEqual([
			'api',
			'auth',
			'jobs',
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
				'service:jobs',
				'service:web',
			]),
		);

		const checked = seen.filter((e) => e.type === 'health.checked');
		expect(checked).toHaveLength(4);
		expect(checked).toContainEqual({
			type: 'health.checked',
			app: 'api',
			url: 'https://api.compose-app.localhost/health',
			healthy: true,
			status: 200,
			attempt: 1,
		});
		// The worker, by its container's own health check.
		expect(checked).toContainEqual({
			type: 'health.checked',
			app: 'jobs',
			url: 'docker:jobs',
			healthy: true,
			attempt: 1,
		});

		expect(result).toMatchObject({
			stage: 'development',
			tag: 'abc1234',
			dryRun: false,
			successCount: 4,
			urls: { web: 'https://compose-app.localhost' },
		});
	});

	it('pulls a given tag, and refuses one the registry lacks before anything changes', async () => {
		await serveFrom(dir);
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
		expect(await stageGenerated(dir)).toBe(false);
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
		// A Telemetry construct switches it on; the local stage takes its port
		// from GKM_COMPOSE_LOGS_PORT, never from deploy.telemetry.
		writeComposeApp(dir, {
			registry: 'registry.example.com/acme',
			telemetry: true,
		});
		const fake = fakeDocker();
		const run = deploy({
			cwd: dir,
			stage: 'development',
			target: 'compose',
			targets: {
				compose: composeTarget({
					...quiet(),
					env: { GKM_COMPOSE_LOGS_PORT: '5099' },
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

	it('fails verify when a worker never turns healthy, naming it', async () => {
		const fake = fakeDocker();
		const run = deploy({
			cwd: dir,
			stage: 'development',
			target: 'compose',
			targets: {
				compose: composeTarget({
					...quiet(),
					docker: {
						...fake.docker,
						health: async (_stack, service) =>
							service === 'jobs' ? 'unhealthy' : 'healthy',
					},
					probe: answering(fake.calls),
					healthAttempts: 2,
				}),
			},
		});
		const error = await run.result.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ComposeAppsUnhealthy);
		expect((error as ComposeAppsUnhealthy).apps).toEqual([
			{ app: 'jobs', url: 'docker:jobs', last: 'unhealthy' },
		]);
	});

	it('fails verify when the log UI never turns healthy', async () => {
		writeComposeApp(dir, { telemetry: true });
		const fake = fakeDocker();
		const run = deploy({
			cwd: dir,
			stage: 'development',
			target: 'compose',
			targets: {
				compose: composeTarget({
					...quiet(),
					docker: {
						...fake.docker,
						health: async (_stack, service) =>
							service === 'openobserve' ? 'unhealthy' : 'healthy',
					},
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

describe('the DNS check', { timeout: RUN_TIMEOUT }, () => {
	/** A production run, with each host resolved by `lookup`. */
	async function production(
		lookup: (host: string) => Promise<string[]>,
		options: { skipDnsCheck?: boolean } = {},
	) {
		const fake = fakeDocker();
		const run = deploy({
			cwd: dir,
			stage: 'production',
			target: 'compose',
			...(options.skipDnsCheck ? { skipDnsCheck: true } : {}),
			targets: {
				compose: composeTarget({
					...quiet(),
					lookup,
					docker: fake.docker,
					probe: answering(fake.calls),
				}),
			},
		});
		const seen = await events(run);
		const error = await run.result.catch((e: unknown) => e);
		return { seen, error, ops: fake.ops() };
	}

	const validated = (seen: DeployEvent[]) =>
		seen.some((e) => e.type === 'phase.finished' && e.phase === 'validate');

	it('stops validate when a host resolves elsewhere, before anything is started', async () => {
		await serveFrom(dir);

		const { seen, error, ops } = await production(async (host) =>
			host === 'api.shop.example.com' ? ['198.51.100.7'] : [SERVER_IPV4],
		);

		expect(error).toBeInstanceOf(HostNotPointingAtServer);
		expect((error as HostNotPointingAtServer).hosts).toEqual([
			{ host: 'api.shop.example.com', resolved: ['198.51.100.7'] },
		]);
		expect(validated(seen)).toBe(false);
		expect(ops).not.toContain('up');
	});

	it('passes hosts that resolve to the server', async () => {
		await serveFrom(dir);
		const asked: string[] = [];

		const { seen } = await production(async (host) => {
			asked.push(host);
			return [SERVER_IPV4];
		});

		expect(validated(seen)).toBe(true);
		expect(asked.sort()).toEqual([
			'api.shop.example.com',
			'auth.shop.example.com',
			'shop.example.com',
		]);
	});

	it('checks nothing with --skip-dns-check', async () => {
		await serveFrom(dir);

		const { seen } = await production(
			async () => {
				throw new Error('nothing is resolved');
			},
			{ skipDnsCheck: true },
		);

		expect(validated(seen)).toBe(true);
		expect(seen).toContainEqual({
			type: 'log',
			level: 'info',
			message: '🌐 DNS check skipped (--skip-dns-check)',
		});
	});

	it('refuses a stage with a domain and no GKM_SERVER_IPV4, naming the command', async () => {
		const { error, ops } = await production(async () => [SERVER_IPV4]);

		expect(error).toBeInstanceOf(ServerAddressMissing);
		expect((error as Error).message).toContain(
			"gkm secrets:set GKM_SERVER_IPV4 '<ip>' --stage production",
		);
		expect(ops).toEqual([]);
	});

	it('never checks the local stage', async () => {
		const asked: string[] = [];
		const fake = fakeDocker();
		const run = deploy({
			cwd: dir,
			stage: 'development',
			target: 'compose',
			targets: {
				compose: composeTarget({
					...quiet(),
					lookup: async (host) => {
						asked.push(host);
						return [];
					},
					docker: fake.docker,
					probe: answering(fake.calls),
				}),
			},
		});
		await events(run);
		await run.result;

		expect(asked).toEqual([]);
	});
});

describe("the stage's deploy state", { timeout: RUN_TIMEOUT }, () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	const stateFile = (stage: string) =>
		JSON.parse(
			readFileSync(join(dir, '.gkm', `deploy-${stage}.json`), 'utf-8'),
		);

	it('is the compose shape: releases with who released them, and the run in its history', async () => {
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
		await events(run);
		await run.result;

		const document = stateFile('development');
		expect(document.schemaVersion).toBe(3);
		expect(document.state).toEqual({
			provider: 'compose',
			stage: 'development',
			lastDeployedAt: expect.any(String),
			identity: expect.any(String),
			releases: expect.any(Object),
		});
		for (const name of [
			'projectId',
			'environmentId',
			'applications',
			'services',
			'dnsRecords',
			'dnsVerified',
		]) {
			expect(document.state).not.toHaveProperty(name);
		}
		expect(Object.keys(document.state.releases).sort()).toEqual([
			'api',
			'auth',
			'jobs',
			'web',
		]);
		expect(document.state.releases.api.current.releasedBy).toEqual(
			currentActor(),
		);
		expect(document.updatedBy).toEqual(currentActor());
		// One run, one entry — however many writes it made.
		expect(document.history).toEqual([
			{
				serial: document.serial,
				at: document.updatedAt,
				by: currentActor(),
				operation: 'deploy',
			},
		]);
	});

	it('refuses a deployed stage in CI while its state is local, before anything happens', async () => {
		vi.stubEnv('GITHUB_ACTIONS', 'true');
		await serveFrom(dir);
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
		await events(run);

		const error = await run.result.catch((e) => e);
		expect(error).toBeInstanceOf(LocalStateInCi);
		expect(error.message).toContain(
			"state: { provider: 'ssm', region: '<region>' }",
		);
		expect(error.message).toContain('gkm state:push --stage production');
		expect(fake.ops()).toEqual([]);
		expect(existsSync(join(dir, '.gkm', 'deploy-production.json'))).toBe(false);
	});

	it('deploys the local stage in CI with local state', async () => {
		vi.stubEnv('GITHUB_ACTIONS', 'true');
		vi.stubEnv('GITHUB_ACTOR', 'octocat');
		vi.stubEnv('GITHUB_SERVER_URL', 'https://github.com');
		vi.stubEnv('GITHUB_REPOSITORY', 'acme/shop');
		vi.stubEnv('GITHUB_RUN_ID', '42');
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
		await events(run);
		await run.result;

		expect(
			stateFile('development').state.releases.api.current.releasedBy,
		).toEqual({
			kind: 'github',
			actor: 'octocat',
			run: 'https://github.com/acme/shop/actions/runs/42',
		});
	});
});
