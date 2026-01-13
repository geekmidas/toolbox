import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Construct } from '@geekmidas/constructs';
import { itWithDir } from '@geekmidas/testkit/os';
import { beforeEach, describe, expect, vi } from 'vitest';
import type { StageSecrets } from '../../secrets/types';
import { bundleServer } from '../bundler';

// Mock child_process to avoid actually running tsdown
vi.mock('node:child_process', () => ({
	spawnSync: vi.fn().mockReturnValue({ status: 0, error: null }),
}));

// Mock construct that returns specific environment variables
function createMockConstruct(envVars: string[]): Construct {
	return {
		getEnvironment: vi.fn().mockResolvedValue(envVars),
	} as unknown as Construct;
}

// Helper to create a minimal secrets file
async function createSecretsFile(
	dir: string,
	stage: string,
	secrets: Partial<StageSecrets>,
): Promise<void> {
	const secretsDir = join(dir, '.gkm', 'secrets');
	await mkdir(secretsDir, { recursive: true });

	const fullSecrets: StageSecrets = {
		stage,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		services: {},
		urls: {},
		custom: {},
		...secrets,
	};

	await writeFile(
		join(secretsDir, `${stage}.json`),
		JSON.stringify(fullSecrets, null, 2),
	);
}

// Helper to create a minimal entry point file and mock the bundle output
async function createEntryPoint(dir: string): Promise<string> {
	const outputDir = join(dir, '.gkm', 'server');
	const distDir = join(outputDir, 'dist');
	await mkdir(outputDir, { recursive: true });
	await mkdir(distDir, { recursive: true });

	const entryPoint = join(outputDir, 'server.ts');
	await writeFile(entryPoint, 'console.log("hello");');

	// Create the output file that tsdown would normally create
	// (since we're mocking execSync, the file won't be created automatically)
	await writeFile(join(distDir, 'server.js'), 'console.log("bundled");');

	return entryPoint;
}

