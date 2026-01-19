import { describe, expect, it } from 'vitest';
import type { NormalizedAppConfig } from '../../workspace/types';
import {
	AUTO_SUPPORTED_VARS,
	buildDatabaseUrl,
	buildRedisUrl,
	type EnvResolverContext,
	formatMissingVarsError,
	generateSecret,
	getOrGenerateSecret,
	isAutoSupportedVar,
	resolveEnvVar,
	resolveEnvVars,
	validateEnvVars,
} from '../env-resolver';
import { createEmptyState, type DokployStageState } from '../state';

describe('isAutoSupportedVar', () => {
	it('should return true for all AUTO_SUPPORTED_VARS', () => {
		for (const varName of AUTO_SUPPORTED_VARS) {
			expect(isAutoSupportedVar(varName)).toBe(true);
		}
	});

	it('should return false for unknown variables', () => {
		expect(isAutoSupportedVar('UNKNOWN_VAR')).toBe(false);
		expect(isAutoSupportedVar('MY_CUSTOM_VAR')).toBe(false);
		expect(isAutoSupportedVar('')).toBe(false);
	});

	it('should be case-sensitive', () => {
		expect(isAutoSupportedVar('port')).toBe(false);
		expect(isAutoSupportedVar('Port')).toBe(false);
		expect(isAutoSupportedVar('PORT')).toBe(true);
	});
});

describe('generateSecret', () => {
	it('should generate a 64-character hex string', () => {
		const secret = generateSecret();
		expect(secret).toMatch(/^[a-f0-9]{64}$/);
	});

	it('should generate unique secrets each time', () => {
		const secrets = new Set<string>();
		for (let i = 0; i < 100; i++) {
			secrets.add(generateSecret());
		}
		expect(secrets.size).toBe(100);
	});
});

describe('getOrGenerateSecret', () => {
	it('should return existing secret if already stored', () => {
		const state: DokployStageState = {
			...createEmptyState('production', 'proj_test', 'env-123'),
			generatedSecrets: {
				api: { BETTER_AUTH_SECRET: 'existing-secret-123' },
			},
		};

		const result = getOrGenerateSecret(state, 'api', 'BETTER_AUTH_SECRET');
		expect(result).toBe('existing-secret-123');
	});

	it('should generate and store new secret if not exists', () => {
		const state = createEmptyState('production', 'proj_test', 'env-123');

		const result = getOrGenerateSecret(state, 'api', 'BETTER_AUTH_SECRET');

		expect(result).toMatch(/^[a-f0-9]{64}$/);
		expect(state.generatedSecrets?.api?.BETTER_AUTH_SECRET).toBe(result);
	});

	it('should generate different secrets for different apps', () => {
		const state = createEmptyState('production', 'proj_test', 'env-123');

		const apiSecret = getOrGenerateSecret(state, 'api', 'BETTER_AUTH_SECRET');
		const authSecret = getOrGenerateSecret(state, 'auth', 'BETTER_AUTH_SECRET');

		expect(apiSecret).not.toBe(authSecret);
		expect(state.generatedSecrets?.api?.BETTER_AUTH_SECRET).toBe(apiSecret);
		expect(state.generatedSecrets?.auth?.BETTER_AUTH_SECRET).toBe(authSecret);
	});

	it('should generate different secrets for different secret names', () => {
		const state = createEmptyState('production', 'proj_test', 'env-123');

		const secret1 = getOrGenerateSecret(state, 'api', 'SECRET_ONE');
		const secret2 = getOrGenerateSecret(state, 'api', 'SECRET_TWO');

		expect(secret1).not.toBe(secret2);
	});

	it('should return same secret on subsequent calls', () => {
		const state = createEmptyState('production', 'proj_test', 'env-123');

		const first = getOrGenerateSecret(state, 'api', 'BETTER_AUTH_SECRET');
		const second = getOrGenerateSecret(state, 'api', 'BETTER_AUTH_SECRET');

		expect(first).toBe(second);
	});
});

