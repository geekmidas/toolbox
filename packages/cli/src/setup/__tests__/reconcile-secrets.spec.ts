import { describe, expect, it } from 'vitest';
import type { StageSecrets } from '../../secrets/types.js';
import type { NormalizedWorkspace } from '../../workspace/types.js';
import { generateFullstackCustomSecrets } from '../fullstack-secrets.js';
import { reconcileSecrets } from '../index.js';

function createWorkspace(
	overrides: Partial<NormalizedWorkspace> = {},
): NormalizedWorkspace {
	return {
		name: 'test-project',
		root: '/tmp/test-project',
		apps: {
			api: {
				type: 'backend',
				port: 3000,
				root: '/tmp/test-project/apps/api',
				packageName: '@test/api',
				routes: './src/endpoints/**/*.ts',
				dependencies: [],
			},
			auth: {
				type: 'backend',
				port: 3001,
				root: '/tmp/test-project/apps/auth',
				packageName: '@test/auth',
				entry: './src/index.ts',
				framework: 'better-auth',
				dependencies: [],
			},
			web: {
				type: 'frontend',
				port: 3002,
				root: '/tmp/test-project/apps/web',
				packageName: '@test/web',
				dependencies: ['api', 'auth'],
			},
		},
		services: {
			db: true,
			cache: false,
			mail: false,
		},
		...overrides,
	} as NormalizedWorkspace;
}

function createSecrets(custom: Record<string, string> = {}): StageSecrets {
	return {
		stage: 'development',
		createdAt: '2025-01-01T00:00:00.000Z',
		updatedAt: '2025-01-01T00:00:00.000Z',
		services: {
			postgres: {
				host: 'localhost',
				port: 5432,
				username: 'postgres',
				password: 'postgres',
				database: 'test_dev',
			},
		},
		urls: {
			DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test_dev',
		},
		custom,
	};
}

describe('reconcileSecrets', () => {
	it('should add missing BETTER_AUTH_* keys to existing secrets', () => {
		const workspace = createWorkspace();
		const secrets = createSecrets({
			NODE_ENV: 'development',
			PORT: '3000',
			LOG_LEVEL: 'debug',
			JWT_SECRET: 'existing-jwt-secret',
			API_DATABASE_URL: 'postgresql://api:pass@localhost:5432/test_dev',
			API_DB_PASSWORD: 'pass',
			AUTH_DATABASE_URL: 'postgresql://auth:pass@localhost:5432/test_dev',
			AUTH_DB_PASSWORD: 'pass',
			WEB_URL: 'http://localhost:3002',
		});

		const result = reconcileSecrets(secrets, workspace);

		expect(result).not.toBeNull();
		expect(result!.custom.BETTER_AUTH_SECRET).toBeDefined();
		expect(result!.custom.BETTER_AUTH_URL).toBe('http://localhost:3001');
		expect(result!.custom.BETTER_AUTH_TRUSTED_ORIGINS).toContain(
			'http://localhost:3000',
		);
		expect(result!.custom.BETTER_AUTH_TRUSTED_ORIGINS).toContain(
			'http://localhost:3001',
		);
		expect(result!.custom.BETTER_AUTH_TRUSTED_ORIGINS).toContain(
			'http://localhost:3002',
		);
		expect(result!.custom.AUTH_PORT).toBe('3001');
		expect(result!.custom.AUTH_URL).toBe('http://localhost:3001');
	});

	it('should not overwrite existing secret values', () => {
		const workspace = createWorkspace();
		const secrets = createSecrets({
			NODE_ENV: 'development',
			PORT: '3000',
			LOG_LEVEL: 'debug',
			JWT_SECRET: 'my-custom-jwt',
			API_DATABASE_URL: 'postgresql://api:custom@localhost:5432/test_dev',
			API_DB_PASSWORD: 'custom',
			AUTH_DATABASE_URL: 'postgresql://auth:custom@localhost:5432/test_dev',
			AUTH_DB_PASSWORD: 'custom',
			WEB_URL: 'http://localhost:3002',
			BETTER_AUTH_SECRET: 'my-existing-secret',
			BETTER_AUTH_URL: 'http://localhost:3001',
			BETTER_AUTH_TRUSTED_ORIGINS:
				'http://localhost:3000,http://localhost:3001',
			AUTH_PORT: '3001',
			AUTH_URL: 'http://localhost:3001',
		});

		const result = reconcileSecrets(secrets, workspace);

		expect(result).toBeNull();
	});

	it('should add missing service credentials when workspace config adds a new service', () => {
		const workspace = createWorkspace({
			services: { db: true, storage: true },
		});
		// Secrets only have postgres, not minio
		const secrets = createSecrets({
			NODE_ENV: 'development',
			PORT: '3000',
			API_DATABASE_URL: 'postgresql://api:pass@localhost:5432/test_dev',
			API_DB_PASSWORD: 'pass',
			AUTH_DATABASE_URL: 'postgresql://auth:pass@localhost:5432/test_dev',
			AUTH_DB_PASSWORD: 'pass',
			WEB_URL: 'http://localhost:3002',
			BETTER_AUTH_SECRET: 'existing',
			BETTER_AUTH_URL: 'http://localhost:3001',
			BETTER_AUTH_TRUSTED_ORIGINS:
				'http://localhost:3000,http://localhost:3001,http://localhost:3002',
			AUTH_PORT: '3001',
			AUTH_URL: 'http://localhost:3001',
		});

		const result = reconcileSecrets(secrets, workspace);

		expect(result).not.toBeNull();
		expect(result!.services.minio).toBeDefined();
		expect(result!.services.minio!.host).toBe('localhost');
		expect(result!.services.minio!.port).toBe(9000);
		expect(result!.services.minio!.bucket).toBe('test-project');
		expect(result!.services.minio!.password).toHaveLength(32);
		expect(result!.urls.STORAGE_ENDPOINT).toBe('http://localhost:9000');
		// Existing postgres should be preserved
		expect(result!.services.postgres).toEqual(secrets.services.postgres);
	});

	it('should not regenerate credentials for existing services', () => {
		const workspace = createWorkspace({
			services: { db: true, storage: true },
		});
		// Include ALL expected custom keys so reconcile has nothing to add
		const expected = generateFullstackCustomSecrets(
			createWorkspace({ services: { db: true, storage: true } }),
		);
		const secrets = createSecrets(expected);
		// Add existing minio creds
		secrets.services.minio = {
			host: 'localhost',
			port: 9000,
			username: 'mykey',
			password: 'mysecret',
			bucket: 'my-bucket',
		};
		secrets.urls.STORAGE_ENDPOINT = 'http://localhost:9000';

		const result = reconcileSecrets(secrets, workspace);

		// No changes needed — all services and custom keys present
		expect(result).toBeNull();
	});

	it('should return null for single-app workspaces', () => {
		const workspace = createWorkspace({
			apps: {
				api: {
					type: 'backend',
					port: 3000,
					root: '/tmp/test-project/apps/api',
					path: 'apps/api',
					resolvedDeployTarget: 'dokploy',
					packageName: '@test/api',
					routes: './src/endpoints/**/*.ts',
					dependencies: [],
				},
			},
		} as Partial<NormalizedWorkspace>);

		const secrets = createSecrets({ NODE_ENV: 'development' });

		const result = reconcileSecrets(secrets, workspace);

		expect(result).toBeNull();
	});

	it('should preserve all existing custom secrets when adding new ones', () => {
		const workspace = createWorkspace();
		const secrets = createSecrets({
			NODE_ENV: 'development',
			PORT: '3000',
			LOG_LEVEL: 'debug',
			JWT_SECRET: 'keep-this',
			MY_CUSTOM_VAR: 'user-added',
			API_DATABASE_URL: 'postgresql://api:pass@localhost:5432/test_dev',
			API_DB_PASSWORD: 'pass',
			AUTH_DATABASE_URL: 'postgresql://auth:pass@localhost:5432/test_dev',
			AUTH_DB_PASSWORD: 'pass',
			WEB_URL: 'http://localhost:3002',
		});

		const result = reconcileSecrets(secrets, workspace);

		expect(result).not.toBeNull();
		expect(result!.custom.JWT_SECRET).toBe('keep-this');
		expect(result!.custom.MY_CUSTOM_VAR).toBe('user-added');
		expect(result!.custom.BETTER_AUTH_SECRET).toBeDefined();
	});

	it('should update updatedAt timestamp when reconciling', () => {
		const workspace = createWorkspace();
		const secrets = createSecrets({
			NODE_ENV: 'development',
			PORT: '3000',
			API_DATABASE_URL: 'postgresql://api:pass@localhost:5432/test_dev',
			API_DB_PASSWORD: 'pass',
			AUTH_DATABASE_URL: 'postgresql://auth:pass@localhost:5432/test_dev',
			AUTH_DB_PASSWORD: 'pass',
			WEB_URL: 'http://localhost:3002',
		});

		const result = reconcileSecrets(secrets, workspace);

		expect(result).not.toBeNull();
		expect(result!.updatedAt).not.toBe(secrets.updatedAt);
		expect(result!.createdAt).toBe(secrets.createdAt);
	});
});

