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
import { SSMStateProvider } from '../SSMStateProvider';
import type { DokployStageState } from '../state';

/**
 * SSMStateProvider Tests
 *
 * These tests require LocalStack to be running with SSM enabled.
 * Run: docker compose up -d localstack
 */
describe('SSMStateProvider', () => {
	const LOCALSTACK_ENDPOINT = 'http://localhost:4566';
	let client: SSMClient;
	let provider: SSMStateProvider;
	const workspaceName = 'test-workspace';
	const testStage = 'test-stage';

	beforeAll(() => {
		process.env.AWS_ACCESS_KEY_ID = 'test';
		process.env.AWS_SECRET_ACCESS_KEY = 'test';
	});

	beforeEach(() => {
		client = new SSMClient({
			region: 'us-east-1',
			endpoint: LOCALSTACK_ENDPOINT,
			credentials: {
				accessKeyId: 'test',
				secretAccessKey: 'test',
			},
		});

		// Create provider with injected client
		provider = new SSMStateProvider(workspaceName, client);
	});

	afterEach(async () => {
		try {
			await client.send(
				new DeleteParameterCommand({
					Name: `/gkm/${workspaceName}/${testStage}/state`,
				}),
			);
		} catch {
			// Ignore if parameter doesn't exist
		}
	});

	afterAll(() => {
		client.destroy();
	});

	describe('static create', () => {
		it('should create provider with options', () => {
			const provider = SSMStateProvider.create({
				workspaceName: 'my-workspace',
				region: 'us-west-2',
				endpoint: LOCALSTACK_ENDPOINT,
			});

			expect(provider).toBeInstanceOf(SSMStateProvider);
			expect(provider.workspaceName).toBe('my-workspace');
		});
	});

	describe('read', () => {
		it('should return null when parameter does not exist', async () => {
			const state = await provider.read('nonexistent-stage');
			expect(state).toBeNull();
		});

		it('should read existing parameter', async () => {
			const stateData: DokployStageState = {
				provider: 'dokploy',
				stage: testStage,
				environmentId: 'env_123',
				applications: { api: 'app_123' },
				services: { postgresId: 'pg_123' },
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			await client.send(
				new PutParameterCommand({
					Name: `/gkm/${workspaceName}/${testStage}/state`,
					Value: JSON.stringify(stateData),
					Type: 'SecureString',
					Overwrite: true,
				}),
			);

			const state = await provider.read(testStage);
			expect(state).toEqual(stateData);
		});
	});

	describe('write', () => {
		it('should create new parameter', async () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: testStage,
				environmentId: 'env_123',
				applications: { api: 'app_123' },
				services: {},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			await provider.write(testStage, state);

			const response = await client.send(
				new GetParameterCommand({
					Name: `/gkm/${workspaceName}/${testStage}/state`,
					WithDecryption: true,
				}),
			);

			const stored = JSON.parse(response.Parameter!.Value!);
			expect(stored.applications).toEqual({ api: 'app_123' });
		});

		it('should update existing parameter', async () => {
			const state1: DokployStageState = {
				provider: 'dokploy',
				stage: testStage,
				environmentId: 'env_123',
				applications: { api: 'app_old' },
				services: {},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			const state2: DokployStageState = {
				provider: 'dokploy',
				stage: testStage,
				environmentId: 'env_123',
				applications: { api: 'app_new' },
				services: {},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			await provider.write(testStage, state1);
			await provider.write(testStage, state2);

			const response = await client.send(
				new GetParameterCommand({
					Name: `/gkm/${workspaceName}/${testStage}/state`,
					WithDecryption: true,
				}),
			);

			const stored = JSON.parse(response.Parameter!.Value!);
			expect(stored.applications.api).toBe('app_new');
		});

		it('should update lastDeployedAt timestamp', async () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: testStage,
				environmentId: 'env_123',
				applications: {},
				services: {},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			const originalTimestamp = state.lastDeployedAt;
			await new Promise((resolve) => setTimeout(resolve, 10));
			await provider.write(testStage, state);

			expect(state.lastDeployedAt).not.toBe(originalTimestamp);
		});
	});
});
