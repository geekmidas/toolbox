/**
 * `gkm state:pull | push | show | diff`, against a real workspace.
 *
 * The workspace is a temp directory with its own gkm.config.ts. Local state is
 * the file under `.gkm/`; remote state is SSM on the AWS emulator, reached the
 * way any SDK client would reach it — `AWS_ENDPOINT_URL_SSM` — since
 * `createStateStore` builds its own client from the config.
 *
 * Requires the emulator: docker compose up -d localstack
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { projectBucket } from '../../providers/projectBucket';
import { currentActor, describeActor } from '../actor';
import { LocalStateStore } from '../LocalStateStore';
import { S3StateStore } from '../S3StateStore';
import { SSMStateStore } from '../SSMStateStore';
import { COMPRESSED_PREFIX, StateLocked, type StateStore } from '../StateStore';
import {
	createComposeState,
	type DokployStageState,
	recordRelease,
} from '../state';
import {
	stateDiffCommand,
	stateHistoryCommand,
	statePullCommand,
	statePushCommand,
	stateShowCommand,
	stateUnlockCommand,
} from '../state-commands';
import { busyResources, busyState } from './__helpers__/busyStage';

const STAGE = 'production';

/** `process.exit` would end the test run; this lets a test observe it. */
class ExitCalled extends Error {
	constructor(readonly code: number | undefined) {
		super(`process.exit(${code})`);
		this.name = 'ExitCalled';
	}
}

const state = (
	overrides: Partial<DokployStageState> = {},
): DokployStageState => ({
	provider: 'dokploy',
	stage: STAGE,
	projectId: 'proj_1',
	environmentId: 'env_1',
	applications: { api: 'app_api', web: 'app_web' },
	services: { postgresId: 'pg_1', redisId: 'redis_1' },
	lastDeployedAt: '2026-01-01T00:00:00.000Z',
	...overrides,
});

