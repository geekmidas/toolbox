import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareEntryCredentials } from '../index';
import { createPackageJson, createSecretsFile } from './helpers';

describe('prepareEntryCredentials', () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(
			tmpdir(),
			`gkm-creds-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(testDir, { recursive: true });
		createPackageJson('my-app', testDir);
	});

	afterEach(async () => {
		if (existsSync(testDir)) {
			const { rm } = await import('node:fs/promises');
			await rm(testDir, { recursive: true, force: true });
		}
	});

	it('should return default port 3000', async () => {
		const result = await prepareEntryCredentials({ cwd: testDir });

		expect(result.resolvedPort).toBe(3000);
		expect(result.credentials.PORT).toBe('3000');
	});

	it('should respect explicitPort', async () => {
		const result = await prepareEntryCredentials({
			cwd: testDir,
			explicitPort: 8080,
		});

		expect(result.resolvedPort).toBe(8080);
		expect(result.credentials.PORT).toBe('8080');
	});

	it('should load secrets from development stage by default', async () => {
		createSecretsFile(
			'development',
			{ DATABASE_URL: 'postgresql://localhost/mydb', API_KEY: 'secret' },
			testDir,
		);

		const result = await prepareEntryCredentials({ cwd: testDir });

		expect(result.credentials.DATABASE_URL).toBe('postgresql://localhost/mydb');
		expect(result.credentials.API_KEY).toBe('secret');
	});

	it('should load secrets from custom stage', async () => {
		createSecretsFile('staging', { API_KEY: 'staging-key' }, testDir);

		const result = await prepareEntryCredentials({
			cwd: testDir,
			stages: ['staging'],
		});

		expect(result.credentials.API_KEY).toBe('staging-key');
	});

	it('should not load secrets when stage does not exist', async () => {
		createSecretsFile('development', { API_KEY: 'dev-key' }, testDir);

		const result = await prepareEntryCredentials({
			cwd: testDir,
			stages: ['production'],
		});

		expect(result.credentials.API_KEY).toBeUndefined();
		expect(result.credentials.PORT).toBe('3000');
	});

	it('should use custom secretsFileName', async () => {
		const result = await prepareEntryCredentials({
			cwd: testDir,
			secretsFileName: 'test-secrets.json',
		});

		expect(result.secretsJsonPath).toBe(
			join(testDir, '.gkm', 'test-secrets.json'),
		);
		const content = JSON.parse(readFileSync(result.secretsJsonPath, 'utf-8'));
		expect(content.PORT).toBe('3000');
	});

	it('should have undefined appInfo outside workspace', async () => {
		const result = await prepareEntryCredentials({ cwd: testDir });

		expect(result.appInfo).toBeUndefined();
	});

	it('should extract appName from package.json', async () => {
		const result = await prepareEntryCredentials({ cwd: testDir });

		expect(result.appName).toBe('my-app');
	});

	it('should extract appName from scoped package', async () => {
		writeFileSync(
			join(testDir, 'package.json'),
			JSON.stringify({ name: '@scope/my-app', version: '0.0.1' }),
		);

		const result = await prepareEntryCredentials({ cwd: testDir });

		expect(result.appName).toBe('my-app');
	});

	it('should write credentials JSON with all secrets and PORT', async () => {
		createSecretsFile('development', { JWT_SECRET: 'abc123' }, testDir);

		const result = await prepareEntryCredentials({ cwd: testDir });

		const content = JSON.parse(readFileSync(result.secretsJsonPath, 'utf-8'));
		expect(content.PORT).toBe('3000');
		expect(content.JWT_SECRET).toBe('abc123');
	});
});
