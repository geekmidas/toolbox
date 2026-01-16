import { describe, expect, it } from 'vitest';
import type { StageSecrets } from '../../secrets/types';
import {
	encryptSecretsForApp,
	filterSecretsForApp,
	generateSecretsReport,
	prepareSecretsForAllApps,
	prepareSecretsForApp,
} from '../secrets';
import type { SniffedEnvironment } from '../sniffer';

describe('filterSecretsForApp', () => {
	const createStageSecrets = (
		custom: Record<string, string> = {},
	): StageSecrets => ({
		stage: 'production',
		createdAt: '2024-01-01T00:00:00Z',
		updatedAt: '2024-01-01T00:00:00Z',
		services: {},
		urls: {
			DATABASE_URL: 'postgresql://localhost:5432/db',
			REDIS_URL: 'redis://localhost:6379',
		},
		custom,
	});

	it('should filter secrets to only required env vars', () => {
		const secrets = createStageSecrets({ API_KEY: 'secret123' });
		const sniffed: SniffedEnvironment = {
			appName: 'api',
			requiredEnvVars: ['DATABASE_URL', 'API_KEY'],
		};

		const result = filterSecretsForApp(secrets, sniffed);

		expect(result.appName).toBe('api');
		expect(result.secrets).toEqual({
			DATABASE_URL: 'postgresql://localhost:5432/db',
			API_KEY: 'secret123',
		});
		expect(result.found).toEqual(['API_KEY', 'DATABASE_URL']);
		expect(result.missing).toEqual([]);
	});

	it('should track missing secrets', () => {
		const secrets = createStageSecrets();
		const sniffed: SniffedEnvironment = {
			appName: 'api',
			requiredEnvVars: ['DATABASE_URL', 'STRIPE_KEY', 'JWT_SECRET'],
		};

		const result = filterSecretsForApp(secrets, sniffed);

		expect(result.found).toEqual(['DATABASE_URL']);
		expect(result.missing).toEqual(['JWT_SECRET', 'STRIPE_KEY']);
	});

	it('should return empty secrets when no env vars required', () => {
		const secrets = createStageSecrets({ API_KEY: 'secret' });
		const sniffed: SniffedEnvironment = {
			appName: 'web',
			requiredEnvVars: [],
		};

		const result = filterSecretsForApp(secrets, sniffed);

		expect(result.secrets).toEqual({});
		expect(result.found).toEqual([]);
		expect(result.missing).toEqual([]);
	});

	it('should include service credentials when referenced', () => {
		const secrets: StageSecrets = {
			stage: 'production',
			createdAt: '2024-01-01T00:00:00Z',
			updatedAt: '2024-01-01T00:00:00Z',
			services: {
				postgres: {
					host: 'localhost',
					port: 5432,
					username: 'user',
					password: 'pass',
					database: 'mydb',
				},
			},
			urls: { DATABASE_URL: 'postgresql://user:pass@localhost:5432/mydb' },
			custom: {},
		};
		const sniffed: SniffedEnvironment = {
			appName: 'api',
			requiredEnvVars: ['DATABASE_URL', 'POSTGRES_PASSWORD'],
		};

		const result = filterSecretsForApp(secrets, sniffed);

		expect(result.secrets.DATABASE_URL).toBe(
			'postgresql://user:pass@localhost:5432/mydb',
		);
		expect(result.secrets.POSTGRES_PASSWORD).toBe('pass');
		expect(result.found).toContain('DATABASE_URL');
		expect(result.found).toContain('POSTGRES_PASSWORD');
	});
});

describe('encryptSecretsForApp', () => {
	it('should encrypt filtered secrets and return master key', () => {
		const filtered = {
			appName: 'api',
			secrets: { DATABASE_URL: 'postgresql://localhost:5432/db' },
			found: ['DATABASE_URL'],
			missing: [],
		};

		const result = encryptSecretsForApp(filtered);

		expect(result.appName).toBe('api');
		expect(result.masterKey).toHaveLength(64); // 32 bytes hex
		expect(result.payload.encrypted).toBeTruthy();
		expect(result.payload.iv).toBeTruthy();
		expect(result.secretCount).toBe(1);
		expect(result.missingSecrets).toEqual([]);
	});

	it('should track missing secrets in result', () => {
		const filtered = {
			appName: 'api',
			secrets: { DATABASE_URL: 'postgresql://localhost:5432/db' },
			found: ['DATABASE_URL'],
			missing: ['STRIPE_KEY', 'JWT_SECRET'],
		};

		const result = encryptSecretsForApp(filtered);

		expect(result.missingSecrets).toEqual(['STRIPE_KEY', 'JWT_SECRET']);
	});

	it('should handle empty secrets', () => {
		const filtered = {
			appName: 'web',
			secrets: {},
			found: [],
			missing: [],
		};

		const result = encryptSecretsForApp(filtered);

		expect(result.secretCount).toBe(0);
		expect(result.masterKey).toHaveLength(64);
	});
});

