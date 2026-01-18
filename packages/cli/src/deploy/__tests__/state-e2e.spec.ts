/**
 * End-to-End State Provider Tests
 *
 * Tests the full flow from workspace config to state storage.
 * - Local: verifies state is written to .gkm/deploy-{stage}.json
 * - SSM: verifies state is written to AWS SSM Parameter Store (via LocalStack)
 *
 * SSM tests require LocalStack: docker compose up -d localstack
 */

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
} from 'vitest';
import { normalizeWorkspace } from '../../workspace/index';
import type { WorkspaceConfig } from '../../workspace/types';
import { CachedStateProvider } from '../CachedStateProvider';
import { LocalStateProvider } from '../LocalStateProvider';
import { SSMStateProvider } from '../SSMStateProvider';
import { createStateProvider } from '../StateProvider';
import type { DokployStageState } from '../state';

describe('State Provider E2E', () => {
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

	describe('Local State Provider', () => {
		let testDir: string;

		beforeEach(async () => {
			testDir = join(tmpdir(), `gkm-e2e-local-${Date.now()}`);
			await mkdir(testDir, { recursive: true });
		});

		afterEach(async () => {
			await rm(testDir, { recursive: true, force: true });
		});

		it('should write state to filesystem when config has state.provider = local', async () => {
			// 1. Create workspace config with local state provider
			const config: WorkspaceConfig = {
				name: 'e2e-local-test',
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
					},
				},
				state: { provider: 'local' },
			};

			// 2. Normalize the workspace (simulates loadWorkspaceConfig)
			const workspace = normalizeWorkspace(config, testDir);

			// 3. Verify state config is passed through
			expect(workspace.state).toEqual({ provider: 'local' });

			// 4. Create state provider from workspace config
			const provider = await createStateProvider({
				config: workspace.state,
				workspaceRoot: workspace.root,
				workspaceName: workspace.name,
			});

			// 5. Write state
			const state = createTestState();
			await provider.write(testStage, state);

			// 6. Verify state was written to filesystem directly
			const stateFilePath = join(testDir, '.gkm', `deploy-${testStage}.json`);
			const fileContent = await readFile(stateFilePath, 'utf-8');
			const storedState = JSON.parse(fileContent);

			expect(storedState.provider).toBe('dokploy');
			expect(storedState.stage).toBe(testStage);
			expect(storedState.environmentId).toBe('env_e2e_123');
			expect(storedState.applications).toEqual({
				api: 'app_e2e_123',
				web: 'app_e2e_456',
			});
			expect(storedState.services).toEqual({
				postgresId: 'pg_e2e_123',
				redisId: 'redis_e2e_123',
			});
			expect(storedState.lastDeployedAt).toBeDefined();
		});

		it('should write state to filesystem when state config is undefined (default)', async () => {
			// 1. Create workspace config WITHOUT state (should default to local)
			const config: WorkspaceConfig = {
				name: 'e2e-default-test',
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
					},
				},
				// No state config - should default to local
			};

			// 2. Normalize the workspace
			const workspace = normalizeWorkspace(config, testDir);

			// 3. Verify state config is undefined
			expect(workspace.state).toBeUndefined();

			// 4. Create state provider (should create LocalStateProvider)
			const provider = await createStateProvider({
				config: workspace.state,
				workspaceRoot: workspace.root,
				workspaceName: workspace.name,
			});

			// 5. Write state
			const state = createTestState();
			await provider.write(testStage, state);

			// 6. Verify state was written to filesystem
			const stateFilePath = join(testDir, '.gkm', `deploy-${testStage}.json`);
			const fileContent = await readFile(stateFilePath, 'utf-8');
			const storedState = JSON.parse(fileContent);

			expect(storedState.environmentId).toBe('env_e2e_123');
			expect(storedState.applications.api).toBe('app_e2e_123');
		});

		it('should read state back correctly through provider', async () => {
			const config: WorkspaceConfig = {
				name: 'e2e-read-test',
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
					},
				},
				state: { provider: 'local' },
			};

			const workspace = normalizeWorkspace(config, testDir);
			const provider = await createStateProvider({
				config: workspace.state,
				workspaceRoot: workspace.root,
				workspaceName: workspace.name,
			});

			// Write state
			const originalState = createTestState();
			await provider.write(testStage, originalState);

			// Read state back
			const readState = await provider.read(testStage);

			expect(readState).not.toBeNull();
			expect(readState!.environmentId).toBe('env_e2e_123');
			expect(readState!.applications).toEqual({
				api: 'app_e2e_123',
				web: 'app_e2e_456',
			});
		});
	});

	describe('SSM State Provider', () => {
		const LOCALSTACK_ENDPOINT = 'http://localhost:4566';
		const workspaceName = 'e2e-ssm-test';
		let ssmClient: SSMClient;
		let testDir: string;

		beforeAll(() => {
			process.env.AWS_ACCESS_KEY_ID = 'test';
			process.env.AWS_SECRET_ACCESS_KEY = 'test';
		});

		beforeEach(async () => {
			testDir = join(tmpdir(), `gkm-e2e-ssm-${Date.now()}`);
			await mkdir(testDir, { recursive: true });

			ssmClient = new SSMClient({
				region: 'us-east-1',
				endpoint: LOCALSTACK_ENDPOINT,
				credentials: {
					accessKeyId: 'test',
					secretAccessKey: 'test',
				},
			});
		});

		afterEach(async () => {
			// Clean up SSM parameter
			try {
				await ssmClient.send(
					new DeleteParameterCommand({
						Name: `/gkm/${workspaceName}/${testStage}/state`,
					}),
				);
			} catch {
				// Ignore if parameter doesn't exist
			}

			// Clean up test directory
			await rm(testDir, { recursive: true, force: true });
		});

		afterAll(() => {
			ssmClient.destroy();
		});

		it('should write state to SSM when config has state.provider = ssm', async () => {
			// 1. Create workspace config with SSM state provider
			const config: WorkspaceConfig = {
				name: workspaceName,
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
					},
				},
				state: { provider: 'ssm', region: 'us-east-1' },
			};

			// 2. Normalize the workspace
			const workspace = normalizeWorkspace(config, testDir);

			// 3. Verify state config is passed through
			expect(workspace.state).toEqual({ provider: 'ssm', region: 'us-east-1' });

			// 4. Create providers with injected SSM client (for LocalStack)
			const local = new LocalStateProvider(workspace.root);
			const ssm = new SSMStateProvider(workspace.name, ssmClient);
			const provider = new CachedStateProvider(ssm, local);

			// 5. Write state
			const state = createTestState();
			await provider.write(testStage, state);

			// 6. Query SSM directly to verify state was written
			const response = await ssmClient.send(
				new GetParameterCommand({
					Name: `/gkm/${workspaceName}/${testStage}/state`,
					WithDecryption: true,
				}),
			);

			expect(response.Parameter).toBeDefined();
			expect(response.Parameter!.Value).toBeDefined();

			const storedState = JSON.parse(response.Parameter!.Value!);
			expect(storedState.provider).toBe('dokploy');
			expect(storedState.stage).toBe(testStage);
			expect(storedState.environmentId).toBe('env_e2e_123');
			expect(storedState.applications).toEqual({
				api: 'app_e2e_123',
				web: 'app_e2e_456',
			});
			expect(storedState.services).toEqual({
				postgresId: 'pg_e2e_123',
				redisId: 'redis_e2e_123',
			});
		});

		it('should read state from SSM correctly', async () => {
			// 1. Pre-populate SSM with state
			const preExistingState: DokployStageState = {
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
					Name: `/gkm/${workspaceName}/${testStage}/state`,
					Value: JSON.stringify(preExistingState),
					Type: 'SecureString',
					Overwrite: true,
				}),
			);

			// 2. Create workspace config with SSM state provider
			const config: WorkspaceConfig = {
				name: workspaceName,
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
					},
				},
				state: { provider: 'ssm', region: 'us-east-1' },
			};

			const workspace = normalizeWorkspace(config, testDir);

			// 3. Create providers with injected SSM client
			const local = new LocalStateProvider(workspace.root);
			const ssm = new SSMStateProvider(workspace.name, ssmClient);
			const provider = new CachedStateProvider(ssm, local);

			// 4. Read state through provider
			const readState = await provider.read(testStage);

			expect(readState).not.toBeNull();
			expect(readState!.environmentId).toBe('env_pre_existing');
			expect(readState!.applications.api).toBe('app_pre_123');
		});

		it('should use CachedStateProvider that syncs local and remote', async () => {
			const config: WorkspaceConfig = {
				name: workspaceName,
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						routes: './src/**/*.ts',
					},
				},
				state: { provider: 'ssm', region: 'us-east-1' },
			};

			const workspace = normalizeWorkspace(config, testDir);

			// Create providers with injected SSM client
			const local = new LocalStateProvider(workspace.root);
			const ssm = new SSMStateProvider(workspace.name, ssmClient);
			const provider = new CachedStateProvider(ssm, local);

			// Write state
			const state = createTestState();
			await provider.write(testStage, state);

			// Verify both local and SSM have the state
			// Check local file
			const localFilePath = join(testDir, '.gkm', `deploy-${testStage}.json`);
			const localContent = await readFile(localFilePath, 'utf-8');
			const localState = JSON.parse(localContent);
			expect(localState.environmentId).toBe('env_e2e_123');

			// Check SSM directly
			const ssmResponse = await ssmClient.send(
				new GetParameterCommand({
					Name: `/gkm/${workspaceName}/${testStage}/state`,
					WithDecryption: true,
				}),
			);
			const ssmState = JSON.parse(ssmResponse.Parameter!.Value!);
			expect(ssmState.environmentId).toBe('env_e2e_123');
		});
	});
});