describe('buildDatabaseUrl', () => {
	it('should build correct URL with credentials', () => {
		const credentials = { dbUser: 'myuser', dbPassword: 'mypassword' };
		const postgres = { host: 'localhost', port: 5432, database: 'mydb' };

		const url = buildDatabaseUrl(credentials, postgres);

		expect(url).toBe('postgresql://myuser:mypassword@localhost:5432/mydb');
	});

	it('should encode special characters in username and password', () => {
		const credentials = { dbUser: 'user@test', dbPassword: 'pass#word!123' };
		const postgres = { host: 'db.example.com', port: 5432, database: 'app' };

		const url = buildDatabaseUrl(credentials, postgres);

		expect(url).toBe(
			'postgresql://user%40test:pass%23word!123@db.example.com:5432/app',
		);
	});

	it('should handle different port numbers', () => {
		const credentials = { dbUser: 'user', dbPassword: 'pass' };
		const postgres = { host: 'localhost', port: 5433, database: 'testdb' };

		const url = buildDatabaseUrl(credentials, postgres);

		expect(url).toBe('postgresql://user:pass@localhost:5433/testdb');
	});
});

describe('buildRedisUrl', () => {
	it('should build URL with password', () => {
		const redis = { host: 'localhost', port: 6379, password: 'redispass' };

		const url = buildRedisUrl(redis);

		expect(url).toBe('redis://:redispass@localhost:6379');
	});

	it('should build URL without password', () => {
		const redis = { host: 'localhost', port: 6379 };

		const url = buildRedisUrl(redis);

		expect(url).toBe('redis://localhost:6379');
	});

	it('should encode special characters in password', () => {
		const redis = {
			host: 'redis.example.com',
			port: 6380,
			password: 'p@ss:word',
		};

		const url = buildRedisUrl(redis);

		expect(url).toBe('redis://:p%40ss%3Aword@redis.example.com:6380');
	});
});

