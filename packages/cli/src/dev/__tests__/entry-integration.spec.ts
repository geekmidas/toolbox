import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareEntryCredentials } from '../index';

describe('prepareEntryCredentials', () => {
	let workspaceDir: string;

	beforeEach(async () => {
		workspaceDir = join(tmpdir(), `gkm-entry-test-${Date.now()}`);
		await mkdir(workspaceDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(workspaceDir, { recursive: true, force: true });
	});

	describe('workspace with port config', () => {
		beforeEach(async () => {
			// Create workspace structure:
			// workspace/
			//   gkm.config.ts
			//   apps/
			//     api/
			//       package.json
			//     auth/
			//       package.json

			// Create gkm.config.ts
			const gkmConfig = `
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'test-workspace',
  apps: {
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',
    },
    auth: {
      type: 'backend',
      path: 'apps/auth',
      port: 3002,
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',
    },
  },
  services: {},
});
`;
			await writeFile(join(workspaceDir, 'gkm.config.ts'), gkmConfig);

			// Create apps directories
			await mkdir(join(workspaceDir, 'apps', 'api', 'src'), {
				recursive: true,
			});
			await mkdir(join(workspaceDir, 'apps', 'auth', 'src'), {
				recursive: true,
			});

			// Create package.json for api app
			await writeFile(
				join(workspaceDir, 'apps', 'api', 'package.json'),
				JSON.stringify({ name: '@test/api', version: '0.0.1' }, null, 2),
			);

			// Create package.json for auth app
			await writeFile(
				join(workspaceDir, 'apps', 'auth', 'package.json'),
				JSON.stringify({ name: '@test/auth', version: '0.0.1' }, null, 2),
			);

			// Create entry files
			await writeFile(
				join(workspaceDir, 'apps', 'api', 'src', 'index.ts'),
				'console.log("api");',
			);
			await writeFile(
				join(workspaceDir, 'apps', 'auth', 'src', 'index.ts'),
				'console.log("auth");',
			);
		});

		it('should inject PORT from workspace config for api app (port 3000)', async () => {
			const apiDir = join(workspaceDir, 'apps', 'api');

			const result = await prepareEntryCredentials({ cwd: apiDir });

			expect(result.resolvedPort).toBe(3000);
			expect(result.credentials.PORT).toBe('3000');
			expect(result.appName).toBe('api');
			expect(result.secretsRoot).toBe(workspaceDir);
		});

		it('should inject PORT from workspace config for auth app (port 3002)', async () => {
			const authDir = join(workspaceDir, 'apps', 'auth');

			const result = await prepareEntryCredentials({ cwd: authDir });

			expect(result.resolvedPort).toBe(3002);
			expect(result.credentials.PORT).toBe('3002');
			expect(result.appName).toBe('auth');
			expect(result.secretsRoot).toBe(workspaceDir);
		});

		it('should use explicit --port over workspace config', async () => {
			const authDir = join(workspaceDir, 'apps', 'auth');

			const result = await prepareEntryCredentials({
				cwd: authDir,
				explicitPort: 4000,
			});

			expect(result.resolvedPort).toBe(4000);
			expect(result.credentials.PORT).toBe('4000');
			expect(result.appName).toBe('auth');
		});

		it('should write credentials to dev-secrets.json at workspace root', async () => {
			const apiDir = join(workspaceDir, 'apps', 'api');

			const result = await prepareEntryCredentials({ cwd: apiDir });

			// Verify the file was written at workspace root
			expect(result.secretsJsonPath).toBe(
				join(workspaceDir, '.gkm', 'dev-secrets.json'),
			);

			// Verify file contents
			const content = await readFile(result.secretsJsonPath, 'utf-8');
			const parsed = JSON.parse(content);

			expect(parsed.PORT).toBe('3000');
		});
	});

	describe('without workspace config', () => {
		beforeEach(async () => {
			// Create a simple directory without workspace config
			await mkdir(join(workspaceDir, 'src'), { recursive: true });
			await writeFile(
				join(workspaceDir, 'package.json'),
				JSON.stringify({ name: 'standalone-app', version: '0.0.1' }, null, 2),
			);
			await writeFile(
				join(workspaceDir, 'src', 'index.ts'),
				'console.log("standalone");',
			);
		});

		it('should fallback to port 3000 when no workspace config exists', async () => {
			const result = await prepareEntryCredentials({ cwd: workspaceDir });

			expect(result.resolvedPort).toBe(3000);
			expect(result.credentials.PORT).toBe('3000');
		});

		it('should use explicit --port when no workspace config exists', async () => {
			const result = await prepareEntryCredentials({
				cwd: workspaceDir,
				explicitPort: 5000,
			});

			expect(result.resolvedPort).toBe(5000);
			expect(result.credentials.PORT).toBe('5000');
		});

		it('should write credentials to current directory when not in workspace', async () => {
			const result = await prepareEntryCredentials({ cwd: workspaceDir });

			expect(result.secretsJsonPath).toBe(
				join(workspaceDir, '.gkm', 'dev-secrets.json'),
			);
		});
	});

	describe('with GKM_CONFIG_PATH set (turbo environment)', () => {
		const originalEnv = process.env.GKM_CONFIG_PATH;

		beforeEach(async () => {
			// Create workspace structure
			const gkmConfig = `
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'test-workspace',
  apps: {
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',
    },
    auth: {
      type: 'backend',
      path: 'apps/auth',
      port: 3002,
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',
    },
  },
  services: {},
});
`;
			await writeFile(join(workspaceDir, 'gkm.config.ts'), gkmConfig);

			// Create apps directories
			await mkdir(join(workspaceDir, 'apps', 'api', 'src'), {
				recursive: true,
			});
			await mkdir(join(workspaceDir, 'apps', 'auth', 'src'), {
				recursive: true,
			});

			// Create package.json files
			await writeFile(
				join(workspaceDir, 'apps', 'api', 'package.json'),
				JSON.stringify({ name: '@test/api', version: '0.0.1' }, null, 2),
			);
			await writeFile(
				join(workspaceDir, 'apps', 'auth', 'package.json'),
				JSON.stringify({ name: '@test/auth', version: '0.0.1' }, null, 2),
			);

			// Set GKM_CONFIG_PATH like turbo does
			process.env.GKM_CONFIG_PATH = join(workspaceDir, 'gkm.config.ts');
		});

		afterEach(() => {
			// Restore original env
			if (originalEnv === undefined) {
				delete process.env.GKM_CONFIG_PATH;
			} else {
				process.env.GKM_CONFIG_PATH = originalEnv;
			}
		});

		it('should read port from workspace config when GKM_CONFIG_PATH is set', async () => {
			const authDir = join(workspaceDir, 'apps', 'auth');

			const result = await prepareEntryCredentials({ cwd: authDir });

			expect(result.resolvedPort).toBe(3002);
			expect(result.credentials.PORT).toBe('3002');
			expect(result.appName).toBe('auth');
		});

		it('should read port 3000 for api when GKM_CONFIG_PATH is set', async () => {
			const apiDir = join(workspaceDir, 'apps', 'api');

			const result = await prepareEntryCredentials({ cwd: apiDir });

			expect(result.resolvedPort).toBe(3000);
			expect(result.credentials.PORT).toBe('3000');
			expect(result.appName).toBe('api');
		});
	});

	describe('with secrets', () => {
		beforeEach(async () => {
			// Create workspace with secrets
			const gkmConfig = `
import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'test-workspace',
  apps: {
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',
    },
  },
  services: {},
});
`;
			await writeFile(join(workspaceDir, 'gkm.config.ts'), gkmConfig);

			await mkdir(join(workspaceDir, 'apps', 'api', 'src'), {
				recursive: true,
			});
			await writeFile(
				join(workspaceDir, 'apps', 'api', 'package.json'),
				JSON.stringify({ name: '@test/api', version: '0.0.1' }, null, 2),
			);
			await writeFile(
				join(workspaceDir, 'apps', 'api', 'src', 'index.ts'),
				'console.log("api");',
			);

			// Create unencrypted secrets (legacy format for testing)
			await mkdir(join(workspaceDir, '.gkm', 'secrets'), { recursive: true });
			const secrets = {
				stage: 'development',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				services: {},
				urls: {
					DATABASE_URL: 'postgresql://localhost:5432/test',
				},
				custom: {
					API_KEY: 'test-api-key',
				},
			};
			await writeFile(
				join(workspaceDir, '.gkm', 'secrets', 'development.json'),
				JSON.stringify(secrets, null, 2),
			);
		});

		it('should load secrets and inject PORT', async () => {
			const apiDir = join(workspaceDir, 'apps', 'api');

			const result = await prepareEntryCredentials({ cwd: apiDir });

			expect(result.credentials.PORT).toBe('3000');
			expect(result.credentials.DATABASE_URL).toBe(
				'postgresql://localhost:5432/test',
			);
			expect(result.credentials.API_KEY).toBe('test-api-key');
		});

		it('should write both secrets and PORT to dev-secrets.json', async () => {
			const apiDir = join(workspaceDir, 'apps', 'api');

			const result = await prepareEntryCredentials({ cwd: apiDir });

			const content = await readFile(result.secretsJsonPath, 'utf-8');
			const parsed = JSON.parse(content);

			expect(parsed.PORT).toBe('3000');
			expect(parsed.DATABASE_URL).toBe('postgresql://localhost:5432/test');
			expect(parsed.API_KEY).toBe('test-api-key');
		});
	});
});
