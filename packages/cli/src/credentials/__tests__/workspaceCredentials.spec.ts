import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareEntryCredentials } from '../index';
import {
	createDockerCompose,
	createPackageJson,
	createPortState,
	createSecretsFile,
	createWorkspaceConfig,
} from './helpers';

describe('workspace credentials', () => {
	let testDir: string;
	const originalGkmConfigPath = process.env.GKM_CONFIG_PATH;

	beforeEach(() => {
		testDir = join(
			tmpdir(),
			`gkm-ws-creds-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(async () => {
		if (originalGkmConfigPath === undefined) {
			delete process.env.GKM_CONFIG_PATH;
		} else {
			process.env.GKM_CONFIG_PATH = originalGkmConfigPath;
		}

		if (existsSync(testDir)) {
			const { rm } = await import('node:fs/promises');
			await rm(testDir, { recursive: true, force: true });
		}
	});

	describe('workspace mode', () => {
		let apiDir: string;
		let webDir: string;

		beforeEach(() => {
			createWorkspaceConfig(
				{
					api: { type: 'backend', path: 'apps/api', port: 3001 },
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3002,
						dependencies: ['api'],
					},
				},
				testDir,
			);

			apiDir = join(testDir, 'apps', 'api');
			webDir = join(testDir, 'apps', 'web');

			createPackageJson('@test/api', apiDir);
			createPackageJson('@test/web', webDir);

			process.env.GKM_CONFIG_PATH = join(testDir, 'gkm.config.ts');
		});

		it('should populate appInfo in workspace mode', async () => {
			const result = await prepareEntryCredentials({ cwd: apiDir });

			expect(result.appInfo).toBeDefined();
			expect(result.appInfo?.appName).toBe('api');
			expect(result.appInfo?.workspaceRoot).toBe(testDir);
		});

		it('should resolve port from workspace config', async () => {
			const result = await prepareEntryCredentials({ cwd: apiDir });

			expect(result.resolvedPort).toBe(3001);
			expect(result.credentials.PORT).toBe('3001');
		});

		it('should inject dependency URLs for frontend app', async () => {
			const result = await prepareEntryCredentials({ cwd: webDir });

			expect(result.credentials.API_URL).toBe('http://localhost:3001');
		});

		it('should map APP_DATABASE_URL to DATABASE_URL', async () => {
			createSecretsFile(
				'development',
				{
					API_DATABASE_URL: 'postgresql://localhost/apidb',
					WEB_DATABASE_URL: 'postgresql://localhost/webdb',
				},
				testDir,
			);

			const result = await prepareEntryCredentials({ cwd: apiDir });

			expect(result.credentials.DATABASE_URL).toBe(
				'postgresql://localhost/apidb',
			);
		});

		it('should use app-specific secrets filename by default', async () => {
			const result = await prepareEntryCredentials({ cwd: apiDir });

			expect(result.secretsJsonPath).toBe(
				join(testDir, '.gkm', 'dev-secrets-api.json'),
			);
		});

		it('should use custom secretsFileName in workspace mode', async () => {
			const result = await prepareEntryCredentials({
				cwd: apiDir,
				secretsFileName: 'test-secrets.json',
			});

			expect(result.secretsJsonPath).toBe(
				join(testDir, '.gkm', 'test-secrets.json'),
			);
		});
	});

	describe('exec-style readonly in workspace', () => {
		let apiDir: string;

		beforeEach(() => {
			createWorkspaceConfig(
				{
					api: { type: 'backend', path: 'apps/api', port: 3001 },
				},
				testDir,
			);

			apiDir = join(testDir, 'apps', 'api');
			createPackageJson('@test/api', apiDir);

			process.env.GKM_CONFIG_PATH = join(testDir, 'gkm.config.ts');

			createDockerCompose(
				[
					{
						name: 'postgres',
						envVar: 'POSTGRES_HOST_PORT',
						defaultPort: 5432,
						containerPort: 5432,
					},
					{
						name: 'redis',
						envVar: 'REDIS_HOST_PORT',
						defaultPort: 6379,
						containerPort: 6379,
					},
				],
				testDir,
			);

			createSecretsFile(
				'development',
				{
					DATABASE_URL: 'postgresql://user:pass@postgres:5432/mydb',
					REDIS_URL: 'redis://default:pass@redis:6379',
					API_DATABASE_URL: 'postgresql://api:pass@postgres:5432/apidb',
				},
				testDir,
			);

			createPortState(
				{ POSTGRES_HOST_PORT: 25432, REDIS_HOST_PORT: 26379 },
				testDir,
			);
		});

		it('should resolve ports from saved state and rewrite URLs', async () => {
			const result = await prepareEntryCredentials({
				cwd: apiDir,
				resolveDockerPorts: 'readonly',
			});

			expect(result.credentials.DATABASE_URL).toBe(
				'postgresql://api:pass@localhost:25432/apidb',
			);
			expect(result.credentials.REDIS_URL).toBe(
				'redis://default:pass@localhost:26379',
			);
		});

		it('should use workspace port, not Docker port, for PORT', async () => {
			const result = await prepareEntryCredentials({
				cwd: apiDir,
				resolveDockerPorts: 'readonly',
			});

			expect(result.credentials.PORT).toBe('3001');
			expect(result.resolvedPort).toBe(3001);
		});

		it('should have appInfo set alongside readonly ports', async () => {
			const result = await prepareEntryCredentials({
				cwd: apiDir,
				resolveDockerPorts: 'readonly',
			});

			expect(result.appInfo).toBeDefined();
			expect(result.appInfo?.appName).toBe('api');
			expect(result.appName).toBe('api');
		});
	});
});
