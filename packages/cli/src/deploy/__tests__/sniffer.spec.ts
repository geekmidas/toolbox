import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NormalizedAppConfig } from '../../workspace/types';
import {
	_sniffEntryFile,
	_sniffEnvParser,
	sniffAllApps,
	sniffAppEnvironment,
} from '../sniffer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesPath = resolve(__dirname, '__fixtures__/entry-apps');
const envParserFixturesPath = resolve(__dirname, '__fixtures__/env-parsers');

describe('sniffAppEnvironment', () => {
	const workspacePath = '/test/workspace';

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

	describe('frontend apps', () => {
		it('should return empty env vars for frontend apps', async () => {
			const app = createApp({ type: 'frontend' });

			const result = await sniffAppEnvironment(app, 'web', workspacePath);

			expect(result.appName).toBe('web');
			expect(result.requiredEnvVars).toEqual([]);
		});

		it('should ignore requiredEnv for frontend apps', async () => {
			const app = createApp({
				type: 'frontend',
				requiredEnv: ['API_KEY', 'SECRET'], // Should be ignored
			});

			const result = await sniffAppEnvironment(app, 'web', workspacePath);

			expect(result.requiredEnvVars).toEqual([]);
		});
	});

	describe('entry-based apps with requiredEnv', () => {
		it('should return requiredEnv list for entry-based apps', async () => {
			const app = createApp({
				entry: './src/index.ts',
				requiredEnv: ['DATABASE_URL', 'BETTER_AUTH_SECRET'],
			});

			const result = await sniffAppEnvironment(app, 'auth', workspacePath);

			expect(result.appName).toBe('auth');
			expect(result.requiredEnvVars).toEqual([
				'DATABASE_URL',
				'BETTER_AUTH_SECRET',
			]);
		});

		it('should return copy of requiredEnv (not reference)', async () => {
			const requiredEnv = ['DATABASE_URL'];
			const app = createApp({ requiredEnv });

			const result = await sniffAppEnvironment(app, 'api', workspacePath);

			// Modify the result and verify original is unchanged
			result.requiredEnvVars.push('MODIFIED');
			expect(requiredEnv).toEqual(['DATABASE_URL']);
		});

		it('should return empty when requiredEnv is empty array', async () => {
			const app = createApp({ requiredEnv: [] });

			const result = await sniffAppEnvironment(app, 'api', workspacePath);

			expect(result.requiredEnvVars).toEqual([]);
		});
	});

	describe('apps with envParser', () => {
		it('should return empty when envParser module cannot be loaded', async () => {
			const app = createApp({
				envParser: './src/nonexistent/env#parser',
			});

			// This will fail to load the module and return empty
			// Suppress warnings for this test
			const result = await sniffAppEnvironment(app, 'api', workspacePath, {
				logWarnings: false,
			});

			expect(result.requiredEnvVars).toEqual([]);
		});

		it('should gracefully handle errors without failing the build', async () => {
			const app = createApp({
				envParser: './src/invalid/path#nonexistent',
			});

			// Should not throw, just return empty
			const result = await sniffAppEnvironment(app, 'api', workspacePath, {
				logWarnings: false,
			});

			expect(result.appName).toBe('api');
			expect(result.requiredEnvVars).toEqual([]);
		});
	});

	describe('apps without env detection', () => {
		it('should return empty when no envParser or requiredEnv', async () => {
			const app = createApp({
				// No envParser or requiredEnv
			});

			const result = await sniffAppEnvironment(app, 'api', workspacePath);

			expect(result.requiredEnvVars).toEqual([]);
		});
	});
});

