import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NormalizedAppConfig } from '../../workspace/types';
import {
	_sniffEntryFile,
	_sniffEnvParser,
	_sniffRouteFiles,
	sniffAllApps,
	sniffAppEnvironment,
} from '../sniffer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesPath = resolve(__dirname, '__fixtures__/entry-apps');
const envParserFixturesPath = resolve(__dirname, '__fixtures__/env-parsers');
const routeAppsFixturesPath = resolve(__dirname, '__fixtures__/route-apps');

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
		it('should return empty env vars for frontend apps with no dependencies', async () => {
			const app = createApp({ type: 'frontend', dependencies: [] });

			const result = await sniffAppEnvironment(app, 'web', workspacePath);

			expect(result.appName).toBe('web');
			expect(result.requiredEnvVars).toEqual([]);
		});

		it('should return NEXT_PUBLIC_{DEP}_URL for frontend dependencies', async () => {
			const app = createApp({
				type: 'frontend',
				dependencies: ['api', 'auth'],
			});

			const result = await sniffAppEnvironment(app, 'web', workspacePath);

			expect(result.appName).toBe('web');
			expect(result.requiredEnvVars).toContain('NEXT_PUBLIC_API_URL');
			expect(result.requiredEnvVars).toContain('NEXT_PUBLIC_AUTH_URL');
			expect(result.requiredEnvVars).toHaveLength(2);
		});

		it('should generate uppercase dep names in NEXT_PUBLIC_{DEP}_URL', async () => {
			const app = createApp({
				type: 'frontend',
				dependencies: ['payments-service', 'notification_api'],
			});

			const result = await sniffAppEnvironment(app, 'web', workspacePath);

			expect(result.requiredEnvVars).toContain('NEXT_PUBLIC_PAYMENTS-SERVICE_URL');
			expect(result.requiredEnvVars).toContain('NEXT_PUBLIC_NOTIFICATION_API_URL');
		});

		describe('config sniffing', () => {
			it('should sniff env vars from string config path', async () => {
				const app = createApp({
					type: 'frontend',
					path: fixturesPath,
					dependencies: ['api'],
					config: './simple-entry.ts',
				});

				const result = await sniffAppEnvironment(app, 'web', fixturesPath);

				// Should have dependency var + sniffed vars
				expect(result.requiredEnvVars).toContain('NEXT_PUBLIC_API_URL');
				expect(result.requiredEnvVars).toContain('PORT');
				expect(result.requiredEnvVars).toContain('DATABASE_URL');
				expect(result.requiredEnvVars).toContain('REDIS_URL');
			});

			it('should sniff env vars from config.client path', async () => {
				const app = createApp({
					type: 'frontend',
					path: fixturesPath,
					dependencies: [],
					config: {
						client: './simple-entry.ts',
					},
				});

				const result = await sniffAppEnvironment(app, 'web', fixturesPath);

				expect(result.requiredEnvVars).toContain('PORT');
				expect(result.requiredEnvVars).toContain('DATABASE_URL');
				expect(result.requiredEnvVars).toContain('REDIS_URL');
			});

			it('should sniff env vars from config.server path', async () => {
				const app = createApp({
					type: 'frontend',
					path: fixturesPath,
					dependencies: [],
					config: {
						server: './nested-config-entry.ts',
					},
				});

				const result = await sniffAppEnvironment(app, 'web', fixturesPath);

				expect(result.requiredEnvVars).toContain('PORT');
				expect(result.requiredEnvVars).toContain('HOST');
				expect(result.requiredEnvVars).toContain('DATABASE_URL');
			});

			it('should combine vars from both config.client and config.server', async () => {
				const app = createApp({
					type: 'frontend',
					path: fixturesPath,
					dependencies: ['api'],
					config: {
						client: './simple-entry.ts',
						server: './nested-config-entry.ts',
					},
				});

				const result = await sniffAppEnvironment(app, 'web', fixturesPath);

				// Dependency var
				expect(result.requiredEnvVars).toContain('NEXT_PUBLIC_API_URL');
				// From simple-entry.ts
				expect(result.requiredEnvVars).toContain('REDIS_URL');
				// From nested-config-entry.ts
				expect(result.requiredEnvVars).toContain('HOST');
				expect(result.requiredEnvVars).toContain('BETTER_AUTH_SECRET');
			});

			it('should deduplicate vars from both config files', async () => {
				const app = createApp({
					type: 'frontend',
					path: fixturesPath,
					dependencies: [],
					config: {
						client: './simple-entry.ts',
						server: './nested-config-entry.ts',
					},
				});

				const result = await sniffAppEnvironment(app, 'web', fixturesPath);

				// Both files have PORT and DATABASE_URL, should only appear once
				const portCount = result.requiredEnvVars.filter(
					(v) => v === 'PORT',
				).length;
				const dbUrlCount = result.requiredEnvVars.filter(
					(v) => v === 'DATABASE_URL',
				).length;

				expect(portCount).toBe(1);
				expect(dbUrlCount).toBe(1);
			});
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
		it('should return empty when no envParser, entry, or routes', async () => {
			const app = createApp({
				// No envParser, entry, or routes
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
				// No entry, routes, or envParser - will return empty
			},
			auth: {
				type: 'backend',
				path: 'apps/auth',
				port: 3002,
				dependencies: [],
				resolvedDeployTarget: 'dokploy',
				// No entry, routes, or envParser - will return empty
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
			requiredEnvVars: [],
		});

		expect(results.get('auth')).toEqual({
			appName: 'auth',
			requiredEnvVars: [],
		});

		expect(results.get('web')).toEqual({
			appName: 'web',
			requiredEnvVars: ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_AUTH_URL'],
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

	it('should use subprocess sniffing for entry apps', async () => {
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

		const result = await sniffAppEnvironment(app, 'api', envParserFixturesPath);

		expect(result.appName).toBe('api');
		expect(result.requiredEnvVars).toContain('PORT');
		expect(result.requiredEnvVars).toContain('DATABASE_URL');
		expect(result.requiredEnvVars).toContain('DB_POOL_SIZE');
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

describe('route files sniffing via _sniffRouteFiles', () => {
	// These tests verify the route-based sniffing for apps with routes config.
	// Each test uses fixture files that export endpoints with services.

	it('should sniff environment variables from endpoint with single service', async () => {
		const result = await _sniffRouteFiles(
			'./endpoints/users.ts',
			routeAppsFixturesPath,
			routeAppsFixturesPath,
		);

		expect(result.envVars).toContain('DATABASE_URL');
		// DB_POOL_SIZE is optional, may or may not be captured
		expect(result.error).toBeUndefined();
	});

	it('should sniff environment variables from endpoint with multiple services', async () => {
		const result = await _sniffRouteFiles(
			'./endpoints/auth.ts',
			routeAppsFixturesPath,
			routeAppsFixturesPath,
		);

		expect(result.envVars).toContain('DATABASE_URL');
		expect(result.envVars).toContain('AUTH_SECRET');
		expect(result.envVars).toContain('AUTH_URL');
		expect(result.error).toBeUndefined();
	});

	it('should return empty for endpoint without services', async () => {
		const result = await _sniffRouteFiles(
			'./endpoints/health.ts',
			routeAppsFixturesPath,
			routeAppsFixturesPath,
		);

		expect(result.envVars).toEqual([]);
		expect(result.error).toBeUndefined();
	});

	it('should sniff all endpoints matching glob pattern', async () => {
		const result = await _sniffRouteFiles(
			'./endpoints/**/*.ts',
			routeAppsFixturesPath,
			routeAppsFixturesPath,
		);

		// Should capture env vars from all endpoints
		expect(result.envVars).toContain('DATABASE_URL');
		expect(result.envVars).toContain('AUTH_SECRET');
		expect(result.envVars).toContain('AUTH_URL');
		expect(result.error).toBeUndefined();
	});

	it('should return empty for non-existent pattern', async () => {
		const result = await _sniffRouteFiles(
			'./nonexistent/**/*.ts',
			routeAppsFixturesPath,
			routeAppsFixturesPath,
		);

		expect(result.envVars).toEqual([]);
		expect(result.error).toBeUndefined();
	});

	it('should handle array of patterns', async () => {
		const result = await _sniffRouteFiles(
			['./endpoints/users.ts', './endpoints/health.ts'],
			routeAppsFixturesPath,
			routeAppsFixturesPath,
		);

		expect(result.envVars).toContain('DATABASE_URL');
		expect(result.error).toBeUndefined();
	});

	it('should deduplicate env vars from multiple endpoints using same service', async () => {
		const result = await _sniffRouteFiles(
			['./endpoints/users.ts', './endpoints/auth.ts'],
			routeAppsFixturesPath,
			routeAppsFixturesPath,
		);

		// DATABASE_URL is used by both endpoints, should only appear once
		const databaseUrlCount = result.envVars.filter(
			(v) => v === 'DATABASE_URL',
		).length;
		expect(databaseUrlCount).toBe(1);
	});

	it('should return sorted env vars', async () => {
		const result = await _sniffRouteFiles(
			'./endpoints/**/*.ts',
			routeAppsFixturesPath,
			routeAppsFixturesPath,
		);

		const sorted = [...result.envVars].sort();
		expect(result.envVars).toEqual(sorted);
	});
});

describe('sniffAppEnvironment with route-based apps', () => {
	// Integration tests for sniffAppEnvironment with route-based apps

	it('should use route sniffing for apps with routes config', async () => {
		const app: NormalizedAppConfig = {
			type: 'backend',
			path: routeAppsFixturesPath,
			port: 3000,
			dependencies: [],
			resolvedDeployTarget: 'dokploy',
			routes: './endpoints/**/*.ts',
			envParser: './src/config/env#envParser', // Should be ignored when routes exist
		};

		const result = await sniffAppEnvironment(app, 'api', routeAppsFixturesPath);

		expect(result.appName).toBe('api');
		expect(result.requiredEnvVars).toContain('DATABASE_URL');
		expect(result.requiredEnvVars).toContain('AUTH_SECRET');
		expect(result.requiredEnvVars).toContain('AUTH_URL');
	});

	it('should handle route pattern that matches no files', async () => {
		const app: NormalizedAppConfig = {
			type: 'backend',
			path: routeAppsFixturesPath,
			port: 3000,
			dependencies: [],
			resolvedDeployTarget: 'dokploy',
			routes: './nonexistent/**/*.ts',
		};

		const result = await sniffAppEnvironment(
			app,
			'api',
			routeAppsFixturesPath,
			{ logWarnings: false },
		);

		expect(result.appName).toBe('api');
		expect(result.requiredEnvVars).toEqual([]);
	});
});
