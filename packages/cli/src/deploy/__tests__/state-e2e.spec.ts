/**
 * Workspace config to stored state, end to end.
 *
 * - Local: the store writes `.gkm/deploy-{stage}.json`, schema v2
 * - SSM: the store writes `/gkm/<workspace>/<stage>/state` on the AWS emulator,
 *   and nothing locally — SSM is read directly, so no stale local copy can
 *   stand in for it
 *
 * SSM tests require the emulator: docker compose up -d localstack
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	DeleteParameterCommand,
	GetParameterCommand,
	PutParameterCommand,
	SSMClient,
} from '@aws-sdk/client-ssm';
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
import { normalizeWorkspace } from '../../workspace/index';
import type { WorkspaceConfig } from '../../workspace/types';
import { LocalStateStore } from '../LocalStateStore';
import { SSMStateStore } from '../SSMStateStore';
import { createStateStore } from '../StateStore';
import type { DokployStageState } from '../state';

describe('State store E2E', () => {
	const testStage = 'e2e-test';

	const createTestState = (
		overrides?: Partial<DokployStageState>,
	): DokployStageState => ({
		provider: 'dokploy',
		stage: testStage,
		projectId: 'proj_e2e_123',
		environmentId: 'env_e2e_123',
		applications: { api: 'app_e2e_123', web: 'app_e2e_456' },
		services: { postgresId: 'pg_e2e_123', redisId: 'redis_e2e_123' },
		lastDeployedAt: '2024-01-01T00:00:00.000Z',
		...overrides,
	});

	const workspaceConfig = (
		name: string,
		state?: WorkspaceConfig['state'],
	): WorkspaceConfig => ({
		stages: { local: 'development', deployed: ['production'] },
		name,
		apps: {
			api: {
				type: 'backend',
				path: 'apps/api',
				port: 3000,
				routes: './src/**/*.ts',
			},
		},
		...(state ? { state } : {}),
	});

	describe('local', () => {
		let testDir: string;

		beforeEach(async () => {
			testDir = join(tmpdir(), `gkm-e2e-local-${Date.now()}`);
			await mkdir(testDir, { recursive: true });
		});

		afterEach(async () => {
			await rm(testDir, { recursive: true, force: true });
		});

		it.each([
			['state.provider = local', { provider: 'local' as const }],
			['no state config (the default)', undefined],
		])('writes the stage to .gkm with %s', async (_, state) => {
			const workspace = normalizeWorkspace(
				workspaceConfig('e2e-local-test', state),
				testDir,
			);
			expect(workspace.state).toEqual(state);

			const store = await createStateStore({
				config: workspace.state,
				workspaceRoot: workspace.root,
				workspaceName: workspace.name,
			});
			expect(store).toBeInstanceOf(LocalStateStore);

			await store.write(testStage, createTestState(), {
				expectedVersion: null,
			});

			const document = JSON.parse(
				await readFile(
					join(testDir, '.gkm', `deploy-${testStage}.json`),
					'utf-8',
				),
			);
			expect(document).toMatchObject({
				schemaVersion: 2,
				stage: testStage,
				state: {
					provider: 'dokploy',
					environmentId: 'env_e2e_123',
					applications: { api: 'app_e2e_123', web: 'app_e2e_456' },
					services: { postgresId: 'pg_e2e_123', redisId: 'redis_e2e_123' },
				},
				resources: {},
			});
		});

		it('reads the state back through the store', async () => {
			const workspace = normalizeWorkspace(
				workspaceConfig('e2e-read-test', { provider: 'local' }),
				testDir,
			);
			const store = await createStateStore({
				config: workspace.state,
				workspaceRoot: workspace.root,
				workspaceName: workspace.name,
			});

			await store.write(testStage, createTestState(), {
				expectedVersion: null,
			});
			const stored = await store.read(testStage);

			expect(stored?.state.environmentId).toBe('env_e2e_123');
			expect(stored?.state.applications).toEqual({
				api: 'app_e2e_123',
				web: 'app_e2e_456',
			});
		});
	});

	describe('ssm', () => {
		const workspaceName = 'e2e-ssm-test';
		const parameter = `/gkm/${workspaceName}/${testStage}/state`;
		let ssmClient: SSMClient;
		let testDir: string;

		beforeAll(() => {
			// How `createStateStore` reaches the emulator: the SDK's own
			// per-service endpoint variable, as any client would.
			vi.stubEnv('AWS_ENDPOINT_URL_SSM', LOCALSTACK_URL);
			vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
			vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
		});

		beforeEach(async () => {
			testDir = join(tmpdir(), `gkm-e2e-ssm-${Date.now()}`);
			await mkdir(testDir, { recursive: true });

			ssmClient = new SSMClient({
				region: 'us-east-1',
				endpoint: LOCALSTACK_URL,
				credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
			});
		});

		afterEach(async () => {
			for (const leaf of ['state', 'state.v1', 'lock']) {
				await ssmClient
					.send(
						new DeleteParameterCommand({
							Name: `/gkm/${workspaceName}/${testStage}/${leaf}`,
						}),
					)
					.catch(() => {});
			}
			await rm(testDir, { recursive: true, force: true });
		});

		afterAll(() => {
			ssmClient.destroy();
			vi.unstubAllEnvs();
		});

		const ssmWorkspace = () =>
			normalizeWorkspace(
				workspaceConfig(workspaceName, {
					provider: 'ssm',
					region: 'us-east-1',
				}),
				testDir,
			);

		it('writes the stage to SSM, and nothing locally', async () => {
			const workspace = ssmWorkspace();
			expect(workspace.state).toEqual({ provider: 'ssm', region: 'us-east-1' });

			const store = await createStateStore({
				config: workspace.state,
				workspaceRoot: workspace.root,
				workspaceName: workspace.name,
			});
			expect(store).toBeInstanceOf(SSMStateStore);

			await store.write(testStage, createTestState(), {
				expectedVersion: null,
			});

			const response = await ssmClient.send(
				new GetParameterCommand({ Name: parameter, WithDecryption: true }),
			);
			expect(JSON.parse(response.Parameter!.Value!)).toMatchObject({
				schemaVersion: 2,
				state: {
					stage: testStage,
					environmentId: 'env_e2e_123',
					applications: { api: 'app_e2e_123', web: 'app_e2e_456' },
				},
			});
			// The old provider cached every write under .gkm, which is how a
			// stale copy came to win over SSM.
			expect(existsSync(join(testDir, '.gkm'))).toBe(false);
		});

		it('reads a state written before stores, migrating it in place', async () => {
			const preExisting: DokployStageState = {
				provider: 'dokploy',
				stage: testStage,
				projectId: 'proj_test',
				environmentId: 'env_pre_existing',
				applications: { api: 'app_pre_123' },
				services: { postgresId: 'pg_pre_123' },
				lastDeployedAt: '2024-06-01T00:00:00.000Z',
			};
			await ssmClient.send(
				new PutParameterCommand({
					Name: parameter,
					Value: JSON.stringify(preExisting),
					Type: 'SecureString',
					Overwrite: true,
				}),
			);

			const workspace = ssmWorkspace();
			const store = await createStateStore({
				config: workspace.state,
				workspaceRoot: workspace.root,
				workspaceName: workspace.name,
			});
			const stored = await store.read(testStage);

			expect(stored?.state.environmentId).toBe('env_pre_existing');
			expect(stored?.resources['application:api']).toMatchObject({
				status: 'ready',
				id: 'app_pre_123',
			});
			const backup = await ssmClient.send(
				new GetParameterCommand({
					Name: `/gkm/${workspaceName}/${testStage}/state.v1`,
					WithDecryption: true,
				}),
			);
			expect(JSON.parse(backup.Parameter!.Value!)).toEqual(preExisting);
		});
	});
});
