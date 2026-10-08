import { realpathSync, writeFileSync } from 'node:fs';
import { type AddressInfo, createServer } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	cleanupDir,
	createSurfaceFile,
	createTempDir,
} from '../../__tests__/test-helpers';
import { prepareEntryCredentials } from '../index';
import { createPackageJson, createSecretsFile } from './helpers';

/**
 * A port nothing holds. Not a fixed one: an app whose port another process
 * holds is moved off it, so a test that configured 3001 asserted whatever the
 * machine happened to be running.
 */
async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((r) => server.listen(0, r));
	const { port } = server.address() as AddressInfo;
	await new Promise((r) => server.close(r));
	return port;
}

describe('workspace credentials', () => {
	let testDir: string;
	let apiDir: string;
	let apiPort: number;

	beforeEach(async () => {
		apiPort = await freePort();
		testDir = realpathSync(await createTempDir('gkm-ws-creds-'));
		// Compose reads this from the environment; anything that reaches it from
		// here gets a project of its own, never a shared one.
		vi.stubEnv('COMPOSE_PROJECT_NAME', `gkm-spec-${Date.now()}`);
		vi.spyOn(console, 'log').mockImplementation(() => {});

		writeFileSync(
			join(testDir, 'gkm.config.ts'),
			`export default {
  name: 'test-workspace',
  stages: { local: 'development', deployed: ['production'] },
  constructs: './src/constructs/**/*.ts',
  apps: { api: { type: 'backend', path: 'apps/api', port: ${apiPort} } },
};
`,
		);
		await createSurfaceFile(testDir);

		apiDir = join(testDir, 'apps', 'api');
		createPackageJson('@test/api', apiDir);

		vi.stubEnv('GKM_CONFIG_PATH', join(testDir, 'gkm.config.ts'));
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		await cleanupDir(testDir);
	});

	it('should populate appInfo in workspace mode', async () => {
		const result = await prepareEntryCredentials({ cwd: apiDir });

		expect(result.appInfo).toBeDefined();
		expect(result.appInfo?.appName).toBe('api');
		expect(result.appInfo?.workspaceRoot).toBe(testDir);
	});

	it('should resolve port from workspace config', async () => {
		const result = await prepareEntryCredentials({ cwd: apiDir });

		expect(result.resolvedPort).toBe(apiPort);
		expect(result.credentials.PORT).toBe(String(apiPort));
	});

	// An app's database URL is its construct's key, derived by reconcile —
	// never a stored per-app one renamed onto `DATABASE_URL`.
	it('renames no stored <APP>_DATABASE_URL onto DATABASE_URL', async () => {
		createSecretsFile(
			'development',
			{
				API_DATABASE_URL: 'postgresql://localhost/apidb',
				WEB_DATABASE_URL: 'postgresql://localhost/webdb',
			},
			testDir,
		);

		const result = await prepareEntryCredentials({ cwd: apiDir });

		expect(result.credentials).not.toHaveProperty('DATABASE_URL');
		expect(result.credentials.API_DATABASE_URL).toBe(
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