describe('state commands', () => {
	let root: string;
	let cwd: string;
	let name: string;
	let out: string[];
	let err: string[];

	beforeAll(() => {
		vi.stubEnv('AWS_ENDPOINT_URL_SSM', LOCALSTACK_URL);
		vi.stubEnv('AWS_ENDPOINT_URL_S3', LOCALSTACK_URL);
		vi.stubEnv('AWS_ENDPOINT_URL_STS', LOCALSTACK_URL);
		vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
		vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
	});

	afterAll(() => {
		vi.unstubAllEnvs();
	});

	/** A workspace whose state lives where `provider` says. */
	function workspace(provider: 'ssm' | 's3' | 'local' | undefined) {
		const block =
			provider === 'ssm'
				? "state: { provider: 'ssm', region: 'us-east-1' },"
				: provider === 's3'
					? "state: { provider: 's3', region: 'us-east-1' },"
					: provider === 'local'
						? "state: { provider: 'local' },"
						: '';
		writeFileSync(
			join(root, 'gkm.config.ts'),
			`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: '${name}',
  constructs: './constructs/**/*.ts',
  stages: { local: 'dev', deployed: ['${STAGE}'] },
  ${block}
});
`,
		);
	}

	/** A store seen as whole states, the way these tests set them up. */
	const view = (store: StateStore) => ({
		store,
		read: async (stage: string) => (await store.read(stage))?.state ?? null,
		write: async (stage: string, value: DokployStageState) => {
			const current = await store.read(stage);
			await store.write(stage, value, {
				expectedVersion: current?.version ?? null,
			});
		},
	});
	const local = () => view(new LocalStateStore(root));
	const remote = () =>
		view(SSMStateStore.create({ workspaceName: name, region: 'us-east-1' }));
	const said = () => out.join('\n');

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'gkm-state-cmd-'));
		// One workspace name per test, so SSM parameters never leak between them.
		name = `state-cmd-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
		cwd = process.cwd();
		process.chdir(root);
		out = [];
		err = [];
		vi.spyOn(console, 'log').mockImplementation((...a) => {
			out.push(a.join(' '));
		});
		vi.spyOn(console, 'error').mockImplementation((...a) => {
			err.push(a.join(' '));
		});
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new ExitCalled(code as number | undefined);
		});
	});

	afterEach(() => {
		process.chdir(cwd);
		vi.restoreAllMocks();
		rmSync(root, { recursive: true, force: true });
	});

	describe('state:pull', () => {
		it('copies remote state down and summarises it', async () => {
			workspace('ssm');
			await remote().write(STAGE, state());

			await statePullCommand({ stage: STAGE });

			expect(await local().read(STAGE)).toMatchObject({
				applications: { api: 'app_api', web: 'app_web' },
			});
			expect(said()).toContain('State pulled successfully.');
			expect(said()).toContain('Applications: 2');
			expect(said()).toContain('Postgres: configured');
			expect(said()).toContain('Redis: configured');
		});

		it('brings the resource records down with the state', async () => {
			workspace('ssm');
			const ssm = remote();
			await ssm.write(STAGE, state());
			await ssm.store.putResource(STAGE, {
				key: 'application:api',
				type: 'application',
				status: 'pending',
				data: { name: 'production-shop-api' },
			});
			// A record only the local copy has is not the remote's.
			const mine = local();
			await mine.write(STAGE, state());
			await mine.store.putResource(STAGE, {
				key: 'application:old',
				type: 'application',
				id: 'app_old',
				status: 'ready',
			});

			await statePullCommand({ stage: STAGE });

			const pulled = await mine.store.read(STAGE);
			expect(Object.keys(pulled!.resources)).toEqual(['application:api']);
			expect(pulled!.resources['application:api']).toMatchObject({
				status: 'pending',
				data: { name: 'production-shop-api' },
			});
		});

		it('says so when the stage has no remote state', async () => {
			workspace('ssm');

			await statePullCommand({ stage: STAGE });

			expect(said()).toContain('No remote state found for this stage.');
			expect(await local().read(STAGE)).toBeNull();
		});

		it('refuses a workspace with no remote provider', async () => {
			workspace('local');

			await expect(statePullCommand({ stage: STAGE })).rejects.toThrow(
				ExitCalled,
			);
			expect(err[0]).toBe('No remote state provider configured.');
		});
	});

	describe('state:push', () => {
		it('copies local state up and summarises it', async () => {
			workspace('ssm');
			await local().write(STAGE, state({ services: {} }));

			await statePushCommand({ stage: STAGE });

			expect(await remote().read(STAGE)).toMatchObject({
				projectId: 'proj_1',
			});
			expect(said()).toContain('State pushed successfully.');
			expect(said()).toContain('Postgres: none');
			expect(said()).toContain('Redis: none');
		});

		it('migrates a v1 state file on the way up', async () => {
			workspace('ssm');
			mkdirSync(join(root, '.gkm'), { recursive: true });
			writeFileSync(
				join(root, '.gkm', `deploy-${STAGE}.json`),
				JSON.stringify(state()),
			);

			await statePushCommand({ stage: STAGE });

			const pushed = await remote().store.read(STAGE);
			expect(pushed?.state).toMatchObject({ projectId: 'proj_1' });
			// v1's ids arrive as records, so a deploy reading the remote adopts
			// them rather than treating them as unknown.
			expect(pushed?.resources['application:api']).toMatchObject({
				status: 'ready',
				id: 'app_api',
			});
		});

		it('refuses while a deploy holds the remote stage, and changes nothing', async () => {
			workspace('ssm');
			const ssm = remote();
			await ssm.write(STAGE, state({ projectId: 'proj_remote' }));
			await local().write(STAGE, state({ projectId: 'proj_local' }));
			const deploying = await ssm.store.lock(STAGE, { operation: 'deploy' });

			await expect(statePushCommand({ stage: STAGE })).rejects.toBeInstanceOf(
				StateLocked,
			);

			expect(await ssm.read(STAGE)).toMatchObject({
				projectId: 'proj_remote',
			});
			await deploying.release();
		});

		it('says so when the stage has no local state', async () => {
			workspace('ssm');

			await statePushCommand({ stage: STAGE });

			expect(said()).toContain('No local state found for this stage.');
		});

		it('refuses a workspace with no state block at all', async () => {
			workspace(undefined);

			await expect(statePushCommand({ stage: STAGE })).rejects.toThrow(
				ExitCalled,
			);
			expect(err).toContain('No remote state provider configured.');
		});
	});

	describe('state:show', () => {
		it('prints every part of the state', async () => {
			workspace('local');
			await local().write(
				STAGE,
				state({
					dnsVerified: {
						'api.example.com': {
							serverIp: '1.2.3.4',
							verifiedAt: '2026-01-02T00:00:00.000Z',
						},
					},
				}),
			);

			await stateShowCommand({ stage: STAGE });

			expect(out).toEqual(
				expect.arrayContaining([
					`Stage: ${STAGE}`,
					'Environment ID: env_1',
					'  api: app_api',
					'  web: app_web',
					'  Postgres: pg_1',
					'  Redis: redis_1',
					'DNS Verified:',
					'  api.example.com: 1.2.3.4 (2026-01-02T00:00:00.000Z)',
				]),
			);
		});

		it('says "(none)" for an empty stage', async () => {
			workspace('local');
			await local().write(STAGE, state({ applications: {}, services: {} }));

			await stateShowCommand({ stage: STAGE });

			expect(out.filter((line) => line === '  (none)')).toHaveLength(2);
			expect(said()).not.toContain('DNS Verified:');
		});

		it('prints only one service when only one exists', async () => {
			workspace('local');
			await local().write(STAGE, state({ services: { redisId: 'redis_9' } }));

			await stateShowCommand({ stage: STAGE });

			expect(said()).toContain('  Redis: redis_9');
			expect(said()).not.toContain('Postgres:');
		});

		it('prints JSON with --json', async () => {
			workspace('local');
			await local().write(STAGE, state());

			await stateShowCommand({ stage: STAGE, json: true });

			expect(JSON.parse(out[0]!)).toMatchObject({ environmentId: 'env_1' });
		});

		/** A stage holding every kind of secret deploy keeps. */
		const withSecrets = () =>
			state({
				appCredentials: {
					api: { dbUser: 'api_user', dbPassword: 'pg-password-api' },
				},
				generatedSecrets: { api: { BETTER_AUTH_SECRET: 'auth-secret-api' } },
				backups: {
					bucketName: 'backups-bucket',
					bucketArn: 'arn:aws:s3:::backups-bucket',
					iamUserName: 'backup-user',
					iamAccessKeyId: 'AKIAEXAMPLEKEYID',
					iamSecretAccessKey: 'iam-secret-access-key',
					destinationId: 'dest_1',
					region: 'us-east-1',
					createdAt: '2026-01-01T00:00:00.000Z',
				},
			});
		const secrets = [
			'pg-password-api',
			'auth-secret-api',
			'AKIAEXAMPLEKEYID',
			'iam-secret-access-key',
		];

		it('masks database passwords, generated secrets and IAM keys', async () => {
			workspace('local');
			await local().write(STAGE, withSecrets());

			await stateShowCommand({ stage: STAGE });

			for (const secret of secrets) {
				expect(said()).not.toContain(secret);
			}
			expect(out).toEqual(
				expect.arrayContaining([
					'  api: api_user / ********',
					'  api.BETTER_AUTH_SECRET: ********',
					'  Bucket: backups-bucket',
					'  IAM Access Key: ********',
					'  IAM Secret Key: ********',
				]),
			);
		});

		it('masks the same secrets in --json', async () => {
			workspace('local');
			await local().write(STAGE, withSecrets());

			await stateShowCommand({ stage: STAGE, json: true });

			for (const secret of secrets) {
				expect(said()).not.toContain(secret);
			}
			expect(JSON.parse(out[0]!)).toMatchObject({
				appCredentials: { api: { dbUser: 'api_user', dbPassword: '********' } },
				backups: {
					bucketName: 'backups-bucket',
					iamSecretAccessKey: '********',
				},
			});
		});

		it('lists what a deploy stopped while creating', async () => {
			workspace('local');
			const mine = local();
			await mine.write(STAGE, state());
			await mine.store.putResource(STAGE, {
				key: 'domain:api.example.com',
				type: 'domain',
				status: 'pending',
			});

			await stateShowCommand({ stage: STAGE });

			expect(out).toEqual(
				expect.arrayContaining([
					'Unfinished (a deploy stopped while creating these):',
					'  domain:api.example.com',
				]),
			);
		});

		it('reads the remote store directly, never a stale local copy', async () => {
			workspace('ssm');
			await local().write(STAGE, state({ environmentId: 'env_stale' }));
			await remote().write(STAGE, state({ environmentId: 'env_remote' }));

			await stateShowCommand({ stage: STAGE });

			expect(out).toContain('Environment ID: env_remote');
		});

		it('says so when the stage has no state', async () => {
			workspace(undefined);

			await stateShowCommand({ stage: STAGE });

			expect(said()).toBe(`No state found for stage: ${STAGE}`);
		});
	});

	describe('a busy stage, stored compressed in SSM', () => {
		/** The busy stage, written into SSM the way deploys write it. */
		async function busyInSsm(): Promise<void> {
			const store = remote().store;
			let version = await store.write(STAGE, busyState(STAGE), {
				expectedVersion: null,
			});
			for (const record of busyResources(STAGE)) {
				version = await store.putResource(STAGE, record, {
					expectedVersion: version,
				});
			}
			const { Parameter } = await new SSMClient({
				region: 'us-east-1',
				endpoint: LOCALSTACK_URL,
			}).send(
				new GetParameterCommand({
					Name: `/gkm/${name}/${STAGE}/state`,
					WithDecryption: true,
				}),
			);
			expect(Parameter?.Value?.startsWith(COMPRESSED_PREFIX)).toBe(true);
		}

		it('state:show reads it', async () => {
			workspace('ssm');
			await busyInSsm();

			await stateShowCommand({ stage: STAGE, json: true });

			expect(JSON.parse(said())).toEqual(busyState(STAGE));
		});

		it('state:pull brings it down whole', async () => {
			workspace('ssm');
			await busyInSsm();

			await statePullCommand({ stage: STAGE });

			const pulled = await local().store.read(STAGE);
			expect(pulled?.state).toEqual(busyState(STAGE));
			expect(Object.keys(pulled!.resources)).toEqual(
				busyResources(STAGE).map((r) => r.key),
			);
		});

		it('moves to the project bucket: pull with ssm, switch to s3, push', async () => {
			workspace('ssm');
			await busyInSsm();
			await statePullCommand({ stage: STAGE });

			// The config switched to s3. A config module is imported once per
			// process — each gkm command is a process of its own — so the switch
			// is made in a copy of the workspace, with the pulled state in it.
			const pulledInto = root;
			root = mkdtempSync(join(tmpdir(), 'gkm-state-cmd-s3-'));
			cpSync(join(pulledInto, '.gkm'), join(root, '.gkm'), {
				recursive: true,
			});
			process.chdir(root);
			workspace('s3');
			await statePushCommand({ stage: STAGE });
			rmSync(pulledInto, { recursive: true, force: true });

			const s3 = S3StateStore.create({
				workspaceName: name,
				region: 'us-east-1',
			});
			const moved = await s3.read(STAGE);
			expect(moved?.state).toEqual(busyState(STAGE));
			expect(Object.keys(moved!.resources)).toEqual(
				busyResources(STAGE).map((r) => r.key),
			);
			expect(s3.bucket).toBe(
				projectBucket({ name }, { accountId: '000000000000' }),
			);

			// And deploys read it there: state:show with the s3 config.
			out = [];
			await stateShowCommand({ stage: STAGE, json: true });
			expect(JSON.parse(said())).toEqual(busyState(STAGE));
		});
	});

	describe('state in the project bucket', () => {
		it('state:show of a project with no bucket yet creates none', async () => {
			workspace('s3');

			await stateShowCommand({ stage: STAGE });

			expect(said()).toBe(`No state found for stage: ${STAGE}`);
			const bucket = projectBucket({ name }, { accountId: '000000000000' });
			const found = await new S3Client({
				region: 'us-east-1',
				endpoint: LOCALSTACK_URL,
				forcePathStyle: true,
			})
				.send(new HeadBucketCommand({ Bucket: bucket }))
				.then(
					() => true,
					() => false,
				);
			expect(found).toBe(false);
		});
	});

	describe('state:push of a compose stage kept on a laptop', () => {
		it('moves a local v2 document into SSM as v3, DNS records as resources', async () => {
			workspace('ssm');
			mkdirSync(join(root, '.gkm'), { recursive: true });
			writeFileSync(
				join(root, '.gkm', `deploy-${STAGE}.json`),
				JSON.stringify({
					schemaVersion: 2,
					stage: STAGE,
					serial: 4,
					state: {
						provider: 'dokploy',
						stage: STAGE,
						projectId: '',
						environmentId: '',
						applications: {},
						services: {},
						releases: {
							api: {
								current: {
									ref: 'ghcr.io/acme/api:v1',
									releasedAt: '2026-09-01T00:00:00.000Z',
								},
								history: [
									{
										ref: 'ghcr.io/acme/api:v1',
										releasedAt: '2026-09-01T00:00:00.000Z',
									},
								],
							},
						},
						dnsRecords: {
							'api:A': {
								domain: 'example.com',
								name: 'api',
								type: 'A',
								value: '203.0.113.10',
								ttl: 600,
								createdAt: '2026-09-01T00:00:00.000Z',
							},
						},
						lastDeployedAt: '2026-09-01T00:00:00.000Z',
					},
					resources: {},
					updatedAt: '2026-09-01T00:00:00.000Z',
				}),
			);

			await statePushCommand({ stage: STAGE });

			const ssm = new SSMClient({ region: 'us-east-1' });
			const { Parameter } = await ssm.send(
				new GetParameterCommand({
					Name: `/gkm/${name}/${STAGE}/state`,
					WithDecryption: true,
				}),
			);
			const document = JSON.parse(Parameter!.Value!);
			expect(document).toMatchObject({
				schemaVersion: 3,
				state: {
					provider: 'compose',
					stage: STAGE,
					releases: { api: { current: { ref: 'ghcr.io/acme/api:v1' } } },
				},
				resources: {
					'dns-record:api.example.com:A': {
						type: 'dns-record',
						id: 'api.example.com A',
						status: 'ready',
						data: { domain: 'example.com', name: 'api', value: '203.0.113.10' },
					},
				},
				updatedBy: currentActor(),
			});
			expect(document.state).not.toHaveProperty('projectId');
			expect(document.history[0]).toMatchObject({ operation: 'state:push' });
			expect(said()).toContain('State pushed successfully.');
		});
	});

	describe('state:history', () => {
		async function deployed() {
			workspace('local');
			const store = new LocalStateStore(root);
			const lock = await store.lock(STAGE, { operation: 'deploy' });
			const state = createComposeState(STAGE);
			recordRelease(
				state,
				'api',
				{ ref: 'ghcr.io/acme/api:v1', digest: 'sha256:aaa' },
				{ kind: 'local', user: 'ada', host: 'laptop' },
			);
			await store.write(STAGE, state, { expectedVersion: null });
			await lock.release();
			const rollback = await store.lock(STAGE, { operation: 'rollback' });
			const stored = (await store.read(STAGE))!;
			await store.write(STAGE, stored.state, {
				expectedVersion: stored.version,
			});
			await rollback.release();
			return (await store.read(STAGE))!;
		}

		it('prints each write newest first, and what each app runs', async () => {
			const { history } = await deployed();
			const me = describeActor(currentActor());

			await stateHistoryCommand({ stage: STAGE });

			expect(out).toEqual([
				`History of stage ${STAGE} (newest first):`,
				`  2 · ${history[0]!.at} · ${me} · rollback`,
				`  1 · ${history[1]!.at} · ${me} · deploy`,
				'',
				'Releases:',
				expect.stringMatching(
					/^ {2}api: ghcr\.io\/acme\/api:v1 \(sha256:aaa\) · .+ · ada@laptop$/,
				),
			]);
		});

		it('prints JSON with --json', async () => {
			const { history } = await deployed();

			await stateHistoryCommand({ stage: STAGE, json: true });

			expect(JSON.parse(said())).toEqual({
				stage: STAGE,
				history,
				releases: {
					api: {
						ref: 'ghcr.io/acme/api:v1',
						digest: 'sha256:aaa',
						releasedAt: expect.any(String),
						releasedBy: { kind: 'local', user: 'ada', host: 'laptop' },
					},
				},
			});
		});

		it('says so when the stage has no state', async () => {
			workspace('local');

			await stateHistoryCommand({ stage: STAGE });

			expect(said()).toBe(`No state found for stage: ${STAGE}`);
		});
	});

	describe('state:unlock', () => {
		it('releases a lock left behind and names who held it', async () => {
			workspace('local');
			const abandoned = await new LocalStateStore(root).lock(STAGE);

			await stateUnlockCommand({ stage: STAGE });

			expect(said()).toContain(
				`Released the lock on stage ${STAGE}, held by ${abandoned.holder.owner}@${abandoned.holder.host} (pid ${process.pid})`,
			);
			const next = await new LocalStateStore(root).lock(STAGE);
			await next.release();
		});

		it('says so when the stage was not locked', async () => {
			workspace('local');

			await stateUnlockCommand({ stage: STAGE });

			expect(said()).toBe(`Stage ${STAGE} was not locked.`);
		});
	});

	describe('state:diff', () => {
		it('names every difference between local and remote', async () => {
			workspace('ssm');
			await local().write(
				STAGE,
				state({
					applications: { api: 'same', web: 'local_web', admin: 'only_local' },
					services: { postgresId: 'pg_same', redisId: 'redis_local' },
				}),
			);
			await remote().write(
				STAGE,
				state({
					applications: { api: 'same', web: 'remote_web', docs: 'only_remote' },
					services: { postgresId: 'pg_same' },
				}),
			);

			await stateDiffCommand({ stage: STAGE });

			expect(out).toEqual(
				expect.arrayContaining([
					// Writing stamps the time, so only the shape is fixed.
					expect.stringMatching(/^Local: {2}Last deployed \d{4}-/),
					expect.stringMatching(/^Remote: Last deployed \d{4}-/),
					'  api: same',
					'  web: local_web (local) != remote_web (remote) [MISMATCH]',
					'  admin: only_local -> (none) [LOCAL ONLY]',
					'  docs: (none) -> only_remote [REMOTE ONLY]',
					'  postgresId: pg_same',
					'  redisId: redis_local (local) != (none) (remote)',
				]),
			);
		});

		it('names resource records the two sides disagree on', async () => {
			workspace('ssm');
			const mine = local();
			const theirs = remote();
			await mine.write(STAGE, state());
			await theirs.write(STAGE, state());
			for (const side of [mine, theirs]) {
				await side.store.putResource(STAGE, {
					key: 'application:api',
					type: 'application',
					id: 'app_api',
					status: 'ready',
				});
			}
			await mine.store.putResource(STAGE, {
				key: 'application:web',
				type: 'application',
				status: 'pending',
			});
			await theirs.store.putResource(STAGE, {
				key: 'application:web',
				type: 'application',
				id: 'app_web',
				status: 'ready',
			});

			await stateDiffCommand({ stage: STAGE });

			expect(out).toContain(
				'  application:web: pending (local) != ready app_web (remote)',
			);
			// Records both sides agree on are not repeated.
			expect(said()).not.toContain('application:api:');
		});

		it('shows a side that has no state as "(none)"', async () => {
			workspace('ssm');
			await remote().write(STAGE, state({ applications: {}, services: {} }));

			await stateDiffCommand({ stage: STAGE });

			expect(out).toContain('Local:  (none)');
			expect(said()).not.toContain('Applications:');
			expect(said()).not.toContain('Services:');
		});

		it('shows a missing remote as "(none)"', async () => {
			workspace('ssm');
			await local().write(STAGE, state());

			await stateDiffCommand({ stage: STAGE });

			expect(out).toContain('Remote: (none)');
			expect(out).toContain('  api: app_api -> (none) [LOCAL ONLY]');
		});

		it('says so when neither side has state', async () => {
			workspace('ssm');

			await stateDiffCommand({ stage: STAGE });

			expect(said()).toContain('No state found (local or remote).');
		});

		it('refuses a workspace with no remote provider', async () => {
			workspace('local');

			await expect(stateDiffCommand({ stage: STAGE })).rejects.toThrow(
				ExitCalled,
			);
			expect(err).toContain(
				'Diff requires a remote provider to compare against.',
			);
		});
	});
});
