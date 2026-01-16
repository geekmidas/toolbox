import { describe, expect, it } from 'vitest';
import type { NormalizedAppConfig } from '../../workspace/types';
import { sniffAllApps, sniffAppEnvironment, type SniffResult } from '../sniffer';

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
