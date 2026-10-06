/**
 * `gkm state:pull | push | show | diff`, against a real workspace.
 *
 * The workspace is a temp directory with its own gkm.config.ts. Local state is
 * the file under `.gkm/`; remote state is SSM on the AWS emulator, reached the
 * way any SDK client would reach it — `AWS_ENDPOINT_URL_SSM` — since
 * `createStateProvider` builds its own client from the config.
 *
 * Requires the emulator: docker compose up -d localstack
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { LocalStateProvider } from '../LocalStateProvider';
import { SSMStateProvider } from '../SSMStateProvider';
import type { DokployStageState } from '../state';
import {
	stateDiffCommand,
	statePullCommand,
	statePushCommand,
	stateShowCommand,
} from '../state-commands';

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
		vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
		vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
	});

	afterAll(() => {
		vi.unstubAllEnvs();
	});

	/** A workspace whose state lives where `provider` says. */
	function workspace(provider: 'ssm' | 'local' | undefined) {
		const block =
			provider === 'ssm'
				? "state: { provider: 'ssm', region: 'us-east-1' },"
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

	const local = () => new LocalStateProvider(root);
	const remote = () =>
		SSMStateProvider.create({ workspaceName: name, region: 'us-east-1' });
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

		it('says so when the stage has no state', async () => {
			workspace(undefined);

			await stateShowCommand({ stage: STAGE });

			expect(said()).toBe(`No state found for stage: ${STAGE}`);
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