describe('bundleServer environment validation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	itWithDir(
		'should pass validation when all required env vars are present',
		async ({ dir }) => {
			const entryPoint = await createEntryPoint(dir);
			await createSecretsFile(dir, 'production', {
				urls: { DATABASE_URL: 'postgresql://localhost/db' },
				custom: { API_KEY: 'sk_test_123' },
			});

			const constructs = [
				createMockConstruct(['DATABASE_URL']),
				createMockConstruct(['API_KEY']),
			];

			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				// Should not throw
				const result = await bundleServer({
					entryPoint,
					outputDir: join(dir, '.gkm', 'server', 'dist'),
					minify: false,
					sourcemap: false,
					external: [],
					stage: 'production',
					constructs,
				});

				expect(result.masterKey).toBeDefined();
				expect(constructs[0].getEnvironment).toHaveBeenCalled();
				expect(constructs[1].getEnvironment).toHaveBeenCalled();
			} finally {
				process.chdir(originalCwd);
			}
		},
	);

	itWithDir(
		'should throw error when required env vars are missing',
		async ({ dir }) => {
			const entryPoint = await createEntryPoint(dir);
			await createSecretsFile(dir, 'production', {
				urls: { DATABASE_URL: 'postgresql://localhost/db' },
				custom: {},
			});

			const constructs = [
				createMockConstruct(['DATABASE_URL', 'API_KEY', 'JWT_SECRET']),
			];

			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				await expect(
					bundleServer({
						entryPoint,
						outputDir: join(dir, '.gkm', 'server', 'dist'),
						minify: false,
						sourcemap: false,
						external: [],
						stage: 'production',
						constructs,
					}),
				).rejects.toThrow('Missing environment variables');
			} finally {
				process.chdir(originalCwd);
			}
		},
	);

	itWithDir(
		'should include missing variables in error message',
		async ({ dir }) => {
			const entryPoint = await createEntryPoint(dir);
			await createSecretsFile(dir, 'staging', {
				custom: { EXISTING_VAR: 'value' },
			});

			const constructs = [
				createMockConstruct(['EXISTING_VAR', 'MISSING_VAR_1', 'MISSING_VAR_2']),
			];

			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				await expect(
					bundleServer({
						entryPoint,
						outputDir: join(dir, '.gkm', 'server', 'dist'),
						minify: false,
						sourcemap: false,
						external: [],
						stage: 'staging',
						constructs,
					}),
				).rejects.toThrow(/MISSING_VAR_1/);

				await expect(
					bundleServer({
						entryPoint,
						outputDir: join(dir, '.gkm', 'server', 'dist'),
						minify: false,
						sourcemap: false,
						external: [],
						stage: 'staging',
						constructs,
					}),
				).rejects.toThrow(/MISSING_VAR_2/);
			} finally {
				process.chdir(originalCwd);
			}
		},
	);

	itWithDir(
		'should collect env vars from multiple constructs',
		async ({ dir }) => {
			const entryPoint = await createEntryPoint(dir);
			await createSecretsFile(dir, 'production', {
				urls: { DATABASE_URL: 'postgresql://localhost/db' },
				custom: {
					API_KEY: 'key',
					REDIS_URL: 'redis://localhost',
					JWT_SECRET: 'secret',
				},
			});

			const constructs = [
				createMockConstruct(['DATABASE_URL']),
				createMockConstruct(['API_KEY', 'REDIS_URL']),
				createMockConstruct(['JWT_SECRET']),
			];

			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				const result = await bundleServer({
					entryPoint,
					outputDir: join(dir, '.gkm', 'server', 'dist'),
					minify: false,
					sourcemap: false,
					external: [],
					stage: 'production',
					constructs,
				});

				expect(result.masterKey).toBeDefined();

				// All constructs should have been checked
				for (const construct of constructs) {
					expect(construct.getEnvironment).toHaveBeenCalled();
				}
			} finally {
				process.chdir(originalCwd);
			}
		},
	);

	itWithDir(
		'should deduplicate env vars from multiple constructs',
		async ({ dir }) => {
			const entryPoint = await createEntryPoint(dir);
			await createSecretsFile(dir, 'production', {
				custom: { SHARED_VAR: 'value' },
			});

			// Multiple constructs requiring the same variable
			const constructs = [
				createMockConstruct(['SHARED_VAR']),
				createMockConstruct(['SHARED_VAR']),
				createMockConstruct(['SHARED_VAR']),
			];

			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				// Should pass since SHARED_VAR is provided once
				const result = await bundleServer({
					entryPoint,
					outputDir: join(dir, '.gkm', 'server', 'dist'),
					minify: false,
					sourcemap: false,
					external: [],
					stage: 'production',
					constructs,
				});

				expect(result.masterKey).toBeDefined();
			} finally {
				process.chdir(originalCwd);
			}
		},
	);

	itWithDir(
		'should skip validation when no constructs provided',
		async ({ dir }) => {
			const entryPoint = await createEntryPoint(dir);
			await createSecretsFile(dir, 'production', {
				custom: {},
			});

			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				// Should not throw even with empty secrets
				const result = await bundleServer({
					entryPoint,
					outputDir: join(dir, '.gkm', 'server', 'dist'),
					minify: false,
					sourcemap: false,
					external: [],
					stage: 'production',
					constructs: [],
				});

				expect(result.masterKey).toBeDefined();
			} finally {
				process.chdir(originalCwd);
			}
		},
	);

	itWithDir(
		'should skip validation when constructs is undefined',
		async ({ dir }) => {
			const entryPoint = await createEntryPoint(dir);
			await createSecretsFile(dir, 'production', {
				custom: {},
			});

			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				const result = await bundleServer({
					entryPoint,
					outputDir: join(dir, '.gkm', 'server', 'dist'),
					minify: false,
					sourcemap: false,
					external: [],
					stage: 'production',
					// No constructs provided
				});

				expect(result.masterKey).toBeDefined();
			} finally {
				process.chdir(originalCwd);
			}
		},
	);

	itWithDir(
		'should recognize service credentials as provided',
		async ({ dir }) => {
			const entryPoint = await createEntryPoint(dir);
			await createSecretsFile(dir, 'production', {
				services: {
					postgres: {
						host: 'localhost',
						port: 5432,
						username: 'app',
						password: 'secret',
						database: 'mydb',
					},
				},
			});

			const constructs = [
				createMockConstruct([
					'POSTGRES_HOST',
					'POSTGRES_PORT',
					'POSTGRES_USER',
					'POSTGRES_PASSWORD',
					'POSTGRES_DB',
				]),
			];

			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				const result = await bundleServer({
					entryPoint,
					outputDir: join(dir, '.gkm', 'server', 'dist'),
					minify: false,
					sourcemap: false,
					external: [],
					stage: 'production',
					constructs,
				});

				expect(result.masterKey).toBeDefined();
			} finally {
				process.chdir(originalCwd);
			}
		},
	);

	itWithDir(
		'should auto-initialize secrets and throw for missing env vars',
		async ({ dir }) => {
			const entryPoint = await createEntryPoint(dir);
			// Don't create secrets file - it should be auto-initialized

			const constructs = [createMockConstruct(['DATABASE_URL'])];

			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				// Should auto-initialize secrets but then fail because DATABASE_URL is required
				await expect(
					bundleServer({
						entryPoint,
						outputDir: join(dir, '.gkm', 'server', 'dist'),
						minify: false,
						sourcemap: false,
						external: [],
						stage: 'production',
						constructs,
					}),
				).rejects.toThrow('Missing environment variables');
			} finally {
				process.chdir(originalCwd);
			}
		},
	);

	itWithDir(
		'should include helpful instructions in error message',
		async ({ dir }) => {
			const entryPoint = await createEntryPoint(dir);
			await createSecretsFile(dir, 'myapp', {
				custom: {},
			});

			const constructs = [createMockConstruct(['MISSING_VAR'])];

			const originalCwd = process.cwd();
			process.chdir(dir);

			try {
				await expect(
					bundleServer({
						entryPoint,
						outputDir: join(dir, '.gkm', 'server', 'dist'),
						minify: false,
						sourcemap: false,
						external: [],
						stage: 'myapp',
						constructs,
					}),
				).rejects.toThrow(/gkm secrets:set/);

				await expect(
					bundleServer({
						entryPoint,
						outputDir: join(dir, '.gkm', 'server', 'dist'),
						minify: false,
						sourcemap: false,
						external: [],
						stage: 'myapp',
						constructs,
					}),
				).rejects.toThrow(/gkm secrets:import/);
			} finally {
				process.chdir(originalCwd);
			}
		},
	);
});