describe('sniffAllApps', () => {
	const workspacePath = '/test/workspace';

	it('should sniff all apps in workspace', async () => {
		const apps: Record<string, NormalizedAppConfig> = {
			api: {
				type: 'backend',
				path: 'apps/api',
				port: 3000,
				dependencies: [],
				resolvedDeployTarget: 'dokploy',
				requiredEnv: ['DATABASE_URL', 'REDIS_URL'],
			},
			auth: {
				type: 'backend',
				path: 'apps/auth',
				port: 3002,
				dependencies: [],
				resolvedDeployTarget: 'dokploy',
				requiredEnv: ['DATABASE_URL', 'BETTER_AUTH_SECRET'],
			},
			web: {
				type: 'frontend',
				path: 'apps/web',
				port: 3001,
				dependencies: ['api', 'auth'],
				resolvedDeployTarget: 'dokploy',
			},
		};

		const results = await sniffAllApps(apps, workspacePath);

		expect(results.size).toBe(3);

		expect(results.get('api')).toEqual({
			appName: 'api',
			requiredEnvVars: ['DATABASE_URL', 'REDIS_URL'],
		});

		expect(results.get('auth')).toEqual({
			appName: 'auth',
			requiredEnvVars: ['DATABASE_URL', 'BETTER_AUTH_SECRET'],
		});

		expect(results.get('web')).toEqual({
			appName: 'web',
			requiredEnvVars: [], // Frontend - no secrets
		});
	});

	it('should handle empty apps record', async () => {
		const apps: Record<string, NormalizedAppConfig> = {};

		const results = await sniffAllApps(apps, workspacePath);

		expect(results.size).toBe(0);
	});

	it('should pass options to individual app sniffing', async () => {
		const apps: Record<string, NormalizedAppConfig> = {
			api: {
				type: 'backend',
				path: 'apps/api',
				port: 3000,
				dependencies: [],
				resolvedDeployTarget: 'dokploy',
				envParser: './src/nonexistent/env#parser', // Will fail but shouldn't log
			},
		};

		// Should not throw, and suppress warnings
		const results = await sniffAllApps(apps, workspacePath, {
			logWarnings: false,
		});

		expect(results.size).toBe(1);
		expect(results.get('api')?.requiredEnvVars).toEqual([]);
	});
});

describe('fire-and-forget handling', () => {
	it('captures environment variables even when envParser throws', async () => {
		// The sniffer should capture env vars that were accessed before an error
		// This is the "fire and forget" pattern - errors don't stop env detection
		const app: NormalizedAppConfig = {
			type: 'backend',
			path: 'apps/api',
			port: 3000,
			dependencies: [],
			resolvedDeployTarget: 'dokploy',
			envParser: './src/invalid#missing',
		};

		const result = await sniffAppEnvironment(app, 'api', '/test/workspace', {
			logWarnings: false,
		});

		// Should return gracefully without throwing
		expect(result.appName).toBe('api');
		expect(Array.isArray(result.requiredEnvVars)).toBe(true);
	});
});

describe('entry app sniffing via subprocess', () => {
	// These tests verify the subprocess-based sniffing for entry apps.
	// Each test uses fixture files that import @geekmidas/envkit.

	it('should sniff environment variables from simple entry app', async () => {
		const result = await _sniffEntryFile(
			'./simple-entry.ts',
			fixturesPath,
			fixturesPath,
		);

		expect(result.envVars).toContain('PORT');
		expect(result.envVars).toContain('DATABASE_URL');
		expect(result.envVars).toContain('REDIS_URL');
		expect(result.envVars).toHaveLength(3);
	});

	it('should sniff environment variables from nested config entry app', async () => {
		const result = await _sniffEntryFile(
			'./nested-config-entry.ts',
			fixturesPath,
			fixturesPath,
		);

		// Should capture all nested env vars
		expect(result.envVars).toContain('PORT');
		expect(result.envVars).toContain('HOST');
		expect(result.envVars).toContain('DATABASE_URL');
		expect(result.envVars).toContain('DB_POOL_SIZE');
		expect(result.envVars).toContain('BETTER_AUTH_SECRET');
		expect(result.envVars).toContain('BETTER_AUTH_URL');
		expect(result.envVars).toContain('BETTER_AUTH_TRUSTED_ORIGINS');
		expect(result.envVars).toHaveLength(7);
	});

	it('should capture env vars even when entry throws', async () => {
		const result = await _sniffEntryFile(
			'./throwing-entry.ts',
			fixturesPath,
			fixturesPath,
		);

		// Should still capture env vars accessed before the throw
		expect(result.envVars).toContain('PORT');
		expect(result.envVars).toContain('API_KEY');
		expect(result.envVars).toHaveLength(2);

		// Should report the error
		expect(result.error).toBeDefined();
		expect(result.error?.message).toContain('Initialization failed');
	});

	it('should return empty when entry has no env vars', async () => {
		const result = await _sniffEntryFile(
			'./no-env-entry.ts',
			fixturesPath,
			fixturesPath,
		);

		expect(result.envVars).toEqual([]);
		expect(result.error).toBeUndefined();
	});

	it('should handle async entry apps with fire-and-forget promises', async () => {
		const result = await _sniffEntryFile(
			'./async-entry.ts',
			fixturesPath,
			fixturesPath,
		);

		expect(result.envVars).toContain('PORT');
		expect(result.envVars).toContain('DATABASE_URL');
		expect(result.envVars).toHaveLength(2);
	});

	it('should return error for non-existent entry file', async () => {
		const result = await _sniffEntryFile(
			'./non-existent.ts',
			fixturesPath,
			fixturesPath,
		);

		expect(result.envVars).toEqual([]);
		expect(result.error).toBeDefined();
	});
});