describe('resolveEnvVar', () => {
	const createApp = (
		overrides: Partial<NormalizedAppConfig> = {},
	): NormalizedAppConfig => ({
		type: 'backend',
		path: 'apps/api',
		port: 3000,
		dependencies: [],
		resolvedDeployTarget: 'dokploy',
		...overrides,
	});

	const createContext = (
		overrides: Partial<EnvResolverContext> = {},
	): EnvResolverContext => ({
		app: createApp(),
		appName: 'api',
		stage: 'production',
		state: createEmptyState('production', 'proj_test', 'env-123'),
		appHostname: 'api.example.com',
		frontendUrls: [],
		...overrides,
	});

	it('should resolve PORT from app config', () => {
		const context = createContext({
			app: createApp({ port: 8080 }),
		});

		expect(resolveEnvVar('PORT', context)).toBe('8080');
	});

	it('should resolve NODE_ENV to production for all stages (deployed apps)', () => {
		// NODE_ENV is always 'production' for deployed apps
		// gkm dev handles development mode separately
		expect(
			resolveEnvVar('NODE_ENV', createContext({ stage: 'production' })),
		).toBe('production');
		expect(resolveEnvVar('NODE_ENV', createContext({ stage: 'staging' }))).toBe(
			'production',
		);
		expect(
			resolveEnvVar('NODE_ENV', createContext({ stage: 'development' })),
		).toBe('production');
	});

	it('should resolve DATABASE_URL when credentials and postgres are provided', () => {
		const context = createContext({
			appCredentials: { dbUser: 'api', dbPassword: 'secret123' },
			postgres: { host: 'postgres', port: 5432, database: 'myproject' },
		});

		const url = resolveEnvVar('DATABASE_URL', context);

		expect(url).toBe('postgresql://api:secret123@postgres:5432/myproject');
	});

	it('should return undefined for DATABASE_URL when credentials missing', () => {
		const context = createContext({
			postgres: { host: 'postgres', port: 5432, database: 'myproject' },
		});

		expect(resolveEnvVar('DATABASE_URL', context)).toBeUndefined();
	});

	it('should resolve REDIS_URL when redis is provided', () => {
		const context = createContext({
			redis: { host: 'redis', port: 6379, password: 'redispass' },
		});

		const url = resolveEnvVar('REDIS_URL', context);

		expect(url).toBe('redis://:redispass@redis:6379');
	});

	it('should return undefined for REDIS_URL when redis missing', () => {
		const context = createContext();

		expect(resolveEnvVar('REDIS_URL', context)).toBeUndefined();
	});

	it('should resolve BETTER_AUTH_URL from app hostname', () => {
		const context = createContext({ appHostname: 'auth.myapp.com' });

		expect(resolveEnvVar('BETTER_AUTH_URL', context)).toBe(
			'https://auth.myapp.com',
		);
	});

	it('should resolve BETTER_AUTH_SECRET by generating and storing secret', () => {
		const state = createEmptyState('production', 'proj_test', 'env-123');
		const context = createContext({ state, appName: 'auth' });

		const secret = resolveEnvVar('BETTER_AUTH_SECRET', context);

		expect(secret).toMatch(/^[a-f0-9]{64}$/);
		expect(state.generatedSecrets?.auth?.BETTER_AUTH_SECRET).toBe(secret);
	});

	it('should resolve BETTER_AUTH_TRUSTED_ORIGINS from frontend URLs', () => {
		const context = createContext({
			frontendUrls: ['https://web.myapp.com', 'https://admin.myapp.com'],
		});

		const origins = resolveEnvVar('BETTER_AUTH_TRUSTED_ORIGINS', context);

		expect(origins).toBe('https://web.myapp.com,https://admin.myapp.com');
	});

	it('should return undefined for BETTER_AUTH_TRUSTED_ORIGINS when no frontend URLs', () => {
		const context = createContext({ frontendUrls: [] });

		expect(
			resolveEnvVar('BETTER_AUTH_TRUSTED_ORIGINS', context),
		).toBeUndefined();
	});

	it('should resolve GKM_MASTER_KEY from context', () => {
		const context = createContext({ masterKey: 'my-master-key-123' });

		expect(resolveEnvVar('GKM_MASTER_KEY', context)).toBe('my-master-key-123');
	});

	it('should return undefined for GKM_MASTER_KEY when not provided', () => {
		const context = createContext();

		expect(resolveEnvVar('GKM_MASTER_KEY', context)).toBeUndefined();
	});

	it('should resolve custom variable from userSecrets.custom', () => {
		const context = createContext({
			userSecrets: {
				stage: 'production',
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z',
				custom: { MY_API_KEY: 'secret-api-key' },
				urls: {},
				services: {},
			},
		});

		expect(resolveEnvVar('MY_API_KEY', context)).toBe('secret-api-key');
	});

	it('should resolve URL variables from userSecrets.urls', () => {
		const context = createContext({
			userSecrets: {
				stage: 'production',
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z',
				custom: {},
				urls: { DATABASE_URL: 'postgresql://external:5432/db' },
				services: {},
			},
		});

		expect(resolveEnvVar('DATABASE_URL', context)).toBe(
			'postgresql://external:5432/db',
		);
	});

	it('should resolve POSTGRES_PASSWORD from userSecrets.services', () => {
		const context = createContext({
			userSecrets: {
				stage: 'production',
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z',
				custom: {},
				urls: {},
				services: {
					postgres: {
						host: 'localhost',
						port: 5432,
						username: 'postgres',
						password: 'pg-password',
					},
				},
			},
		});

		expect(resolveEnvVar('POSTGRES_PASSWORD', context)).toBe('pg-password');
	});

	it('should resolve REDIS_PASSWORD from userSecrets.services', () => {
		const context = createContext({
			userSecrets: {
				stage: 'production',
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z',
				custom: {},
				urls: {},
				services: {
					redis: {
						host: 'localhost',
						port: 6379,
						username: 'default',
						password: 'redis-password',
					},
				},
			},
		});

		expect(resolveEnvVar('REDIS_PASSWORD', context)).toBe('redis-password');
	});

	it('should return undefined for unknown variable', () => {
		const context = createContext();

		expect(resolveEnvVar('UNKNOWN_VAR', context)).toBeUndefined();
	});

	describe('dependency URLs', () => {
		it('should resolve AUTH_URL from dependencyUrls', () => {
			const context = createContext({
				dependencyUrls: { auth: 'https://auth.example.com' },
			});

			expect(resolveEnvVar('AUTH_URL', context)).toBe(
				'https://auth.example.com',
			);
		});

		it('should resolve API_URL from dependencyUrls', () => {
			const context = createContext({
				dependencyUrls: { api: 'https://api.example.com' },
			});

			expect(resolveEnvVar('API_URL', context)).toBe('https://api.example.com');
		});

		it('should resolve any {DEP}_URL pattern from dependencyUrls', () => {
			const context = createContext({
				dependencyUrls: {
					payments: 'https://payments.example.com',
					notifications: 'https://notifications.example.com',
				},
			});

			expect(resolveEnvVar('PAYMENTS_URL', context)).toBe(
				'https://payments.example.com',
			);
			expect(resolveEnvVar('NOTIFICATIONS_URL', context)).toBe(
				'https://notifications.example.com',
			);
		});

		it('should return undefined for missing dependency URL', () => {
			const context = createContext({
				dependencyUrls: { auth: 'https://auth.example.com' },
			});

			expect(resolveEnvVar('API_URL', context)).toBeUndefined();
		});

		it('should return undefined when dependencyUrls is not provided', () => {
			const context = createContext();

			expect(resolveEnvVar('AUTH_URL', context)).toBeUndefined();
		});

		it('should handle custom domain from config', () => {
			const context = createContext({
				dependencyUrls: { auth: 'https://login.myapp.com' },
			});

			expect(resolveEnvVar('AUTH_URL', context)).toBe(
				'https://login.myapp.com',
			);
		});

		it('should prefer user secrets over dependency URLs', () => {
			const context = createContext({
				dependencyUrls: { auth: 'https://auth.example.com' },
				userSecrets: {
					stage: 'production',
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z',
					custom: { AUTH_URL: 'https://custom-auth.example.com' },
					urls: {},
					services: {},
				},
			});

			// User secrets are checked after dependency URLs, so dependency URL wins
			// If you want user secrets to override, the order in resolveEnvVar should change
			expect(resolveEnvVar('AUTH_URL', context)).toBe(
				'https://auth.example.com',
			);
		});

		describe('NEXT_PUBLIC_ prefix', () => {
			it('should resolve NEXT_PUBLIC_API_URL from dependencyUrls.api', () => {
				const context = createContext({
					dependencyUrls: { api: 'https://api.example.com' },
				});

				expect(resolveEnvVar('NEXT_PUBLIC_API_URL', context)).toBe(
					'https://api.example.com',
				);
			});

			it('should resolve NEXT_PUBLIC_AUTH_URL from dependencyUrls.auth', () => {
				const context = createContext({
					dependencyUrls: { auth: 'https://auth.example.com' },
				});

				expect(resolveEnvVar('NEXT_PUBLIC_AUTH_URL', context)).toBe(
					'https://auth.example.com',
				);
			});

			it('should resolve both AUTH_URL and NEXT_PUBLIC_AUTH_URL to same value', () => {
				const context = createContext({
					dependencyUrls: { auth: 'https://auth.example.com' },
				});

				expect(resolveEnvVar('AUTH_URL', context)).toBe(
					'https://auth.example.com',
				);
				expect(resolveEnvVar('NEXT_PUBLIC_AUTH_URL', context)).toBe(
					'https://auth.example.com',
				);
			});

			it('should resolve NEXT_PUBLIC_ prefix for any dependency', () => {
				const context = createContext({
					dependencyUrls: {
						payments: 'https://payments.example.com',
						notifications: 'https://notifications.example.com',
					},
				});

				expect(resolveEnvVar('NEXT_PUBLIC_PAYMENTS_URL', context)).toBe(
					'https://payments.example.com',
				);
				expect(resolveEnvVar('NEXT_PUBLIC_NOTIFICATIONS_URL', context)).toBe(
					'https://notifications.example.com',
				);
			});

			it('should return undefined for missing NEXT_PUBLIC_ dependency URL', () => {
				const context = createContext({
					dependencyUrls: { auth: 'https://auth.example.com' },
				});

				expect(resolveEnvVar('NEXT_PUBLIC_API_URL', context)).toBeUndefined();
			});

			it('should return undefined when dependencyUrls is not provided', () => {
				const context = createContext();

				expect(resolveEnvVar('NEXT_PUBLIC_AUTH_URL', context)).toBeUndefined();
			});
		});
	});
});

