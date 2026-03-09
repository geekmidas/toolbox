import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareEntryCredentials } from '../index';
import {
	createDockerCompose,
	createPackageJson,
	createPortState,
	createSecretsFile,
} from './helpers';

describe('readonly Docker port resolution', () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(
			tmpdir(),
			`gkm-ports-ro-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(testDir, { recursive: true });
		createPackageJson('my-app', testDir);
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
				POSTGRES_HOST: 'postgres',
				POSTGRES_PORT: '5432',
				CACHE_ENDPOINT: 'redis://default:pass@redis:6379/0',
				EVENT_SUBSCRIBER_CONNECTION_STRING:
					'sqs://key:secret@localstack:4566?region=us-east-1',
			},
			testDir,
		);
	});

	afterEach(async () => {
		if (existsSync(testDir)) {
			const { rm } = await import('node:fs/promises');
			await rm(testDir, { recursive: true, force: true });
		}
	});

	it('should rewrite URLs with saved port state', async () => {
		createPortState(
			{ POSTGRES_HOST_PORT: 15432, REDIS_HOST_PORT: 16379 },
			testDir,
		);

		const result = await prepareEntryCredentials({
			cwd: testDir,
			resolveDockerPorts: 'readonly',
		});

		expect(result.credentials.DATABASE_URL).toBe(
			'postgresql://user:pass@localhost:15432/mydb',
		);
		expect(result.credentials.REDIS_URL).toBe(
			'redis://default:pass@localhost:16379',
		);
	});

	it('should rewrite _HOST vars to localhost', async () => {
		createPortState({ POSTGRES_HOST_PORT: 15432 }, testDir);

		const result = await prepareEntryCredentials({
			cwd: testDir,
			resolveDockerPorts: 'readonly',
		});

		expect(result.credentials.POSTGRES_HOST).toBe('localhost');
	});

	it('should rewrite _PORT vars to resolved port', async () => {
		createPortState({ POSTGRES_HOST_PORT: 15432 }, testDir);

		const result = await prepareEntryCredentials({
			cwd: testDir,
			resolveDockerPorts: 'readonly',
		});

		expect(result.credentials.POSTGRES_PORT).toBe('15432');
	});

	it('should rewrite _ENDPOINT keys', async () => {
		createPortState({ REDIS_HOST_PORT: 16379 }, testDir);

		const result = await prepareEntryCredentials({
			cwd: testDir,
			resolveDockerPorts: 'readonly',
		});

		expect(result.credentials.CACHE_ENDPOINT).toBe(
			'redis://default:pass@localhost:16379/0',
		);
	});

	it('should rewrite _CONNECTION_STRING keys', async () => {
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
				{
					name: 'localstack',
					envVar: 'LOCALSTACK_HOST_PORT',
					defaultPort: 4566,
					containerPort: 4566,
				},
			],
			testDir,
		);
		createPortState(
			{
				POSTGRES_HOST_PORT: 15432,
				REDIS_HOST_PORT: 16379,
				LOCALSTACK_HOST_PORT: 14566,
			},
			testDir,
		);

		const result = await prepareEntryCredentials({
			cwd: testDir,
			resolveDockerPorts: 'readonly',
		});

		expect(result.credentials.EVENT_SUBSCRIBER_CONNECTION_STRING).toContain(
			'@localhost:',
		);
		expect(result.credentials.EVENT_SUBSCRIBER_CONNECTION_STRING).toContain(
			':14566',
		);
	});

	it('should not rewrite URLs when no saved state exists', async () => {
		const result = await prepareEntryCredentials({
			cwd: testDir,
			resolveDockerPorts: 'readonly',
		});

		expect(result.credentials.DATABASE_URL).toBe(
			'postgresql://user:pass@postgres:5432/mydb',
		);
		expect(result.credentials.REDIS_URL).toBe(
			'redis://default:pass@redis:6379',
		);
	});

	it('should not overwrite existing ports.json', async () => {
		const originalPorts = { POSTGRES_HOST_PORT: 15432 };
		createPortState(originalPorts, testDir);

		await prepareEntryCredentials({
			cwd: testDir,
			resolveDockerPorts: 'readonly',
		});

		const portsAfter = JSON.parse(
			readFileSync(join(testDir, '.gkm', 'ports.json'), 'utf-8'),
		);
		expect(portsAfter).toEqual(originalPorts);
	});
});