describe('sniffAppEnvironment with entry apps', () => {
	// Integration tests for sniffAppEnvironment with entry-based apps

	it('should use subprocess sniffing for entry apps without requiredEnv', async () => {
		const app: NormalizedAppConfig = {
			type: 'backend',
			path: fixturesPath,
			port: 3000,
			dependencies: [],
			resolvedDeployTarget: 'dokploy',
			entry: './simple-entry.ts',
		};

		const result = await sniffAppEnvironment(app, 'api', fixturesPath);

		expect(result.appName).toBe('api');
		expect(result.requiredEnvVars).toContain('PORT');
		expect(result.requiredEnvVars).toContain('DATABASE_URL');
		expect(result.requiredEnvVars).toContain('REDIS_URL');
	});

	it('should prefer requiredEnv over sniffing for entry apps', async () => {
		const app: NormalizedAppConfig = {
			type: 'backend',
			path: fixturesPath,
			port: 3000,
			dependencies: [],
			resolvedDeployTarget: 'dokploy',
			entry: './simple-entry.ts',
			requiredEnv: ['CUSTOM_VAR', 'ANOTHER_VAR'], // Should use this instead of sniffing
		};

		const result = await sniffAppEnvironment(app, 'api', fixturesPath);

		expect(result.requiredEnvVars).toEqual(['CUSTOM_VAR', 'ANOTHER_VAR']);
		// Should NOT contain the sniffed vars since requiredEnv takes precedence
		expect(result.requiredEnvVars).not.toContain('PORT');
		expect(result.requiredEnvVars).not.toContain('DATABASE_URL');
	});

	it('should handle entry app that throws and still return captured env vars', async () => {
		const app: NormalizedAppConfig = {
			type: 'backend',
			path: fixturesPath,
			port: 3000,
			dependencies: [],
			resolvedDeployTarget: 'dokploy',
			entry: './throwing-entry.ts',
		};

		const result = await sniffAppEnvironment(app, 'api', fixturesPath, {
			logWarnings: false,
		});

		expect(result.appName).toBe('api');
		expect(result.requiredEnvVars).toContain('PORT');
		expect(result.requiredEnvVars).toContain('API_KEY');
	});
});