describe('resolveEnvVars', () => {
	const createContext = (
		overrides: Partial<EnvResolverContext> = {},
	): EnvResolverContext => ({
		app: {
			type: 'backend',
			path: 'apps/api',
			port: 3000,
			dependencies: [],
			resolvedDeployTarget: 'dokploy',
		},
		appName: 'api',
		stage: 'production',
		state: createEmptyState('production', 'proj_test', 'env-123'),
		appHostname: 'api.example.com',
		frontendUrls: ['https://web.example.com'],
		...overrides,
	});

	it('should resolve all provided variables', () => {
		const context = createContext({
			appCredentials: { dbUser: 'api', dbPassword: 'pass' },
			postgres: { host: 'postgres', port: 5432, database: 'mydb' },
		});

		const result = resolveEnvVars(
			['PORT', 'NODE_ENV', 'DATABASE_URL'],
			context,
		);

		expect(result.resolved).toEqual({
			PORT: '3000',
			NODE_ENV: 'production',
			DATABASE_URL: 'postgresql://api:pass@postgres:5432/mydb',
		});
		expect(result.missing).toEqual([]);
	});

	it('should collect missing variables', () => {
		const context = createContext();

		const result = resolveEnvVars(
			['PORT', 'DATABASE_URL', 'CUSTOM_VAR'],
			context,
		);

		expect(result.resolved).toEqual({ PORT: '3000' });
		expect(result.missing).toEqual(['DATABASE_URL', 'CUSTOM_VAR']);
	});

	it('should handle empty input', () => {
		const context = createContext();

		const result = resolveEnvVars([], context);

		expect(result.resolved).toEqual({});
		expect(result.missing).toEqual([]);
	});
});

