import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DokployStageState } from '../state';
import {
	createEmptyState,
	getAllAppCredentials,
	getAllDnsVerifications,
	getAllGeneratedSecrets,
	getAppCredentials,
	getAppGeneratedSecrets,
	getApplicationId,
	getDnsVerification,
	getGeneratedSecret,
	getPostgresId,
	getRedisId,
	isDnsVerified,
	readStageState,
	setAppCredentials,
	setApplicationId,
	setDnsVerification,
	setGeneratedSecret,
	setPostgresId,
	setRedisId,
	writeStageState,
} from '../state';

describe('state management', () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = join(tmpdir(), `gkm-state-test-${Date.now()}`);
		await mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe('createEmptyState', () => {
		it('should create a valid empty state', () => {
			const state = createEmptyState('production', 'env_123');

			expect(state.provider).toBe('dokploy');
			expect(state.stage).toBe('production');
			expect(state.environmentId).toBe('env_123');
			expect(state.applications).toEqual({});
			expect(state.services).toEqual({});
			expect(state.lastDeployedAt).toBeDefined();
		});

		it('should generate valid ISO timestamp', () => {
			const state = createEmptyState('staging', 'env_456');

			expect(() => new Date(state.lastDeployedAt)).not.toThrow();
		});
	});

	describe('readStageState', () => {
		it('should return null when state file does not exist', async () => {
			const state = await readStageState(testDir, 'nonexistent');

			expect(state).toBeNull();
		});

		it('should read existing state file', async () => {
			const stateData: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
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

			const state = await readStageState(testDir, 'production');

			expect(state).toEqual(stateData);
		});

		it('should return null for invalid JSON', async () => {
			await mkdir(join(testDir, '.gkm'), { recursive: true });
			await writeFile(
				join(testDir, '.gkm', 'deploy-invalid.json'),
				'not valid json',
			);

			const state = await readStageState(testDir, 'invalid');

			expect(state).toBeNull();
		});
	});

	describe('writeStageState', () => {
		it('should create .gkm directory if not exists', async () => {
			const state = createEmptyState('staging', 'env_456');

			await writeStageState(testDir, 'staging', state);

			const content = await readFile(
				join(testDir, '.gkm', 'deploy-staging.json'),
				'utf-8',
			);
			expect(JSON.parse(content).stage).toBe('staging');
		});

		it('should update lastDeployedAt timestamp', async () => {
			const state = createEmptyState('staging', 'env_456');
			const originalTimestamp = state.lastDeployedAt;

			// Wait a bit to ensure different timestamp
			await new Promise((resolve) => setTimeout(resolve, 10));

			await writeStageState(testDir, 'staging', state);

			expect(state.lastDeployedAt).not.toBe(originalTimestamp);
		});

		it('should preserve existing state data', async () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: { api: 'app_123', web: 'app_456' },
				services: { postgresId: 'pg_123', redisId: 'redis_123' },
				appCredentials: { api: { dbUser: 'api', dbPassword: 'secret' } },
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			await writeStageState(testDir, 'production', state);

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

	describe('getApplicationId', () => {
		it('should return application ID when exists', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: { api: 'app_123' },
				services: {},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(getApplicationId(state, 'api')).toBe('app_123');
		});

		it('should return undefined when application does not exist', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(getApplicationId(state, 'nonexistent')).toBeUndefined();
		});

		it('should return undefined when state is null', () => {
			expect(getApplicationId(null, 'api')).toBeUndefined();
		});
	});

	describe('setApplicationId', () => {
		it('should set application ID', () => {
			const state = createEmptyState('production', 'env_123');

			setApplicationId(state, 'api', 'app_123');

			expect(state.applications.api).toBe('app_123');
		});

		it('should update existing application ID', () => {
			const state = createEmptyState('production', 'env_123');
			state.applications.api = 'app_old';

			setApplicationId(state, 'api', 'app_new');

			expect(state.applications.api).toBe('app_new');
		});
	});

	describe('getPostgresId', () => {
		it('should return postgres ID when exists', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: { postgresId: 'pg_123' },
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(getPostgresId(state)).toBe('pg_123');
		});

		it('should return undefined when postgres not configured', () => {
			const state = createEmptyState('production', 'env_123');

			expect(getPostgresId(state)).toBeUndefined();
		});

		it('should return undefined when state is null', () => {
			expect(getPostgresId(null)).toBeUndefined();
		});
	});

	describe('setPostgresId', () => {
		it('should set postgres ID', () => {
			const state = createEmptyState('production', 'env_123');

			setPostgresId(state, 'pg_123');

			expect(state.services.postgresId).toBe('pg_123');
		});
	});

	describe('getRedisId', () => {
		it('should return redis ID when exists', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: { redisId: 'redis_123' },
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(getRedisId(state)).toBe('redis_123');
		});

		it('should return undefined when redis not configured', () => {
			const state = createEmptyState('production', 'env_123');

			expect(getRedisId(state)).toBeUndefined();
		});

		it('should return undefined when state is null', () => {
			expect(getRedisId(null)).toBeUndefined();
		});
	});

	describe('setRedisId', () => {
		it('should set redis ID', () => {
			const state = createEmptyState('production', 'env_123');

			setRedisId(state, 'redis_123');

			expect(state.services.redisId).toBe('redis_123');
		});
	});

	describe('getAppCredentials', () => {
		it('should return credentials when exists', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				appCredentials: {
					api: { dbUser: 'api', dbPassword: 'secret123' },
				},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(getAppCredentials(state, 'api')).toEqual({
				dbUser: 'api',
				dbPassword: 'secret123',
			});
		});

		it('should return undefined when app not found', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				appCredentials: {},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(getAppCredentials(state, 'nonexistent')).toBeUndefined();
		});

		it('should return undefined when no appCredentials', () => {
			const state = createEmptyState('production', 'env_123');

			expect(getAppCredentials(state, 'api')).toBeUndefined();
		});

		it('should return undefined when state is null', () => {
			expect(getAppCredentials(null, 'api')).toBeUndefined();
		});
	});

	describe('setAppCredentials', () => {
		it('should set credentials', () => {
			const state = createEmptyState('production', 'env_123');

			setAppCredentials(state, 'api', { dbUser: 'api', dbPassword: 'secret' });

			expect(state.appCredentials?.api).toEqual({
				dbUser: 'api',
				dbPassword: 'secret',
			});
		});

		it('should initialize appCredentials if not exists', () => {
			const state = createEmptyState('production', 'env_123');
			expect(state.appCredentials).toBeUndefined();

			setAppCredentials(state, 'api', { dbUser: 'api', dbPassword: 'secret' });

			expect(state.appCredentials).toBeDefined();
		});

		it('should update existing credentials', () => {
			const state = createEmptyState('production', 'env_123');
			state.appCredentials = {
				api: { dbUser: 'api', dbPassword: 'old_password' },
			};

			setAppCredentials(state, 'api', {
				dbUser: 'api',
				dbPassword: 'new_password',
			});

			expect(state.appCredentials.api.dbPassword).toBe('new_password');
		});
	});

	describe('getAllAppCredentials', () => {
		it('should return all credentials', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				appCredentials: {
					api: { dbUser: 'api', dbPassword: 'secret1' },
					auth: { dbUser: 'auth', dbPassword: 'secret2' },
				},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(getAllAppCredentials(state)).toEqual({
				api: { dbUser: 'api', dbPassword: 'secret1' },
				auth: { dbUser: 'auth', dbPassword: 'secret2' },
			});
		});

		it('should return empty object when no credentials', () => {
			const state = createEmptyState('production', 'env_123');

			expect(getAllAppCredentials(state)).toEqual({});
		});

		it('should return empty object when state is null', () => {
			expect(getAllAppCredentials(null)).toEqual({});
		});
	});

	// =========================================================================
	// Generated Secrets Tests
	// =========================================================================

	describe('getGeneratedSecret', () => {
		it('should return secret when exists', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				generatedSecrets: {
					auth: { BETTER_AUTH_SECRET: 'secret123' },
				},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(getGeneratedSecret(state, 'auth', 'BETTER_AUTH_SECRET')).toBe(
				'secret123',
			);
		});

		it('should return undefined when app not found', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				generatedSecrets: {
					auth: { BETTER_AUTH_SECRET: 'secret123' },
				},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(
				getGeneratedSecret(state, 'api', 'BETTER_AUTH_SECRET'),
			).toBeUndefined();
		});

		it('should return undefined when secret name not found', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				generatedSecrets: {
					auth: { BETTER_AUTH_SECRET: 'secret123' },
				},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(getGeneratedSecret(state, 'auth', 'OTHER_SECRET')).toBeUndefined();
		});

		it('should return undefined when no generatedSecrets', () => {
			const state = createEmptyState('production', 'env_123');

			expect(
				getGeneratedSecret(state, 'auth', 'BETTER_AUTH_SECRET'),
			).toBeUndefined();
		});

		it('should return undefined when state is null', () => {
			expect(
				getGeneratedSecret(null, 'auth', 'BETTER_AUTH_SECRET'),
			).toBeUndefined();
		});
	});

	describe('setGeneratedSecret', () => {
		it('should set secret', () => {
			const state = createEmptyState('production', 'env_123');

			setGeneratedSecret(state, 'auth', 'BETTER_AUTH_SECRET', 'secret123');

			expect(state.generatedSecrets?.auth?.BETTER_AUTH_SECRET).toBe(
				'secret123',
			);
		});

		it('should initialize generatedSecrets if not exists', () => {
			const state = createEmptyState('production', 'env_123');
			expect(state.generatedSecrets).toBeUndefined();

			setGeneratedSecret(state, 'auth', 'BETTER_AUTH_SECRET', 'secret123');

			expect(state.generatedSecrets).toBeDefined();
		});

		it('should initialize app secrets if not exists', () => {
			const state = createEmptyState('production', 'env_123');
			state.generatedSecrets = {};

			setGeneratedSecret(state, 'auth', 'BETTER_AUTH_SECRET', 'secret123');

			expect(state.generatedSecrets.auth).toBeDefined();
		});

		it('should update existing secret', () => {
			const state = createEmptyState('production', 'env_123');
			state.generatedSecrets = {
				auth: { BETTER_AUTH_SECRET: 'old_secret' },
			};

			setGeneratedSecret(state, 'auth', 'BETTER_AUTH_SECRET', 'new_secret');

			expect(state.generatedSecrets.auth.BETTER_AUTH_SECRET).toBe('new_secret');
		});

		it('should add multiple secrets for same app', () => {
			const state = createEmptyState('production', 'env_123');

			setGeneratedSecret(state, 'auth', 'BETTER_AUTH_SECRET', 'secret1');
			setGeneratedSecret(state, 'auth', 'OTHER_SECRET', 'secret2');

			expect(state.generatedSecrets?.auth).toEqual({
				BETTER_AUTH_SECRET: 'secret1',
				OTHER_SECRET: 'secret2',
			});
		});
	});

	describe('getAppGeneratedSecrets', () => {
		it('should return all secrets for an app', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				generatedSecrets: {
					auth: {
						BETTER_AUTH_SECRET: 'secret1',
						OTHER_SECRET: 'secret2',
					},
				},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(getAppGeneratedSecrets(state, 'auth')).toEqual({
				BETTER_AUTH_SECRET: 'secret1',
				OTHER_SECRET: 'secret2',
			});
		});

		it('should return empty object when app not found', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				generatedSecrets: {
					auth: { BETTER_AUTH_SECRET: 'secret1' },
				},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(getAppGeneratedSecrets(state, 'api')).toEqual({});
		});

		it('should return empty object when state is null', () => {
			expect(getAppGeneratedSecrets(null, 'auth')).toEqual({});
		});
	});

	describe('getAllGeneratedSecrets', () => {
		it('should return all generated secrets', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				generatedSecrets: {
					auth: { BETTER_AUTH_SECRET: 'secret1' },
					'admin-auth': { BETTER_AUTH_SECRET: 'secret2' },
				},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(getAllGeneratedSecrets(state)).toEqual({
				auth: { BETTER_AUTH_SECRET: 'secret1' },
				'admin-auth': { BETTER_AUTH_SECRET: 'secret2' },
			});
		});

		it('should return empty object when no secrets', () => {
			const state = createEmptyState('production', 'env_123');

			expect(getAllGeneratedSecrets(state)).toEqual({});
		});

		it('should return empty object when state is null', () => {
			expect(getAllGeneratedSecrets(null)).toEqual({});
		});
	});

	// =========================================================================
	// DNS Verification Tests
	// =========================================================================

	describe('getDnsVerification', () => {
		it('should return verification record when exists', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				dnsVerified: {
					'api.example.com': {
						serverIp: '1.2.3.4',
						verifiedAt: '2024-01-01T00:00:00.000Z',
					},
				},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(getDnsVerification(state, 'api.example.com')).toEqual({
				serverIp: '1.2.3.4',
				verifiedAt: '2024-01-01T00:00:00.000Z',
			});
		});

		it('should return undefined when hostname not found', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				dnsVerified: {
					'api.example.com': {
						serverIp: '1.2.3.4',
						verifiedAt: '2024-01-01T00:00:00.000Z',
					},
				},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(getDnsVerification(state, 'web.example.com')).toBeUndefined();
		});

		it('should return undefined when no dnsVerified', () => {
			const state = createEmptyState('production', 'env_123');

			expect(getDnsVerification(state, 'api.example.com')).toBeUndefined();
		});

		it('should return undefined when state is null', () => {
			expect(getDnsVerification(null, 'api.example.com')).toBeUndefined();
		});
	});

	describe('setDnsVerification', () => {
		it('should set verification record', () => {
			const state = createEmptyState('production', 'env_123');

			setDnsVerification(state, 'api.example.com', '1.2.3.4');

			expect(state.dnsVerified?.['api.example.com']?.serverIp).toBe('1.2.3.4');
			expect(state.dnsVerified?.['api.example.com']?.verifiedAt).toBeDefined();
		});

		it('should initialize dnsVerified if not exists', () => {
			const state = createEmptyState('production', 'env_123');
			expect(state.dnsVerified).toBeUndefined();

			setDnsVerification(state, 'api.example.com', '1.2.3.4');

			expect(state.dnsVerified).toBeDefined();
		});

		it('should update existing verification', () => {
			const state = createEmptyState('production', 'env_123');
			state.dnsVerified = {
				'api.example.com': {
					serverIp: '1.1.1.1',
					verifiedAt: '2024-01-01T00:00:00.000Z',
				},
			};

			setDnsVerification(state, 'api.example.com', '2.2.2.2');

			expect(state.dnsVerified['api.example.com'].serverIp).toBe('2.2.2.2');
		});

		it('should generate valid ISO timestamp', () => {
			const state = createEmptyState('production', 'env_123');

			setDnsVerification(state, 'api.example.com', '1.2.3.4');

			const verifiedAt = state.dnsVerified?.['api.example.com']?.verifiedAt;
			expect(() => new Date(verifiedAt!)).not.toThrow();
		});
	});

	describe('isDnsVerified', () => {
		it('should return true when hostname verified with same IP', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				dnsVerified: {
					'api.example.com': {
						serverIp: '1.2.3.4',
						verifiedAt: '2024-01-01T00:00:00.000Z',
					},
				},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(isDnsVerified(state, 'api.example.com', '1.2.3.4')).toBe(true);
		});

		it('should return false when hostname verified with different IP', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				dnsVerified: {
					'api.example.com': {
						serverIp: '1.2.3.4',
						verifiedAt: '2024-01-01T00:00:00.000Z',
					},
				},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(isDnsVerified(state, 'api.example.com', '5.6.7.8')).toBe(false);
		});

		it('should return false when hostname not verified', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				dnsVerified: {},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(isDnsVerified(state, 'api.example.com', '1.2.3.4')).toBe(false);
		});

		it('should return false when state is null', () => {
			expect(isDnsVerified(null, 'api.example.com', '1.2.3.4')).toBe(false);
		});
	});

	describe('getAllDnsVerifications', () => {
		it('should return all verification records', () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				dnsVerified: {
					'api.example.com': {
						serverIp: '1.2.3.4',
						verifiedAt: '2024-01-01T00:00:00.000Z',
					},
					'web.example.com': {
						serverIp: '1.2.3.4',
						verifiedAt: '2024-01-02T00:00:00.000Z',
					},
				},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			expect(getAllDnsVerifications(state)).toEqual({
				'api.example.com': {
					serverIp: '1.2.3.4',
					verifiedAt: '2024-01-01T00:00:00.000Z',
				},
				'web.example.com': {
					serverIp: '1.2.3.4',
					verifiedAt: '2024-01-02T00:00:00.000Z',
				},
			});
		});

		it('should return empty object when no verifications', () => {
			const state = createEmptyState('production', 'env_123');

			expect(getAllDnsVerifications(state)).toEqual({});
		});

		it('should return empty object when state is null', () => {
			expect(getAllDnsVerifications(null)).toEqual({});
		});
	});

	describe('writeStageState with new fields', () => {
		it('should preserve generatedSecrets', async () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				generatedSecrets: {
					auth: { BETTER_AUTH_SECRET: 'secret123' },
				},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			await writeStageState(testDir, 'production', state);

			const content = await readFile(
				join(testDir, '.gkm', 'deploy-production.json'),
				'utf-8',
			);
			const parsed = JSON.parse(content);

			expect(parsed.generatedSecrets).toEqual({
				auth: { BETTER_AUTH_SECRET: 'secret123' },
			});
		});

		it('should preserve dnsVerified', async () => {
			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: {},
				services: {},
				dnsVerified: {
					'api.example.com': {
						serverIp: '1.2.3.4',
						verifiedAt: '2024-01-01T00:00:00.000Z',
					},
				},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			await writeStageState(testDir, 'production', state);

			const content = await readFile(
				join(testDir, '.gkm', 'deploy-production.json'),
				'utf-8',
			);
			const parsed = JSON.parse(content);

			expect(parsed.dnsVerified).toEqual({
				'api.example.com': {
					serverIp: '1.2.3.4',
					verifiedAt: '2024-01-01T00:00:00.000Z',
				},
			});
		});
	});
});