describe('envParser sniffing via _sniffEnvParser', () => {
	// These tests verify the envParser sniffing functionality.
	// Each test uses fixture files that export envParser functions.

	it('should sniff environment variables from valid envParser', async () => {
		const result = await _sniffEnvParser(
			'./valid-env-parser.ts#envParser',
			envParserFixturesPath,
			envParserFixturesPath,
		);

		expect(result.envVars).toContain('PORT');
		expect(result.envVars).toContain('DATABASE_URL');
		expect(result.envVars).toContain('DB_POOL_SIZE');
		expect(result.envVars).toHaveLength(3);
	});

	it('should sniff environment variables from default export', async () => {
		// Test with default export (no # specifier)
		const result = await _sniffEnvParser(
			'./valid-env-parser.ts',
			envParserFixturesPath,
			envParserFixturesPath,
		);

		expect(result.envVars).toContain('PORT');
		expect(result.envVars).toContain('DATABASE_URL');
		expect(result.envVars).toContain('DB_POOL_SIZE');
	});

	it('should return empty when export is not a function', async () => {
		const result = await _sniffEnvParser(
			'./non-function-export.ts#envParser',
			envParserFixturesPath,
			envParserFixturesPath,
		);

		expect(result.envVars).toEqual([]);
	});

	it('should handle non-function default export', async () => {
		const result = await _sniffEnvParser(
			'./non-function-export.ts', // Uses default export which is not a function
			envParserFixturesPath,
			envParserFixturesPath,
		);

		expect(result.envVars).toEqual([]);
	});

	it('should return empty when module path is empty', async () => {
		const result = await _sniffEnvParser(
			'#envParser', // Empty module path
			envParserFixturesPath,
			envParserFixturesPath,
		);

		expect(result.envVars).toEqual([]);
		expect(result.unhandledRejections).toEqual([]);
	});

	it('should capture env vars from throwing envParser', async () => {
		const result = await _sniffEnvParser(
			'./throwing-env-parser.ts#envParser',
			envParserFixturesPath,
			envParserFixturesPath,
		);

		// Should still capture env vars accessed before the throw
		expect(result.envVars).toContain('PORT');
		expect(result.envVars).toContain('API_KEY');
	});

	it('should return empty when module does not exist', async () => {
		const result = await _sniffEnvParser(
			'./non-existent.ts#envParser',
			envParserFixturesPath,
			envParserFixturesPath,
		);

		expect(result.envVars).toEqual([]);
	});

	it('should call parse() on returned config and capture env vars', async () => {
		// This tests the path where envParser returns a config with parse() method
		const result = await _sniffEnvParser(
			'./parseable-env-parser.ts#envParser',
			envParserFixturesPath,
			envParserFixturesPath,
		);

		// Should capture env vars even though parse() fails due to missing values
		expect(result.envVars).toContain('PORT');
		expect(result.envVars).toContain('DATABASE_URL');
		expect(result.envVars).toContain('API_KEY');
		expect(result.envVars).toHaveLength(3);
	});
});

describe('sniffAppEnvironment with envParser apps', () => {
	it('should use envParser sniffing for apps with envParser config', async () => {
		const app: NormalizedAppConfig = {
			type: 'backend',
			path: envParserFixturesPath,
			port: 3000,
			dependencies: [],
			resolvedDeployTarget: 'dokploy',
			envParser: './valid-env-parser.ts#envParser',
		};

		const result = await sniffAppEnvironment(
			app,
			'api',
			envParserFixturesPath,
		);

		expect(result.appName).toBe('api');
		expect(result.requiredEnvVars).toContain('PORT');
		expect(result.requiredEnvVars).toContain('DATABASE_URL');
		expect(result.requiredEnvVars).toContain('DB_POOL_SIZE');
	});

	it('should prefer requiredEnv over envParser sniffing', async () => {
		const app: NormalizedAppConfig = {
			type: 'backend',
			path: envParserFixturesPath,
			port: 3000,
			dependencies: [],
			resolvedDeployTarget: 'dokploy',
			envParser: './valid-env-parser.ts#envParser',
			requiredEnv: ['CUSTOM_VAR'], // Should use this instead
		};

		const result = await sniffAppEnvironment(
			app,
			'api',
			envParserFixturesPath,
		);

		expect(result.requiredEnvVars).toEqual(['CUSTOM_VAR']);
		// Should NOT contain the sniffed vars
		expect(result.requiredEnvVars).not.toContain('PORT');
	});

	it('should handle envParser that exports non-function gracefully', async () => {
		const app: NormalizedAppConfig = {
			type: 'backend',
			path: envParserFixturesPath,
			port: 3000,
			dependencies: [],
			resolvedDeployTarget: 'dokploy',
			envParser: './non-function-export.ts#envParser',
		};

		const result = await sniffAppEnvironment(
			app,
			'api',
			envParserFixturesPath,
			{ logWarnings: false },
		);

		expect(result.appName).toBe('api');
		expect(result.requiredEnvVars).toEqual([]);
	});
});