describe('formatMissingVarsError', () => {
	it('should format error message with missing variables', () => {
		const error = formatMissingVarsError(
			'api',
			['DATABASE_URL', 'REDIS_URL'],
			'production',
		);

		expect(error).toContain(
			'Deployment failed: api is missing required environment variables',
		);
		expect(error).toContain('- DATABASE_URL');
		expect(error).toContain('- REDIS_URL');
		expect(error).toContain(
			'gkm secrets:set <VAR_NAME> <value> --stage production',
		);
	});

	it('should handle single missing variable', () => {
		const error = formatMissingVarsError('auth', ['MY_SECRET'], 'staging');

		expect(error).toContain('auth is missing required environment variables');
		expect(error).toContain('- MY_SECRET');
		expect(error).toContain('--stage staging');
	});
});

describe('validateEnvVars', () => {
	const createContext = (
		overrides: Partial<EnvResolverContext> = {},
	): EnvResolverContext => ({
		app: {
			type: 'backend',
			path: 'apps/api',
			port: 3000,
			dependencies: [],
			resolvedDeployTarget: 'dokploy',
		},
		appName: 'api',
		stage: 'production',
		state: createEmptyState('production', 'proj_test', 'env-123'),
		appHostname: 'api.example.com',
		frontendUrls: [],
		...overrides,
	});

	it('should return valid=true when all vars resolved', () => {
		const context = createContext();

		const result = validateEnvVars(['PORT', 'NODE_ENV'], context);

		expect(result.valid).toBe(true);
		expect(result.missing).toEqual([]);
		expect(result.resolved).toEqual({
			PORT: '3000',
			NODE_ENV: 'production',
		});
	});

	it('should return valid=false when vars are missing', () => {
		const context = createContext();

		const result = validateEnvVars(
			['PORT', 'DATABASE_URL', 'CUSTOM_VAR'],
			context,
		);

		expect(result.valid).toBe(false);
		expect(result.missing).toEqual(['DATABASE_URL', 'CUSTOM_VAR']);
		expect(result.resolved).toEqual({ PORT: '3000' });
	});

	it('should return valid=true for empty input', () => {
		const context = createContext();

		const result = validateEnvVars([], context);

		expect(result.valid).toBe(true);
		expect(result.missing).toEqual([]);
		expect(result.resolved).toEqual({});
	});

	it('should resolve dependency URLs in validation', () => {
		const context = createContext({
			dependencyUrls: {
				auth: 'https://auth.example.com',
				api: 'https://api.example.com',
			},
		});

		const result = validateEnvVars(['PORT', 'AUTH_URL', 'API_URL'], context);

		expect(result.valid).toBe(true);
		expect(result.missing).toEqual([]);
		expect(result.resolved).toEqual({
			PORT: '3000',
			AUTH_URL: 'https://auth.example.com',
			API_URL: 'https://api.example.com',
		});
	});

	it('should report missing dependency URLs', () => {
		const context = createContext({
			dependencyUrls: { auth: 'https://auth.example.com' },
		});

		const result = validateEnvVars(
			['PORT', 'AUTH_URL', 'PAYMENTS_URL'],
			context,
		);

		expect(result.valid).toBe(false);
		expect(result.missing).toEqual(['PAYMENTS_URL']);
		expect(result.resolved).toEqual({
			PORT: '3000',
			AUTH_URL: 'https://auth.example.com',
		});
	});
});

