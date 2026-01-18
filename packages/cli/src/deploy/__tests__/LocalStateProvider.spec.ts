import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStateProvider } from '../LocalStateProvider';
import type { DokployStageState } from '../state';

describe('LocalStateProvider', () => {
	let testDir: string;
	let provider: LocalStateProvider;

	beforeEach(async () => {
		testDir = join(tmpdir(), `gkm-local-state-test-${Date.now()}`);
		await mkdir(testDir, { recursive: true });
		provider = new LocalStateProvider(testDir);
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe('read', () => {
		it('should return null when state file does not exist', async () => {
			const state = await provider.read('nonexistent');
			expect(state).toBeNull();
		});

		it('should read existing state file', async () => {
			const stateData: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				projectId: 'proj_test',
				environmentId: 'env_123',
				applications: { api: 'app_123' },
				services: { postgresId: 'pg_123' },
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			await mkdir(join(testDir, '.gkm'), { recursive: true });
			await writeFile(
				join(testDir, '.gkm', 'deploy-production.json'),
				JSON.stringify(stateData),
			);

			const state = await provider.read('production');
			expect(state).toEqual(stateData);
		});

		it('should return null for invalid JSON', async () => {
			await mkdir(join(testDir, '.gkm'), { recursive: true });
			await writeFile(
				join(testDir, '.gkm', 'deploy-invalid.json'),
				'not valid json',
			);

			const state = await provider.read('invalid');
			expect(state).toBeNull();
		});
	});

	describe('write', () => {
		it('should create .gkm directory if not exists', async () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'staging',
				projectId: 'proj_test',
				environmentId: 'env_456',
				applications: {},
				services: {},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			await provider.write('staging', state);

			const content = await readFile(
				join(testDir, '.gkm', 'deploy-staging.json'),
				'utf-8',
			);
			expect(JSON.parse(content).stage).toBe('staging');
		});

		it('should update lastDeployedAt timestamp', async () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'staging',
				projectId: 'proj_test',
				environmentId: 'env_456',
				applications: {},
				services: {},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			const originalTimestamp = state.lastDeployedAt;
			await new Promise((resolve) => setTimeout(resolve, 10));
			await provider.write('staging', state);

			expect(state.lastDeployedAt).not.toBe(originalTimestamp);
		});

		it('should preserve state data', async () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				projectId: 'proj_test',
				environmentId: 'env_123',
				applications: { api: 'app_123', web: 'app_456' },
				services: { postgresId: 'pg_123', redisId: 'redis_123' },
				appCredentials: { api: { dbUser: 'api', dbPassword: 'secret' } },
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			await provider.write('production', state);

			const content = await readFile(
				join(testDir, '.gkm', 'deploy-production.json'),
				'utf-8',
			);
			const parsed = JSON.parse(content);

			expect(parsed.applications).toEqual({ api: 'app_123', web: 'app_456' });
			expect(parsed.services).toEqual({
				postgresId: 'pg_123',
				redisId: 'redis_123',
			});
			expect(parsed.appCredentials).toEqual({
				api: { dbUser: 'api', dbPassword: 'secret' },
			});
		});
	});
});