describe('prepareSecretsForApp', () => {
	it('should filter and encrypt in one step', () => {
		const secrets: StageSecrets = {
			stage: 'production',
			createdAt: '2024-01-01T00:00:00Z',
			updatedAt: '2024-01-01T00:00:00Z',
			services: {},
			urls: { DATABASE_URL: 'postgresql://localhost:5432/db' },
			custom: { API_KEY: 'key123' },
		};
		const sniffed: SniffedEnvironment = {
			appName: 'api',
			requiredEnvVars: ['DATABASE_URL', 'API_KEY'],
		};

		const result = prepareSecretsForApp(secrets, sniffed);

		expect(result.appName).toBe('api');
		expect(result.secretCount).toBe(2);
		expect(result.masterKey).toHaveLength(64);
	});
});

describe('prepareSecretsForAllApps', () => {
	const secrets: StageSecrets = {
		stage: 'production',
		createdAt: '2024-01-01T00:00:00Z',
		updatedAt: '2024-01-01T00:00:00Z',
		services: {},
		urls: {
			DATABASE_URL: 'postgresql://localhost:5432/db',
			REDIS_URL: 'redis://localhost:6379',
		},
		custom: { BETTER_AUTH_SECRET: 'auth-secret' },
	};

	it('should prepare secrets for multiple apps', () => {
		const sniffedApps = new Map<string, SniffedEnvironment>([
			['api', { appName: 'api', requiredEnvVars: ['DATABASE_URL', 'REDIS_URL'] }],
			[
				'auth',
				{
					appName: 'auth',
					requiredEnvVars: ['DATABASE_URL', 'BETTER_AUTH_SECRET'],
				},
			],
		]);

		const results = prepareSecretsForAllApps(secrets, sniffedApps);

		expect(results.size).toBe(2);
		expect(results.get('api')?.secretCount).toBe(2);
		expect(results.get('auth')?.secretCount).toBe(2);
	});

	it('should skip apps with no required env vars', () => {
		const sniffedApps = new Map<string, SniffedEnvironment>([
			['api', { appName: 'api', requiredEnvVars: ['DATABASE_URL'] }],
			['web', { appName: 'web', requiredEnvVars: [] }], // Frontend - no secrets
		]);

		const results = prepareSecretsForAllApps(secrets, sniffedApps);

		expect(results.size).toBe(1);
		expect(results.has('api')).toBe(true);
		expect(results.has('web')).toBe(false);
	});

	it('should generate unique master keys per app', () => {
		const sniffedApps = new Map<string, SniffedEnvironment>([
			['api', { appName: 'api', requiredEnvVars: ['DATABASE_URL'] }],
			['auth', { appName: 'auth', requiredEnvVars: ['DATABASE_URL'] }],
		]);

		const results = prepareSecretsForAllApps(secrets, sniffedApps);

		const apiKey = results.get('api')?.masterKey;
		const authKey = results.get('auth')?.masterKey;

		expect(apiKey).not.toBe(authKey);
	});
});

describe('generateSecretsReport', () => {
	it('should generate report for apps with and without secrets', () => {
		const sniffedApps = new Map<string, SniffedEnvironment>([
			['api', { appName: 'api', requiredEnvVars: ['DATABASE_URL'] }],
			['auth', { appName: 'auth', requiredEnvVars: ['DATABASE_URL'] }],
			['web', { appName: 'web', requiredEnvVars: [] }],
		]);

		const encryptedApps = new Map([
			[
				'api',
				{
					appName: 'api',
					payload: { encrypted: '', iv: '', masterKey: '' },
					masterKey: 'key1',
					secretCount: 1,
					missingSecrets: [],
				},
			],
			[
				'auth',
				{
					appName: 'auth',
					payload: { encrypted: '', iv: '', masterKey: '' },
					masterKey: 'key2',
					secretCount: 1,
					missingSecrets: ['MISSING_VAR'],
				},
			],
		]);

		const report = generateSecretsReport(encryptedApps, sniffedApps);

		expect(report.totalApps).toBe(3);
		expect(report.appsWithSecrets).toEqual(['api', 'auth']);
		expect(report.appsWithoutSecrets).toEqual(['web']);
		expect(report.appsWithMissingSecrets).toEqual([
			{ appName: 'auth', missing: ['MISSING_VAR'] },
		]);
	});

	it('should handle all apps having secrets', () => {
		const sniffedApps = new Map<string, SniffedEnvironment>([
			['api', { appName: 'api', requiredEnvVars: ['DATABASE_URL'] }],
		]);

		const encryptedApps = new Map([
			[
				'api',
				{
					appName: 'api',
					payload: { encrypted: '', iv: '', masterKey: '' },
					masterKey: 'key1',
					secretCount: 1,
					missingSecrets: [],
				},
			],
		]);

		const report = generateSecretsReport(encryptedApps, sniffedApps);

		expect(report.appsWithSecrets).toEqual(['api']);
		expect(report.appsWithoutSecrets).toEqual([]);
		expect(report.appsWithMissingSecrets).toEqual([]);
	});
});