/**
 * Tests for Docker build arg extraction logic.
 * This simulates the behavior in deploy/index.ts where NEXT_PUBLIC_* vars
 * are extracted from resolved vars for Docker build args.
 */
describe('Docker build arg extraction', () => {
	const createContext = (
		overrides: Partial<EnvResolverContext> = {},
	): EnvResolverContext => ({
		app: {
			type: 'frontend',
			path: 'apps/web',
			port: 3001,
			dependencies: ['api', 'auth'],
			resolvedDeployTarget: 'dokploy',
		},
		appName: 'web',
		stage: 'production',
		state: createEmptyState('production', 'proj_test', 'env-123'),
		appHostname: 'web.example.com',
		frontendUrls: [],
		...overrides,
	});

	/**
	 * Simulates the build arg extraction logic from deploy/index.ts
	 */
	function extractBuildArgs(resolved: Record<string, string>): {
		buildArgs: string[];
		publicUrlArgNames: string[];
	} {
		const buildArgs: string[] = [];
		const publicUrlArgNames: string[] = [];

		for (const [key, value] of Object.entries(resolved)) {
			if (key.startsWith('NEXT_PUBLIC_')) {
				buildArgs.push(`${key}=${value}`);
				publicUrlArgNames.push(key);
			}
		}

		return { buildArgs, publicUrlArgNames };
	}

	it('should extract NEXT_PUBLIC_* vars as build args', () => {
		const context = createContext({
			dependencyUrls: {
				api: 'https://api.example.com',
				auth: 'https://auth.example.com',
			},
		});

		const sniffedVars = [
			'NEXT_PUBLIC_API_URL',
			'NEXT_PUBLIC_AUTH_URL',
			'NEXT_PUBLIC_STRIPE_KEY',
		];

		const { resolved } = validateEnvVars(sniffedVars, context);

		// Simulate user secrets providing STRIPE_KEY
		resolved.NEXT_PUBLIC_STRIPE_KEY = 'pk_test_123';

		const { buildArgs, publicUrlArgNames } = extractBuildArgs(resolved);

		expect(publicUrlArgNames).toEqual([
			'NEXT_PUBLIC_API_URL',
			'NEXT_PUBLIC_AUTH_URL',
			'NEXT_PUBLIC_STRIPE_KEY',
		]);
		expect(buildArgs).toEqual([
			'NEXT_PUBLIC_API_URL=https://api.example.com',
			'NEXT_PUBLIC_AUTH_URL=https://auth.example.com',
			'NEXT_PUBLIC_STRIPE_KEY=pk_test_123',
		]);
	});

	it('should NOT include server-only vars in build args', () => {
		const context = createContext({
			dependencyUrls: { api: 'https://api.example.com' },
			appCredentials: { dbUser: 'web', dbPassword: 'pass' },
			postgres: { host: 'postgres', port: 5432, database: 'mydb' },
		});

		const sniffedVars = [
			'NEXT_PUBLIC_API_URL',
			'DATABASE_URL',
			'STRIPE_SECRET_KEY',
		];

		const { resolved } = validateEnvVars(sniffedVars, context);

		// Add server-only secret
		resolved.STRIPE_SECRET_KEY = 'sk_test_secret';

		const { buildArgs, publicUrlArgNames } = extractBuildArgs(resolved);

		// Only NEXT_PUBLIC_* should be in build args
		expect(publicUrlArgNames).toEqual(['NEXT_PUBLIC_API_URL']);
		expect(buildArgs).toEqual(['NEXT_PUBLIC_API_URL=https://api.example.com']);

		// Server vars should still be in resolved (for runtime)
		expect(resolved.DATABASE_URL).toBe(
			'postgresql://web:pass@postgres:5432/mydb',
		);
		expect(resolved.STRIPE_SECRET_KEY).toBe('sk_test_secret');
	});

	it('should handle mixed frontend vars correctly', () => {
		const context = createContext({
			dependencyUrls: {
				api: 'https://api.example.com',
				auth: 'https://auth.example.com',
			},
			userSecrets: {
				stage: 'production',
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z',
				custom: {
					NEXT_PUBLIC_POSTHOG_KEY: 'phc_test123',
					STRIPE_SECRET_KEY: 'sk_test_secret',
				},
				urls: {},
				services: {},
			},
		});

		const sniffedVars = [
			// From dependencies (auto-generated)
			'NEXT_PUBLIC_API_URL',
			'NEXT_PUBLIC_AUTH_URL',
			// From client config
			'NEXT_PUBLIC_POSTHOG_KEY',
			// From server config
			'STRIPE_SECRET_KEY',
			'DATABASE_URL',
		];

		const { resolved, missing } = validateEnvVars(sniffedVars, context);

		// DATABASE_URL is missing (no postgres config)
		expect(missing).toContain('DATABASE_URL');

		const { buildArgs, publicUrlArgNames } = extractBuildArgs(resolved);

		// Only NEXT_PUBLIC_* should be build args
		expect(publicUrlArgNames).toHaveLength(3);
		expect(publicUrlArgNames).toContain('NEXT_PUBLIC_API_URL');
		expect(publicUrlArgNames).toContain('NEXT_PUBLIC_AUTH_URL');
		expect(publicUrlArgNames).toContain('NEXT_PUBLIC_POSTHOG_KEY');

		// Server secret should NOT be in build args
		expect(publicUrlArgNames).not.toContain('STRIPE_SECRET_KEY');

		// But should be in resolved for runtime
		expect(resolved.STRIPE_SECRET_KEY).toBe('sk_test_secret');
	});

	it('should return empty build args when no NEXT_PUBLIC_* vars', () => {
		const context = createContext({
			appCredentials: { dbUser: 'web', dbPassword: 'pass' },
			postgres: { host: 'postgres', port: 5432, database: 'mydb' },
		});

		const sniffedVars = ['DATABASE_URL', 'PORT'];

		const { resolved } = validateEnvVars(sniffedVars, context);
		const { buildArgs, publicUrlArgNames } = extractBuildArgs(resolved);

		expect(buildArgs).toEqual([]);
		expect(publicUrlArgNames).toEqual([]);
	});
});