describe('generateFullstackCustomSecrets', () => {
	it('should generate BETTER_AUTH_* secrets for better-auth framework apps', () => {
		const workspace = createWorkspace();

		const result = generateFullstackCustomSecrets(workspace);

		expect(result.BETTER_AUTH_SECRET).toBeDefined();
		expect(result.BETTER_AUTH_SECRET).toMatch(/^better-auth-/);
		expect(result.BETTER_AUTH_URL).toBe('http://localhost:3001');
		expect(result.AUTH_PORT).toBe('3001');
		expect(result.AUTH_URL).toBe('http://localhost:3001');
	});

	it('should include all app ports in BETTER_AUTH_TRUSTED_ORIGINS', () => {
		const workspace = createWorkspace();

		const result = generateFullstackCustomSecrets(workspace);

		const origins = result.BETTER_AUTH_TRUSTED_ORIGINS.split(',');
		expect(origins).toContain('http://localhost:3000');
		expect(origins).toContain('http://localhost:3001');
		expect(origins).toContain('http://localhost:3002');
	});

	it('should not generate BETTER_AUTH_* for non-better-auth apps', () => {
		const workspace = createWorkspace({
			apps: {
				api: {
					type: 'backend',
					port: 3000,
					root: '/tmp/test-project/apps/api',
					path: 'apps/api',
					resolvedDeployTarget: 'dokploy',
					packageName: '@test/api',
					routes: './src/endpoints/**/*.ts',
					dependencies: [],
				},
				web: {
					type: 'frontend',
					port: 3001,
					root: '/tmp/test-project/apps/web',
					path: 'apps/web',
					resolvedDeployTarget: 'dokploy',
					packageName: '@test/web',
					dependencies: ['api'],
				},
			},
		} as Partial<NormalizedWorkspace>);

		const result = generateFullstackCustomSecrets(workspace);

		expect(result.BETTER_AUTH_SECRET).toBeUndefined();
		expect(result.BETTER_AUTH_URL).toBeUndefined();
		expect(result.BETTER_AUTH_TRUSTED_ORIGINS).toBeUndefined();
	});
});
