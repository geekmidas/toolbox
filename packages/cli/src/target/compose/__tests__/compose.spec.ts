import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { migrationTargets } from '@geekmidas/manifest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALSTACK_URL } from '../../../../../testkit/test/ports';
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
	type Call,
	fakeDocker,
	fakeServer,
} from '../../../compose/__tests__/__helpers__/fakeDocker';
import {
	HostNotPointingAtServer,
	ServerAddressMissing,
} from '../../../compose/dns';
import { ImageTagNotFound } from '../../../compose/images';
import { currentActor } from '../../../deploy/actor';
import { deploy } from '../../../deploy/deploy';
import type { DeployEvent } from '../../../deploy/events';
import { deployIdentity } from '../../../deploy/identity';
import { LocalStateInCi } from '../../../deploy/StateStore';
import { SeedFailed } from '../../../migrate/databases';
import type { SqlClient } from '../../../reconcile/provision';
import { CommandFailed } from '../../../run';
import { S3SecretsStore } from '../../../secrets/s3';
import { UndeclaredStage } from '../../../workspace/stages';
import { resolveTarget } from '../../resolve';
import { HealthRequestTimedOut } from '../health';
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
					server: fakeServer([]),
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
					server: fakeServer([]),
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
					server: fakeServer([]),
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
		expect((error as ComposeAppsUnhealthy).via).toBe('edge');
		expect((error as ComposeAppsUnhealthy).message).toContain(
			'this app does not answer through Caddy',
		);
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

	it('releases the rest of the stack when an app never turns healthy, then fails release naming it', async () => {
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
						// What `up --wait` does when one container fails its check.
						async up(stack, services) {
							await fake.docker.up(stack, services);
							if (!services) {
								throw new CommandFailed('docker', ['compose', 'up'], 1, null);
							}
						},
						health: async (_stack, service) =>
							service === 'api' ? 'unhealthy' : 'healthy',
					},
					server: fakeServer([]),
					probe: answering(fake.calls),
				}),
			},
		});
		const seen = await events(run);
		const error = await run.result.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ComposeAppsUnhealthy);
		expect((error as ComposeAppsUnhealthy).apps).toEqual([
			{ app: 'api', url: 'docker:api', last: 'unhealthy' },
		]);
		// Docker's own check failed, not a request through the edge.
		expect((error as ComposeAppsUnhealthy).via).toBe('docker');
		expect((error as ComposeAppsUnhealthy).message).toContain(
			"this container's health check has not passed",
		);
		expect((error as ComposeAppsUnhealthy).message).toContain(
			'  - api: Docker reports it unhealthy',
		);
		expect((error as ComposeAppsUnhealthy).message).toContain(
			'docker compose -p compose-app-development logs api',
		);
		expect((error as ComposeAppsUnhealthy).message).not.toContain(
			'answer through',
		);
		expect(seen).toContainEqual(
			expect.objectContaining({ type: 'phase.failed', phase: 'release' }),
		);
		// Caddy is up, serving the certificate gkm's local CA issued before
		// anything started — nothing is copied out of it — and the healthy
		// apps are released.
		expect(fake.ops()).not.toContain('copyOut');
		expect(
			existsSync(join(dir, '.gkm', 'compose', 'development', 'local-edge.pem')),
		).toBe(true);
		const deployed = seen
			.filter((e) => e.type === 'app.deployed')
			.map((e) => (e as { app: string }).app)
			.sort();
		expect(deployed).toEqual(['auth', 'web']);
		expect(fake.ops()).not.toContain('probe');
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
					server: fakeServer([]),
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
		options: { skipDns?: boolean } = {},
	) {
		const fake = fakeDocker();
		const run = deploy({
			cwd: dir,
			stage: 'production',
			target: 'compose',
			...(options.skipDns ? { skipDns: true } : {}),
			targets: {
				compose: composeTarget({
					...quiet(),
					lookup,
					docker: fake.docker,
					server: fakeServer([]),
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

	it('checks nothing with --skip-dns', async () => {
		await serveFrom(dir);

		const { seen } = await production(
			async () => {
				throw new Error('nothing is resolved');
			},
			{ skipDns: true },
		);

		expect(validated(seen)).toBe(true);
		expect(seen).toContainEqual({
			type: 'log',
			level: 'info',
			message: '🌐 DNS skipped (--skip-dns): no record is written or checked',
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
					server: fakeServer([]),
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
					server: fakeServer([]),
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
			"state: { provider: 's3', region: '<region>' }",
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
		// A GitHub runner sets its own; without this the actor gains `workflow`.
		vi.stubEnv('GITHUB_WORKFLOW', '');
		const fake = fakeDocker();
		const run = deploy({
			cwd: dir,
			stage: 'development',
			target: 'compose',
			targets: {
				compose: composeTarget({
					...quiet(),
					docker: fake.docker,
					server: fakeServer([]),
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

describe(
	'a stage whose secrets and state are in the project bucket',
	{ timeout: RUN_TIMEOUT },
	() => {
		let name: string;

		beforeEach(() => {
			// Against the AWS emulator, through the SDK's endpoint variable.
			vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
			vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
			vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
			// A project of its own per run: the emulator outlives the suite.
			name = `compose-${randomUUID().slice(0, 8)}`;
			writeComposeApp(dir, {
				name,
				registry: 'registry.example.com/acme',
				state: { provider: 's3', region: 'eu-west-1' },
				secrets: { store: { provider: 's3' } },
			});
		});

		afterEach(() => vi.unstubAllEnvs());

		it('deploys production reading its secrets from S3, and writes what it generates back there', async () => {
			await serveFrom(dir);
			const inS3 = () =>
				new S3SecretsStore({
					project: name,
					identity: deployIdentity({ name }, ''),
					region: 'eu-west-1',
					prefix: 'gkm',
				}).read('production');
			expect((await inS3())?.custom).toEqual({
				GKM_SERVER_IPV4: SERVER_IPV4,
			});
			const fake = fakeDocker();

			const run = deploy({
				cwd: dir,
				stage: 'production',
				target: 'compose',
				targets: {
					compose: composeTarget({
						...quiet(),
						docker: fake.docker,
						server: fakeServer(fake.calls),
						probe: answering(fake.calls),
					}),
				},
			});
			const seen = await events(run);
			await run.result;

			expect(
				seen
					.filter((e) => e.type === 'phase.finished')
					.map((e) => (e as { phase: string }).phase),
			).toEqual(['validate', 'provision', 'build', 'release', 'verify']);
			// The server's address came from S3; what the deploy generated went there.
			expect(await stageGenerated(dir)).toBe(true);
			const stored = await inS3();
			expect(stored?.custom.GKM_SERVER_IPV4).toBe(SERVER_IPV4);
			expect(stored?.seed).toBeDefined();
			expect(existsSync(join(dir, '.gkm', 'secrets', 'production.json'))).toBe(
				false,
			);
			expect(existsSync(join(dir, '.gkm', 'deploy-production.json'))).toBe(
				false,
			);
		});
	},
);

describe('warming a server-rendered site', { timeout: RUN_TIMEOUT }, () => {
	/** The run's events, and each page the warm-up asked the edge for. */
	async function deployWith(
		fetch: ComposeDeps['fetch'],
		docker: Parameters<typeof fakeDocker>[0] = {},
	): Promise<{
		seen: DeployEvent[];
		result: unknown;
		ops: string[];
		calls: Call[];
	}> {
		const fake = fakeDocker(docker);
		const run = deploy({
			cwd: dir,
			stage: 'development',
			target: 'compose',
			targets: {
				compose: composeTarget({
					...quiet(),
					docker: fake.docker,
					server: fakeServer([]),
					probe: answering(fake.calls),
					fetch: async (request) => {
						fake.calls.push({ op: 'warm', args: request.url });
						return fetch!(request);
					},
				}),
			},
		});
		const seen = await events(run);
		const result = await run.result.catch((error: unknown) => error);
		return { seen, result, ops: fake.ops(), calls: fake.calls };
	}

	const logs = (seen: DeployEvent[], level: 'info' | 'warn') =>
		seen
			.filter((e) => e.type === 'log' && e.level === level)
			.map((e) => (e as { message: string }).message);

	it('asks a Next site for its root and its sitemap once the stack is healthy, and only warns on a failed page', async () => {
		writeComposeApp(dir, {
			registry: 'registry.example.com/acme',
			siteVariant: 'next',
		});
		const asked: { url: string; connectTo?: string }[] = [];
		const { seen, result, ops } = await deployWith(
			async ({ url, connectTo }) => {
				asked.push({ url, ...(connectTo ? { connectTo } : {}) });
				const { pathname } = new URL(url);
				if (pathname === '/sitemap.xml') {
					return {
						status: 200,
						body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://compose-app.localhost/</loc></url><url><loc>https://compose-app.localhost/notes</loc></url><url><loc>https://compose-app.localhost/broken</loc></url></urlset>`,
					};
				}
				return { status: pathname === '/broken' ? 500 : 200, body: '' };
			},
		);

		// The deploy succeeds: a page that did not warm fails nothing.
		expect(result).toMatchObject({ stage: 'development', successCount: 4 });
		// Through the local edge, by the site's host, after every check passed.
		expect(asked.map(({ url }) => url).sort()).toEqual([
			'https://compose-app.localhost/',
			'https://compose-app.localhost/broken',
			'https://compose-app.localhost/notes',
			'https://compose-app.localhost/sitemap.xml',
		]);
		expect(asked.every(({ connectTo }) => connectTo === '127.0.0.1')).toBe(
			true,
		);
		expect(ops.indexOf('warm')).toBeGreaterThan(ops.lastIndexOf('probe'));
		expect(logs(seen, 'warn')).toEqual(
			expect.arrayContaining([
				expect.stringContaining('web          warmed 2 page(s), 1 warning(s)'),
				expect.stringContaining(
					'https://compose-app.localhost/broken: HTTP 500',
				),
			]),
		);
	});

	it('has a Next site render each page from the deployed APIs, with the id read from its running container', async () => {
		writeComposeApp(dir, {
			registry: 'registry.example.com/acme',
			siteVariant: 'next',
		});
		const PREVIEW_MODE_ID = '5ec1e7c0ffee5ec1e7c0ffee5ec1e7c0';
		const sent: (string | undefined)[] = [];
		const { seen, result, calls } = await deployWith(
			async ({ url, headers }) => {
				const id = headers?.['x-prerender-revalidate'];
				sent.push(id);
				const forced = id === PREVIEW_MODE_ID;
				const { pathname } = new URL(url);
				return {
					status: 200,
					// `/old` is not a page Next caches: it never says HIT.
					headers: {
						'x-nextjs-cache':
							pathname === '/old' ? undefined : forced ? 'REVALIDATED' : 'HIT',
					},
					body:
						pathname === '/sitemap.xml'
							? `<urlset><url><loc>https://compose-app.localhost/notes</loc></url><url><loc>https://compose-app.localhost/old</loc></url></urlset>`
							: '',
				};
			},
			{
				exec: (_stack, service, command) =>
					service === 'web' && command[0] === 'node'
						? { code: 0, stdout: PREVIEW_MODE_ID, stderr: '' }
						: undefined,
			},
		);

		expect(result).toMatchObject({ stage: 'development', successCount: 4 });
		// Read in the site's container, at the standalone layout's path.
		const read = calls.find(
			(call) =>
				call.op === 'exec' &&
				(call.args as { service: string }).service === 'web',
		);
		expect((read?.args as { command: string[] }).command).toEqual([
			'node',
			'-e',
			expect.any(String),
			'/app/apps/web/.next/prerender-manifest.json',
		]);
		expect(sent).toHaveLength(4);
		expect(sent.every((id) => id === PREVIEW_MODE_ID)).toBe(true);
		expect(logs(seen, 'info')).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/✓ web +warmed 3 page\(s\)$/),
			]),
		);
		// The id is the site's secret: it is sent, never said.
		expect(JSON.stringify(seen)).not.toContain(PREVIEW_MODE_ID);
	});

	it('warns once and warms with plain requests where the id cannot be read, saying which pages came from the build cache', async () => {
		writeComposeApp(dir, {
			registry: 'registry.example.com/acme',
			siteVariant: 'next',
		});
		const sent: (string | undefined)[] = [];
		const { seen, result } = await deployWith(
			async ({ url, headers }) => {
				sent.push(headers?.['x-prerender-revalidate']);
				const { pathname } = new URL(url);
				return {
					status: 200,
					headers: { 'x-nextjs-cache': pathname === '/live' ? 'MISS' : 'HIT' },
					body:
						pathname === '/sitemap.xml'
							? `<urlset><url><loc>https://compose-app.localhost/about</loc></url><url><loc>https://compose-app.localhost/live</loc></url></urlset>`
							: '',
				};
			},
			{
				exec: (_stack, _service, command) =>
					command[0] === 'node'
						? { code: 3, stdout: '', stderr: '' }
						: undefined,
			},
		);

		expect(result).toMatchObject({ stage: 'development', successCount: 4 });
		expect(sent.every((id) => id === undefined)).toBe(true);
		const warned = logs(seen, 'warn').filter((line) =>
			line.includes("can't force ISR pages to render"),
		);
		expect(warned).toHaveLength(1);
		expect(warned[0]).toContain('has no preview.previewModeId');
		expect(logs(seen, 'info')).toEqual(
			expect.arrayContaining([
				expect.stringContaining(
					'web          warmed 3 page(s), 3 served from the build cache: /sitemap.xml, /, /about',
				),
			]),
		);
	});

	it('only warns when the edge does not answer the warm-up at all', async () => {
		writeComposeApp(dir, {
			registry: 'registry.example.com/acme',
			siteVariant: 'tanstack',
		});
		const { seen, result } = await deployWith(async ({ url, timeoutMs }) => {
			throw new HealthRequestTimedOut(url, timeoutMs);
		});

		expect(result).toMatchObject({ stage: 'development', successCount: 4 });
		expect(logs(seen, 'warn')).toEqual(
			expect.arrayContaining([
				expect.stringContaining('web          warmed 0 page(s), 2 warning(s)'),
				expect.stringContaining(
					'https://compose-app.localhost/: no answer within 30000ms',
				),
			]),
		);
	});

	it('never warms a static site: its pages are files', async () => {
		const { result, ops } = await deployWith(async () => ({
			status: 200,
			body: '',
		}));

		expect(result).toMatchObject({ successCount: 4 });
		expect(ops).not.toContain('warm');
	});
});

describe(
	"a site pre-rendered against its stage (prerender: 'stage')",
	{
		timeout: RUN_TIMEOUT,
	},
	() => {
		beforeEach(() => {
			writeComposeApp(dir, {
				registry: 'registry.example.com/acme',
				sitePrerender: true,
			});
		});

		async function deployWith(
			probe: (url: string) => number,
		): Promise<{ seen: DeployEvent[]; result: unknown; calls: Call[] }> {
			const fake = fakeDocker();
			const run = deploy({
				cwd: dir,
				stage: 'development',
				target: 'compose',
				targets: {
					compose: composeTarget({
						...quiet(),
						healthAttempts: 2,
						docker: fake.docker,
						server: fakeServer([]),
						probe: async ({ url }) => {
							fake.calls.push({ op: 'probe', args: url });
							return probe(url);
						},
					}),
				},
			});
			const seen = await events(run);
			const result = await run.result.catch((error: unknown) => error);
			return { seen, result, calls: fake.calls };
		}

		/** `build` and `up` as they were asked of the stack, and each probe, in order. */
		const steps = (calls: Call[]) =>
			calls
				.filter((c) => ['build', 'up', 'probe'].includes(c.op) && !c.edge)
				.map((c) => ({ op: c.op, args: c.args }));

		it('is built only once the APIs it depends on are up and answer through the edge', async () => {
			const { seen, result, calls } = await deployWith(() => 200);

			expect(result).toMatchObject({ stage: 'development', successCount: 4 });
			const order = steps(calls);
			const at = (match: (s: (typeof order)[number]) => boolean) =>
				order.findIndex(match);

			// Everything else is built first; the site is held back.
			const first = at((s) => s.op === 'build');
			expect(order[first]?.args).toEqual(['api', 'auth', 'jobs']);
			// The stack but the site is started, and healthy by its own checks…
			const started = at(
				(s) =>
					s.op === 'up' &&
					Array.isArray(s.args) &&
					(s.args as string[]).includes('caddy'),
			);
			expect(started).toBeGreaterThan(first);
			expect(order[started]?.args).toEqual(
				expect.arrayContaining(['api', 'auth', 'jobs', 'caddy', 'postgres']),
			);
			expect(order[started]?.args).not.toContain('web');
			// …each API it calls answers through the edge…
			const asked = order
				.slice(started)
				.filter((s) => s.op === 'probe')
				.slice(0, 2)
				.map((s) => s.args as string);
			expect(asked.sort()).toEqual([
				'https://api.compose-app.localhost/health',
				'https://auth.compose-app.localhost/health',
			]);
			// …and only then is it built, then the whole stack started.
			const site = at(
				(s) => s.op === 'build' && (s.args as string[])[0] === 'web',
			);
			expect(order[site]?.args).toEqual(['web']);
			expect(site).toBeGreaterThan(started + 2);
			expect(at((s) => s.op === 'up' && s.args === 'all')).toBeGreaterThan(
				site,
			);

			const built = seen
				.filter((e) => e.type === 'artifact.built')
				.map((e) => (e as { app: string }).app);
			expect(built).toEqual(['api', 'auth', 'jobs', 'web']);
		});

		it('is not built when an API it depends on does not answer, and nothing more is started', async () => {
			const { seen, calls } = await deployWith((url) =>
				url.startsWith('https://api.') ? 503 : 200,
			);

			expect(seen).toContainEqual({
				type: 'phase.failed',
				phase: 'release',
				error: {
					name: 'SitePrerenderApisDown',
					message: expect.stringContaining(
						"'web' pre-renders from its stage's APIs (prerender: 'stage'), and this one does not answer, so it was not built:\n  - https://api.compose-app.localhost/health: HTTP 503",
					),
				},
			});
			const order = steps(calls);
			expect(order).not.toContainEqual({ op: 'build', args: ['web'] });
			expect(order).not.toContainEqual({ op: 'up', args: 'all' });
		});

		it('is never held back when pulled: its image was built against the stage when it was pushed', async () => {
			await serveFrom(dir);
			const fake = fakeDocker({
				registry: [
					'registry.example.com/acme/compose-app/compose-app-api:v1.4.0',
					'registry.example.com/acme/compose-app/compose-app-auth:v1.4.0',
					'registry.example.com/acme/compose-app/compose-app-jobs:v1.4.0',
					'registry.example.com/acme/compose-app/compose-app-web:v1.4.0-production',
				],
			});
			const run = deploy({
				cwd: dir,
				stage: 'production',
				target: 'compose',
				tag: 'v1.4.0',
				targets: {
					compose: composeTarget({
						...quiet(),
						docker: fake.docker,
						server: fakeServer(fake.calls),
						probe: answering(fake.calls),
					}),
				},
			});
			await events(run);
			await run.result;

			expect(fake.ops()).not.toContain('build');
			// One start of the whole stack; none of the stack but the site.
			const ups = fake.calls.filter((c) => c.op === 'up' && !c.edge);
			expect(
				ups.filter(
					(c) =>
						Array.isArray(c.args) && (c.args as string[]).includes('caddy'),
				),
			).toEqual([]);
		});
	},
);
